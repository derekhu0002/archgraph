# -*- coding: utf-8 -*-
"""Generate a themed 900x383 banner for the OpenClaw support WeChat article.

Theme: "your personal AI assistant can finally read the architecture graph".
Visual: a dark tech-blue blueprint background with a grid, an AI-assistant chat
bubble on the left, an architecture graph (nodes + edges) on the right, and a
dashed connector between them. Text (zh/fallback en) is drawn with Microsoft
YaHei / Arial. Rendered at 2x and downscaled for smooth lines. Requires Pillow.
"""
from PIL import Image, ImageDraw, ImageFont
import os
import math

W, H = 900, 383
SS = 2  # supersample factor
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'diagrams', 'openclaw-banner.png')

# Palette (ArchGraph accent on dark).
BG_TOP = (10, 16, 34)
BG_BOTTOM = (30, 42, 86)
ACCENT = (77, 107, 254)
GRID = (120, 140, 200, 26)
NODE = (58, 84, 190)
NODE_HI = (110, 138, 255)
EDGE = (130, 155, 230, 180)
WHITE = (255, 255, 255)
MUTED = (168, 180, 216)

FONT_DIR = 'C:/Windows/Fonts'


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def font(size, zh=True, bold=False):
    if zh:
        cands = [
            os.path.join(FONT_DIR, 'msyhbd.ttc' if bold else 'msyh.ttc'),
        ]
    else:
        cands = [
            os.path.join(FONT_DIR, 'arialbd.ttf' if bold else 'arial.ttf'),
            os.path.join(FONT_DIR, 'segoeuib.ttf' if bold else 'segoeui.ttf'),
        ]
    for c in cands:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_grid(d):
    for x in range(0, W * SS, 40 * SS):
        d.line([(x, 0), (x, H * SS)], fill=GRID)
    for y in range(0, H * SS, 40 * SS):
        d.line([(0, y), (W * SS, y)], fill=GRID)


def draw_assistant(d):
    """AI-assistant chat bubble with a simple robot head + spark."""
    bx, by, bw, bh = 56 * SS, 150 * SS, 300 * SS, 150 * SS
    r = 26 * SS
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=r,
                        fill=(20, 30, 62, 235), outline=ACCENT, width=3 * SS)
    d.polygon([(bx + 48 * SS, by + bh - 8 * SS),
               (bx + 78 * SS, by + bh + 22 * SS),
               (bx + 108 * SS, by + bh - 2 * SS)], fill=(20, 30, 62, 235))
    # robot head
    hx, hy = bx + 72 * SS, by + 52 * SS
    hr = 46 * SS
    d.rounded_rectangle([hx - hr, hy - hr, hx + hr, hy + hr], radius=hr,
                        fill=(36, 52, 112, 255), outline=ACCENT, width=3 * SS)
    d.line([(hx, hy - hr), (hx, hy - hr - 16 * SS)], fill=ACCENT, width=3 * SS)
    d.ellipse([hx - 5 * SS, hy - hr - 22 * SS, hx + 5 * SS, hy - hr - 12 * SS],
              fill=ACCENT)
    for ex in (hx - 16 * SS, hx + 16 * SS):
        d.ellipse([ex - 6 * SS, hy - 8 * SS, ex + 6 * SS, hy + 8 * SS], fill=WHITE)
    d.rounded_rectangle([hx - 14 * SS, hy + 16 * SS, hx + 14 * SS, hy + 22 * SS],
                        radius=3 * SS, fill=ACCENT)
    # spark beside head
    sxp, syp = bx + bw - 60 * SS, by + 48 * SS
    r1, r2 = 16 * SS, 7 * SS
    pts = []
    for i in range(8):
        ang = math.pi * i / 4
        rr = r1 if i % 2 == 0 else r2
        pts.append((sxp + rr * math.cos(ang), syp + rr * math.sin(ang)))
    d.polygon(pts, fill=ACCENT)
    # label
    fl = font(19 * SS, zh=True, bold=True)
    d.text((bx + 150 * SS, by + 52 * SS), "OpenClaw 个人 AI 助手", font=fl, fill=WHITE)


def draw_graph(d):
    """Architecture graph: hub node + satellites connected by edges."""
    gx, gy = 640 * SS, 240 * SS
    r = 34 * SS
    sat = [
        (520 * SS, 150 * SS),
        (770 * SS, 130 * SS),
        (840 * SS, 250 * SS),
        (760 * SS, 330 * SS),
        (560 * SS, 330 * SS),
    ]
    for (sx, sy) in sat:
        d.line([(gx, gy), (sx, sy)], fill=EDGE, width=3 * SS)
    d.ellipse([gx - r, gy - r, gx + r, gy + r], fill=NODE_HI, outline=WHITE, width=3 * SS)
    d.text((gx - 22 * SS, gy - 14 * SS), "KG", font=font(24 * SS, zh=False, bold=True),
           fill=WHITE)
    for (sx, sy) in sat:
        sr = 13 * SS
        d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=NODE, outline=ACCENT, width=2 * SS)


def draw_connector(d):
    """Dashed line + plug node linking assistant to the graph."""
    x0, y0 = 356 * SS, 225 * SS
    x1, y1 = 520 * SS, 240 * SS
    steps = 60
    dash = 8 * SS
    n = 0
    for i in range(steps):
        t = i / steps
        x = int(x0 + (x1 - x0) * t)
        y = int(y0 + (y1 - y0) * t)
        if n < dash:
            d.point((x, y), fill=ACCENT)
        n += 1
        if n > 2 * dash:
            n = 0
    d.ellipse([x1 - 10 * SS, y1 - 10 * SS, x1 + 10 * SS, y1 + 10 * SS],
              fill=ACCENT, outline=WHITE, width=2 * SS)


def main():
    img = Image.new('RGB', (W * SS, H * SS))
    d = ImageDraw.Draw(img)
    for y in range(H * SS):
        t = y / (H * SS - 1)
        d.line([(0, y), (W * SS, y)], fill=lerp(BG_TOP, BG_BOTTOM, t))
    draw_grid(d)

    glow = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * SS * 0.18, H * SS * 0.05, W * SS * 0.92, H * SS * 1.1],
               fill=(77, 107, 254, 42))
    img = Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')
    d = ImageDraw.Draw(img)

    draw_assistant(d)
    draw_graph(d)
    draw_connector(d)

    # brand chip
    chip = "ArchGraph"
    fb = font(20 * SS, zh=False, bold=True)
    cw = d.textlength(chip, font=fb)
    cx, cy = 44 * SS, 40 * SS
    d.rounded_rectangle([cx, cy, cx + cw + 26 * SS, cy + 40 * SS], radius=20 * SS,
                        fill=ACCENT)
    d.text((cx + 13 * SS, cy + 9 * SS), chip, font=fb, fill=WHITE)

    # headline
    fh = font(40 * SS, zh=True, bold=True)
    head = "个人 AI 助手，也能看懂你的架构图"
    d.text((44 * SS, 250 * SS), head, font=fh, fill=WHITE)

    # sub
    fs = font(19 * SS, zh=True, bold=False)
    sub = "规则 · argo-init 技能 · argo MCP —— 一条命令装进 OpenClaw"
    d.text((44 * SS, 312 * SS), sub, font=fs, fill=MUTED)

    # accent bar
    d.rounded_rectangle([44 * SS, 356 * SS, 250 * SS, 362 * SS], radius=3 * SS,
                        fill=ACCENT)

    img = img.resize((W, H), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT)
    print('wrote', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
