#!/usr/bin/env python3
"""Build the 1200x630 social card from the current desktop capture.

This is a local design asset, not part of the CI Pages build. Run it after
refreshing site/captures/desktop-library-dark.png.

Requires Pillow and DejaVu fonts (both available in the reference environment).
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CAPTURE = ROOT / 'site/captures/desktop-library-dark.png'
SYMBOL = ROOT / 'site/assets/branding/statocyst-symbol-128.png'
OUT = ROOT / 'site/assets/branding/og.jpg'

W, H = 1200, 630
BG = (5, 10, 24)
TEXT = (233, 244, 255)
MUTED = (169, 192, 216)
CYAN = (127, 233, 255)
SAND = (203, 185, 158)


def font(path, size):
    return ImageFont.truetype(path, size)


def main():
    capture = Image.open(CAPTURE).convert('RGB')
    symbol = Image.open(SYMBOL).convert('RGBA')

    canvas = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(canvas)

    # A quiet vertical wash, then a warm sand horizon at the bottom.
    for y in range(H):
        t = y / H
        r = int(5 + 14 * (1 - t))
        g = int(10 + 18 * (1 - t))
        b = int(24 + 22 * (1 - t))
        draw.line((0, y, W, y), fill=(r, g, b))
    draw.rectangle((0, H - 3, W, H), fill=SAND)

    # Screenshot panel.
    panel_w, panel_h = 660, 440
    panel = ImageOps_fit(capture, (panel_w, panel_h))
    panel = round_corners(panel, 18)
    px, py = 500, 95
    canvas.paste(panel, (px, py), panel)
    draw.rounded_rectangle((px, py, px + panel_w, py + panel_h), radius=18, outline=(148, 197, 255, 60), width=1)

    # Left-side brand lockup.
    logo = symbol.resize((86, 86), Image.LANCZOS)
    canvas.paste(logo, (64, 54), logo)
    draw.text((166, 66), 'Statocyst', font=font('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 38), fill=TEXT)
    draw.text((168, 108), 'A PLAYER FOR WHAT YOU OWN', font=font('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12), fill=CYAN)

    draw.text((64, 228), 'Your music.', font=font('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 48), fill=TEXT)
    draw.text((64, 286), 'Every depth.', font=font('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 48), fill=CYAN)
    draw.text((64, 362), 'Every screen and every source you own.', font=font('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18), fill=MUTED)
    draw.text((64, 390), 'Your files · Your own Jellyfin server', font=font('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18), fill=MUTED)
    draw.text((64, 416), 'Desktop · tablet · phone · Android Auto', font=font('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18), fill=MUTED)

    draw.line((64, 548, 412, 548), fill=(148, 197, 255, 80), width=1)
    version = json.loads((ROOT / 'package.json').read_text())['version']
    draw.text((64, 566), f'v{version}  ·  MIT  ·  github.com/cjrutherford/statocyst', font=font('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12), fill=MUTED)

    canvas.save(OUT, 'JPEG', quality=90, optimize=True)
    print(OUT)


def ImageOps_fit(image, size):
    # Center-crop to the target aspect, then resize.
    target_ratio = size[0] / size[1]
    ratio = image.width / image.height
    if ratio > target_ratio:
        new_w = int(image.height * target_ratio)
        left = (image.width - new_w) // 2
        image = image.crop((left, 0, left + new_w, image.height))
    else:
        new_h = int(image.width / target_ratio)
        top = (image.height - new_h) // 2
        image = image.crop((0, top, image.width, top + new_h))
    return image.resize(size, Image.LANCZOS)


def round_corners(image, radius):
    mask = Image.new('L', image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width, image.height), radius=radius, fill=255)
    out = image.convert('RGBA')
    out.putalpha(mask)
    return out


if __name__ == '__main__':
    main()
