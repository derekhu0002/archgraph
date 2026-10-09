'use strict';

/**
 * Rasterize the deck SVGs (docs/ppt/assets/*.svg) into the PPTX-ready PNGs.
 *
 *   node scripts/rasterize-coding-deck.js [--scale 2.5]
 *
 * Width is fixed: 1600 px (16:9), height 900 px. The SVG is 1280x720, so the
 * resvg scale factor is 1600/1280 = 1.25 by default.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'ppt', 'assets');
const TARGET_W = 1600;

function main() {
  const pages = fs
    .readdirSync(DIR)
    .filter((f) => /^p\d.*\.svg$/.test(f))
    .sort();
  const out = [];
  for (const f of pages) {
    const svg = fs.readFileSync(path.join(DIR, f), 'utf8');
    const m = svg.match(/width="(\d+)" height="(\d+)"/);
    const srcW = Number(m[1]);
    const scale = TARGET_W / srcW;
    const img = new Resvg(svg, {
      fitTo: { mode: 'zoom', value: scale },
      font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei' },
    }).render();
    const png = path.join(DIR, f.replace(/\.svg$/, '.png'));
    fs.writeFileSync(png, img.asPng());
    out.push({ svg: f, png: path.basename(png), w: img.width, h: img.height, bytes: img.asPng().length });
    console.log(`rasterized ${f} -> ${path.basename(png)} (${img.width}x${img.height}, ${img.asPng().length} bytes)`);
  }
  if (!out.length) throw new Error('no deck SVGs found in docs/ppt/assets');
  return out;
}

if (require.main === module) main();

module.exports = { main };
