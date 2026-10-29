"""Builds the Play Store icon (512x512) and feature graphic (1024x500) from resources/icons/statocyst-512.png.

Run: python3 -I tools/make-store-graphics.py   (needs Pillow)
Output: store/graphics/icon-512.png, store/graphics/feature-graphic-1024x500.png
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
src = root / "resources/icons/statocyst-512.png"
out = root / "store/graphics"
out.mkdir(parents=True, exist_ok=True)

art = Image.open(src).convert("RGBA")

# Play applies its own corner mask, so crop the margin off and ship a full-bleed square.
icon = art.crop((34, 34, 478, 478)).resize((512, 512), Image.LANCZOS).convert("RGB")
icon.save(out / "icon-512.png", optimize=True)

W, H = 1024, 500
top, bottom = (4, 8, 28), (14, 24, 78)
canvas = Image.new("RGB", (W, H))
px = canvas.load()
for y in range(H):
    t = y / (H - 1)
    row = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    for x in range(W):
        px[x, y] = row
canvas = canvas.convert("RGBA")
mark = art.crop((34, 34, 478, 478)).resize((380, 380), Image.LANCZOS)
mask = Image.new("L", mark.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, 379, 379), radius=84, fill=255)
canvas.paste(mark, (70, 60), mask)

d = ImageDraw.Draw(canvas)
bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
reg = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
d.text((500, 140), "Statocyst", font=ImageFont.truetype(bold, 84), fill=(240, 244, 255))
d.text((504, 252), "Your music. Your server.", font=ImageFont.truetype(reg, 34), fill=(170, 190, 255))
d.text((504, 304), "Local files + Jellyfin  |  Offline  |  Android Auto", font=ImageFont.truetype(reg, 22), fill=(130, 150, 220))
canvas.convert("RGB").save(out / "feature-graphic-1024x500.png", optimize=True)
