'use strict';

/**
 * Generate the five ArchGraph deck diagrams as self-contained dark SVG.
 *
 *   node scripts/gen-coding-deck.js          # write docs/ppt/assets/*.svg
 *   node scripts/gen-coding-deck.js --check   # also rasterize (resvg) to validate
 *
 * The page content lives in docs/ppt/content-plan.json (single source of truth);
 * scripts/build-coding-deck-pptx.js embeds the rasterized PNGs into the PPTX and
 * tests/coding-business-deck.test.js asserts plan <-> diagram consistency.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'ppt', 'assets');
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'ppt', 'content-plan.json'), 'utf8'));

const W = 1280;
const H = 720;

const C = {
  bg: '#0a0e1a',
  grid: '#161f36',
  text: '#eef1f6',
  muted: '#9aa6bd',
  faint: '#6b7793',
  dim: '#4b5670',
  blue: { f: 'rgba(107,140,255,0.13)', s: '#6b8cff' },
  cyan: { f: 'rgba(34,211,238,0.11)', s: '#22d3ee' },
  green: { f: 'rgba(52,211,153,0.12)', s: '#34d399' },
  violet: { f: 'rgba(167,139,250,0.13)', s: '#a78bfa' },
  amber: { f: 'rgba(251,191,36,0.11)', s: '#fbbf24' },
  rose: { f: 'rgba(251,113,133,0.11)', s: '#fb7185' },
  slate: { f: 'rgba(148,163,184,0.09)', s: '#94a3b8' },
  hot: '#ff6b8a',
};

const FAMILY =
  "'Microsoft YaHei', 'Segoe UI', 'Noto Sans SC', 'PingFang SC', Roboto, Helvetica, Arial, sans-serif";
const MONO = "Consolas, 'Cascadia Code', ui-monospace, monospace";

/* ---------------------------------------------------------------- helpers */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const clip = (s, n) => (s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…');

function text(x, y, s, o = {}) {
  const {
    size = 12,
    fill = C.text,
    anchor = 'start',
    weight = 400,
    opacity = 1,
    mono = false,
    italic = false,
  } = o;
  const fam = mono ? MONO : FAMILY;
  return (
    `<text x="${x}" y="${y}" font-family="${fam}" font-size="${size}" font-weight="${weight}"` +
    ` fill="${fill}" text-anchor="${anchor}" opacity="${opacity}"${italic ? ' font-style="italic"' : ''}>${esc(s)}</text>`
  );
}

function rect(x, y, w, h, color, o = {}) {
  const { rx = 10, dash = '', width = 1.4, fillOverride } = o;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fillOverride || color.f}"` +
    ` stroke="${color.s}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
  );
}

/** width estimate: CJK ≈ 1.0em, ASCII ≈ 0.55em */
function strWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) w += /[\u2E80-\u9FFF\uFF00-\uFF60\u3000-\u303F]/.test(ch) ? size : size * 0.55;
  return w;
}

function wrap(s, size, maxWidth, maxLines = 99) {
  const out = [];
  let line = '';
  let lineW = 0;
  for (const ch of String(s)) {
    if (ch === '\n') {
      out.push(line);
      line = '';
      lineW = 0;
      continue;
    }
    const cw = /[\u2E80-\u9FFF\uFF00-\uFF60\u3000-\u303F]/.test(ch) ? size : size * 0.55;
    if (lineW + cw > maxWidth && line) {
      out.push(line);
      line = ch;
      lineW = cw;
    } else {
      line += ch;
      lineW += cw;
    }
  }
  if (line) out.push(line);
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept[maxLines - 1] = clip(kept[maxLines - 1] + '…', kept[maxLines - 1].length + 40);
    return kept;
  }
  return out;
}

/** wrapped paragraph; returns the y after the last line */
function para(x, y, s, o = {}) {
  const { size = 11, fill = C.muted, maxWidth = 200, lh = null, maxLines = 99, weight = 400 } = o;
  const lines = wrap(s, size, maxWidth, maxLines);
  const step = lh || size + 6;
  const parts = lines.map((ln, i) => text(x, y + i * step, ln, { size, fill, weight }));
  return { svg: parts.join('\n'), endY: y + (lines.length - 1) * step, lines: lines.length };
}

function arrow(x1, y1, x2, y2, o = {}) {
  const { stroke = C.muted, width = 1.6, marker = 'arrow', dash = '' } = o;
  return (
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"` +
    ` marker-end="url(#${marker})"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
  );
}

function poly(points, o = {}) {
  const { stroke = C.muted, width = 1.6, dash = '', fill = 'none', marker = '' } = o;
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}${marker ? ` marker-end="url(#${marker})"` : ''}/>`;
}

function pill(x, y, label, color, o = {}) {
  const { size = 10.5, pad = 8, h = 19 } = o;
  const w = strWidth(label, size) + pad * 2;
  return {
    svg:
      `<rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color.f}" stroke="${color.s}" stroke-width="1"/>` +
      text(x + w / 2, y + h / 2 + size * 0.36, label, { size, fill: color.s, anchor: 'middle', weight: 600 }),
    w,
  };
}

/** numbered circle marker */
function badge(cx, cy, n, o = {}) {
  const { r = 11, color = C.blue, size = 12.5, fillText = '#0a0e1a' } = o;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color.s}" stroke="#0a0e1a" stroke-width="2"/>` +
    text(cx, cy + size * 0.36, String(n), { size, fill: fillText, anchor: 'middle', weight: 700 })
  );
}

function bullets(x, y, items, o = {}) {
  const { size = 10, fill = C.muted, dot = C.blue.s, maxWidth = 240, lh = 15, dotGap = 12, maxLines = 3 } = o;
  const parts = [];
  let cy = y;
  for (const it of items) {
    parts.push(`<circle cx="${x + 3}" cy="${cy - size * 0.32}" r="2.6" fill="${dot}"/>`);
    const r = para(x + dotGap, cy, it, { size, fill, maxWidth: maxWidth - dotGap, lh, maxLines });
    parts.push(r.svg);
    cy = r.endY + lh;
  }
  return parts.join('\n');
}

function table(x, y, cols, rows, o = {}) {
  const { size = 9.6, headSize = 9.8, rowH = 21, headH = 24, zebra = true, cellLines = 2 } = o;
  const total = cols.reduce((s, c) => s + c.w, 0);
  const parts = [];
  parts.push(
    `<rect x="${x}" y="${y}" width="${total}" height="${headH}" rx="6" fill="rgba(148,163,184,0.13)" stroke="rgba(148,163,184,0.22)" stroke-width="1"/>`
  );
  let cx = x;
  for (const c of cols) {
    parts.push(text(cx + 7, y + headH / 2 + headSize * 0.36, c.label, { size: headSize, weight: 700, fill: C.text }));
    cx += c.w;
  }
  let cy = y + headH;
  rows.forEach((row, ri) => {
    if (zebra && ri % 2 === 1) {
      parts.push(
        `<rect x="${x}" y="${cy}" width="${total}" height="${rowH}" fill="rgba(148,163,184,0.05)"/>`
      );
    }
    parts.push(
      `<line x1="${x}" y1="${cy}" x2="${x + total}" y2="${cy}" stroke="rgba(148,163,184,0.14)" stroke-width="1"/>`
    );
    let rx = x;
    cols.forEach((c, ci) => {
      const cell = row[ci];
      if (cell && typeof cell === 'object') {
        const p = para(rx + 7, cy + rowH / 2 - (cell.lines ? (cell.lines.length - 1) * 5 : 0) + size * 0.36, cell.text, {
          size: cell.size || size,
          fill: cell.fill || C.muted,
          maxWidth: c.w - 12,
          lh: 11,
          maxLines: cell.lines || cellLines,
        });
        parts.push(p.svg);
      } else if (cell != null && cell !== '') {
        parts.push(text(rx + 7, cy + rowH / 2 + size * 0.36, clip(String(cell), c.clip || 40), { size, fill: C.muted }));
      }
      rx += c.w;
    });
    cy += rowH;
  });
  parts.push(`<line x1="${x}" y1="${cy}" x2="${x + total}" y2="${cy}" stroke="rgba(148,163,184,0.18)" stroke-width="1"/>`);
  return { svg: parts.join('\n'), height: headH + rows.length * rowH, endY: cy };
}

function card(x, y, w, h, o = {}) {
  const { color = C.slate, title, n, numColor, titleSize = 12, dash = '', accent = true } = o;
  const parts = [rect(x, y, w, h, color, { rx: 10, dash })];
  if (accent) parts.push(`<rect x="${x}" y="${y}" width="3" height="${h}" rx="1.5" fill="${color.s}"/>`);
  let tx = x + 14;
  if (n != null) {
    parts.push(badge(x + 17, y + 19, n, { r: 10, color: numColor || color, size: 11.5 }));
    tx = x + 34;
  }
  if (title) parts.push(text(tx, y + 23, title, { size: titleSize, weight: 700 }));
  return parts.join('\n');
}

function sectionLabel(x, y, s, o = {}) {
  const { color = C.faint, size = 10, width = 0 } = o;
  const parts = [text(x, y, s, { size, fill: color, weight: 700 })];
  if (width) {
    parts.push(
      `<line x1="${x + strWidth(s, size) + 10}" y1="${y - 3.5}" x2="${x + width}" y2="${y - 3.5}" stroke="${C.grid}" stroke-width="1"/>`
    );
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
  <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0a0e1a"/><stop offset="55%" stop-color="#0b1120"/><stop offset="100%" stop-color="#0d1424"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bgGrad)"/>
<g opacity="0.5" stroke="${C.grid}" stroke-width="1">
${Array.from({ length: 15 }, (_, i) => `<line x1="0" y1="${i * 48 + 24}" x2="${W}" y2="${i * 48 + 24}"/>`).join('')}
</g>
${body}
</svg>`;
}

function pageHeader(p, o = {}) {
  const parts = [];
  parts.push(
    `<rect x="0" y="0" width="${W}" height="4" fill="url(#bgGrad)"/>` +
      `<rect x="0" y="0" width="240" height="4" fill="${C.blue.s}"/>`
  );
  parts.push(text(28, 30, p.kicker, { size: 10.5, fill: C.blue.s, weight: 700, mono: true }));
  parts.push(text(28, 60, p.title, { size: 25, weight: 700 }));
  if (p.subtitle) parts.push(text(28, 84, p.subtitle, { size: 11.5, fill: C.muted }));
  parts.push(`<line x1="28" y1="${o.ruleY || 96}" x2="${W - 28}" y2="${o.ruleY || 96}" stroke="${C.grid}" stroke-width="1"/>`);
  return parts.join('\n');
}

function pageFooter(p, refs) {
  const parts = [];
  parts.push(`<line x1="28" y1="${H - 40}" x2="${W - 28}" y2="${H - 40}" stroke="${C.grid}" stroke-width="1"/>`);
  const refText = refs && refs.length ? `依据：${refs.join('　·　')}` : '';
  if (refText) {
    const r = para(28, H - 24, refText, { size: 8.8, fill: C.faint, maxWidth: W - 200, lh: 11, maxLines: 1 });
    parts.push(r.svg);
  }
  parts.push(text(W - 28, H - 24, `ArchGraph · ${p.kicker}`, { size: 8.8, fill: C.dim, anchor: 'end', mono: true }));
  return parts.join('\n');
}

/* ---------------------------------------------------------- page 1 layout */

function drawStateMachine() {
  const parts = [];
  const X0 = 28;
  const Y0 = 108;
  const BW = 862;
  const BH = 520;
  parts.push(sectionLabel(X0, Y0 - 10, '① 业务价值流程 = 状态机（主体：一次 Agent 会话）', { color: C.blue.s, width: BW }));
  parts.push(rect(X0, Y0, BW, BH, C.slate, { rx: 14, dash: '5 5', width: 1.2 }));

  // --- orthogonal background region -------------------------------------
  const bgY = 540;
  const bgH = 78;
  parts.push(rect(X0 + 16, bgY, BW - 32, bgH, C.amber, { rx: 10, dash: '4 4', width: 1.2 }));
  parts.push(text(X0 + 30, bgY + 22, '正交区域 B · 后台任务（Region B）', { size: 11.5, weight: 700, fill: C.amber.s }));
  const bgNodes = [
    { label: 'Submitted', cn: '已提交' },
    { label: 'Running', cn: '运行中' },
    { label: 'Done', cn: '完成 → 抛事件唤醒主区域' },
    { label: 'Failed', cn: '失败' },
  ];
  const bw = 188;
  let bx = X0 + 30;
  bgNodes.forEach((n, i) => {
    parts.push(rect(bx, bgY + 30, bw, 36, C.amber, { rx: 7, width: 1.2 }));
    parts.push(text(bx + bw / 2, bgY + 46, `BG.${n.label}`, { size: 10.5, weight: 700, anchor: 'middle', fill: C.text }));
    parts.push(text(bx + bw / 2, bgY + 59, n.cn, { size: 8.4, anchor: 'middle', fill: C.muted }));
    if (i < bgNodes.length - 1) {
      parts.push(arrow(bx + bw + 4, bgY + 48, bx + bw + 18, bgY + 48, { stroke: C.amber.s, marker: 'arrow-amber', width: 1.4 }));
    }
    bx += bw + 22;
  });

  // --- main region -------------------------------------------------------
  const mY = 140;
  const mH = 386;
  parts.push(rect(X0 + 16, mY, BW - 32, mH, C.slate, { rx: 12, width: 1.2 }));
  parts.push(text(X0 + 30, mY + 20, '主体区域 · Coding Agent 会话', { size: 11.5, weight: 700, fill: C.muted }));

  // RUNNING composite
  const rY = mY + 32;
  const rH = 148;
  parts.push(rect(X0 + 34, rY, BW - 68, rH, C.blue, { rx: 10, width: 1.5 }));
  parts.push(text(X0 + 48, rY + 20, 'Running（执行回合）· 复合态：内部六个子状态', { size: 12, weight: 700, fill: C.blue.s }));

  const colW = (BW - 106) / 3;
  const rowY1 = rY + 32;
  const rowY2 = rY + 96;
  const nodeH = 42;
  const cols = [
    { x: X0 + 48, y: rowY1 },
    { x: X0 + 48 + colW + 12, y: rowY1 },
    { x: X0 + 48 + 2 * (colW + 12), y: rowY1 },
    { x: X0 + 48, y: rowY2 },
    { x: X0 + 48 + colW + 12, y: rowY2 },
    { x: X0 + 48 + 2 * (colW + 12), y: rowY2 },
  ];
  const nodes = [
    { n: 3, label: 'Reasoning', cn: '推理/规划', color: C.blue, metric: '计划正确率' },
    { n: 4, label: 'Retrieving', cn: '检索（KG-first）', color: C.cyan, metric: '检索召回与排序' },
    { n: 5, label: 'Acting', cn: '工具执行 / 写图', color: C.violet, metric: '工具成功率·轮次 / 去重·无损' },
    { n: 8, label: 'AwaitingResult', cn: '等工具结果（等待）', color: C.amber, metric: '等待/唤醒时延' },
    { n: 6, label: 'Verifying', cn: '验收（可执行 AT）', color: C.green, metric: '验收通过率与回归' },
    { n: 7, label: 'Finalizing', cn: '提交 / 交付 / 沉淀', color: C.green, metric: '登记完整率 · 记忆准确率' },
  ];
  const mk = (c) => (c === C.blue ? 'blue' : c === C.cyan ? 'cyan' : c === C.violet ? 'violet' : c === C.amber ? 'amber' : 'green');
  nodes.forEach((nd, i) => {
    const { x, y } = cols[i];
    parts.push(rect(x, y, colW, nodeH, nd.color, { rx: 8, width: 1.4 }));
    parts.push(badge(x + 15, y + 14, nd.n, { r: 9.5, color: nd.color, size: 11 }));
    parts.push(text(x + 29, y + 18, nd.label, { size: 11, weight: 700, fill: nd.color.s }));
    parts.push(text(x + 11, y + 32, nd.cn, { size: 9.2, fill: C.muted }));
    parts.push(text(x + 11, y + 42, `指标·${nd.metric}`, { size: 7.8, fill: C.faint }));
  });

  const cy = rowY1 + nodeH / 2;
  const cy2 = rowY2 + nodeH / 2;
  const seg = (x1, x2, y, label, color) => {
    parts.push(arrow(x1, y, x2, y, { stroke: color.s, marker: `arrow-${mk(color)}`, width: 1.5 }));
    if (label) parts.push(text((x1 + x2) / 2, y - 4, label, { size: 8.4, fill: color.s, anchor: 'middle' }));
  };
  seg(cols[0].x + colW, cols[1].x, cy, '需上下文', C.blue);
  seg(cols[1].x + colW, cols[2].x, cy, '决定动作', C.cyan);
  seg(cols[2].x + colW, cols[3].x + colW, cy2 - 4, '已派发', C.violet);
  // return: AwaitingResult -> Reasoning, routed through the left margin corridor
  parts.push(poly(
    [
      [cols[3].x, rowY2 + nodeH / 2],
      [cols[0].x + 30, rowY2 + nodeH / 2],
      [cols[0].x + 30, rowY1 + nodeH + 6],
      [cols[0].x + 88, rowY1 + nodeH + 6],
      [cols[0].x + 88, rowY1 + nodeH + 2],
    ],
    { stroke: C.amber.s, width: 1.5, marker: 'arrow-amber' }
  ));
  parts.push(text(cols[0].x + 96, rowY1 + nodeH + 24, '工具结果 → 回到推理', { size: 8.4, fill: C.amber.s }));
  seg(cols[0].x + colW, cols[4].x, cy, '实现完成', C.blue);
  // fail: Verifying -> Acting, routed through the bottom corridor of the composite
  parts.push(poly(
    [
      [cols[4].x + colW - 20, rowY2 + nodeH],
      [cols[4].x + colW - 20, rowY2 + nodeH + 13],
      [cols[2].x + 20, rowY2 + nodeH + 13],
      [cols[2].x + 20, rowY2 + nodeH + 2],
    ],
    { stroke: C.rose.s, width: 1.5, marker: 'arrow-rose' }
  ));
  parts.push(text(cols[3].x + colW + 46, rowY2 + nodeH + 24, '验收失败 → 回流执行', { size: 8.4, fill: C.rose.s }));
  seg(cols[4].x + colW, cols[5].x, cy2 - 4, '验收通过', C.green);

  // --- main states row ---------------------------------------------------
  const sY = mY + 256;
  const sW = 218;
  const sX = [X0 + 46, X0 + 294, X0 + 546];
  const states = [
    { n: 1, label: 'Idle', cn: '空闲/待命', color: C.slate, metric: '指标·空闲时长' },
    { n: 9, label: 'AwaitingUser', cn: '等待用户（人在回路）', color: C.rose, metric: '指标·请示频率与回环轮次' },
    { n: 11, label: 'Stopped', cn: '已停止（终态）', color: C.slate, metric: '指标·任务完成成功率（观测点）' },
  ];
  states.forEach((st, i) => {
    const x = sX[i];
    parts.push(rect(x, sY, sW, 38, st.color, { rx: 8, width: 1.4 }));
    parts.push(badge(x + 15, sY + 19, st.n, { r: 9.5, color: st.color, size: 11 }));
    parts.push(text(x + 29, sY + 16, st.label, { size: 11, weight: 700, fill: st.color.s }));
    parts.push(text(x + 29, sY + 29, st.cn, { size: 9, fill: C.muted }));
    parts.push(text(x + 12, sY + 50, st.metric, { size: 7.8, fill: C.faint }));
  });

  // T7 / T8 human loop
  parts.push(arrow(sX[0] + sW, sY + 28, sX[1], sY + 28, { stroke: C.rose.s, marker: 'arrow-rose', width: 1.5 }));
  parts.push(text(sX[0] + sW + 56, sY + 8, 'T7 need_clarification', { size: 8, fill: C.rose.s }));
  parts.push(poly(
    [
      [sX[1] - 70, sY],
      [sX[1] - 70, sY - 14],
      [sX[0] + sW / 2, sY - 14],
      [sX[0] + sW / 2, sY - 2],
    ],
    { stroke: C.rose.s, width: 1.5, marker: 'arrow-rose' }
  ));
  parts.push(text(sX[0] + sW / 2 + 4, sY - 18, 'T8 user_reply → 回 Running', { size: 8.4, fill: C.rose.s }));

  // T1: Idle -> Running (entry)
  parts.push(poly(
    [
      [sX[0] + sW / 2, sY],
      [sX[0] + sW / 2, rY + rH + 16],
      [X0 + 48 + colW / 2, rY + rH + 16],
      [X0 + 48 + colW / 2, rY + rH + 2],
    ],
    { stroke: C.blue.s, width: 1.6, marker: 'arrow-blue' }
  ));
  parts.push(text(X0 + 62, rY + rH + 12, 'T1 user_message[需外部动作] → Running', { size: 9, fill: C.blue.s, weight: 600 }));

  // T10: background_task_done cross-region wake (corridor between Running and Stopped)
  parts.push(poly(
    [
      [X0 + 30 + 2 * (bw + 22) + bw / 2, bgY],
      [X0 + 30 + 2 * (bw + 22) + bw / 2, 512],
      [X0 + 806, 512],
      [X0 + 806, rY + rH + 6],
    ],
    { stroke: C.amber.s, width: 1.6, marker: 'arrow-amber', dash: '5 4' }
  ));
  parts.push(text(X0 + 815, rY + rH + 20, 'T10 后台完成唤醒', { size: 8.4, fill: C.amber.s, weight: 600 }));

  // T11/T12: stop -> Stopped (shared exit bus at the bottom of the main region)
  parts.push(poly(
    [
      [sX[0] + sW / 2, sY + 38],
      [sX[0] + sW / 2, sY + 62],
      [sX[2] + sW / 2, sY + 62],
      [sX[2] + sW / 2, sY + 40],
    ],
    { stroke: C.slate.s, width: 1.5, marker: 'arrow' }
  ));
  parts.push(text(sX[0] + sW / 2 + 8, sY + 58, 'T11 / T12  stop → Stopped（任意状态可终止）', { size: 8.4, fill: C.muted }));

  // callout badges for transition groups
  parts.push(badge(X0 + 48 + colW / 2 + 6, rY + rH / 2 - 10, 13, { r: 9.5, color: C.cyan, size: 11 }));
  parts.push(badge(X0 + 650, rowY2 + nodeH + 13, 14, { r: 9.5, color: C.green, size: 11 }));
  parts.push(badge(X0 + 578, sY + 4, 15, { r: 9.5, color: C.rose, size: 11 }));
  parts.push(badge(X0 + 706, sY + 19, 16, { r: 9.5, color: C.slate, size: 11 }));
  parts.push(badge(X0 + 30 + 2 * (bw + 22) + bw / 2, bgY + 12, 10, { r: 9.5, color: C.amber, size: 11 }));

  return { svg: parts.join('\n'), nextX: X0 + BW + 8 };
}

function drawP1Legend(markers, x) {
  const parts = [];
  const width = W - 28 - x;
  parts.push(sectionLabel(x, 98, '② 逐标号简释（状态 / 转移）', { color: C.blue.s, width }));
  const y0 = 110;
  const rowH = 31;
  markers.forEach((m, i) => {
    const y = y0 + i * rowH;
    if (i % 2 === 1) {
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${rowH - 3}" rx="5" fill="rgba(148,163,184,0.05)"/>`);
    }
    parts.push(badge(x + 12, y + 12, m.n, { r: 9, color: i < 11 ? C.blue : C.violet, size: 10 }));
    parts.push(text(x + 26, y + 11, clip(m.name, 24), { size: 9.4, weight: 700, fill: C.text }));
    const t1 = para(x + 26, y + 23, m.text, { size: 8.4, fill: C.muted, maxWidth: width - 32, lh: 9.6, maxLines: 1 });
    parts.push(t1.svg);
  });
  return { svg: parts.join('\n'), endY: y0 + markers.length * rowH };
}

function genP1() {
  const p = PLAN.pages.find((x) => x.id === 'p1');
  const parts = [pageHeader(p, { ruleY: 96 })];
  const sm = drawStateMachine();
  parts.push(sm.svg);
  const legend = drawP1Legend(p.markers, sm.nextX);
  parts.push(legend.svg);
  const ma = p.metricAnchor;
  const x = sm.nextX;
  const width = W - 28 - x;
  parts.push(sectionLabel(x, legend.endY + 16, ma.title, { color: C.green.s, width }));
  const items = ma.items.map((it) => it.replace(/^阶段 /, ''));
  parts.push(bullets(x + 2, legend.endY + 34, items, { size: 8.9, fill: C.muted, dot: C.green.s, maxWidth: width - 6, lh: 13.5, maxLines: 2 }));
  parts.push(pageFooter(p, p.references));
  return svg(p.title, parts.join('\n'));
}

/* ---------------------------------------------------------- page 2 layout */

function genP2() {
  const p = PLAN.pages.find((x) => x.id === 'p2');
  const parts = [pageHeader(p, { ruleY: 96 })];

  const LX = 28;
  const LW = 700;
  const RX = 748;
  const RW = W - 28 - RX;
  const FOOT = H - 48;

  // left upper: best practices
  parts.push(sectionLabel(LX, 116, '① 业界做得好的是什么（先进实践，逐条附可查来源）', { color: C.green.s, width: LW }));
  const caseH = 50;
  const caseGap = 4;
  p.cases.forEach((cse, i) => {
    const y = 124 + i * (caseH + caseGap);
    parts.push(card(LX, y, LW, caseH, { color: C.green, n: cse.n, numColor: C.green, title: cse.head, titleSize: 10.8 }));
    parts.push(para(LX + 34, y + 32, cse.text, { size: 8.1, fill: C.muted, maxWidth: LW - 44, lh: 9.8, maxLines: 2 }).svg);
    parts.push(text(LX + LW - 10, y + 15, clip(cse.metric, 44), { size: 8, fill: C.green.s, anchor: 'end', weight: 600 }));
  });
  const casesEnd = 124 + p.cases.length * (caseH + caseGap) - caseGap;

  // left middle: pain points
  parts.push(sectionLabel(LX, casesEnd + 12, '② 业界痛点：为什么大型项目仍然失败', { color: C.rose.s, width: LW }));
  const painH = 50;
  const painGap = 5;
  p.pains.forEach((pn, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const w = LW / 3 - 7;
    const x = LX + col * (LW / 3);
    const y = casesEnd + 20 + row * (painH + painGap);
    parts.push(card(x, y, w, painH, { color: C.rose, n: pn.n, numColor: C.rose, title: pn.head, titleSize: 9.6 }));
    parts.push(para(x + 12, y + 30, pn.text, { size: 7.3, fill: C.muted, maxWidth: w - 22, lh: 8.8, maxLines: 2 }).svg);
  });
  const painsEnd = casesEnd + 20 + 2 * (painH + painGap) - painGap;

  // left bottom: 启发
  parts.push(sectionLabel(LX, painsEnd + 12, p.insight.title, { color: C.amber.s, width: LW }));
  const insY = painsEnd + 18;
  parts.push(rect(LX, insY, LW, 90, C.amber, { rx: 10, dash: '4 4', width: 1.2 }));
  parts.push(bullets(LX + 12, insY + 14, p.insight.points, { size: 7.8, fill: C.muted, dot: C.amber.s, maxWidth: LW - 26, lh: 11, maxLines: 1 }));
  parts.push(text(LX + 12, insY + 78, `⇒ ${p.insight.conclusion}`, { size: 8.8, weight: 700, fill: C.amber.s }));

  // right: solution
  parts.push(rect(RX, 110, RW, FOOT - 110, C.blue, { rx: 12, dash: '4 4', width: 1.2 }));
  parts.push(sectionLabel(RX + 14, 130, '③ Arc 框架解决方案', { color: C.blue.s, width: RW - 28 }));
  parts.push(para(RX + 14, 148, p.solution.base, { size: 8.8, fill: C.cyan.s, maxWidth: RW - 28, lh: 11, maxLines: 2 }).svg);
  const blocks = p.solution.blocks;
  const top = 172;
  const bH = Math.floor((FOOT - 14 - top - (blocks.length - 1) * 8) / blocks.length);
  blocks.forEach((b, i) => {
    const y = top + i * (bH + 8);
    parts.push(card(RX + 14, y, RW - 28, bH, { color: C.blue, n: b.n, numColor: C.blue, title: b.head, titleSize: 11 }));
    parts.push(para(RX + 26, y + 40, b.text, { size: 8.7, fill: C.muted, maxWidth: RW - 52, lh: 11.5, maxLines: Math.floor((bH - 46) / 11.5) }).svg);
  });
  parts.push(pageFooter(p, p.references));
  return svg(p.title, parts.join('\n'));
}

/* ---------------------------------------------------------- page 3 layout */

function genP3() {
  const p = PLAN.pages.find((x) => x.id === 'p3');
  const parts = [pageHeader(p, { ruleY: 96 })];

  // left: compact state machine with metric anchors
  const LX = 28;
  const LW = 392;
  parts.push(sectionLabel(LX, 116, '指标 ↔ 状态机映射（挂到被测动作）', { color: C.blue.s, width: LW }));
  const groups = [
    { state: '① Idle', cn: '空闲/待命', metrics: ['空闲时长'], n: 1, color: C.slate },
    { state: '② Running（主体）', cn: '执行回合 · 跨整体', metrics: ['任务完成成功率', '端到端时延/成本/可复现'], n: 2, color: C.blue },
    { state: '③ Reasoning', cn: '推理/规划', metrics: ['计划正确率'], n: 3, color: C.blue },
    { state: '④ Retrieving', cn: '检索', metrics: ['检索召回与排序'], n: 4, color: C.cyan },
    { state: '⑤ Acting', cn: '工具执行 / 写图', metrics: ['工具成功率与轮次', '去重 P/R 与无损率'], n: 5, color: C.violet },
    { state: '⑥ Verifying', cn: '验收', metrics: ['验收通过率与回归'], n: 6, color: C.green },
    { state: '⑦ Finalizing', cn: '提交 / 交付 / 沉淀', metrics: ['提交登记完整率', '记忆准确率与拒答'], n: 7, color: C.green },
    { state: '⑧⑨ 等待态', cn: '等工具结果 / 等用户', metrics: ['等待/唤醒时延', '请示频率与回环轮次'], n: 8, color: C.amber },
    { state: '⑩⑪ 正交区 / 终态', cn: '后台任务 / Stopped', metrics: ['（观测点）'], n: 9, color: C.slate },
  ];
  let y = 128;
  const rowH = 44;
  groups.forEach((g) => {
    parts.push(rect(LX, y, 168, rowH - 6, g.color, { rx: 7, width: 1.3 }));
    parts.push(badge(LX + 15, y + (rowH - 6) / 2, g.n, { r: 9.5, color: g.color, size: 10.5 }));
    parts.push(text(LX + 29, y + 16, g.state, { size: 9.8, weight: 700, fill: g.color.s }));
    parts.push(text(LX + 29, y + 30, g.cn, { size: 8.4, fill: C.muted }));
    if (g.metrics[0] !== '（观测点）') {
      parts.push(arrow(LX + 168, y + (rowH - 6) / 2, LX + 188, y + (rowH - 6) / 2, { stroke: g.color.s, width: 1.3, marker: `arrow-${g.color === C.blue ? 'blue' : g.color === C.cyan ? 'cyan' : g.color === C.violet ? 'violet' : g.color === C.amber ? 'amber' : g.color === C.green ? 'green' : 'arrow'}` }));
    }
    parts.push(para(LX + 194, y + 14, g.metrics.join('\n'), { size: 9.2, fill: C.muted, maxWidth: LW - 200, lh: 12, maxLines: 3 }).svg);
    y += rowH;
  });

  // left bottom: status bar
  const statusY = y + 16;
  const st = p.status;
  const total = st.measured + st.partial + st.notMeasured;
  parts.push(sectionLabel(LX, statusY, `度量覆盖：${total} 个指标`, { color: C.green.s, width: LW }));
  const barW = LW;
  const segs = [
    { v: st.measured, color: C.green, label: 'measured' },
    { v: st.partial, color: C.amber, label: 'partial' },
    { v: st.notMeasured, color: C.rose, label: 'not_measured' },
  ];
  let sx = LX;
  segs.forEach((s) => {
    const w = (s.v / total) * barW;
    parts.push(`<rect x="${sx}" y="${statusY + 8}" width="${w}" height="14" rx="3" fill="${s.color.s}" opacity="0.75"/>`);
    parts.push(text(sx + 6, statusY + 19, String(s.v), { size: 9, weight: 700, fill: '#0a0e1a' }));
    sx += w;
  });
  parts.push(text(LX, statusY + 38, `measured ${st.measured} · partial ${st.partial} · not_measured ${st.notMeasured}`, { size: 8.8, fill: C.muted }));
  parts.push(para(LX, statusY + 52, st.note, { size: 8.5, fill: C.faint, maxWidth: LW, lh: 10.5, maxLines: 3 }).svg);

  // right: metric table
  const RX = 436;
  const cols = [
    { label: '#', w: 24 },
    { label: '指标 / 分组', w: 176 },
    { label: '状态机映射', w: 80 },
    { label: '状态', w: 72 },
    { label: '我方评测结果（KG measurement-result）', w: 262 },
    { label: '业界 / 口径', w: 112 },
    { label: 'Gap · 优化方向', w: 90 },
  ];
  const statusText = { measured: '✓ 实测', partial: '◐ 部分', not_measured: '✗ 未测' };
  const statusColor = { measured: C.green.s, partial: C.amber.s, not_measured: C.rose.s };
  const rows = p.metrics.map((m) => [
    { text: String(m.n), fill: C.faint, size: 8.8 },
    { text: `${m.name}\n${m.group}`, fill: C.text, size: 8.6 },
    { text: m.stateLabel, fill: C.faint, size: 8 },
    { text: statusText[m.status], fill: statusColor[m.status], size: 8.2 },
    { text: m.result, fill: C.muted, size: 7.8 },
    { text: m.benchmark, fill: C.faint, size: 7.8 },
    { text: m.action, fill: C.cyan.s, size: 7.8 },
  ]);
  parts.push(sectionLabel(RX, 116, '20 个指标：状态机映射 · 我方评测 · 业界与 Gap', { color: C.green.s, width: W - 28 - RX }));
  const t = table(RX, 124, cols, rows, { size: 8.4, headSize: 8.8, rowH: 23, headH: 20 });
  parts.push(t.svg);

  // right bottom: insights (two compact columns placed under the table, above the footer)
  const boxY = H - 92;
  const halfW = (W - 28 - RX - 10) / 2;
  parts.push(rect(RX, boxY, halfW, 46, C.rose, { rx: 9, width: 1.1 }));
  parts.push(text(RX + 12, boxY + 15, '结论', { size: 9.4, weight: 700, fill: C.rose.s }));
  parts.push(para(RX + 46, boxY + 15, p.insights.measuredNote, { size: 7.6, fill: C.muted, maxWidth: halfW - 56, lh: 9.2, maxLines: 2 }).svg);
  parts.push(para(RX + 46, boxY + 33, p.insights.gapNote, { size: 7.6, fill: C.rose.s, maxWidth: halfW - 56, lh: 9.2, maxLines: 2 }).svg);

  const px2 = RX + halfW + 10;
  parts.push(rect(px2, boxY, halfW, 46, C.amber, { rx: 9, dash: '4 4', width: 1.1 }));
  parts.push(text(px2 + 12, boxY + 15, p.insights.planTitle, { size: 9.4, weight: 700, fill: C.amber.s }));
  const cw = (halfW - 24) / 3;
  p.insights.plan.slice(0, 3).forEach((it, i) => {
    parts.push(para(px2 + 12 + i * cw, boxY + 29, it, { size: 7, fill: C.muted, maxWidth: cw - 6, lh: 8.4, maxLines: 2 }).svg);
  });
  parts.push(pageFooter(p, p.references));
  return svg(p.title, parts.join('\n'));
}

/* ---------------------------------------------------------- page 4 layout */

function genP4() {
  const p = PLAN.pages.find((x) => x.id === 'p4');
  const parts = [pageHeader(p, { ruleY: 96 })];

  const LX = 28;
  const LW = 596;
  parts.push(sectionLabel(LX, 116, '业界通用流程（覆盖 RAG 与 Graph 全部相关技术）', { color: C.cyan.s, width: LW }));

  const phaseMeta = {
    写入: { color: C.blue, y: 124, h: 212, titleY: 142, note: '① 写入阶段＝治理阶段：这一步的取舍决定后面检索的上限' },
    检索: { color: C.cyan, y: 344, h: 104, titleY: 362, note: '② 多路召回 + 融合重排＝当前工业界的主流做法' },
    生成与闭环: { color: C.green, y: 456, h: 104, titleY: 474, note: '' },
  };
  Object.entries(phaseMeta).forEach(([name, meta]) => {
    parts.push(rect(LX, meta.y, LW, meta.h, meta.color, { rx: 10, dash: '4 4', width: 1.2 }));
    parts.push(text(LX + 12, meta.y + 18, name, { size: 11.5, weight: 700, fill: meta.color.s }));
    if (meta.note) parts.push(text(LX + 104, meta.titleY + 4, meta.note, { size: 8.4, fill: meta.color.s }));
  });

  const stepMap = {};
  p.generic.forEach((ph) => ph.steps.forEach((s) => (stepMap[s.id] = { ...s, phase: ph.phase })));
  const stepPos = {
    L1: [LX + 92, 136],
    L2: [LX + 92, 188],
    L3: [LX + 92, 240],
    L4: [LX + 92, 292],
    L5: [LX + 92, 378],
    L6: [LX + 92, 430],
    L7: [LX + 92, 490],
    L8: [LX + 92, 542],
  };
  const sw = 252;
  const conn = { L1: 'L2', L2: 'L3', L3: 'L4', L4: 'L5', L5: 'L6', L6: 'L7', L7: 'L8' };
  Object.entries(stepPos).forEach(([id, [x, y]]) => {
    const s = stepMap[id];
    const ph = phaseMeta[s.phase].color;
    parts.push(rect(x, y, sw, 44, ph, { rx: 8, width: 1.3 }));
    parts.push(badge(x + 18, y + 22, id, { r: 13, color: ph, size: 9.6 }));
    parts.push(text(x + 38, y + 19, s.name, { size: 10.6, weight: 700, fill: C.text }));
    parts.push(para(x + 38, y + 33, s.detail.replace(/\n/g, ' '), { size: 8.4, fill: C.muted, maxWidth: sw - 46, lh: 9.6, maxLines: 2 }).svg);
    if (conn[id]) {
      const ny = stepPos[conn[id]][1];
      parts.push(arrow(x + sw / 2, y + 44, x + sw / 2, ny - 2, { stroke: ph.s, width: 1.3, marker: `arrow-${ph === C.blue ? 'blue' : ph === C.cyan ? 'cyan' : 'green'}` }));
    }
  });
  // feedback loop L8 -> L1 (评估反馈索引/权重/提示)
  parts.push(poly(
    [
      [LX + 92 + sw, 560],
      [LX + LW - 14, 560],
      [LX + LW - 14, 158],
      [LX + 92 + sw + 4, 158],
    ],
    { stroke: C.rose.s, width: 1.4, dash: '5 4', marker: 'arrow-rose' }
  ));
  parts.push(text(LX + LW - 16, 630, '评估反馈 → 索引 / 权重 / 提示', { size: 8.6, fill: C.rose.s, anchor: 'end' }));
  parts.push(para(LX + 92, 638, '闭环：度量 → 反馈 → 改进索引/权重/提示，再回到写入与召回 —— 检索质量不是一次调参，而是一个循环。', { size: 8.2, fill: C.faint, maxWidth: LW - 110, lh: 10, maxLines: 2 }).svg);

  // right column
  const RX = 640;
  const RW = W - 28 - RX;
  parts.push(sectionLabel(RX, 116, '我方 Graph 框架 · 单项目 Graph MCP 供给面', { color: C.blue.s, width: RW }));
  const mcpRows = [
    ['R1 读·语义', 'getSystemArchitecture（purpose/intent 语义检索）· memory_search（记忆召回，带 matchedSnippet 与出处）'],
    ['R2 读·上下文', 'getIntentElementContext（元素子图/依赖）· getArchitectureViewContext（视图成员全量，含 EA 连线几何）'],
    ['R3 读·结构', 'queryNeo4jGraph（先取 schema 再自行构造只读 Cypher；写子句被拒；投影陈旧自动重建）'],
    ['W1 写·对象', 'add / update / remove ArchitectureElement · Relationship · View'],
    ['W2 写·批次', 'preview / applySystemArchitectureMutation（原子校验）· initializeWorkspace'],
    ['W3 写·门禁链', '图谱校验 → 去重门禁（L0 精确 + L1 语义 0.85）→ 无损门禁（merge/delta + 墓碑）'],
    ['X1 跨项目', '5 个读工具支持 projectId → 经联邦中心读托管副本（引用式，带 namespaceKey）'],
  ].map(([g, t]) => [{ text: g, fill: C.cyan.s, size: 8.4 }, { text: t, fill: C.muted, size: 8.1 }]);
  const mcp = table(RX, 124, [{ label: '工具组', w: 62 }, { label: 'Graph MCP 工具（单项目内即可用）', w: RW - 62 }], mcpRows, { rowH: 17, headH: 18 });
  parts.push(mcp.svg);

  const cy = mcp.endY + 10;
  parts.push(sectionLabel(RX, cy, '(a)(b) 环节覆盖 + 指标映射（对应左侧通用流程 L1–L8）', { color: C.green.s, width: RW }));
  const covRows = p.coverage.map((c) => [
    { text: c.id, fill: C.cyan.s, size: 8.2 },
    { text: `${c.name}｜${c.ours}`, fill: C.muted, size: 7.5 },
    { text: c.status === 'covered' ? '✓ 覆盖' : c.status === 'replaced' ? '◎ 本体替代' : '◐ 部分', fill: c.status === 'covered' ? C.green.s : c.status === 'replaced' ? C.cyan.s : C.amber.s, size: 7.8 },
    { text: c.metrics, fill: C.amber.s, size: 7.8 },
    { text: c.evidence, fill: C.faint, size: 7.2 },
  ]);
  const cov = table(RX, cy + 8, [
    { label: '环节', w: 32 },
    { label: '名称 / 我方实现', w: 250 },
    { label: '状态', w: 56 },
    { label: '(b) 指标', w: 40 },
    { label: '证据（KG / 实测）', w: RW - 32 - 250 - 56 - 40 },
  ], covRows, { rowH: 18, headH: 18, cellLines: 1 });
  parts.push(cov.svg);

  // (c) measured results
  const my = cov.endY + 10;
  parts.push(sectionLabel(RX, my, '(c) 度量结果（measured / partial，取自 KG）', { color: C.green.s, width: RW }));
  const mW = (RW - 12) / 3;
  p.measured.forEach((m, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = RX + col * (mW + 6);
    const y = my + 6 + row * 38;
    const color = m.note.startsWith('partial') ? C.amber : C.green;
    parts.push(rect(x, y, mW, 34, color, { rx: 7, width: 1.1 }));
    parts.push(text(x + 9, y + 13, m.id, { size: 8.2, weight: 700, fill: color.s }));
    parts.push(text(x + 9, y + 27, clip(m.value, 26), { size: 8.6, weight: 700, fill: C.text }));
  });
  const measuredEnd = my + 6 + 2 * 38 - 4;

  // gaps strip
  parts.push(sectionLabel(RX, measuredEnd + 6, 'Gap（与通用流程的差距 → 下一步）', { color: C.rose.s, width: RW }));
  const gapTop = measuredEnd + 12;
  const gapH = Math.max(46, H - 52 - gapTop);
  parts.push(rect(RX, gapTop, RW, gapH, C.rose, { rx: 8, width: 1.1 }));
  p.gaps.forEach((g, i) => {
    const gy = gapTop + 14 + i * 13;
    parts.push(`<circle cx="${RX + 14}" cy="${gy - 2.6}" r="2.3" fill="${C.rose.s}"/>`);
    parts.push(para(RX + 23, gy, g, { size: 7.4, fill: C.muted, maxWidth: RW - 34, lh: 9, maxLines: 1 }).svg);
  });

  parts.push(pageFooter(p, p.references));
  return svg(p.title, parts.join('\n'));
}

/* ---------------------------------------------------------- page 5 layout */

function genP5() {
  const p = PLAN.pages.find((x) => x.id === 'p5');
  const parts = [pageHeader(p, { ruleY: 96 })];

  // top band: scheme
  const TY = 106;
  parts.push(rect(28, TY, W - 56, 110, C.blue, { rx: 10, dash: '4 4', width: 1.2 }));
  parts.push(text(42, TY + 22, '① 整体方案', { size: 11.5, weight: 700, fill: C.blue.s }));
  parts.push(para(42, TY + 40, p.scheme.oneLiner, { size: 9.4, fill: C.text, maxWidth: W - 84, lh: 12, maxLines: 2 }).svg);
  const sw = (W - 84 - 16) / 3;
  p.scheme.points.forEach((pt, i) => {
    const x = 42 + i * (sw + 8);
    if (i > 0) {
      parts.push(
        `<line x1="${x - 10}" y1="${TY + 60}" x2="${x - 10}" y2="${TY + 102}" stroke="rgba(148,163,184,0.22)" stroke-width="1"/>`
      );
    }
    parts.push(`<circle cx="${x + 3}" cy="${TY + 71}" r="2.6" fill="${C.blue.s}"/>`);
    parts.push(para(x + 12, TY + 74, pt, { size: 8.1, fill: C.muted, maxWidth: sw - 26, lh: 9.8, maxLines: 3 }).svg);
  });

  // status chips
  const chipY = TY + 120;
  let cx = 28;
  p.status.forEach((s) => {
    const label = `${s.k}：${s.v}`;
    const pr = pill(cx, chipY, label, C.cyan, { size: 8.8, h: 18 });
    parts.push(pr.svg);
    cx += pr.w + 8;
  });

  // lower left: benefits
  const BY = chipY + 34;
  const BW = 300;
  parts.push(sectionLabel(28, BY, '② 这种方法的好处', { color: C.green.s, width: BW }));
  const bH = 88;
  p.benefits.forEach((b, i) => {
    const y = BY + 10 + i * (bH + 10);
    parts.push(card(28, y, BW, bH, { color: C.green, n: b.n, numColor: C.green, title: b.head, titleSize: 11 }));
    parts.push(para(40, y + 42, b.text, { size: 8.5, fill: C.muted, maxWidth: BW - 26, lh: 11.2, maxLines: 4 }).svg);
  });

  // lower middle: federation composition diagram
  const DX = 344;
  const DW = 660;
  const DY = BY;
  parts.push(sectionLabel(DX, DY, '③ 联邦方式构建组织级图谱（示意）', { color: C.violet.s, width: DW }));
  parts.push(rect(DX, DY + 8, DW, H - 58 - (DY + 8), C.slate, { rx: 12, width: 1.1 }));

  const inner = DX + 16;
  const innerW = DW - 32;

  // layer 3: organizational knowledge base
  const okY = DY + 20;
  parts.push(rect(inner, okY, innerW, 48, C.green, { rx: 9, width: 1.3 }));
  parts.push(text(inner + 12, okY + 19, '组织级知识图谱（组织知识库）', { size: 11, weight: 700, fill: C.green.s }));
  parts.push(text(inner + 12, okY + 35, '领域知识彼此可见可用 · 权限统一管控 · 内容仍是各项目自己的图（引用不拷贝）', { size: 8.2, fill: C.muted }));

  // layer 2: federation center
  const fcY = okY + 78;
  parts.push(rect(inner, fcY, innerW, 62, C.violet, { rx: 9, width: 1.3 }));
  parts.push(text(inner + 12, fcY + 19, '联邦中心（registry + broker）· graph://argo.derekworkspacev5.com', { size: 10.4, weight: 700, fill: C.violet.s }));
  const caps = ['注册 register', '发现 discover', '授权 grant（默认拒绝）', '跨项目读取（返回引用）', '镜像托管 mirror'];
  let px = inner + 12;
  caps.forEach((c) => {
    const pr = pill(px, fcY + 26, c, C.violet, { size: 8, h: 16 });
    parts.push(pr.svg);
    px += pr.w + 6;
  });
  parts.push(text(inner + 12, fcY + 54, '中心只持联邦元数据（成员/能力/接口/授权）—— 不持有成员内容，成员图保持主权', { size: 8, fill: C.muted }));

  // layer 1: member project graphs
  const pjY = fcY + 96;
  parts.push(text(inner + 2, pjY - 8, 'ArcGraph 单项目 = 一块积木（自治的知识图谱单元）', { size: 9.4, weight: 700, fill: C.blue.s }));
  const names = p.members.slice(0, 5);
  const pw = (innerW - 4 * 8) / 5;
  names.forEach((nm, i) => {
    const x = inner + i * (pw + 8);
    const isSelf = nm === 'archgraph';
    const color = isSelf ? C.blue : C.slate;
    parts.push(rect(x, pjY, pw, 56, color, { rx: 8, width: 1.2 }));
    parts.push(text(x + 8, pjY + 17, clip(nm, 20), { size: 8.8, weight: 700, fill: isSelf ? C.blue.s : C.text }));
    parts.push(para(x + 8, pjY + 30, 'canonical 意图图\n本体可 extends\n治理闭环', { size: 7.4, fill: C.muted, maxWidth: pw - 14, lh: 9.2, maxLines: 3 }).svg);
    parts.push(arrow(x + pw / 2, pjY, x + pw / 2, fcY + 62 + 6, { stroke: isSelf ? C.blue.s : C.slate.s, width: 1.2, marker: isSelf ? 'arrow-blue' : 'arrow', dash: '3 3' }));
  });
  parts.push(arrow(inner + innerW / 2 - 120, fcY, inner + innerW / 2 - 120, okY + 48 + 4, { stroke: C.violet.s, width: 1.4, marker: 'arrow-violet' }));
  parts.push(text(inner + innerW / 2 - 112, fcY - 8, '组合 = 组织级知识图谱', { size: 8.4, fill: C.violet.s }));
  parts.push(text(inner + 34, pjY - 20, '注册 · 自注册即被发现', { size: 8, fill: C.muted }));

  // lower right: compact notes
  const NX = DX + DW + 12;
  const NW = W - 28 - NX;
  parts.push(sectionLabel(NX, DY, '④ 图注', { color: C.amber.s, width: NW }));
  const noteH = 98;
  p.diagramNotes.forEach((n, i) => {
    const y = DY + 10 + i * (noteH + 6);
    parts.push(rect(NX, y, NW, noteH, C.amber, { rx: 8, width: 1.1 }));
    parts.push(badge(NX + 16, y + 18, i + 1, { r: 10, color: C.amber, size: 11 }));
    parts.push(para(NX + 32, y + 20, n, { size: 8.4, fill: C.muted, maxWidth: NW - 44, lh: 10.6, maxLines: 7 }).svg);
  });

  parts.push(pageFooter(p, p.references));
  return svg(p.title, parts.join('\n'));
}

function genPreviewHtml() {
  const pages = PLAN.pages
    .map((p) => `    <figure class="slide">
      <img src="assets/${p.diagram}.svg" alt="${esc(p.title)}" />
      <figcaption><b>${esc(p.kicker)}</b>${esc(p.title)}</figcaption>
    </figure>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(PLAN.title)} — 预览</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #070a12; color: #eef1f6;
    font-family: 'Microsoft YaHei', 'Segoe UI', 'Noto Sans SC', sans-serif; }
  header { padding: 28px 32px 12px; }
  h1 { margin: 0 0 6px; font-size: 22px; }
  p.sub { margin: 0; color: #9aa6bd; font-size: 13.5px; line-height: 1.7; }
  p.note { margin: 10px 0 0; font-size: 12.5px; color: #6b7793; }
  main { padding: 18px 32px 48px; display: flex; flex-direction: column; gap: 26px; }
  figure.slide { margin: 0; border: 1px solid rgba(255,255,255,0.10); border-radius: 12px; overflow: hidden;
    background: #0a0e1a; box-shadow: 0 18px 40px rgba(0,0,0,0.45); }
  figure.slide img { display: block; width: 100%; height: auto; }
  figcaption { padding: 10px 14px; font-size: 12.5px; color: #9aa6bd; border-top: 1px solid rgba(255,255,255,0.08); }
  figcaption b { color: #6b8cff; margin-right: 8px; }
  @media print { body { background: #fff; } figure.slide { break-inside: avoid; } }
</style>
</head>
<body>
<header>
  <h1>${esc(PLAN.title)}</h1>
  <p class="sub">${esc(PLAN.subtitle)}</p>
  <p class="note">${esc(PLAN.evidenceNote)}</p>
</header>
<main>
${pages}
</main>
</body>
</html>
`;
}

/* ------------------------------------------------------------------- main */

const FILES = {
  'p1-state-machine.svg': genP1,
  'p2-pain-and-practice.svg': genP2,
  'p3-metric-system.svg': genP3,
  'p4-graph-rag-pipeline.svg': genP4,
  'p5-federation.svg': genP5,
};

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const check = process.argv.includes('--check');
  let Resvg;
  if (check) Resvg = require('@resvg/resvg-js').Resvg;
  for (const [name, fn] of Object.entries(FILES)) {
    const content = fn();
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, content, 'utf8');
    let note = '';
    if (check) {
      const img = new Resvg(content, { font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei' } }).render();
      note = ` (renders ${img.width}x${img.height}, ${img.asPng().length} bytes)`;
    }
    console.log(`wrote docs/ppt/assets/${name}${note}`);
  }
  const preview = path.join(ROOT, 'docs', 'ppt', 'preview.html');
  fs.writeFileSync(preview, genPreviewHtml(), 'utf8');
  console.log('wrote docs/ppt/preview.html');
}

if (require.main === module) main();

module.exports = { FILES, W, H };
