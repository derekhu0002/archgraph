# -*- coding: utf-8 -*-
"""Generate a themed 900x383 banner for the OpenClaw support WeChat article.

Consistent with the existing docs/diagrams/*banner*.png style: a dark-tech
gradient background, the ArchGraph brand chip and an "OpenClaw" headline.
Requires Pillow.
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 900, 383
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'diagrams', 'openclaw-banner.png')

# Dark blue-ish tech gradient (matches ArchGraph accent #4d6bfe on dark).
TOP = (15, 23, 42)
BOTTOM = (37, 49, 90)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


img = Image.new('RGB', (W, H))
d = ImageDraw.Draw(img)

# vertical gradient
for y in range(H):
    t = y / (H - 1)
    d.line([(0, y), (W, y)], fill=lerp(TOP, BOTTOM, t))

# subtle glow behind the title
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([W * 0.18, H * 0.05, W * 0.92, H * 1.1], fill=(77, 107, 254, 40))
img = Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')
d = ImageDraw.Draw(img)

def font(size, bold=False):
    # Prefer a common UI font; fall back to default.
    for cand in (
        'C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',
        'C:/Windows/Fonts/segoeuib.ttf' if bold else 'C:/Windows/Fonts/segoeui.ttf',
    ):
        if os.path.exists(cand):
            return ImageFont.truetype(cand, size)
    return ImageFont.load_default()

f_brand = font(22, bold=True)
f_head = font(52, bold=True)
f_sub = font(20)

# brand chip
chip = "ArchGraph"
cw = d.textlength(chip, font=f_brand)
cx, cy = 48, 46
d.rounded_rectangle([cx, cy, cx + cw + 28, cy + 42], radius=21, fill=(77, 107, 254, 255))
d.text((cx + 14, cy + 10), chip, font=f_brand, fill=(255, 255, 255))

# headline
head = "Now on OpenClaw"
d.text((48, 150), head, font=f_head, fill=(255, 255, 255))

# sub
sub = "Rules · argo-init skill · argo MCP server"
d.text((48, 228), sub, font=f_sub, fill=(180, 192, 220))

# accent bar
d.rounded_rectangle([48, 300, 320, 312], radius=6, fill=(77, 107, 254, 255))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT)
print('wrote', os.path.abspath(OUT))
