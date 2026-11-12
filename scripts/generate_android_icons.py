#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageOps
import sys

root = Path(__file__).resolve().parents[1]
source = root / "assets" / "quizinox-icon.png"
res = root / "android" / "app" / "src" / "main" / "res"
if not source.exists():
    raise SystemExit("Missing assets/quizinox-icon.png")
image = Image.open(source).convert("RGBA")
# Preserve the full circular emblem on a dark square background.
bg = Image.new("RGBA", image.size, (5, 7, 18, 255))
bg.alpha_composite(image)
image = bg.convert("RGB")
sizes = {"mdpi":48, "hdpi":72, "xhdpi":96, "xxhdpi":144, "xxxhdpi":192}
for density, size in sizes.items():
    folder = res / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    icon = ImageOps.fit(image, (size, size), method=Image.Resampling.LANCZOS)
    icon.save(folder / "ic_launcher.png", optimize=True)
    icon.save(folder / "ic_launcher_round.png", optimize=True)

# Adaptive launcher icon (Android 8+).
drawable = res / "drawable"
drawable.mkdir(parents=True, exist_ok=True)
ImageOps.fit(image, (432,432), method=Image.Resampling.LANCZOS).save(drawable / "ic_launcher_foreground.png", optimize=True)
anydpi = res / "mipmap-anydpi-v26"
anydpi.mkdir(parents=True, exist_ok=True)
(anydpi / "ic_launcher.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '  <background android:drawable="@color/ic_launcher_background"/>\n'
    '  <foreground android:drawable="@drawable/ic_launcher_foreground"/>\n'
    '</adaptive-icon>\n', encoding="utf-8")
(anydpi / "ic_launcher_round.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '  <background android:drawable="@color/ic_launcher_background"/>\n'
    '  <foreground android:drawable="@drawable/ic_launcher_foreground"/>\n'
    '</adaptive-icon>\n', encoding="utf-8")
values = res / "values"
values.mkdir(parents=True, exist_ok=True)
colors = values / "ic_launcher_background.xml"
colors.write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<resources><color name="ic_launcher_background">#050712</color></resources>\n',
    encoding="utf-8")
print("QUIZINOX launcher icons generated from uploaded logo.")
