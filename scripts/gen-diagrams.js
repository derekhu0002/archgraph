'use strict';

/**
 * Generate the dark, on-brand diagrams embedded by README.md and index.html.
 *
 *   node scripts/gen-diagrams.js          # write the SVGs into docs/diagrams/
 *   node scripts/gen-diagrams.js --check  # also rasterize each SVG to validate it parses
 *
 * Output (self-contained SVG, no external fonts/CSS):
 *   docs/diagrams/core-model.svg          unified-language core model
 *   docs/diagrams/global-architecture.svg Layered Viewpoint
 *   docs/diagrams/cap-federation.svg      federated graph sharing
 *   docs/diagrams/cap-memory-tiers.svg    three-tier memory
 *   docs/diagrams/cap-lean-reads.svg      token-efficient reads
 */

const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'diagrams');
const FONT = "ui-monospace, 'Cascadia Code', 'Segoe UI', Consolas, 'Courier New', monospace";

const C = {
  bg: '#0a0e1a',
  grid: '#17203a',
  text: '#eef1f6',
  muted: '#94a3b8',
  faint: '#64748b',
  blue: { f: 'rgba(107,140,255,0.14)', s: '#6b8cff' },
  cyan: { f: 'rgba(34,211,238,0.12)', s: '#22d3ee' },
  green: { f: 'rgba(52,211,153,0.12)', s: '#34d399' },
  violet: { f: 'rgba(167,139,250,0.14)', s: '#a78bfa' },
  amber: { f: 'rgba(251,191,36,0.12)', s: '#fbbf24' },
  rose: { f: 'rgba(251,113,133,0.12)', s: '#fb7185' },
  slate: { f: 'rgba(148,163,184,0.10)', s: '#94a3b8' },
};

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function text(x, y, s, o = {}) {
  const { size = 12, fill = C.text, anchor = 'start', weight = 400, opacity = 1, letter = 0 } = o;
  return (
    `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}"` +
    ` fill="${fill}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${letter}">${esc(s)}</text>`
  );
}

function box(x, y, w, h, color, o = {}) {
  const { rx = 10, dash = '', width = 1.5, fillOverride } = o;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fillOverride || color.f}"` +
    ` stroke="${color.s}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
  );
}

function blabel(x, y, w, h, title, subs = [], o = {}) {
  const cx = x + w / 2;
  const tsize = o.titleSize || 15;
  const subSize = o.subSize || 10.5;
  const LH = o.lh || 16;
  const n = 1 + subs.length;
  const first = y + h / 2 - ((n - 1) * LH) / 2 + tsize * 0.35;
  const out = [text(cx, first, title, { size: tsize, weight: 600, anchor: 'middle', fill: o.titleFill || C.text })];
  subs.forEach((s, i) =>
    out.push(text(cx, first + (i + 1) * LH, s, { size: subSize, anchor: 'middle', fill: C.muted }))
  );
  return out.join('');
}

function band(x, y, w, h, label) {
  return (
    box(x, y, w, h, C.slate, { dash: '7 7', width: 1.2, fillOverride: 'transparent', rx: 12 }) +
    text(x + 14, y + 20, label, { size: 10.5, fill: C.faint, weight: 700, letter: 1 })
  );
}

const MARKERS = Object.entries({
  blue: C.blue.s, cyan: C.cyan.s, green: C.green.s, violet: C.violet.s, amber: C.amber.s, slate: C.slate.s, rose: C.rose.s,
})
  .map(
    ([k, v]) =>
      `<marker id="m-${k}" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L8,3 z" fill="${v}"/></marker>`
  )
  .join('');

function arrow(x1, y1, x2, y2, o = {}) {
  const { stroke = C.blue.s, marker = 'm-blue', dash = '', width = 1.6 } = o;
  return (
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"` +
    `${dash ? ` stroke-dasharray="${dash}"` : ''} marker-end="url(#${marker})"/>`
  );
}

function elabel(x, y, s, o = {}) {
  return text(x, y, s, { size: 10.5, fill: C.muted, anchor: 'middle', ...o });
}

function svg(viewBox, aria, body) {
  const [x, y, w, h] = viewBox.split(' ').map(Number);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" role="img" aria-label="${esc(aria)}">\n` +
    `<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="${C.grid}" stroke-width="1"/></pattern>${MARKERS}</defs>\n` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${C.bg}"/>\n` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#grid)"/>\n` +
    `${body}\n</svg>\n`
  );
}

/* ------------------------------------------------------------------ */
/* 1. Global architecture — Layered Viewpoint                          */
/* ------------------------------------------------------------------ */
function genGlobalArchitecture() {
  const b = [];
  b.push(text(34, 44, 'Graph-driven Agentic Engineering · Layered Viewpoint', { size: 21, weight: 700 }));
  b.push(text(34, 66, 'one intent architecture graph, read and written through a single MCP interface', { size: 12, fill: C.muted }));

  b.push(band(28, 84, 944, 112, 'ACTOR / ROLE LAYER'));
  b.push(band(28, 216, 944, 112, 'BUSINESS / PROCESS LAYER'));
  b.push(band(28, 348, 944, 120, 'APPLICATION LAYER'));
  b.push(band(28, 488, 944, 132, 'TECHNOLOGY / DATA LAYER'));
  b.push(band(28, 640, 944, 104, 'META-MODEL'));

  b.push(box(400, 110, 200, 58, C.blue) + blabel(400, 110, 200, 58, '人类 (Human)', ['the human partner']));
  b.push(box(370, 246, 260, 62, C.green) + blabel(370, 246, 260, 62, 'AGENT', ['agentic engineering']));
  b.push(box(70, 376, 210, 64, C.cyan) + blabel(70, 376, 210, 64, 'Federation', ['registry · by reference']));
  b.push(box(390, 376, 220, 64, C.amber) + blabel(390, 376, 220, 64, 'ARGO MCP', ['intent-graph tools']));
  b.push(box(720, 376, 210, 64, C.amber) + blabel(720, 376, 210, 64, 'EA', ['Enterprise Architect (.qea)']));
  b.push(
    box(80, 512, 270, 88, C.violet) +
      text(215, 542, 'graph', { size: 15, weight: 600, anchor: 'middle' }) +
      text(215, 562, 'intent architecture graph', { size: 10.5, anchor: 'middle', fill: C.muted }) +
      text(215, 580, 'SystemArchitecture.json', { size: 10.5, anchor: 'middle', fill: C.muted })
  );
  b.push(box(430, 524, 220, 64, C.green) + blabel(430, 524, 220, 64, 'Neo4j', ['graph database · sync']));
  b.push(box(70, 662, 420, 60, C.slate) + blabel(70, 662, 420, 60, 'ArchiMate 3.2', ['AML extension · schema + rules (.argo/schema)']));

  b.push(arrow(500, 168, 500, 246, { stroke: C.blue.s, marker: 'm-blue' }));
  b.push(elabel(512, 208, 'instructs · work packages', { anchor: 'start' }));
  b.push(arrow(500, 308, 500, 376, { stroke: C.green.s, marker: 'm-green' }));
  b.push(elabel(512, 346, 'calls MCP tools', { anchor: 'start' }));
  b.push(arrow(390, 408, 280, 408, { stroke: C.cyan.s, marker: 'm-cyan' }));
  b.push(elabel(335, 398, 'register · discover'));
  b.push(arrow(610, 408, 720, 408, { stroke: C.amber.s, marker: 'm-amber' }));
  b.push(elabel(665, 398, 'export · import'));
  b.push(arrow(445, 440, 235, 512, { stroke: C.violet.s, marker: 'm-violet' }));
  b.push(elabel(318, 482, 'reads / writes'));
  b.push(arrow(350, 556, 430, 556, { stroke: C.green.s, marker: 'm-green' }));
  b.push(elabel(390, 546, 'sync'));
  b.push(arrow(250, 662, 215, 600, { stroke: C.slate.s, marker: 'm-slate' }));
  b.push(elabel(300, 632, 'complies with'));

  return svg('0 0 1000 780', 'ArchGraph global architecture — layered viewpoint', b.join('\n'));
}

/* ------------------------------------------------------------------ */
/* 2. Core model — one unified language                                */
/* ------------------------------------------------------------------ */
function genCoreModel() {
  const b = [];
  b.push(text(30, 42, 'One model for harness and product design', { size: 21, weight: 700 }));
  b.push(text(30, 64, 'Harness Design and Target System Design in a single ArchiMate 3.2 intent graph', { size: 12, fill: C.muted }));

  b.push(box(168, 92, 624, 300, C.violet, { dash: '8 7', width: 1.2, fillOverride: 'rgba(167,139,250,0.05)' }));
  b.push(text(184, 116, 'Intent Architecture Graph · one model · one view', { size: 11.5, fill: C.violet.s, weight: 600, letter: 0.5 }));

  b.push(box(206, 146, 244, 82, C.blue) + blabel(206, 146, 244, 82, 'Harness Design', ['the agent roles · skills · rules']));
  b.push(box(516, 146, 244, 82, C.green) + blabel(516, 146, 244, 82, 'Target System Design', ['the product components · functions']));
  b.push(arrow(450, 187, 516, 187, { stroke: C.violet.s, marker: 'm-violet' }));
  b.push(elabel(483, 177, 'describes'));

  b.push(box(300, 282, 360, 72, C.violet) + blabel(300, 282, 360, 72, 'Intent Architecture Graph', ['ArchiMate 3.2 · single source of truth']));
  b.push(arrow(330, 228, 400, 282, { stroke: C.blue.s, marker: 'm-blue' }));
  b.push(arrow(636, 228, 560, 282, { stroke: C.green.s, marker: 'm-green' }));

  b.push(box(20, 168, 124, 92, C.cyan) + blabel(20, 168, 124, 92, 'AgentHarness', ['the coding agent']));
  b.push(box(812, 168, 124, 92, C.green) + blabel(812, 168, 124, 92, 'Target Project', ['the product']));
  b.push(arrow(144, 206, 206, 190, { stroke: C.cyan.s, marker: 'm-cyan' }));
  b.push(elabel(184, 224, 'Access', { anchor: 'middle' }));
  b.push(arrow(760, 190, 812, 206, { stroke: C.green.s, marker: 'm-green' }));
  b.push(elabel(786, 224, 'describes'));

  b.push(`<path d="M82,260 L82,470 L874,470 L874,260" fill="none" stroke="${C.cyan.s}" stroke-width="1.6" marker-end="url(#m-cyan)"/>`);
  b.push(elabel(478, 486, 'creates'));

  return svg('0 0 960 540', 'ArchGraph core model — one unified language', b.join('\n'));
}

/* ------------------------------------------------------------------ */
/* 3. Capability — federated graph sharing                             */
/* ------------------------------------------------------------------ */
function genFederation() {
  const b = [];
  b.push(text(24, 36, 'Federated graph sharing', { size: 17, weight: 700 }));

  b.push(box(30, 44, 160, 60, C.blue) + blabel(30, 44, 160, 60, 'ArchGraph graph', ['sovereign'], { titleSize: 13 }));
  b.push(box(370, 44, 160, 60, C.green) + blabel(370, 44, 160, 60, 'SOC-DEMO graph', ['sovereign'], { titleSize: 13 }));
  b.push(box(200, 140, 160, 72, C.cyan) + blabel(200, 140, 160, 72, 'Registry center', ['members + grants only'], { titleSize: 13 }));
  b.push(box(200, 258, 160, 60, C.violet) + blabel(200, 258, 160, 60, 'your project graph', ['sovereign'], { titleSize: 12 }));

  b.push(arrow(110, 104, 232, 140, { stroke: C.blue.s, marker: 'm-blue', dash: '4 4' }));
  b.push(arrow(450, 104, 328, 140, { stroke: C.green.s, marker: 'm-green', dash: '4 4' }));
  b.push(elabel(140, 134, 'register'));
  b.push(elabel(436, 134, 'register'));
  b.push(arrow(280, 212, 280, 258, { stroke: C.violet.s, marker: 'm-violet', dash: '4 4' }));
  b.push(elabel(338, 240, 'discover', { anchor: 'start' }));

  b.push(arrow(370, 74, 190, 74, { stroke: C.rose.s, marker: 'm-rose' }));
  b.push(elabel(280, 66, 'read by reference'));

  b.push(text(24, 336, 'a read returns a reference, not a copy · default deny · each graph stays sovereign', { size: 10.5, fill: C.faint }));
  return svg('0 0 560 356', 'Federated graph sharing', b.join('\n'));
}

/* ------------------------------------------------------------------ */
/* 4. Capability — three-tier memory                                   */
/* ------------------------------------------------------------------ */
function genMemoryTiers() {
  const b = [];
  b.push(text(24, 36, 'Three-tier memory', { size: 17, weight: 700 }));

  b.push(box(150, 74, 280, 56, C.green) + blabel(150, 74, 280, 56, 'T1 · working memory', ['session digest · loaded at start'], { titleSize: 14 }));
  b.push(box(150, 168, 280, 56, C.blue) + blabel(150, 168, 280, 56, 'T2 · long-term memory', ['recalled on demand'], { titleSize: 14 }));
  b.push(box(150, 262, 280, 56, C.slate) + blabel(150, 262, 280, 56, 'T3 · archive', ['explicit retrieval only'], { titleSize: 14 }));

  b.push(arrow(290, 130, 290, 168, { stroke: C.blue.s, marker: 'm-blue', dash: '4 4' }));
  b.push(elabel(300, 152, 'recall', { anchor: 'start' }));
  b.push(arrow(290, 224, 290, 262, { stroke: C.slate.s, marker: 'm-slate', dash: '4 4' }));
  b.push(elabel(300, 246, 'archive', { anchor: 'start' }));

  b.push(text(138, 106, 'load only →', { size: 10.5, fill: C.green.s, anchor: 'end', weight: 600 }));
  b.push(text(24, 340, 'T1 is the only tier loaded into the context at session start', { size: 10.5, fill: C.faint }));
  return svg('0 0 560 360', 'Three-tier agent memory', b.join('\n'));
}

/* ------------------------------------------------------------------ */
/* 5. Capability — token-efficient reads                               */
/* ------------------------------------------------------------------ */
function genLeanReads() {
  const b = [];
  b.push(text(24, 36, 'Lean, matched reads', { size: 17, weight: 700 }));

  b.push(box(30, 90, 150, 64, C.blue) + blabel(30, 90, 150, 64, 'read request', ['view / element context'], { titleSize: 13 }));
  b.push(box(230, 90, 300, 64, C.violet) + blabel(230, 90, 300, 64, 'read projection', ['omit commit + testcase ledgers'], { titleSize: 13 }));
  b.push(arrow(180, 122, 230, 122, { stroke: C.violet.s, marker: 'm-violet' }));
  b.push(box(230, 182, 300, 64, C.cyan) + blabel(230, 182, 300, 64, 'matchedSnippet', ['why it matched · on the hit'], { titleSize: 13 }));
  b.push(arrow(380, 154, 380, 182, { stroke: C.cyan.s, marker: 'm-cyan' }));

  b.push(text(30, 286, 'measured read size', { size: 11, fill: C.muted, weight: 600 }));
  b.push(box(30, 296, 240, 16, C.slate, { rx: 4, fillOverride: 'rgba(148,163,184,0.22)', width: 1 }));
  b.push(text(38, 308, 'before', { size: 9.5, fill: C.muted }));
  b.push(box(30, 320, 118, 16, C.green, { rx: 4, width: 1 }));
  b.push(text(38, 332, 'after', { size: 9.5, fill: C.muted }));
  b.push(elabel(160, 332, '−51% view · −42% merged', { anchor: 'start' }));

  b.push(text(24, 352, 'reads never grow; the focus element keeps its own evidence', { size: 10.5, fill: C.faint }));
  return svg('0 0 560 372', 'Token-efficient architecture reads', b.join('\n'));
}

/* ------------------------------------------------------------------ */

const FILES = {
  'core-model.svg': genCoreModel,
  'global-architecture.svg': genGlobalArchitecture,
  'cap-federation.svg': genFederation,
  'cap-memory-tiers.svg': genMemoryTiers,
  'cap-lean-reads.svg': genLeanReads,
};

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const check = process.argv.includes('--check');
  let Resvg;
  if (check) Resvg = require('@resvg/resvg-js').Resvg;

  for (const [name, fn] of Object.entries(FILES)) {
    const out = path.join(OUT_DIR, name);
    const content = fn();
    fs.writeFileSync(out, content, 'utf8');
    let note = '';
    if (check) {
      const img = new Resvg(content).render();
      note = ` (renders ${img.width}x${img.height})`;
    }
    console.log(`wrote docs/diagrams/${name}${note}`);
  }
}

main();
