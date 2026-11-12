#!/usr/bin/env python3
# QUIZINOX v2 — GitHub repository uploader + Android APK downloader
# Usage: keep this file inside (or next to) the QUIZINOX project folder and run:
#   python upload_to_github.py
# Install dependency: python -m pip install requests
import base64, getpass, os, sys, time, zipfile, io, traceback
try:
    import requests
except ImportError:
    print("Missing requests. Run: python -m pip install requests")
    input("Press Enter to exit..."); sys.exit(1)

API = "https://api.github.com"
HERE = os.path.dirname(os.path.abspath(__file__))
# Accept both supported layouts:
# 1) uploader.py beside the project folder
# 2) uploader.py placed directly inside the project folder (as in the user's screenshot)
def find_project_dir():
    candidates = [
        HERE,
        os.path.join(HERE, "QUIZINOX"),
        os.path.join(HERE, "QUIZINOX_Offline_Android"),
        os.path.join(os.path.dirname(HERE), "QUIZINOX"),
        os.path.join(os.path.dirname(HERE), "QUIZINOX_Offline_Android"),
    ]
    for candidate in candidates:
        if (os.path.isfile(os.path.join(candidate, "package.json"))
                and os.path.isfile(os.path.join(candidate, "capacitor.config.json"))
                and os.path.isdir(os.path.join(candidate, "src"))
                and os.path.isdir(os.path.join(candidate, ".github", "workflows"))):
            return os.path.abspath(candidate)
    return None

PROJECT_DIR = find_project_dir()
BATCH = 1_500_000
SKIP_DIRS = {"node_modules", ".git", "dist", "android", "__pycache__", ".vite", ".idea", ".vscode"}
SKIP_FILES = {".DS_Store", "Thumbs.db", "QUIZINOX.apk", "package-lock.json"}

class UploadError(Exception): pass

def api(method, path, token, **kwargs):
    headers = {"Authorization":"Bearer "+token, "Accept":"application/vnd.github+json",
               "X-GitHub-Api-Version":"2022-11-28"}
    for attempt in range(1,8):
        try:
            r=requests.request(method, API+path, headers=headers, timeout=90, **kwargs)
        except requests.RequestException as e:
            print(f"Network issue ({type(e).__name__}), retry {attempt}/7...")
            time.sleep(attempt*3); continue
        if r.status_code==429 or (r.status_code==403 and any(x in r.text.lower() for x in ("rate limit","abuse","secondary"))):
            wait=int(r.headers.get("Retry-After",0) or 20*attempt)
            print(f"GitHub rate limit; waiting {wait}s..."); time.sleep(wait); continue
        if r.status_code>=500:
            print(f"GitHub server error {r.status_code}; retrying..."); time.sleep(attempt*4); continue
        return r
    raise UploadError(f"GitHub API failed repeatedly: {method} {path}")

def collect():
    if not PROJECT_DIR:
        raise UploadError(
            "App project files were not found. Keep package.json, capacitor.config.json, "
            "src\\ and .github\\workflows together with this uploader, or place the "
            "QUIZINOX_Offline_Android project folder beside this script."
        )
    print("Project folder detected:", PROJECT_DIR)
    out=[]
    for dp,dn,fn in os.walk(PROJECT_DIR):
        dn[:]=[d for d in dn if d not in SKIP_DIRS]
        for name in fn:
            if name in SKIP_FILES: continue
            full=os.path.join(dp,name)
            rel=os.path.relpath(full,PROJECT_DIR).replace(os.sep,"/")
            out.append((rel,full))
    if not out: raise UploadError("No project files found.")
    return out

def entries_for(token, repo, files):
    out=[]
    for rel,full in files:
        data=open(full,"rb").read()
        mode="100755" if rel.endswith("gradlew") else "100644"
        try:
            txt=data.decode("utf-8")
            if "\x00" in txt: raise UnicodeDecodeError("utf8",b"",0,1,"binary")
            out.append(({"path":rel,"mode":mode,"type":"blob","content":txt},len(data)))
        except UnicodeDecodeError:
            r=api("POST",repo+"/git/blobs",token,json={"content":base64.b64encode(data).decode(),"encoding":"base64"})
            if r.status_code!=201: raise UploadError(f"Binary upload failed for {rel}: {r.status_code} {r.text[:200]}")
            out.append(({"path":rel,"mode":mode,"type":"blob","sha":r.json()["sha"]},200))
        print("  Prepared:",rel)
    return out

def commit(token,repo,branch,parent,base_tree,entries):
    batches=[]; cur=[]; size=0
    for item,n in entries:
        if cur and size+n>BATCH: batches.append(cur);cur=[];size=0
        cur.append(item);size+=n
    if cur:batches.append(cur)
    tree=base_tree
    for i,b in enumerate(batches,1):
        r=api("POST",repo+"/git/trees",token,json={"base_tree":tree,"tree":b})
        if r.status_code!=201:raise UploadError(f"Git tree failed: {r.status_code} {r.text[:300]}")
        tree=r.json()["sha"];print(f"  Uploaded tree batch {i}/{len(batches)}")
    r=api("POST",repo+"/git/commits",token,json={"message":"QUIZINOX v2: quiz navigation, coaching PDF converters, launcher icon fix","tree":tree,"parents":[parent]})
    if r.status_code!=201:raise UploadError(f"Commit failed: {r.status_code} {r.text[:300]}")
    sha=r.json()["sha"]
    r=api("PATCH",repo+"/git/refs/heads/"+branch,token,json={"sha":sha})
    if r.status_code!=200:raise UploadError(f"Branch update failed: {r.status_code} {r.text[:300]}")
    return sha

def wait_download(token,repo,sha,username,repo_name):
    print("\nWaiting for GitHub Actions to build the APK (usually 5–15 minutes)...")
    run=None
    for _ in range(60):
        r=api("GET",repo+"/actions/runs?head_sha="+sha,token)
        if r.status_code==200:
            runs=r.json().get("workflow_runs",[])
            if runs:run=runs[0];break
        time.sleep(10)
    actions=f"https://github.com/{username}/{repo_name}/actions"
    if not run:
        print("Workflow not detected yet. Check:",actions);return
    rid=run["id"];started=time.time()
    while time.time()-started<45*60:
        r=api("GET",repo+f"/actions/runs/{rid}",token)
        if r.status_code==200:
            run=r.json()
            if run.get("status")=="completed":break
        print(f"  Build status: {run.get('status','queued')}...")
        time.sleep(20)
    if run.get("conclusion")!="success":
        print("\nAPK build did not succeed. Open Actions for logs:",actions)
        return
    r=api("GET",repo+f"/actions/runs/{rid}/artifacts",token)
    arts=r.json().get("artifacts",[]) if r.status_code==200 else []
    art=next((x for x in arts if x["name"]=="QUIZINOX-APK"),None)
    if not art:
        print("Build completed, but APK artifact not found:",actions);return
    print("Build successful. Downloading APK...")
    r=requests.get(art["archive_download_url"],headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json"},timeout=300)
    if r.status_code!=200:
        print("Auto-download failed. Download artifact from:",actions);return
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        apk=next((n for n in z.namelist() if n.lower().endswith(".apk")),None)
        if not apk:raise UploadError("Artifact archive did not contain an APK.")
        dest=os.path.join(HERE,"QUIZINOX.apk")
        with open(dest,"wb") as f:f.write(z.read(apk))
    print("\nSUCCESS — APK saved here:\n",dest)
    print("GitHub repository:",f"https://github.com/{username}/{repo_name}")
    print("Install the APK on Android. This is a debug build for direct testing.")

def main():
    print("="*58+"\n QUIZINOX — OFFLINE ANDROID APP UPLOADER\n"+"="*58)
    files=collect()
    print(f"\nProject files found: {len(files)}")
    repo_name=input("GitHub repository name: ").strip()
    username=input("GitHub username: ").strip()
    token=getpass.getpass("GitHub Personal Access Token (PAT): ").strip()
    if not all((repo_name,username,token)):raise UploadError("Repository name, username and PAT are required.")
    if "/" in repo_name or " " in repo_name:raise UploadError("Use a valid repository name without spaces or slash.")
    r=api("GET","/user",token)
    if r.status_code!=200:raise UploadError(f"PAT validation failed: {r.status_code} {r.text[:200]}")
    actual=r.json()["login"]
    if actual.lower()!=username.lower():
        print(f"Note: PAT belongs to @{actual}; using the authenticated account.")
    username=actual
    repo=f"/repos/{username}/{repo_name}"
    r=api("GET",repo,token)
    if r.status_code==404:
        r=api("POST","/user/repos",token,json={"name":repo_name,"description":"QUIZINOX offline-first Android quiz app","private":False,"auto_init":True})
        if r.status_code!=201:raise UploadError(f"Could not create repository: {r.status_code} {r.text[:300]}")
        branch=r.json().get("default_branch","main")
        print("Repository created.")
    elif r.status_code==200:
        branch=r.json().get("default_branch","main")
        print("Repository already exists; updating it.")
    else:raise UploadError(f"Repository check failed: {r.status_code} {r.text[:250]}")
    r=api("GET",repo+"/git/ref/heads/"+branch,token)
    if r.status_code!=200:raise UploadError(f"Could not read branch: {r.status_code} {r.text[:250]}")
    parent=r.json()["object"]["sha"]
    r=api("GET",repo+"/git/commits/"+parent,token)
    if r.status_code!=200:raise UploadError("Could not read current commit.")
    tree=r.json()["tree"]["sha"]
    print("\nUploading app source and Android build workflow...")
    sha=commit(token,repo,branch,parent,tree,entries_for(token,repo,files))
    print(f"\nUpload complete: https://github.com/{username}/{repo_name}")
    wait_download(token,repo,sha,username,repo_name)

if __name__=="__main__":
    try:main()
    except KeyboardInterrupt:print("\nCancelled.")
    except Exception as e:print("\nERROR:",e);traceback.print_exc()
    input("\nPress Enter to close...")
