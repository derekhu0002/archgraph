'use strict';

// AT-2100-OPT-04（WP2100）：导入后导出（export-to-kg.js）内容与初始图谱一致。
// 比较器：规范化（键序稳定、数组按稳定键/集合比较、行尾与外空白归一）+ 字段级 diff。
//
// 运行方式（真实 EA 回环验证）：
//   1) 在 EA 中打开 scratch 项目副本（勿用生产 archgraph.feap），选中父包运行
//      eatool/EA-jsscript/import-from-kg.js（固定同步根包 ArchGraph Sync，SQL 直写通道）。
//   2) 在 EA 中打开导出的那张能覆盖全图成员/关系链的顶层图，运行
//      eatool/EA-jsscript/export-to-kg.js 导出 JSON（默认写 design\KG\<Diagram>.json）。
//   3) 把导出文件路径交给本测试：
//        $env:EA_ROUNDTRIP_EXPORT = "C:\...\exported.json"
//        node --test tests/ea-roundtrip.test.js
//    初始图谱默认 design/KG/SystemArchitecture.json（可用 $env:EA_ROUNDTRIP_ORIG 覆盖）。
//
// 归一化策略（集中在 tests/_ea-roundtrip-lib.js，便于修失配时迭代）：
//   - null / undefined / 缺失 / 空串 → 等价空值（默认；opts.emptyAs 可调）；
//   - 字符串：\r\n、\r → \n，两端去空白；数字/布尔转字符串稳定比较；
//   - 数组：elements/relationships/views 按键（id/id/view_id）对齐，顺序无关；
//     included_elements / included_relationships 按值集合比较（顺序无关）；
//     attributes 按 name 对齐（顺序无关），逐 value/description/content 比较；
//   - 单值字段 null vs 缺失 vs 空串视为等价；导出不输出的既有字段（如元素 status）
//     经 opts.ignoreOrigOnly 归为 knownGaps 单独报告而不判失配（可在 env
//     EA_ROUNDTRIP_IGNORE_FIELDS=status,xxx 追加）。
// 导出文件缺失/未指定时 → 显式消息 skip 计通过（保障无真实 EA 基线不破）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { compareRoundtrip, formatReport } = require(path.join(__dirname, '_ea-roundtrip-lib.js'));

const DEFAULT_ORIG = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const DEFAULT_EXPORT = path.join(ROOT, 'results', 'ea-roundtrip-export.json');

function resolvePath(envName, fallback) {
  const value = process.env[envName];
  if (value && value.trim() !== '') {
    return path.resolve(value);
  }
  return fallback;
}

function loadJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function comparatorOptions() {
  const ignore = (process.env.EA_ROUNDTRIP_IGNORE_FIELDS || 'status')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { ignoreOrigOnly: ignore };
}

test('ea-roundtrip (AT-2100-OPT-04): 导入后导出内容与初始图谱一致（忽略 JSON 顺序/键序）', (t) => {
  // GIVEN 初始图谱 JSON + EA_ROUNDTRIP_EXPORT 指定的导出 JSON
  // WHEN 规范化逐对象比较（元素按 id、关系按 id、视图按 view_id）
  // THEN 元素/关系/视图内容集合一致，任何差异结构化报告；导出文件缺失时 skip 计通过
  const origPath = resolvePath('EA_ROUNDTRIP_ORIG', DEFAULT_ORIG);
  const exportPath = resolvePath('EA_ROUNDTRIP_EXPORT', DEFAULT_EXPORT);

  if (!fs.existsSync(origPath)) {
    t.skip(`初始图谱不存在，跳过回环比较：${origPath}`);
    return;
  }
  if (!fs.existsSync(exportPath)) {
    t.skip(`导出 JSON 缺失，跳过回环比较。请先跑真实 EA 回环导出并设 EA_ROUNDTRIP_EXPORT：${exportPath}`);
    return;
  }

  const origDoc = loadJson(origPath);
  const expDoc = loadJson(exportPath);

  const report = compareRoundtrip(origDoc, expDoc, comparatorOptions());
  const rendered = formatReport(report, 40);
  assert.ok(
    report.equal,
    `回环内容不一致（${rendered.text}）`,
  );
  // 已知忽略字段单独提示（不判失败，便于跟踪导出暂不输出的既有字段）
  if (report.knownGaps.length > 0) {
    console.log(`[ea-roundtrip] 导出不输出的既有字段（已忽略，knownGaps=${report.knownGaps.length}）：`
      + report.knownGaps.slice(0, 10).map((g) => `${g.kind}:${g.key}.${g.field}`).join(', '));
  }
});

// ---- 比较器自测（不依赖真实 EA）：保证比较器本身正确 ----
const { normScalar, indexObjects, diffAttributes } = require(path.join(__dirname, '_ea-roundtrip-lib.js'));

test('ea-roundtrip 比较器自测：相等集合 → equal，含字段级差异被检出', () => {
  const orig = {
    name: 'SelfTest',
    description: 'd',
    elements: [
      { id: 'A', name: 'Alpha', type: 'Business Actor', description: '行1\r\n行2', attributes: [{ name: 'k', value: 'v', description: 'd' }] },
      { id: 'B', name: 'Beta', type: 'Device' },
    ],
    relationships: [
      { id: 'R1', name: 'Serving', type: 'Serving', source_id: 'A', target_id: 'B', statement: 'A serves B' },
    ],
    views: [
      { view_id: 'V1', view_name: 'View One', included_elements: ['B', 'A'], included_relationships: ['R1'] },
    ],
  };
  const clone = JSON.parse(JSON.stringify(orig));
  // 反序 + \r\n → \n + 属性顺序调换 + 视图成员倒序：应完全相等
  const exp = JSON.parse(JSON.stringify(orig));
  exp.elements.reverse();
  exp.relationships.reverse();
  exp.views.reverse();
  exp.elements[1].attributes = [{ description: 'd', name: 'k', value: 'v' }]; // 顺序无关
  exp.views[0].included_elements = ['A', 'B']; // 集合顺序无关

  const ok = compareRoundtrip(orig, exp, { ignoreOrigOnly: [] });
  assert.equal(ok.equal, true, '内容集合应相等（忽略顺序/键序/行尾）');

  const bad = JSON.parse(JSON.stringify(orig));
  bad.elements[0].description = '改过了';
  bad.elements.splice(1, 1); // 删 B
  bad.relationships[0].type = 'Composition';
  bad.views[0].included_relationships = [];
  const diff = compareRoundtrip(orig, bad, { ignoreOrigOnly: [] });
  assert.equal(diff.equal, false, '注入差异后应判不一致');
  const whereSet = new Set(diff.diffs.map((d) => d.where));
  assert.ok(whereSet.has('element:A.description'), '应检出元素字段差异');
  assert.ok(whereSet.has('element:B'), '应检出缺失元素');
  assert.ok(whereSet.has('relationship:R1.type'), '应检出关系类型差异');
  assert.ok(whereSet.has('view:V1.included_relationships'), '应检出视图成员集合差异');
});

test('ea-roundtrip 归一化：单值 null/空/缺失等价，行尾与外空白归一', () => {
  assert.equal(normScalar(null), '');
  assert.equal(normScalar(undefined), '');
  assert.equal(normScalar(''), '');
  assert.equal(normScalar('  a\r\nb\r\n  '), 'a\nb');
  assert.equal(normScalar(0), '0');
  assert.equal(normScalar(false), 'false');
  const a = { name: 'x' };
  const b = { name: 'x', value: '', description: null };
  const out = [];
  diffAttributes([a], [b], { ignoreOrigOnly: [] }, out, 'el:1');
  assert.equal(out.length, 0, '空 value/null description 应归一等价');
});
