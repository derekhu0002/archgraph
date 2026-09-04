'use strict';

// 共享 helper：WP2100 AT-2100-OPT-04 回环无损比较器的归一化与 diff 逻辑。
// 独立于 node:test，便于被 ea-roundtrip.test.js 复用并单独演进归一化规则。

// 行尾/外空白归一：null/undefined/缺省 → ''；\r\n、\r → \n；两端去空白。
function normScalar(value, opts) {
  const o = opts || {};
  const emptyAs = o.emptyAs === undefined ? '' : o.emptyAs;
  if (value === null || value === undefined) {
    return emptyAs;
  }
  if (typeof value === 'string') {
    let text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (o.trim !== false) {
      text = text.replace(/^\s+|\s+$/g, '');
    }
    return text;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return value;
}

// 数组/对象深度规范化：叶子标量走 normScalar，对象键排序，数组元素排序（忽略顺序）。
// 用于 included_*、subdiagram_views、testcases 等“数组元素可能是对象”的字段比较。
function canonicalOf(value, opts) {
  const o = opts || {};
  if (value === null || value === undefined) { return JSON.stringify(normScalar(value, o)); }
  if (Array.isArray(value)) {
    const items = value.map((x) => canonicalOf(x, o)).sort();
    return '[' + items.join(',') + ']';
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      const v = value[k];
      if (v === undefined || v === null || (typeof v === 'string' && normScalar(v, o) === '')) {
        continue; // null/缺失/空串等价 → 跳过
      }
      parts.push(JSON.stringify(k) + ':' + canonicalOf(v, o));
    }
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(normScalar(value, o));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keyOf(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// 将对象集合规范化为 Map<stableKey, 对象>（key 由 opts.keyOf 决定）。
function indexObjects(list, opts) {
  const index = new Map();
  for (const entry of list || []) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const k = opts.keyOf(entry);
    if (k !== '' && !index.has(k)) {
      index.set(k, entry);
    }
  }
  return index;
}

// 单值比较（空归一策略：null/缺失/空串等价，差异时摘要展示）。
function scalarDiff(orig, exp, opts) {
  const a = normScalar(orig, opts);
  const b = normScalar(exp, opts);
  return a === b ? null : { orig: summarize(orig), exp: summarize(exp) };
}

function summarize(value) {
  if (value === null || value === undefined) {
    return '(none)';
  }
  const text = String(value);
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? oneLine.slice(0, 80) + '…' : oneLine;
}

function normCrLf(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// 属性规范化文本：value 与 description 视为同一文本的若干段（EA 端超长 value 并入 Notes
// 时用空行分隔，拆分再排序可把 value+description 的合并/拆分差异归一），段内行尾归一。
function canonicalAttrText(o, opts) {
  const parts = [];
  if (!o) { return ''; }
  const push = (v) => {
    const s = normScalar(v, opts);
    if (s === '') { return; }
    for (const piece of normCrLf(s).split(/\n\n+/)) {
      const t = piece.replace(/^\s+|\s+$/g, '');
      if (t !== '') { parts.push(t); }
    }
  };
  push(o.value);
  push(o.description);
  parts.sort();
  return parts.join('\u0001');
}

function canonicalAttrKey(o, opts) {
  return keyOf(o.name) + '\u0001' + canonicalAttrText(o, opts);
}

// attributes 数组比较：多集（multiset）比较 —— 同名且文本等价视同同一属性，数量差异才算 diff；
// 天然支持同名多行台账（如多次 commit）与导出端顺序重排，且不要求长度一致。
function diffAttributes(origList, expList, opts, out, where) {
  const counts = new Map();
  const bump = (list, delta) => {
    for (const entry of list || []) {
      if (!isPlainObject(entry)) { continue; }
      const k = canonicalAttrKey(entry, opts);
      const cur = counts.get(k) || [0, 0];
      cur[delta > 0 ? 0 : 1] += Math.abs(delta);
      counts.set(k, cur);
    }
  };
  bump(origList, +1);
  bump(expList, -1);
  for (const [k, [oc, ec]] of counts) {
    const sep = k.indexOf('\u0001');
    const name = k.slice(0, sep);
    const whereAttr = `${where}.attributes[${name}]`;
    const text = k.slice(sep + 1);
    const excess = oc - ec;
    if (excess > 0) {
      for (let i = 0; i < excess; i++) {
        out.push({ kind: 'attribute', where: whereAttr, issue: 'missing-in-export', orig: summarize(text) });
      }
    } else if (excess < 0) {
      for (let i = 0; i < -excess; i++) {
        out.push({ kind: 'attribute', where: whereAttr, issue: 'extra-in-export', exp: summarize(text) });
      }
    }
  }
}

function diffObjectField(kind, key, field, origObj, expObj, opts, out) {
  const o = origObj === undefined ? undefined : origObj[field];
  const e = expObj === undefined ? undefined : expObj[field];
  const where = `${kind}:${key}.${field}`;
  if (field === 'attributes') {
    diffAttributes(o, e, opts, out, `${kind}:${key}`);
    return;
  }
  if (Array.isArray(o) || Array.isArray(e)) {
    // 数组（含“数组元素为对象”的字段，如 subdiagram_views/testcases）：深度规范化后按集合比较。
    const setA = new Set((o || []).map((x) => canonicalOf(x, opts)));
    const setB = new Set((e || []).map((x) => canonicalOf(x, opts)));
    for (const v of setA) {
      if (!setB.has(v)) {
        out.push({ kind: 'collection', where, issue: 'missing-in-export', orig: v.slice(0, 160) });
      }
    }
    for (const v of setB) {
      if (!setA.has(v)) {
        out.push({ kind: 'collection', where, issue: 'extra-in-export', exp: v.slice(0, 120) });
      }
    }
    return;
  }
  const d = scalarDiff(o, e, opts);
  if (d) {
    out.push({ kind: 'field', where, issue: 'value-diff', orig: d.orig, exp: d.exp });
  }
}

// 单对象内容比较：fields = 需逐字段对齐的字段；opts.ignoreOrigOnly（导出不输出的既有字段）
// 出现于 orig 而缺失于 exp 时跳过字段级 value-diff（单独计数 knownGaps）。
function diffOne(kind, key, origObj, expObj, fields, opts, out, knownGaps) {
  const ignoreOrigOnly = new Set(opts.ignoreOrigOnly || []);
  for (const field of fields) {
    const o = origObj === undefined ? undefined : origObj[field];
    const e = expObj === undefined ? undefined : expObj[field];
    const oEmpty = o === undefined || o === null || normScalar(o, opts) === '';
    const eEmpty = e === undefined || e === null || normScalar(e, opts) === '';
    if (oEmpty && eEmpty) {
      continue;
    }
    if (oEmpty && !eEmpty && kind === 'view' && field === 'parent_element_name') {
      continue; // 导出端由 EA 父元素名派生的富集字段，orig 缺省视为一致
    }
    if (!oEmpty && eEmpty && ignoreOrigOnly.has(field)) {
      knownGaps.push({ kind, key, field });
      continue;
    }
    diffObjectField(kind, key, field, origObj, expObj, opts, out);
  }
}

// 顶层比较入口：orig/exp 为已解析 JSON 文档。
function compareRoundtrip(origDoc, expDoc, opts) {
  const o = opts || {};
  const out = [];
  const knownGaps = [];
  const summary = { elements: 0, relationships: 0, views: 0 };

  const origElements = indexObjects(origDoc.elements, { keyOf: (x) => keyOf(x.id) });
  const expElements = indexObjects(expDoc.elements, { keyOf: (x) => keyOf(x.id) });
  summary.elements = Math.max(origElements.size, expElements.size);
  compareKeyedSet('element', origElements, expElements, ['name', 'type', 'parent', 'alias', 'classifier', 'description', 'status', 'attributes', 'subdiagram_views', 'testcases'], out, knownGaps, o);

  const origRelationships = indexObjects(origDoc.relationships, { keyOf: (x) => keyOf(x.id) });
  const expRelationships = indexObjects(expDoc.relationships, { keyOf: (x) => keyOf(x.id) });
  summary.relationships = Math.max(origRelationships.size, expRelationships.size);
  compareKeyedSet('relationship', origRelationships, expRelationships, ['name', 'type', 'source_id', 'target_id', 'source_name', 'target_name', 'statement', 'description', 'attributes', 'document'], out, knownGaps, o);

  const origViews = indexObjects(origDoc.views, { keyOf: (x) => keyOf(x.view_id) });
  const expViews = indexObjects(expDoc.views, { keyOf: (x) => keyOf(x.view_id) });
  summary.views = Math.max(origViews.size, expViews.size);
  compareKeyedSet('view', origViews, expViews, ['view_name', 'parent_element_id', 'parent_element_name', 'description', 'included_elements', 'included_relationships'], out, knownGaps, o);

  return {
    equal: out.length === 0,
    missingInExport: out.filter((d) => d.issue === 'missing-in-export'),
    extraInExport: out.filter((d) => d.issue === 'extra-in-export'),
    valueDiffs: out.filter((d) => d.issue === 'value-diff'),
    diffs: out,
    knownGaps,
    counts: summary,
    docs: { orig: { name: origDoc.name }, exp: { name: expDoc.name } },
  };
}

function compareKeyedSet(kind, origIndex, expIndex, fields, out, knownGaps, opts) {
  const keys = new Set([...origIndex.keys(), ...expIndex.keys()]);
  for (const key of keys) {
    const o = origIndex.get(key);
    const e = expIndex.get(key);
    if (o && !e) {
      out.push({ kind, where: `${kind}:${key}`, issue: 'missing-in-export' });
      continue;
    }
    if (!o && e) {
      out.push({ kind, where: `${kind}:${key}`, issue: 'extra-in-export' });
      continue;
    }
    diffOne(kind, key, o, e, fields, opts, out, knownGaps);
  }
}

// 人类可读报告（限制条数防刷屏）。
function formatReport(report, limit) {
  const max = limit || 30;
  const lines = [];
  const push = (d) => {
    let line = `[${d.kind}] ${d.where} :: ${d.issue}`;
    if (d.issue === 'value-diff') {
      line += `  orig="${d.orig}" exp="${d.exp}"`;
    } else if (d.issue === 'missing-in-export' || d.issue === 'extra-in-export') {
      if (d.orig !== undefined) line += `  orig=${d.orig}`;
      if (d.exp !== undefined) line += `  exp=${d.exp}`;
    }
    lines.push(line);
  };
  for (const group of [report.missingInExport, report.extraInExport, report.valueDiffs]) {
    for (const d of group) {
      if (lines.length < max) {
        push(d);
      }
    }
  }
  if (report.diffs.length > max) {
    lines.push(`… 其余 ${report.diffs.length - max} 条差异略`);
  }
  const summary = `elements=${report.counts.elements} relationships=${report.counts.relationships} views=${report.counts.views}`;
  const known = report.knownGaps.length > 0
    ? `\nknown-orig-only fields（导出不输出的既有字段，已忽略）: ${report.knownGaps.slice(0, 10).map((g) => `${g.kind}:${g.key}.${g.field}`).join(', ')}` : '';
  return { summary, lines, text: `${summary}\n${lines.join('\n')}${known}` };
}

module.exports = {
  normScalar,
  indexObjects,
  diffAttributes,
  compareRoundtrip,
  formatReport,
};
