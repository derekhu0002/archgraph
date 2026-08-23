# -*- coding: utf-8 -*-
"""媒体艺术家 — 将生成的配图压缩到 <1MB（微信 uploadimg 限制）。
PNG 无损重编码（optimize=True），export 图缩放到 1152x648，其余保持 1280x720。
"""
from PIL import Image
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIAGRAMS = os.path.join(ROOT, 'docs', 'diagrams')

SPECS = {
    'skill-coevolution-banner.png': (1280, 720),
    'skill-coevolution-mount.png': (1280, 720),
    'skill-coevolution-refine.png': (1280, 720),
    'skill-coevolution-export.png': (1152, 648),
}

for name, size in SPECS.items():
    p = os.path.join(DIAGRAMS, name)
    im = Image.open(p).convert('RGB')
    if im.size != size:
        im = im.resize(size, Image.LANCZOS)
    im.save(p, 'PNG', optimize=True)
    kb = os.path.getsize(p) / 1024
    print(f'{name} -> {im.size[0]}x{im.size[1]} {kb:.0f}KB')
    if kb >= 1024:
        print(f'  WARNING {name} still >= 1MB')
