# -*- coding: utf-8 -*-
"""Generate a themed 900x383 banner for the memory-eval WeChat article.

Theme: "give the Agent's long-term memory a benchmark ruler".
Visual: a dark tech-blue blueprint background with a grid; on the left a stack
of layered memory cards (the layered SUBVIEW long-term memory), on the right a
scorecard showing the real measured numbers (23/23, 100%); headline + sub line.
Numbers drawn are the actual measured baseline (23 questions, 100%, ~5.7ms) —
no fabricated content. Rendered at 2x and downscaled for smooth lines.
Requires Pillow.
"""
from PIL import Image, ImageDraw, ImageFont
import os
import math

W, H = 900, 383
SS = 2  # supersample factor
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'diagrams', 'mem-eval-banner.png')

# Palette (ArchGraph accent on dark).
BG_TOP = (10, 16, 34)
BG_BOTTOM = (30, 42, 86)
ACCENT = (77, 107, 254)
GREEN = (72, 200, 140)
GRID = (120, 140, 200, 26)
CARD = (24, 36, 76, 235)
CARD_BORDER = (96, 122, 220, 255)
NODE = (58, 84, 190)
WHITE = (255, 255, 255)
MUTED = (168, 180, 216)

FONT_DIR = 'C:/Windows/Fonts'


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def font(size, zh=True, bold=False):
    if zh:
        cands = [os.path.join(FONT_DIR, 'msyhbd.ttc' if bold else 'msyh.ttc')]
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


def draw_memory_cards(d):
    """Left: a stack of layered memory cards (layered SUBVIEW long-term memory)."""
    cx, cy, cw, ch = 70 * SS, 118 * SS, 300 * SS, 110 * SS
    r = 18 * SS
    for i, off in enumerate([14, 7, 0]):
        x, y = cx + off * SS, cy + off * SS
        fill = (30 + i * 8, 44 + i * 8, 96 + i * 10, 235)
        d.rounded_rectangle([x, y, x + cw, y + ch], radius=r, fill=fill, outline=CARD_BORDER, width=2 * SS)
    # top card label
    fl = font(15 * SS, zh=True, bold=True)
    d.text((cx + 22 * SS, cy + 20 * SS), "记忆层 SUBVIEW", font=fl, fill=WHITE)
    # a few fake "book" lines
    fs = font(12 * SS, zh=False, bold=False)
    for i in range(3):
        bx = cx + 22 * SS
        by = cy + 52 * SS + i * 20 * SS
        d.rounded_rectangle([bx, by, bx + 180 * SS, by + 12 * SS], radius=6 * SS,
                            fill=(90, 116, 190, 180))
        d.rounded_rectangle([bx + 190 * SS, by, bx + 258 * SS, by + 12 * SS], radius=6 * SS,
                            fill=(58, 84, 150, 180))


def draw_scorecard(d):
    """Right: scorecard panel with real measured numbers 23/23 and 100%."""
    sx, sy, sw, sh = 600 * SS, 108 * SS, 250 * SS, 128 * SS
    r = 22 * SS
    d.rounded_rectangle([sx, sy, sx + sw, sy + sh], radius=r,
                        fill=(18, 28, 58, 235), outline=ACCENT, width=3 * SS)
    # big 23/23
    fb = font(42 * SS, zh=False, bold=True)
    d.text((sx + 26 * SS, sy + 18 * SS), "23/23", font=fb, fill=WHITE)
    # 100% in green with checkmark
    fg = font(30 * SS, zh=False, bold=True)
    d.text((sx + 150 * SS, sy + 30 * SS), "100%", font=fg, fill=GREEN)
    # checkmark
    px = sx + 132 * SS
    py = sy + 92 * SS
    d.polygon([(px, py), (px + 12 * SS, py + 18 * SS), (px + 30 * SS, py - 10 * SS)],
              fill=GREEN)
    fl = font(14 * SS, zh=True, bold=False)
    d.text((sx + 42 * SS, sy + 92 * SS), "整体 100% · 拒答 100%", font=fl, fill=MUTED)


def main():
    img = Image.new('RGB', (W * SS, H * SS))
    d = ImageDraw.Draw(img)
    for y in range(H * SS):
        t = y / (H * SS - 1)
        d.line([(0, y), (W * SS, y)], fill=lerp(BG_TOP, BG_BOTTOM, t))
    draw_grid(d)

    glow = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * SS * 0.2, H * SS * 0.0, W * SS * 0.95, H * SS * 1.1],
               fill=(77, 107, 254, 42))
    img = Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')
    d = ImageDraw.Draw(img)

    draw_memory_cards(d)
    draw_scorecard(d)

    # brand chip
    chip = "ArchGraph"
    fb = font(20 * SS, zh=False, bold=True)
    cw = d.textlength(chip, font=fb)
    cx, cy = 44 * SS, 40 * SS
    d.rounded_rectangle([cx, cy, cx + cw + 26 * SS, cy + 40 * SS], radius=20 * SS, fill=ACCENT)
    d.text((cx + 13 * SS, cy + 9 * SS), chip, font=fb, fill=WHITE)

    # headline
    fh = font(38 * SS, zh=True, bold=True)
    head = "给 Agent 的长期记忆，立一把评测的尺子"
    d.text((44 * SS, 252 * SS), head, font=fh, fill=WHITE)

    # sub
    fs = font(19 * SS, zh=True, bold=False)
    sub = "5 能力 · 23 题 · 整体 100% · 平均单题约 5.7ms"
    d.text((44 * SS, 316 * SS), sub, font=fs, fill=MUTED)

    # accent bar
    d.rounded_rectangle([44 * SS, 358 * SS, 260 * SS, 364 * SS], radius=3 * SS, fill=ACCENT)

    img = img.resize((W, H), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT)
    print('wrote', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
