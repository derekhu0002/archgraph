'use strict';

/**
 * Generate the ArchGraph coding-business deck (white "clean tech" theme).
 *
 *   node scripts/gen-coding-deck.js           # write docs/ppt/assets/*.svg + *.excalidraw
 *   node scripts/gen-coding-deck.js --check    # also rasterize (resvg) to validate
 *
 * Layout philosophy (MBB-style): one action title + one dominant visual + a few
 * short callouts + a takeaway bar per page. Content lives in
 * docs/ppt/content-plan.json (single source of truth). Every page is exported
 * BOTH as an embeddable SVG and as an editable `.excalidraw` source with the
 * same geometry (see the scene side-channel below).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'ppt', 'assets');
const EX_DIR = path.join(ROOT, 'docs', 'ppt', 'excalidraw');
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'ppt', 'content-plan.json'), 'utf8'));

const W = 1280;
const H = 720;
const M = 48;              // page margin
const CW = W - 2 * M;      // content width
const BODY_TOP = 136;
const BODY_BOTTOM = 596;

const C = {
  bg: '#ffffff',
  grid: '#eef2f7',
  text: '#0f172a',
  muted: '#475569',
  faint: '#64748b',
  dim: '#94a3b8',
  blue: { f: '#eaf1ff', s: '#2457e6' },
  cyan: { f: '#e6f9fd', s: '#0e86a5' },
  green: { f: '#e8faf1', s: '#0f9d63' },
  violet: { f: '#f2eeff', s: '#6d38d6' },
  amber: { f: '#fff6e6', s: '#b26a04' },
  rose: { f: '#ffeef1', s: '#dc2f52' },
  slate: { f: '#f7f9fc', s: '#5b6b82' },
};
const P = (id) => PLAN.pages.find((p) => p.id === id);

const FAMILY =
  "'Microsoft YaHei', 'Segoe UI', 'Noto Sans SC', 'PingFang SC', Roboto, Helvetica, Arial, sans-serif";
const MONO = "Consolas, 'Cascadia Code', ui-monospace, monospace";

/* ------------------------------------------------ Excalidraw side-channel */
let SCENE = null;
let _eid = 0;
let _seedState = 1;
const _srand = (s) => { _seedState = s >>> 0; };
const _rnd = () => {
  _seedState = (_seedState * 1664525 + 1013904223) >>> 0;
  return _seedState % 2147483000;
};
function _el(type, extra) {
  return {
    id: `el-${(++_eid).toString(36)}`,
    seed: _rnd(), version: 1, versionNonce: _rnd(), isDeleted: false,
    groupIds: [], frameId: null, boundElements: null, updated: 1, link: null,
    locked: false, angle: 0, opacity: 100, ...extra, type,
  };
}
function recRect(x, y, w, h, fill, stroke, sw = 1.4, rx = 0, dash = '', opacity = 100) {
  if (!SCENE) return;
  SCENE.push(_el('rectangle', {
    x, y, width: w, height: h,
    strokeColor: stroke || 'transparent',
    backgroundColor: !fill || fill === 'none' ? 'transparent' : fill,
    fillStyle: 'solid', strokeWidth: sw, strokeStyle: dash ? 'dashed' : 'solid',
    roughness: 0, roundness: rx > 0 ? { type: 3 } : null, opacity,
  }));
}
function recEllipse(cx, cy, rx, ry, fill, stroke, sw = 1.4, opacity = 100) {
  if (!SCENE) return;
  SCENE.push(_el('ellipse', {
    x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2,
    strokeColor: stroke || 'transparent',
    backgroundColor: !fill || fill === 'none' ? 'transparent' : fill,
    fillStyle: 'solid', strokeWidth: sw, strokeStyle: 'solid', roughness: 0,
    roundness: null, opacity,
  }));
}
function recLine(points, stroke, sw = 1.4, dash = '', arrow = false, opacity = 100) {
  if (!SCENE || !points.length) return;
  const [x0, y0] = points[0];
  SCENE.push(_el('arrow', {
    x: x0, y: y0, width: Math.abs(points[points.length - 1][0] - x0),
    height: Math.abs(points[points.length - 1][1] - y0),
    strokeColor: stroke || C.muted, backgroundColor: 'transparent',
    fillStyle: 'solid', strokeWidth: sw, strokeStyle: dash ? 'dashed' : 'solid',
    roughness: 0, roundness: null,
    points: points.map(([px, py]) => [px - x0, py - y0]),
    lastCommittedPoint: null, startBinding: null, endBinding: null,
    startArrowhead: null, endArrowhead: arrow ? 'arrow' : null, opacity,
  }));
}
function recText(x, y, s, size, fill, anchor, weight, mono, opacity = 100) {
  if (!SCENE) return;
  const lines = String(s).split('\n');
  const w = Math.max(4, ...lines.map((ln) => strWidth(ln, size)));
  const h = lines.length * size * 1.25;
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  SCENE.push(_el('text', {
    x: left, y: y - size * 0.86, width: w, height: h,
    strokeColor: fill || C.text, backgroundColor: 'transparent',
    fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0,
    roundness: null, opacity, text: String(s), originalText: String(s),
    fontSize: size, fontFamily: mono ? 3 : 2,
    textAlign: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
    verticalAlign: 'top', containerId: null, lineHeight: 1.25, baseline: size * 0.86,
  }));
}

/* ---------------------------------------------------------------- helpers */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function strWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) w += /[\u2E80-\u9FFF\uFF00-\uFF60\u3000-\u303F]/.test(ch) ? size : size * 0.55;
  return w;
}
function clipToWidth(s, size, maxWidth) {
  if (strWidth(s, size) <= maxWidth) return s;
  let out = '';
  let w = 0;
  for (const ch of String(s)) {
    const cw = /[\u2E80-\u9FFF\uFF00-\uFF60\u3000-\u303F]/.test(ch) ? size : size * 0.55;
    if (w + cw > maxWidth - size) break;
    out += ch; w += cw;
  }
  return out + '…';
}
function wrap(s, size, maxWidth, maxLines = 99) {
  const out = []; let line = ''; let lineW = 0;
  for (const ch of String(s)) {
    if (ch === '\n') { out.push(line); line = ''; lineW = 0; continue; }
    const cw = /[\u2E80-\u9FFF\uFF00-\uFF60\u3000-\u303F]/.test(ch) ? size : size * 0.55;
    if (lineW + cw > maxWidth && line) { out.push(line); line = ch; lineW = cw; }
    else { line += ch; lineW += cw; }
  }
  if (line) out.push(line);
  if (out.length > maxLines) { const k = out.slice(0, maxLines); k[maxLines - 1] = clipToWidth(k[maxLines - 1] + '…', size, maxWidth); return k; }
  return out;
}
function text(x, y, s, o = {}) {
  const { size = 12, fill = C.text, anchor = 'start', weight = 400, opacity = 1, mono = false, italic = false } = o;
  recText(x, y, s, size, fill, anchor, weight, mono, Math.round(opacity * 100));
  return `<text x="${x}" y="${y}" font-family="${mono ? MONO : FAMILY}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}"${italic ? ' font-style="italic"' : ''}>${esc(s)}</text>`;
}
function rect(x, y, w, h, color, o = {}) {
  const { rx = 10, dash = '', width = 1.2, fillOverride } = o;
  recRect(x, y, w, h, fillOverride || color.f, color.s, width, rx, dash);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fillOverride || color.f}" stroke="${color.s}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}
/** wrapped paragraph, returns {svg, endY} */
function para(x, y, s, o = {}) {
  const { size = 11, fill = C.muted, maxWidth = 200, lh = null, maxLines = 99, weight = 400 } = o;
  const lines = wrap(s, size, maxWidth, maxLines);
  const step = lh || size + 6;
  return { svg: lines.map((ln, i) => text(x, y + i * step, ln, { size, fill, weight })).join('\n'), endY: y + (lines.length - 1) * step };
}
function arrow(x1, y1, x2, y2, o = {}) {
  const { stroke = C.muted, width = 1.6, marker = 'arrow', dash = '' } = o;
  recLine([[x1, y1], [x2, y2]], stroke, width, dash, true);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" marker-end="url(#${marker})"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}
function poly(points, o = {}) {
  const { stroke = C.muted, width = 1.6, dash = '', marker = '' } = o;
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  recLine(points, stroke, width, dash, !!marker);
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}${marker ? ` marker-end="url(#${marker})"` : ''}/>`;
}
function pill(x, y, label, color, o = {}) {
  const { size = 10.5, pad = 8, h = 20 } = o;
  const w = strWidth(label, size) + pad * 2;
  recRect(x, y, w, h, color.f, color.s, 1, h / 2);
  return {
    svg: `<rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color.f}" stroke="${color.s}" stroke-width="1"/>` +
      text(x + w / 2, y + h / 2 + size * 0.36, label, { size, fill: color.s, anchor: 'middle', weight: 600 }),
    w,
  };
}
function badge(cx, cy, n, o = {}) {
  const { r = 11, color = C.blue, size = 12, fillText = '#ffffff' } = o;
  recEllipse(cx, cy, r, r, color.s, '#ffffff', 2);
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color.s}" stroke="#ffffff" stroke-width="2"/>` +
    text(cx, cy + size * 0.36, String(n), { size, fill: fillText, anchor: 'middle', weight: 700 });
}
function sectionLabel(x, y, s, o = {}) {
  const { color = C.faint, size = 11, width = 0 } = o;
  const parts = [text(x, y, s, { size, fill: color, weight: 700 })];
  if (width) {
    recLine([[x + strWidth(s, size) + 12, y - 4], [x + width, y - 4]], C.grid, 1, '', false);
    parts.push(`<line x1="${x + strWidth(s, size) + 12}" y1="${y - 4}" x2="${x + width}" y2="${y - 4}" stroke="${C.grid}" stroke-width="1"/>`);
  }
  return parts.join('\n');
}
function svg(title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.muted}"/></marker>
  <marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.blue.s}"/></marker>
  <marker id="arrow-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.green.s}"/></marker>
  <marker id="arrow-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.amber.s}"/></marker>
  <marker id="arrow-rose" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.rose.s}"/></marker>
  <marker id="arrow-cyan" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.cyan.s}"/></marker>
  <marker id="arrow-violet" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.violet.s}"/></marker>
</defs>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${body}
</svg>`;
}
function pageHeader(p) {
  const parts = [
    `<rect x="0" y="0" width="${W}" height="5" fill="${C.blue.f}"/><rect x="0" y="0" width="220" height="5" fill="${C.blue.s}"/>`,
  ];
  recRect(0, 0, W, 5, C.blue.f, 'transparent', 0, 0);
  recRect(0, 0, 220, 5, C.blue.s, 'transparent', 0, 0);
  parts.push(text(M, 40, p.kicker, { size: 10.5, fill: C.blue.s, weight: 700, mono: true }));
  parts.push(text(M, 78, p.title, { size: 26, weight: 800 }));
  if (p.subtitle) parts.push(text(M, 106, p.subtitle, { size: 12.5, fill: C.muted }));
  recLine([[M, 122], [W - M, 122]], C.grid, 1, '', false);
  parts.push(`<line x1="${M}" y1="122" x2="${W - M}" y2="122" stroke="${C.grid}" stroke-width="1"/>`);
  return parts.join('\n');
}
function takeaway(p) {
  const y = 608, h = 52;
  const parts = [rect(M, y, CW, h, C.blue, { rx: 10 })];
  recRect(M, y, 5, h, C.blue.s, 'transparent', 0, 2);
  parts.push(`<rect x="${M}" y="${y}" width="5" height="${h}" rx="2" fill="${C.blue.s}"/>`);
  const pr = pill(M + 16, y + 16, '结论', C.blue, { size: 11, h: 20 });
  parts.push(pr.svg);
  parts.push(para(M + pr.w + 26, y + 21, p.takeaway, { size: 12.5, fill: C.text, maxWidth: CW - 130, lh: 16, maxLines: 2 }).svg);
  return parts.join('\n');
}
function pageFooter(p) {
  const parts = [`<line x1="${M}" y1="${H - 38}" x2="${W - M}" y2="${H - 38}" stroke="${C.grid}" stroke-width="1"/>`];
  recLine([[M, H - 38], [W - M, H - 38]], C.grid, 1, '', false);
  if (p.references && p.references.length) parts.push(text(M, H - 22, `依据：${p.references.join('  ·  ')}`, { size: 8.5, fill: C.faint }));
  parts.push(text(W - M, H - 22, `ArchGraph · ${p.kicker}`, { size: 8.5, fill: C.dim, anchor: 'end', mono: true }));
  return parts.join('\n');
}
function frame(p, body) {
  return svg(p.title, [pageHeader(p), body, takeaway(p), pageFooter(p)].join('\n'));
}

/* ------------------------------------------------------------- components */
function kpiCard(x, y, w, h, { v, label, note, color = C.blue }) {
  const parts = [rect(x, y, w, h, color, { rx: 12 })];
  recRect(x, y, w, 5, color.s, 'transparent', 0, 2);
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="5" rx="2" fill="${color.s}"/>`);
  parts.push(text(x + 20, y + h * 0.44, clipToWidth(v, 24, w - 40), { size: 24, weight: 800, fill: color.s }));
  parts.push(text(x + 20, y + h * 0.44 + 26, clipToWidth(label, 12, w - 36), { size: 12.5, weight: 700, fill: C.text }));
  if (note) parts.push(text(x + 20, y + h * 0.44 + 48, clipToWidth(note, 11, w - 36), { size: 10.5, fill: C.muted }));
  return parts.join('\n');
}
function rowItem(x, y, w, h, n, head, line, color = C.blue, right = '') {
  const parts = [rect(x, y, w, h, { f: '#ffffff', s: color.s }, { rx: 10, width: 1.2 })];
  recRect(x, y, 4, h, color.s, 'transparent', 0, 2);
  parts.push(`<rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${color.s}"/>`);
  if (n != null) parts.push(badge(x + 24, y + h / 2, n, { r: 12, color, size: 12.5 }));
  const tx = x + (n != null ? 46 : 16);
  parts.push(text(tx, y + h / 2 - 3, clipToWidth(head, 13, w - (n != null ? 60 : 24) - (right ? 150 : 0)), { size: 13, weight: 700, fill: C.text }));
  if (line) parts.push(text(tx, y + h / 2 + 15, clipToWidth(line, 10.5, w - (n != null ? 60 : 24)), { size: 10.5, fill: C.muted }));
  if (right) parts.push(text(x + w - 16, y + h / 2 + 4, right, { size: 13, weight: 700, fill: color.s, anchor: 'end' }));
  return parts.join('\n');
}

/* --------------------------------------------------------------- page 1 */
function genP1() {
  const p = P('p1');
  const parts = [];
  const keyX = 916;
  const keyW = W - M - keyX;
  parts.push(sectionLabel(keyX, 150, '关键状态 / 分区', { color: C.blue.s, width: keyW }));
  const rowH = 42;
  const ky = 164;
  p.key.forEach((k, i) => {
    const y = ky + i * rowH;
    if (i % 2 === 1) {
      recRect(keyX, y, keyW, rowH - 4, '#f8fafc', 'transparent', 0, 6);
      parts.push(`<rect x="${keyX}" y="${y}" width="${keyW}" height="${rowH - 4}" rx="6" fill="#f8fafc"/>`);
    }
    parts.push(badge(keyX + 16, y + 16, k.n, { r: 11, color: C.blue, size: 12 }));
    parts.push(text(keyX + 38, y + 13, k.label, { size: 12, weight: 700 }));
    parts.push(text(keyX + 38, y + 29, k.sub, { size: 10.5, fill: C.muted }));
  });

  // state machine (x: 48..896, y: 136..596)
  const RX = 110, RY = 152, RW = 610, RH = 244;
  parts.push(sectionLabel(M, 150, '一次 Agent 会话的状态机', { color: C.blue.s, width: 848 }));
  parts.push(rect(RX, RY, RW, RH, C.blue, { rx: 12, width: 1.5, dash: '' }));
  parts.push(text(RX + 16, RY + 22, 'Running · 执行回合（复合态）', { size: 12.5, weight: 700, fill: C.blue.s }));

  const colW = (RW - 32 - 32) / 3;
  const bx = [RX + 16, RX + 16 + colW + 16, RX + 16 + 2 * (colW + 16)];
  const by1 = RY + 46, by2 = RY + 126, bh = 56;
  const sub = [
    { n: 3, label: 'Reasoning', cn: '规划', c: C.blue, x: bx[0], y: by1 },
    { n: 4, label: 'Retrieving', cn: '检索', c: C.cyan, x: bx[1], y: by1 },
    { n: 5, label: 'Acting', cn: '工具 / 写图', c: C.violet, x: bx[2], y: by1 },
    { n: 8, label: 'AwaitingResult', cn: '等工具结果', c: C.amber, x: bx[0], y: by2 },
    { n: 6, label: 'Verifying', cn: '验收', c: C.green, x: bx[1], y: by2 },
    { n: 7, label: 'Finalizing', cn: '提交 / 沉淀', c: C.green, x: bx[2], y: by2 },
  ];
  sub.forEach((s) => {
    parts.push(rect(s.x, s.y, colW, bh, s.c, { rx: 8, width: 1.3 }));
    parts.push(badge(s.x + 15, s.y + 15, s.n, { r: 9.5, color: s.c, size: 11 }));
    parts.push(text(s.x + 30, s.y + 19, s.label, { size: 11, weight: 700, fill: s.c.s }));
    parts.push(text(s.x + 12, s.y + 40, s.cn, { size: 9.5, fill: C.muted }));
  });
  const mk = (c) => (c === C.blue ? 'blue' : c === C.cyan ? 'cyan' : c === C.violet ? 'violet' : c === C.amber ? 'amber' : 'green');
  const put = (s) => arrow(s[0], s[1], s[2], s[3], { stroke: s[4].s, marker: `arrow-${mk(s[4])}`, width: 1.4 });
  // top row
  parts.push(put([bx[0] + colW, by1 + 28, bx[1], by1 + 28, C.blue]));
  parts.push(put([bx[1] + colW, by1 + 28, bx[2], by1 + 28, C.cyan]));
  // Acting -> AwaitingResult (corridor below row1)
  parts.push(poly([[bx[2] + 30, by1 + bh], [bx[2] + 30, by1 + bh + 14], [bx[0] + 40, by1 + bh + 14], [bx[0] + 40, by2 - 2]], { stroke: C.violet.s, width: 1.4, marker: 'arrow-violet' }));
  // AwaitingResult -> Reasoning (back up)
  parts.push(arrow(bx[0] + 12, by2, bx[0] + 12, by1 + bh + 2, { stroke: C.amber.s, marker: 'arrow-amber', width: 1.4 }));
  parts.push(text(bx[0] + 6, by2 - 6, '工具结果', { size: 8.5, fill: C.amber.s }));
  // Verifying -> Finalizing (pass) ; Verifying -> Acting (fail back, below row2)
  parts.push(put([bx[1] + colW, by2 + 28, bx[2], by2 + 28, C.green]));
  parts.push(poly([[bx[1] + 40, by2 + bh], [bx[1] + 40, by2 + bh + 16], [bx[2] + 40, by2 + bh + 16], [bx[2] + 40, by2 + bh + 2]], { stroke: C.rose.s, width: 1.4, dash: '4 3', marker: 'arrow-rose' }));
  parts.push(text(bx[1] + 46, by2 + bh + 30, '验收失败 → 回流执行', { size: 8.5, fill: C.rose.s }));

  // top-level states
  const IY = 476, IH = 54;
  const idle = { x: 96, w: 150 }, au = { x: 420, w: 190 }, st = { x: 716, w: 140 };
  parts.push(rect(idle.x, IY, idle.w, IH, C.slate, { rx: 9, width: 1.3 }));
  parts.push(badge(idle.x + 16, IY + 27, 1, { r: 9.5, color: C.slate, size: 11 }));
  parts.push(text(idle.x + 32, IY + 24, 'Idle', { size: 12, weight: 700 }));
  parts.push(text(idle.x + 32, IY + 40, '空闲 / 待命', { size: 9.5, fill: C.muted }));
  parts.push(rect(au.x, IY, au.w, IH, C.rose, { rx: 9, width: 1.3 }));
  parts.push(badge(au.x + 16, IY + 27, 8, { r: 9.5, color: C.rose, size: 11 }));
  parts.push(text(au.x + 32, IY + 24, 'AwaitingUser', { size: 12, weight: 700, fill: C.rose.s }));
  parts.push(text(au.x + 32, IY + 40, '等待用户（在环）', { size: 9.5, fill: C.muted }));
  parts.push(rect(st.x, IY, st.w, IH, C.slate, { rx: 9, width: 1.3 }));
  parts.push(badge(st.x + 16, IY + 27, 10, { r: 9.5, color: C.slate, size: 11 }));
  parts.push(text(st.x + 32, IY + 24, 'Stopped', { size: 12, weight: 700 }));
  parts.push(text(st.x + 32, IY + 40, '终态 · 观测点', { size: 9.5, fill: C.muted }));
  // transitions
  parts.push(arrow(idle.x + 75, IY, RX + 40, RY + RH + 2, { stroke: C.blue.s, marker: 'arrow-blue', width: 1.5 }));
  parts.push(text(idle.x + 82, IY - 10, 'user_message', { size: 9, fill: C.blue.s }));
  parts.push(arrow(RX + 200, RY + RH, RX + 200, IY - 2, { stroke: C.slate.s, width: 1.4 }));
  parts.push(text(RX + 206, RY + RH + 16, 'turn_done', { size: 9, fill: C.muted }));
  parts.push(arrow(RX + 470, RY + RH, au.x + 60, IY - 2, { stroke: C.rose.s, marker: 'arrow-rose', width: 1.4 }));
  parts.push(text(RX + 380, RY + RH + 16, 'need_clarification', { size: 9, fill: C.rose.s }));
  parts.push(arrow(au.x + 40, IY, au.x + 40, RY + RH + 30, { stroke: C.rose.s, marker: 'arrow-rose', width: 1.4 }));
  parts.push(text(au.x + 46, IY - 10, 'user_reply', { size: 9, fill: C.rose.s }));
  parts.push(arrow(au.x + au.w, IY + 27, st.x, IY + 27, { stroke: C.slate.s, width: 1.4 }));
  parts.push(text(st.x - 6, IY + 20, 'stop（任意状态）→', { size: 9, fill: C.muted, anchor: 'end' }));

  // background orthogonal region
  const gy = 540, gh = 52;
  parts.push(rect(110, gy, 690, gh, C.amber, { rx: 10, width: 1.3, dash: '5 4' }));
  parts.push(text(124, gy + 18, '后台任务（正交区域）', { size: 10.5, weight: 700, fill: C.amber.s }));
  parts.push(badge(690, gy + 12, 9, { r: 9.5, color: C.amber, size: 11 }));
  const bg = ['Submitted', 'Running', 'Done', 'Failed'];
  let bxx = 250;
  bg.forEach((b, i) => {
    parts.push(rect(bxx, gy + 22, 116, 24, C.amber, { rx: 6, width: 1.1 }));
    parts.push(text(bxx + 58, gy + 38, b, { size: 9.5, weight: 600, fill: C.text, anchor: 'middle' }));
    if (i < bg.length - 1) parts.push(arrow(bxx + 116, gy + 34, bxx + 130, gy + 34, { stroke: C.amber.s, marker: 'arrow-amber', width: 1.2 }));
    bxx += 130;
  });
  parts.push(poly([[568, gy], [568, RY + RH + 8]], { stroke: C.amber.s, width: 1.4, dash: '5 4', marker: 'arrow-amber' }));
  parts.push(text(574, RY + RH + 24, 'background_task_done（唤醒）', { size: 8.5, fill: C.amber.s }));

  return frame(p, parts.join('\n'));
}

/* --------------------------------------------------------------- page 2 */
function genP2() {
  const p = P('p2');
  const parts = [];
  const gap = 24;
  const cw = (CW - 3 * gap) / 4;
  parts.push(arrow(M + 40, 176, W - M - 40, 176, { stroke: C.rose.s, marker: 'arrow-rose', width: 1.6 }));
  parts.push(text(W / 2, 164, '写码越快 → 熵增与验证税越重', { size: 12.5, fill: C.rose.s, anchor: 'middle', weight: 700 }));
  p.pains.forEach((pn, i) => {
    parts.push(kpiCard(M + i * (cw + gap), 210, cw, 250, { v: pn.big, label: pn.head, note: pn.line, color: C.rose }));
  });
  return frame(p, parts.join('\n'));
}

/* --------------------------------------------------------------- page 3 */
function genP3() {
  const p = P('p3');
  const parts = [];
  parts.push(arrow(78, 168, 78, 560, { stroke: C.green.s, marker: 'arrow-green', width: 1.6 }));
  parts.push(text(30, 150, '5 个样本', { size: 10, fill: C.green.s, weight: 700 }));
  const y0 = 160, h = 76, gap = 12;
  p.cases.forEach((cse, i) => {
    parts.push(rowItem(104, y0 + i * (h + gap), W - M - 104, h, cse.n, cse.head, cse.line, C.green, cse.metric));
  });
  return frame(p, parts.join('\n'));
}

/* --------------------------------------------------------------- page 4 */
function genP4() {
  const p = P('p4');
  const parts = [];
  const LX = M, LW = 300, RX = 372, RW = W - M - RX;
  parts.push(sectionLabel(LX, 152, '启发', { color: C.amber.s, width: LW }));
  p.insight.forEach((it, i) => {
    parts.push(rowItem(LX, 168 + i * 78, LW, 66, i + 1, '', it, C.amber));
  });
  parts.push(sectionLabel(RX, 152, '解法：本体 + 图谱 = 人机交流窗口', { color: C.blue.s, width: RW }));

  const x = RX, w = RW;
  const inX = x + 16, inW = w - 32;
  // ontology
  parts.push(rect(inX, 168, inW, 52, C.cyan, { rx: 8, width: 1.3 }));
  parts.push(text(inX + 14, 188, '① 本体 = 共同语言', { size: 11, weight: 700, fill: C.cyan.s }));
  parts.push(text(inX + 14, 206, '元素 / 关系类型即词汇与语法；项目可 extends 自己的领域本体', { size: 9.5, fill: C.muted }));
  // window
  const gy = 240, gH = 132, gW = 190;
  const gx = inX + (inW - gW) / 2;
  const human = { x: inX, y: gy + 26, w: 120, h: 72 };
  const agent = { x: inX + inW - 120, y: gy + 26, w: 120, h: 72 };
  parts.push(rect(human.x, human.y, human.w, human.h, C.green, { rx: 9, width: 1.4 }));
  parts.push(text(human.x + human.w / 2, human.y + 30, '人 · 领域专家', { size: 11, anchor: 'middle', weight: 700, fill: C.green.s }));
  parts.push(text(human.x + human.w / 2, human.y + 48, '写意图 · 读结论', { size: 9, anchor: 'middle', fill: C.muted }));
  parts.push(rect(agent.x, agent.y, agent.w, agent.h, C.violet, { rx: 9, width: 1.4 }));
  parts.push(text(agent.x + agent.w / 2, agent.y + 30, 'Agent · 编排者', { size: 11, anchor: 'middle', weight: 700, fill: C.violet.s }));
  parts.push(text(agent.x + agent.w / 2, agent.y + 48, '读上下文 · 写实现', { size: 9, anchor: 'middle', fill: C.muted }));
  parts.push(rect(gx, gy, gW, gH, C.blue, { rx: 10, width: 1.6 }));
  parts.push(text(gx + gW / 2, gy + 26, '意图图谱', { size: 12.5, anchor: 'middle', weight: 700, fill: C.blue.s }));
  parts.push(text(gx + gW / 2, gy + 44, 'canonical · 单一事实源', { size: 9, anchor: 'middle', fill: C.muted }));
  parts.push(text(gx + gW / 2, gy + 68, '业务 · 架构 · 指标 · 状态机', { size: 9.5, anchor: 'middle', fill: C.text }));
  parts.push(text(gx + gW / 2, gy + 88, 'Graph RAG：语义 + 结构', { size: 9, anchor: 'middle', fill: C.cyan.s }));
  parts.push(text(gx + gW / 2, gy + 106, '证据链 · 出处 · 拒答', { size: 9, anchor: 'middle', fill: C.faint }));
  parts.push(arrow(human.x + human.w, gy + 40, gx - 2, gy + 30, { stroke: C.green.s, marker: 'arrow-green', width: 1.4 }));
  parts.push(text((human.x + human.w + gx) / 2, gy + 24, '写意图', { size: 8.5, anchor: 'middle', fill: C.green.s }));
  parts.push(arrow(gx - 2, gy + 96, human.x + human.w, gy + 86, { stroke: C.green.s, marker: 'arrow-green', width: 1.4 }));
  parts.push(text((human.x + human.w + gx) / 2, gy + 112, '证据 / 结论', { size: 8.5, anchor: 'middle', fill: C.green.s }));
  parts.push(arrow(gx + gW + 2, gy + 30, agent.x - 2, gy + 40, { stroke: C.violet.s, marker: 'arrow-violet', width: 1.4 }));
  parts.push(text((gx + gW + agent.x) / 2, gy + 24, '读 · Graph RAG', { size: 8.5, anchor: 'middle', fill: C.violet.s }));
  parts.push(arrow(agent.x - 2, gy + 86, gx + gW + 2, gy + 96, { stroke: C.violet.s, marker: 'arrow-violet', width: 1.4 }));
  parts.push(text((gx + gW + agent.x) / 2, gy + 112, '写实现 + 验收', { size: 8.5, anchor: 'middle', fill: C.violet.s }));
  // gate
  parts.push(rect(inX, 388, inW, 48, C.amber, { rx: 8, width: 1.3 }));
  parts.push(text(inX + 14, 406, '写入门禁 · 语言的护栏', { size: 10.5, weight: 700, fill: C.amber.s }));
  parts.push(text(inX + 14, 423, '校验 → 去重（L0 / L1）→ 无损（merge / 墓碑）；读写都经 MCP', { size: 9.5, fill: C.muted }));
  // federation
  parts.push(rect(inX, 446, inW, 46, C.violet, { rx: 8, width: 1.3 }));
  parts.push(text(inX + 14, 464, '④ 从单项目到组织', { size: 10.5, weight: 700, fill: C.violet.s }));
  parts.push(text(inX + 14, 481, '跨项目引用 → 联邦式组织级知识图谱（引用不拷贝）', { size: 9.5, fill: C.muted }));
  // base
  parts.push(rect(inX, 502, inW, 44, C.slate, { rx: 8, width: 1.2 }));
  parts.push(text(inX + 14, 520, 'Base · Acme（ArchiMate 3.2 + UML 2 状态机）→ extends 领域本体', { size: 10, weight: 600, fill: C.text }));
  return frame(p, parts.join('\n'));
}

/* --------------------------------------------------------------- page 5 */
function genP5() {
  const p = P('p5');
  const parts = [];
  const LX = M, LW = 560, RX = 636, RW = W - M - RX;
  parts.push(sectionLabel(LX, 152, '指标 ↔ 状态机映射', { color: C.blue.s, width: LW }));
  const rowH = 46, h = 38, y0 = 164;
  p.groups.forEach((g, i) => {
    const y = y0 + i * rowH;
    const col = [C.slate, C.blue, C.blue, C.cyan, C.violet, C.green, C.green, C.amber, C.slate][i];
    parts.push(rect(LX, y, 190, h, col, { rx: 8, width: 1.2 }));
    parts.push(text(LX + 12, y + 16, g.stateLabel, { size: 10.5, weight: 700, fill: col.s }));
    parts.push(text(LX + 12, y + 31, g.cn, { size: 9, fill: C.muted }));
    if (g.metrics[0] !== '（观测点）') parts.push(arrow(LX + 190, y + h / 2, LX + 208, y + h / 2, { stroke: col.s, width: 1.2 }));
    parts.push(text(LX + 216, y + h / 2 + 4, g.metrics.join(' · '), { size: 10.5, fill: C.muted }));
  });

  // right: coverage + takeaways
  const st = p.status;
  const total = st.measured + st.partial + st.notMeasured;
  parts.push(sectionLabel(RX, 152, `度量覆盖：${total} 个指标`, { color: C.green.s, width: RW }));
  const barY = 168, barH = 30;
  const segs = [
    { v: st.measured, color: C.green, label: 'measured' },
    { v: st.partial, color: C.amber, label: 'partial' },
    { v: st.notMeasured, color: C.rose, label: 'not_measured' },
  ];
  let sx = RX;
  segs.forEach((s) => {
    const w = (s.v / total) * RW;
    recRect(sx, barY, w, barH, s.color.s, 'transparent', 0, 4);
    parts.push(`<rect x="${sx}" y="${barY}" width="${w}" height="${barH}" rx="4" fill="${s.color.s}"/>`);
    parts.push(text(sx + 10, barY + 20, `${s.v}  ${s.label}`, { size: 11, weight: 700, fill: '#ffffff' }));
    sx += w;
  });
  parts.push(text(RX, barY + barH + 22, st.note, { size: 10, fill: C.muted }));
  parts.push(sectionLabel(RX, 264, '结论与下一步', { color: C.blue.s, width: RW }));
  p.takeaways.forEach((t, i) => {
    parts.push(rowItem(RX, 278 + i * 58, RW, 50, null, t, '', i === 2 ? C.rose : C.blue));
  });
  return frame(p, parts.join('\n'));
}

/* --------------------------------------------------------------- page 6 */
function genP6() {
  const p = P('p6');
  const parts = [];
  const LX = M, LW = 792, RX = 864, RW = W - M - RX;
  const phases = [
    { name: '写入', color: C.blue, y: 152, h: 196, ids: ['L1', 'L2', 'L3', 'L4'] },
    { name: '检索', color: C.cyan, y: 358, h: 104, ids: ['L5', 'L6'] },
    { name: '生成与闭环', color: C.green, y: 472, h: 104, ids: ['L7', 'L8'] },
  ];
  const byId = new Map(p.stages.map((s) => [s.id, s]));
  const covById = new Map(p.coverage.map((c) => [c.id, c]));
  const statusColor = { covered: C.green, replaced: C.cyan, partial: C.amber };
  parts.push(sectionLabel(LX, 152, '业界通用流程（Graph RAG 全景）', { color: C.cyan.s, width: LW }));
  phases.forEach((ph) => {
    parts.push(rect(LX, ph.y + 12, LW, ph.h - 12, ph.color, { rx: 10, width: 1.1, dash: '4 4' }));
    parts.push(text(LX + 12, ph.y + 30, ph.name, { size: 11.5, weight: 700, fill: ph.color.s }));
    const n = ph.ids.length;
    const bw = (LW - 24 - (n - 1) * 12) / n;
    ph.ids.forEach((id, j) => {
      const s = byId.get(id);
      const c = covById.get(id);
      const col = statusColor[c.status] || C.slate;
      const x = LX + 12 + j * (bw + 12);
      const y = ph.y + 44;
      parts.push(rect(x, y, bw, 52, col, { rx: 8, width: 1.4 }));
      parts.push(text(x + 10, y + 18, `${s.id} · ${s.name}`, { size: 10, weight: 700, fill: C.text }));
      parts.push(text(x + 10, y + 34, s.sub, { size: 8.8, fill: C.muted }));
      parts.push(text(x + 10, y + 47, c.status === 'covered' ? '✓ 覆盖' : c.status === 'replaced' ? '◎ 本体替代' : '◐ 部分', { size: 8.5, weight: 700, fill: col.s }));
    });
  });
  // feedback loop
  parts.push(poly([[LX + LW / 2, 576], [LX + LW / 2, 590], [LX + 30, 590], [LX + 30, 200]], { stroke: C.rose.s, width: 1.4, dash: '5 4', marker: 'arrow-rose' }));
  parts.push(text(LX + 40, 586, '评估反馈 → 索引 / 权重 / 提示', { size: 9, fill: C.rose.s }));

  parts.push(sectionLabel(RX, 152, '环节覆盖（我方）', { color: C.green.s, width: RW }));
  p.coverage.forEach((c, i) => {
    const y = 166 + i * 54;
    const col = statusColor[c.status] || C.slate;
    parts.push(rect(RX, y, RW, 48, { f: '#ffffff', s: col.s }, { rx: 8, width: 1.1 }));
    parts.push(badge(RX + 22, y + 24, c.id, { r: 13, color: col, size: 10 }));
    parts.push(text(RX + 44, y + 20, c.note, { size: 10, weight: 600, fill: C.text }));
    parts.push(text(RX + 44, y + 36, `指标 #${c.metrics}`, { size: 9, fill: col.s }));
  });
  return frame(p, parts.join('\n'));
}

/* --------------------------------------------------------------- page 7 */
function genP7() {
  const p = P('p7');
  const parts = [];
  const LX = M, LW = 704, RX = 780, RW = W - M - RX;
  parts.push(sectionLabel(LX, 152, 'Graph MCP（单项目内即可用）', { color: C.blue.s, width: LW }));
  const y0 = 164, h = 52, gap = 8;
  p.tools.forEach((t, i) => {
    const y = y0 + i * (h + gap);
    const col = t.id.startsWith('R') ? C.blue : t.id.startsWith('W') ? C.violet : C.cyan;
    parts.push(rect(LX, y, LW, h, { f: '#ffffff', s: col.s }, { rx: 10, width: 1.2 }));
    recRect(LX, y, 4, h, col.s, 'transparent', 0, 2);
    parts.push(`<rect x="${LX}" y="${y}" width="4" height="${h}" rx="2" fill="${col.s}"/>`);
    const pr = pill(LX + 14, y + (h - 18) / 2, t.id, col, { size: 10, h: 18 });
    parts.push(pr.svg);
    parts.push(text(LX + pr.w + 28, y + 22, t.head, { size: 13, weight: 700, fill: C.text }));
    parts.push(text(LX + pr.w + 28, y + 40, t.text, { size: 10.5, fill: C.muted }));
  });
  parts.push(sectionLabel(RX, 152, '度量结果（可复现）', { color: C.green.s, width: RW }));
  const cw = (RW - 16) / 2, ch = 150;
  p.kpis.forEach((k, i) => {
    const cx = RX + (i % 2) * (cw + 16);
    const cy = 164 + Math.floor(i / 2) * (ch + 16);
    parts.push(kpiCard(cx, cy, cw, ch, { v: k.v, label: k.label, note: k.note, color: C.green }));
  });
  return frame(p, parts.join('\n'));
}

/* --------------------------------------------------------------- page 8 */
function genP8() {
  const p = P('p8');
  const parts = [];
  // scheme band
  parts.push(rect(M, 136, CW, 52, C.blue, { rx: 10, width: 1.2 }));
  parts.push(text(M + 16, 158, '整体方案', { size: 11, weight: 700, fill: C.blue.s }));
  parts.push(text(M + 16, 176, '单项目 = 一个自治的知识图谱单元；以联邦方式组合 → 组织级知识图谱（组织知识库）', { size: 11.5, fill: C.text }));
  // benefits (left)
  const LX = M, LW = 330;
  parts.push(sectionLabel(LX, 218, '三大好处', { color: C.green.s, width: LW }));
  p.benefits.forEach((b, i) => {
    parts.push(rowItem(LX, 232 + i * 96, LW, 84, b.n, b.head, b.text, C.green));
  });
  // diagram (right)
  const DX = 410, DW = W - M - DX;
  parts.push(sectionLabel(DX, 218, '联邦组合示意', { color: C.violet.s, width: DW }));
  const ix = DX, iw = DW;
  // org KG
  parts.push(rect(ix + 20, 232, iw - 40, 52, C.green, { rx: 9, width: 1.3 }));
  parts.push(text(ix + 34, 254, '组织级知识图谱（组织知识库）', { size: 11.5, weight: 700, fill: C.green.s }));
  parts.push(text(ix + 34, 272, '领域知识彼此可见可用 · 权限统一管控 · 内容是各项目自己的图', { size: 9.5, fill: C.muted }));
  // center
  parts.push(rect(ix + 20, 306, iw - 40, 66, C.violet, { rx: 9, width: 1.3 }));
  parts.push(text(ix + 34, 328, '联邦中心（registry + broker）', { size: 11, weight: 700, fill: C.violet.s }));
  const caps = p.status.map((s) => `${s.k} ${s.v}`);
  let px = ix + 34;
  caps.forEach((c) => { const pr = pill(px, 338, c, C.violet, { size: 9, h: 18 }); parts.push(pr.svg); px += pr.w + 8; });
  parts.push(text(ix + 34, 366, '中心只持联邦元数据（成员 / 能力 / 接口 / 授权），不持有成员内容', { size: 9, fill: C.muted }));
  // members
  const mem = p.members;
  const mw = (iw - 40 - (mem.length - 1) * 8) / mem.length;
  mem.forEach((mn, i) => {
    const x = ix + 20 + i * (mw + 8);
    const self = mn === 'archgraph';
    const col = self ? C.blue : C.slate;
    parts.push(rect(x, 404, mw, 66, col, { rx: 8, width: 1.2 }));
    parts.push(text(x + 8, 426, clipToWidth(mn, 9, mw - 14), { size: 9.5, weight: 700, fill: self ? C.blue.s : C.text }));
    parts.push(text(x + 8, 442, 'canonical 图', { size: 8, fill: C.muted }));
    parts.push(text(x + 8, 454, '本体可 extends', { size: 8, fill: C.muted }));
    parts.push(arrow(x + mw / 2, 404, x + mw / 2, 378, { stroke: col.s, marker: self ? 'arrow-blue' : 'arrow', width: 1.1, dash: '3 3' }));
  });
  parts.push(arrow(ix + 60, 306, ix + 60, 288, { stroke: C.violet.s, marker: 'arrow-violet', width: 1.4 }));
  parts.push(text(ix + 70, 300, '组合 = 组织级知识图谱', { size: 9, fill: C.violet.s }));
  return frame(p, parts.join('\n'));
}

/* --------------------------------------------------------------- page 9 */
function genP9() {
  const p = P('p9');
  const parts = [];
  const cols = [
    { label: '#', w: 30 }, { label: '指标 / 分组', w: 220 }, { label: '状态机', w: 110 },
    { label: '状态', w: 90 }, { label: '我方评测结果', w: 380 }, { label: '下一步', w: 354 },
  ];
  const total = cols.reduce((s, c) => s + c.w, 0);
  const x = M, y = 140, headH = 26, rowH = 22;
  recRect(x, y, total, headH, '#f1f5f9', '#e2e8f0', 1, 6);
  parts.push(`<rect x="${x}" y="${y}" width="${total}" height="${headH}" rx="6" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="1"/>`);
  let cx = x;
  cols.forEach((c) => { parts.push(text(cx + 8, y + 17, c.label, { size: 10, weight: 700, fill: C.text })); cx += c.w; });
  const status = { measured: ['✓ 实测', C.green], partial: ['◐ 部分', C.amber], not_measured: ['✗ 未测', C.rose] };
  let ry = y + headH;
  p.metrics.forEach((m, i) => {
    if (i % 2 === 1) {
      recRect(x, ry, total, rowH, '#f8fafc', 'transparent', 0, 0);
      parts.push(`<rect x="${x}" y="${ry}" width="${total}" height="${rowH}" fill="#f8fafc"/>`);
    }
    const sc = status[m.status];
    const cells = [String(m.n), `${m.name}｜${m.group}`, m.state, sc[0], m.result, m.action];
    const fills = [C.faint, C.text, C.faint, sc[1].s, C.muted, C.cyan.s];
    let ccx = x;
    cells.forEach((cell, ci) => {
      parts.push(text(ccx + 8, ry + 15, clipToWidth(cell, 9.2, cols[ci].w - 14), { size: 9.2, fill: fills[ci], weight: ci === 1 ? 600 : 400 }));
      ccx += cols[ci].w;
    });
    recLine([[x, ry], [x + total, ry]], '#eef2f7', 1, '', false);
    parts.push(`<line x1="${x}" y1="${ry}" x2="${x + total}" y2="${ry}" stroke="#eef2f7" stroke-width="1"/>`);
    ry += rowH;
  });
  return frame(p, parts.join('\n'));
}

/* ------------------------------------------------------------------- main */
const FILES = {
  'p1-state-machine.svg': genP1,
  'p2-pains.svg': genP2,
  'p3-practices.svg': genP3,
  'p4-solution.svg': genP4,
  'p5-metrics.svg': genP5,
  'p6-pipeline.svg': genP6,
  'p7-capability.svg': genP7,
  'p8-federation.svg': genP8,
  'p9-metric-detail.svg': genP9,
};

function toExcalidraw(elements, name) {
  return JSON.stringify(
    {
      type: 'excalidraw', version: 2, source: 'https://archgraph.local/coding-business-deck',
      elements,
      appState: { viewBackgroundColor: '#ffffff', gridSize: 20, gridStep: 20, gridModeEnabled: false, name, exportWithDarkMode: false },
      files: {},
    },
    null, 2
  );
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(EX_DIR, { recursive: true, force: true });
  fs.mkdirSync(EX_DIR, { recursive: true });
  const check = process.argv.includes('--check');
  let Resvg;
  if (check) Resvg = require('@resvg/resvg-js').Resvg;
  for (const [name, fn] of Object.entries(FILES)) {
    SCENE = []; _eid = 0; _srand(20261007);
    recRect(0, 0, W, H, '#ffffff', 'transparent', 0, 0);
    const content = fn();
    fs.writeFileSync(path.join(OUT_DIR, name), content, 'utf8');
    const exName = name.replace(/\.svg$/, '.excalidraw');
    fs.writeFileSync(path.join(EX_DIR, exName), toExcalidraw(SCENE, PLAN.title), 'utf8');
    let note = '';
    if (check) {
      const img = new Resvg(content, { font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei' } }).render();
      note = ` (renders ${img.width}x${img.height}, ${img.asPng().length} bytes)`;
    }
    console.log(`wrote docs/ppt/assets/${name} + docs/ppt/excalidraw/${exName} (${SCENE.length} elements)${note}`);
  }
  fs.writeFileSync(path.join(ROOT, 'docs', 'ppt', 'preview.html'), genPreviewHtml(), 'utf8');
  console.log('wrote docs/ppt/preview.html');
}

function genPreviewHtml() {
  const pages = PLAN.pages
    .map((p) => `    <figure class="slide"><img src="assets/${p.diagram}.svg" alt="${esc(p.title)}" /><figcaption><b>${esc(p.kicker)}</b>${esc(p.title)}</figcaption></figure>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(PLAN.title)} — 预览</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f4f7fb; color: #0f172a; font-family: 'Microsoft YaHei', 'Segoe UI', 'Noto Sans SC', sans-serif; }
  header { padding: 28px 32px 12px; } h1 { margin: 0 0 6px; font-size: 22px; }
  p.sub { margin: 0; color: #475569; font-size: 13.5px; line-height: 1.7; }
  p.note { margin: 10px 0 0; font-size: 12.5px; color: #64748b; }
  main { padding: 18px 32px 48px; display: flex; flex-direction: column; gap: 26px; }
  figure.slide { margin: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 12px 30px rgba(15,23,42,0.08); }
  figure.slide img { display: block; width: 100%; height: auto; }
  figcaption { padding: 10px 14px; font-size: 12.5px; color: #475569; border-top: 1px solid #eef2f7; }
  figcaption b { color: #2457e6; margin-right: 8px; }
  @media print { body { background: #fff; } figure.slide { break-inside: avoid; } }
</style></head>
<body><header><h1>${esc(PLAN.title)}</h1><p class="sub">${esc(PLAN.subtitle)}</p>
<p class="note">${esc(PLAN.evidenceNote)} editable diagrams: docs/ppt/excalidraw/*.excalidraw</p></header>
<main>
${pages}
</main></body></html>`;
}

if (require.main === module) main();
module.exports = { FILES, W, H, toExcalidraw };
