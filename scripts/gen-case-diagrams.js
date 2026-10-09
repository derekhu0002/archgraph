'use strict';

// Deterministic, dependency-free generator for the four SVG diagrams used by
// docs/case-team-graph.html. Only node:fs / node:path are used. Re-running
// overwrites every file with byte-identical content.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'diagrams');

const C = {
  bg: '#f5f7fa',
  panel: '#ffffff',
  border: '#e6e8ee',
  text: '#0f172a',
  muted: '#5b6472',
  accent: '#4d6bfe',
  success: '#0f9d58',
  accentSoft: '#eef1ff',
  successSoft: '#e7f6ee',
};

const FONT = "'Segoe UI','Microsoft YaHei',Roboto,'Helvetica Neue',Arial,sans-serif";

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rect(x, y, w, h, o) {
  o = o || {};
  const fill = o.fill === undefined ? C.panel : o.fill;
  const stroke = o.stroke === undefined ? C.border : o.stroke;
  const rx = o.rx === undefined ? 12 : o.rx;
  const sw = o.sw === undefined ? 1.5 : o.sw;
  const dash = o.dash ? ` stroke-dasharray="${o.dash}"` : '';
  const filter = o.filter === undefined ? 'url(#sh)' : o.filter;
  const flt = filter ? ` filter="${filter}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}${flt}/>`;
}

function text(x, y, s, o) {
  o = o || {};
  const size = o.size === undefined ? 14 : o.size;
  const fill = o.fill === undefined ? C.text : o.fill;
  const anchor = o.anchor === undefined ? 'start' : o.anchor;
  const weight = o.weight === undefined ? 400 : o.weight;
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" font-family="${FONT}">${esc(s)}</text>`;
}

function line(x1, y1, x2, y2, o) {
  o = o || {};
  const stroke = o.stroke === undefined ? C.accent : o.stroke;
  const width = o.width === undefined ? 2 : o.width;
  const dash = o.dash ? ` stroke-dasharray="${o.dash}"` : '';
  const marker = o.marker === undefined ? 'url(#ar)' : o.marker;
  const m = marker ? ` marker-end="${marker}"` : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"${dash}${m}/>`;
}

function defs() {
  const marker = (id, color) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${color}"/></marker>`;
  return '<defs>'
    + marker('ar', C.accent)
    + marker('arm', C.muted)
    + marker('ars', C.success)
    + '<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.08"/></filter>'
    + '</defs>';
}

function svg(W, H, body) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${W} ${H}" role="img" font-family="${FONT}">\n`
    + defs() + '\n'
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/>\n`
    + body + '\n'
    + '</svg>\n';
}

function title(s, x, y) {
  return text(x === undefined ? 50 : x, y === undefined ? 62 : y, s, { size: 26, weight: 700 });
}

// ---------------------------------------------------------------------------
// 1. Ontology
// ---------------------------------------------------------------------------
function ontology() {
  const W = 1000;
  const H = 520;
  const b = [];
  b.push(title('Team Graph 本体'));
  b.push(text(50, 92, '元素类型与合法关系端点（默认 schema / 自定义 schema 通用）', { size: 14, fill: C.muted }));

  const boxes = [
    { x: 50, t: 'Agent Node', sub: 'Agent 节点', badge: true },
    { x: 370, t: 'Team Node', sub: 'Team 节点', badge: false },
    { x: 690, t: 'Service Node', sub: 'Service 节点', badge: false },
  ];
  const bw = 260;
  const bh = 104;
  const by = 122;
  boxes.forEach((o) => {
    b.push(text(o.x + bw / 2, by - 8, 'element type', { size: 11, fill: C.muted, anchor: 'middle' }));
    b.push(rect(o.x, by, bw, bh));
    b.push(rect(o.x + 14, by + 16, 9, bh - 32, { fill: C.accent, stroke: 'none', rx: 5, filter: null }));
    b.push(text(o.x + bw / 2 + 6, by + 46, o.t, { size: 19, weight: 700, anchor: 'middle' }));
    b.push(text(o.x + bw / 2 + 6, by + 72, o.sub, { size: 13, fill: C.muted, anchor: 'middle' }));
    if (o.badge) {
      b.push(rect(o.x + bw - 100, by + bh - 36, 86, 24, { fill: C.successSoft, stroke: C.success, rx: 12, sw: 1, filter: null }));
      b.push(text(o.x + bw - 57, by + bh - 19, '· actor ·', { size: 12, fill: C.success, anchor: 'middle', weight: 700 }));
    }
  });

  b.push(text(50, 296, '关系类型与合法端点', { size: 18, weight: 700 }));

  const card = (x, y, w, h, head, lines) => {
    b.push(rect(x, y, w, h, { filter: 'url(#sh)' }));
    b.push(rect(x, y, w, 42, { fill: C.accentSoft, stroke: 'none', rx: 12, filter: null }));
    b.push(rect(x, y + 30, w, 12, { fill: C.accentSoft, stroke: 'none', rx: 0, filter: null }));
    b.push(text(x + 18, y + 27, head, { size: 16, weight: 700, fill: C.accent }));
    lines.forEach((ln, i) => b.push(text(x + 18, y + 76 + i * 26, ln, { size: 14, fill: C.text })));
  };

  card(50, 312, 430, 150, 'Assigned To', [
    'Agent  ↔  Team',
    '合法端点：Agent → Team',
    '　　　　　　Team → Agent',
  ]);
  card(520, 312, 430, 150, 'Depends On', [
    'Team → { Service, Team }',
    'Service → Service',
    'Agent → { Team, Service }',
  ]);

  b.push(rect(760, 472, 190, 36, { fill: C.panel, stroke: C.success, rx: 10, sw: 1.5, filter: null }));
  b.push(text(855, 495, 'maxElementsPerView = 12', { size: 14, fill: C.success, anchor: 'middle', weight: 700 }));

  return svg(W, H, b.join('\n'));
}

// ---------------------------------------------------------------------------
// 2. Elements & relations
// ---------------------------------------------------------------------------
function elementsRelations() {
  const W = 1000;
  const H = 520;
  const b = [];
  b.push(title('元素与关系'));
  b.push(text(50, 92, '一次写操作创建的元素与有向关系', { size: 14, fill: C.muted }));

  const node = (cx, cy, label, sub, stroke) => {
    const w = 192;
    const h = 66;
    b.push(rect(cx - w / 2, cy - h / 2, w, h, { stroke: stroke || C.border }));
    b.push(text(cx, cy - (sub ? 4 : 0), label, { size: 17, weight: 700, anchor: 'middle' }));
    if (sub) b.push(text(cx, cy + 18, sub, { size: 12, fill: C.muted, anchor: 'middle' }));
  };

  const label = (cx, cy, s) => {
    const w = s.length * 8.2 + 18;
    const h = 22;
    b.push(rect(cx - w / 2, cy - h / 2, w, h, { fill: C.panel, stroke: C.border, rx: 8, sw: 1, filter: null }));
    b.push(text(cx, cy + 5, s, { size: 12.5, anchor: 'middle', fill: C.accent, weight: 600 }));
  };

  // Edges (drawn first so nodes/labels sit on top).
  b.push(line(273, 255, 372, 255, {}));
  b.push(line(568, 222, 674, 184, {}));
  b.push(line(770, 183, 770, 330, {}));

  node(175, 255, 'Agent 001', 'Agent Node', C.success);
  node(470, 255, 'Team A', 'Team Node');
  node(770, 150, 'Service A', 'Service Node');
  node(770, 365, 'Service B', 'Service Node');

  label(322, 238, 'Assigned To');
  label(626, 196, 'Depends On');
  label(770, 258, 'Depends On');

  return svg(W, H, b.join('\n'));
}

// ---------------------------------------------------------------------------
// 3. View composition
// ---------------------------------------------------------------------------
function viewComposition() {
  const W = 1000;
  const H = 520;
  const b = [];
  b.push(title('视图组合'));
  b.push(text(50, 92, 'root 视图承载全部元素与关系；子视图通过 subdiagram_views 挂载', { size: 14, fill: C.muted }));

  const rx = 50;
  const ry = 112;
  const rw = 590;
  const rh = 350;

  b.push(rect(rx, ry, rw, rh, { stroke: C.accent, sw: 2 }));
  b.push(rect(rx, ry, rw, 44, { fill: C.accentSoft, stroke: 'none', rx: 12, filter: null }));
  b.push(rect(rx, ry + 30, rw, 14, { fill: C.accentSoft, stroke: 'none', rx: 0, filter: null }));
  b.push(text(rx + 18, ry + 28, 'SystemArchitecture', { size: 18, weight: 700 }));
  b.push(rect(rx + rw - 152, ry + 10, 134, 24, { fill: C.panel, stroke: C.accent, rx: 12, sw: 1, filter: null }));
  b.push(text(rx + rw - 85, ry + 27, 'rootViewName', { size: 12, fill: C.accent, anchor: 'middle', weight: 700 }));

  // Inner elements.
  const chip = (x, y, w, label, accent) => {
    b.push(rect(x, y, w, 50, { stroke: accent || C.border }));
    b.push(text(x + w / 2, y + 31, label, { size: 15, weight: 700, anchor: 'middle' }));
  };
  chip(76, 190, 150, 'Agent 001', C.success);
  chip(76, 300, 150, 'Team A');
  chip(330, 190, 170, 'Service A');
  chip(330, 300, 170, 'Service B');

  // Inner relationships.
  b.push(line(151, 240, 151, 300, {}));
  b.push(line(228, 318, 328, 224, {}));
  b.push(line(415, 240, 415, 300, {}));

  // Badge + count.
  b.push(rect(76, 408, 168, 32, { fill: C.accentSoft, stroke: C.accent, rx: 10, sw: 1.5, filter: null }));
  b.push(text(160, 429, '≤ 12 元素/视图', { size: 13, fill: C.accent, anchor: 'middle', weight: 700 }));
  b.push(text(rx + rw - 20, 429, '4 元素 · 3 关系', { size: 13, fill: C.muted, anchor: 'end' }));

  // Optional child view.
  const cx = 700;
  const cy = 170;
  const cw = 250;
  const ch = 170;
  b.push(rect(cx, cy, cw, ch, { stroke: C.success, sw: 2 }));
  b.push(rect(cx, cy, cw, 40, { fill: C.successSoft, stroke: 'none', rx: 12, filter: null }));
  b.push(rect(cx, cy + 28, cw, 12, { fill: C.successSoft, stroke: 'none', rx: 0, filter: null }));
  b.push(text(cx + 16, cy + 26, 'Organization view', { size: 14, weight: 700, fill: C.success }));
  b.push(text(cx + 16, cy + 76, 'Team A 的 Organization view', { size: 14 }));
  b.push(text(cx + 16, cy + 104, 'parent_element_id → Team A', { size: 12, fill: C.muted }));
  b.push(text(cx + 16, cy + 132, '可选子视图', { size: 12, fill: C.muted }));

  b.push(line(640, 290, 700, 240, { stroke: C.success, marker: 'url(#ars)' }));
  b.push(text(670, 312, 'subdiagram_views', { size: 11.5, fill: C.success, anchor: 'middle', weight: 600 }));

  return svg(W, H, b.join('\n'));
}

// ---------------------------------------------------------------------------
// 4. MCP call & recall sequence
// ---------------------------------------------------------------------------
function sequence() {
  const W = 1000;
  const H = 560;
  const b = [];
  b.push(title('MCP 调用与召回时序', 50, 46));
  b.push(text(50, 74, 'Coding Agent 通过 ARGO MCP 读写意图图谱并召回记忆', { size: 14, fill: C.muted }));

  const lanes = [
    { x: 140, label: 'Coding Agent' },
    { x: 320, label: 'ARGO MCP' },
    { x: 500, label: '意图图谱 JSON' },
    { x: 680, label: 'Neo4j 结构投影' },
    { x: 860, label: '向量索引' },
  ];
  const top = 148;
  const bottom = 522;
  lanes.forEach((l) => {
    b.push(rect(l.x - 82, 98, 164, 46, { filter: 'url(#sh)' }));
    b.push(text(l.x, 127, l.label, { size: 14, weight: 700, anchor: 'middle' }));
    b.push(`<line x1="${l.x}" y1="${top}" x2="${l.x}" y2="${bottom}" stroke="${C.border}" stroke-width="1.5" stroke-dasharray="5 6"/>`);
  });

  const M = (from, to, y, s, o) => {
    o = o || {};
    const x1 = lanes[from].x;
    const x2 = lanes[to].x;
    const dir = x2 > x1 ? 1 : -1;
    b.push(line(x1 + dir * 6, y, x2 - dir * 8, y, {
      stroke: o.color || C.accent,
      width: 2,
      dash: o.dash || null,
      marker: o.marker || 'url(#ar)',
    }));
    b.push(text((x1 + x2) / 2, y - 9, s, {
      size: o.size || 12.5,
      anchor: 'middle',
      fill: o.textFill || C.text,
      weight: o.weight || 400,
    }));
  };

  const back = { dash: '6 6', marker: 'url(#arm)', color: C.muted, textFill: C.muted };

  M(0, 1, 178, 'validateSystemArchitecture → 通过');
  M(0, 1, 214, 'queryNeo4jGraph {schema:true}');
  M(3, 1, 240, '返回 schemaKind / actorElementType', back);
  M(0, 1, 280, 'addArchitectureElement / addArchitectureRelationship / addArchitectureView', { size: 11.5 });
  M(1, 2, 306, '写入');
  M(2, 1, 332, 'ok / 已写入', back);
  M(0, 1, 372, 'memory_search / getSystemArchitecture');
  M(1, 4, 398, '语义召回', back);
  M(4, 1, 424, 'hits', back);
  M(1, 2, 450, 'getSystemArchitecture', back);
  M(2, 1, 476, '命中（含 matchedSnippet）', back);
  M(1, 0, 502, '返回 hits（matchedSnippet）', back);

  return svg(W, H, b.join('\n'));
}

// ---------------------------------------------------------------------------
function writeFile(name, content) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = [
    ['team-graph-ontology.svg', ontology()],
    ['team-graph-elements-relations.svg', elementsRelations()],
    ['team-graph-view-composition.svg', viewComposition()],
    ['team-graph-mcp-recall-sequence.svg', sequence()],
  ];
  files.forEach(([name, content]) => {
    const p = writeFile(name, content);
    console.log('wrote ' + p + ' (' + Buffer.byteLength(content, 'utf8') + ' bytes)');
  });
}

main();
