#!/usr/bin/env python3
"""Generate QUIZINOX Android launcher icons from assets/quizinox-icon.png.

Why the icon did not show before: `npx cap add android` creates a default
vector `drawable-v24/ic_launcher_foreground.xml` (the Capacitor logo). On
Android 7+ that vector wins over a PNG in plain `drawable/`, so the adaptive
icon kept showing the default artwork. This script deletes every default
launcher resource first, then writes the QUIZINOX artwork into each density.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "quizinox-icon.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
BG = (5, 7, 18, 255)

if not SOURCE.exists():
    raise SystemExit("Missing assets/quizinox-icon.png")
if not RES.exists():
    raise SystemExit("Android project missing. Run `npx cap add android` first.")

src = Image.open(SOURCE).convert("RGBA")
bbox = src.getbbox() or (0, 0, *src.size)
emblem = src.crop(bbox)
side = max(emblem.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.alpha_composite(emblem, ((side - emblem.width) // 2, (side - emblem.height) // 2))

# 1) Remove all default launcher resources (vector + png) in every folder.
removed = 0
for folder in RES.iterdir():
    if not folder.is_dir() or not (folder.name.startswith("mipmap") or folder.name.startswith("drawable")):
        continue
    for f in folder.iterdir():
        if f.stem in ("ic_launcher", "ic_launcher_round", "ic_launcher_foreground", "ic_launcher_background"):
            f.unlink(); removed += 1

def legacy(size):
    """Full-bleed square icon: dark background + emblem (fills ~92%)."""
    canvas = Image.new("RGBA", (size, size), BG)
    inner = int(size * 0.92)
    e = square.resize((inner, inner), Image.Resampling.LANCZOS)
    canvas.alpha_composite(e, ((size - inner) // 2, (size - inner) // 2))
    return canvas.convert("RGB")

def round_icon(size):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    e = square.resize((size, size), Image.Resampling.LANCZOS)
    canvas.alpha_composite(e)
    return canvas

def foreground(size):
    """Adaptive foreground: 108dp canvas, emblem kept inside 72dp safe zone."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * 0.70)
    e = square.resize((inner, inner), Image.Resampling.LANCZOS)
    canvas.alpha_composite(e, ((size - inner) // 2, (size - inner) // 2))
    return canvas

densities = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}
for name, scale in densities.items():
    folder = RES / f"mipmap-{name}"
    folder.mkdir(parents=True, exist_ok=True)
    legacy(int(48 * scale)).save(folder / "ic_launcher.png", optimize=True)
    round_icon(int(48 * scale)).save(folder / "ic_launcher_round.png", optimize=True)
    foreground(int(108 * scale)).save(folder / "ic_launcher_foreground.png", optimize=True)

anydpi = RES / "mipmap-anydpi-v26"
anydpi.mkdir(parents=True, exist_ok=True)
xml = ('<?xml version="1.0" encoding="utf-8"?>\n'
       '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
       '    <background android:drawable="@color/ic_launcher_background"/>\n'
       '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
       '</adaptive-icon>\n')
(anydpi / "ic_launcher.xml").write_text(xml, encoding="utf-8")
(anydpi / "ic_launcher_round.xml").write_text(xml, encoding="utf-8")

values = RES / "values"
values.mkdir(parents=True, exist_ok=True)
(values / "ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<resources>\n    <color name="ic_launcher_background">#050712</color>\n</resources>\n',
    encoding="utf-8")

# Splash screen: replace the default Capacitor splash with the QUIZINOX emblem.
for folder in RES.iterdir():
    if folder.is_dir() and folder.name.startswith("drawable"):
        splash = folder / "splash.png"
        if splash.exists():
            w, h = Image.open(splash).size
            canvas = Image.new("RGBA", (w, h), BG)
            inner = int(min(w, h) * 0.42)
            e = square.resize((inner, inner), Image.Resampling.LANCZOS)
            canvas.alpha_composite(e, ((w - inner) // 2, (h - inner) // 2))
            canvas.convert("RGB").save(splash, optimize=True)

print(f"Removed {removed} default launcher files. QUIZINOX icons generated.")
