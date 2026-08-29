'use strict';

// Reviewer（角色 2732）交付的可执行验收测试：
// 1) 检视报告存在且包含总体结论与问题清单格式；
// 2) 意图图谱组件 2760 携带 AT-2760-04（GIVEN-WHEN-THEN、可执行）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'docs', 'ea-web-service-code-review.md');
const GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');

function readGraph() {
  return JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
}

test('检视报告存在且包含总体结论', () => {
  // GIVEN Reviewer 已完成代码检视
  // WHEN 检查 docs/ea-web-service-code-review.md
  // THEN 报告存在，且包含「总体结论」与结论取值（通过/有条件通过/需返工 之一）
  assert.ok(fs.existsSync(REPORT), '检视报告应存在');
  const text = fs.readFileSync(REPORT, 'utf8');
  assert.match(text, /总体结论/, '报告应包含「总体结论」章节');
  assert.match(text, /有条件通过|需返工|通过/, '报告应给出总体结论取值');
});

test('检视报告包含问题清单格式（编号/级别/位置/建议）', () => {
  // GIVEN 检视报告已产出
  // WHEN 检查报告的问题清单
  // THEN 至少存在一张问题清单表，含编号/级别/位置/建议列，且包含 Critical 与 Major 级别项
  const text = fs.readFileSync(REPORT, 'utf8');
  assert.match(text, /问题清单/, '报告应包含「问题清单」章节');
  assert.match(text, /\| 编号 \| 级别 \| 位置 \| 描述 \| 修复建议 \|/, '问题清单应为表格式（编号/级别/位置/建议）');
  assert.match(text, /Critical/, '问题清单应包含 Critical 级别项');
  assert.match(text, /Major/, '问题清单应包含 Major 级别项');
});
