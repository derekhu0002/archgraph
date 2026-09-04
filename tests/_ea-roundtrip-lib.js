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

// attributes 数组比较：按 name 对齐（顺序忽略）；每个 attribute 逐字段比较。
// opts.compareAttribute 允许调用方覆盖（如对超长 value 合并进 Notes 造成的已知差异做降级）。
function diffAttributes(origList, expList, opts, out, where) {
  const origByName = indexObjects(origList, { keyOf: (x) => keyOf(x.name) });
  const expByName = indexObjects(expList, { keyOf: (x) => keyOf(x.name) });
  const names = new Set([...origByName.keys(), ...expByName.keys()]);
  const compareField = opts.compareAttribute || ((a, b) => {
    const diffs = [];
    for (const field of ['value', 'description', 'content']) {
      const aVal = a === undefined ? undefined : a[field];
      const bVal = b === undefined ? undefined : b[field];
      if ((aVal === undefined || aVal === null || aVal === '') && (bVal === undefined || bVal === null || bVal === '')) {
        continue;
      }
      const d = scalarDiff(aVal, bVal, opts);
      if (d) {
        diffs.push({ field, orig: d.orig, exp: d.exp });
      }
    }
    return diffs;
  });
  for (const name of names) {
    const o = origByName.get(name);
    const e = expByName.get(name);
    const whereAttr = `${where}.attributes[${name}]`;
    if (o && !e) {
      out.push({ kind: 'attribute', where: whereAttr, issue: 'missing-in-export' });
      continue;
    }
    if (!o && e) {
      out.push({ kind: 'attribute', where: whereAttr, issue: 'extra-in-export' });
      continue;
    }
    const subDiffs = compareField(o, e);
    for (const d of subDiffs) {
      out.push({ kind: 'attribute', where: whereAttr + '.' + d.field, issue: 'value-diff', orig: d.orig, exp: d.exp });
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
    // 集合类（如 included_elements/included_relationships）：忽略顺序，按值集合比较。
    const setA = new Set((o || []).map((x) => normScalar(x, opts)).filter((x) => x !== ''));
    const setB = new Set((e || []).map((x) => normScalar(x, opts)).filter((x) => x !== ''));
    for (const v of setA) {
      if (!setB.has(v)) {
        out.push({ kind: 'collection', where, issue: 'missing-in-export', orig: v });
      }
    }
    for (const v of setB) {
      if (!setA.has(v)) {
        out.push({ kind: 'collection', where, issue: 'extra-in-export', exp: v });
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
