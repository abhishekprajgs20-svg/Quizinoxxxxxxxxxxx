// Native helpers: saving/sharing files and the Android back button.
// In the browser it falls back to normal downloads.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';

export const isNative = () => Capacitor.isNativePlatform();

function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}

/**
 * Save a file. data = string (text) or Blob (binary, e.g. PDF).
 * Android: writes to Documents/QUIZINOX (falls back to app cache) and opens the share sheet
 * so the user can save to Downloads / Drive / WhatsApp / Telegram.
 */
export async function saveFile(name, data, mime = 'text/plain') {
  if (!isNative()) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement('a'); const url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { where: 'Downloads' };
  }
  const isText = typeof data === 'string';
  const payload = isText ? data : await blobToBase64(data);
  const opts = isText ? { encoding: Encoding.UTF8 } : {};
  let uri = null, where = 'Documents/QUIZINOX';
  try {
    const r = await Filesystem.writeFile({ path: `QUIZINOX/${name}`, data: payload, directory: Directory.Documents, recursive: true, ...opts });
    uri = r.uri;
  } catch {
    const r = await Filesystem.writeFile({ path: name, data: payload, directory: Directory.Cache, recursive: true, ...opts });
    uri = r.uri; where = 'share sheet';
  }
  try { await Share.share({ title: name, text: name, url: uri, dialogTitle: 'Save or share ' + name }); } catch { /* user closed the sheet */ }
  return { where };
}

export function onBackButton(handler) {
  if (!isNative()) return;
  App.addListener('backButton', () => handler(() => App.exitApp()));
}

/** Share a generated file. On browsers without file sharing, download it instead. */
export async function shareFile(name, data, mime = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  if (isNative()) return saveFile(name, blob, mime);
  const file = new File([blob], name, { type: mime });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    await navigator.share({ files: [file], title: name });
    return { where: 'share sheet' };
  }
  return saveFile(name, blob, mime);
}
