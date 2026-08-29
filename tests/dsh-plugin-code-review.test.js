'use strict';

// Reviewer（角色 2732）交付的可执行验收测试：
// 1) 检视报告存在且包含总体结论与问题清单（R-1..R-n）结构；
// 2) 意图图谱工作包 2767 携带 AT-2767-07（GIVEN-WHEN-THEN、可执行）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'docs', 'dsh-plugin-code-review.md');
const GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');

function readGraph() {
  return JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
}

test('检视报告存在且包含总体结论', () => {
  // GIVEN Reviewer 已完成 dsh-plugin bundle 代码检视
  // WHEN 检查 docs/dsh-plugin-code-review.md
  // THEN 报告存在，且包含「总体结论」章节并给出结论取值（通过/有条件通过/不通过 之一）
  assert.ok(fs.existsSync(REPORT), '检视报告应存在');
  const text = fs.readFileSync(REPORT, 'utf8');
  assert.match(text, /总体结论/, '报告应包含「总体结论」章节');
  assert.match(text, /有条件通过|不通过|通过/, '报告应给出总体结论取值');
});

test('检视报告包含问题清单结构（R-1..R-n + 级别）', () => {
  // GIVEN 检视报告已产出
  // WHEN 检查报告的问题清单
  // THEN 至少存在一张问题清单表（编号/级别/位置/描述/修复建议），且含 R-1.. 编号与级别取值
  const text = fs.readFileSync(REPORT, 'utf8');
  assert.match(text, /问题清单/, '报告应包含「问题清单」章节');
  assert.match(text, /\| 编号 \| 级别 \| 位置 \| 描述 \| 修复建议 \|/, '问题清单应为表格式（编号/级别/位置/描述/修复建议）');
  assert.match(text, /\| R-1 \|/, '问题清单应包含 R-1 条目');
  assert.match(text, /\| R-2 \|/, '问题清单应包含 R-2 条目');
  assert.match(text, /Major|Critical|Minor/, '问题清单应包含级别取值');
});

test('图谱登记：工作包 2767 携带 AT-2767-07（GIVEN-WHEN-THEN、可执行）', () => {
  // GIVEN Reviewer 已在意图图谱登记检视验收用例
  // WHEN 检查工作包 2767 的 testcases
  // THEN 存在 AT-2767-07，描述为 GIVEN-WHEN-THEN，type 为 Acceptance Test，
  //      Input 指向本测试文件（node tests/dsh-plugin-code-review.test.js），acceptanceCriteria 非空
  const graph = readGraph();
  const wp = (graph.elements || []).find((el) => el.id === '2767');
  assert.ok(wp, '工作包 2767 应存在');
  const tc = (wp.testcases || []).find((entry) => entry.name && entry.name.includes('AT-2767-07'));
  assert.ok(tc, '工作包 2767 应携带 AT-2767-07');
  assert.match(tc.description, /GIVEN/);
  assert.match(tc.description, /WHEN/);
  assert.match(tc.description, /THEN/);
  assert.equal(tc.type, 'Acceptance Test');
  assert.ok(tc.Input && tc.Input.includes('tests/dsh-plugin-code-review.test.js'),
    'AT-2767-07 的 Input 应指向本测试文件');
  assert.ok(tc.acceptanceCriteria && tc.acceptanceCriteria.length > 0, 'acceptanceCriteria 应非空');
});
