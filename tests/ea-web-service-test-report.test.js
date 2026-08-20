'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'docs', 'ea-web-service-test-report.md');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'),
);

function readReport() {
  assert.ok(existsSync(REPORT), '测试报告应存在');
  return readFileSync(REPORT, 'utf8');
}

test('测试报告：存在且含全量回归与 PASS 结论', () => {
  // GIVEN 验证测试工程师已完成验证
  // WHEN 读取测试报告
  // THEN 报告含全量回归结果、图谱校验结果、PASS 结论与 AC 覆盖追踪
  const text = readReport();
  assert.match(text, /全量回归/);
  assert.match(text, /52 pass/);
  assert.match(text, /validateSystemArchitecture/);
  assert.match(text, /PASS/);
});

test('测试报告：覆盖 AC-1..AC-12 追踪表', () => {
  // GIVEN 测试报告已产出
  // WHEN 检查 AC 覆盖追踪
  // THEN 包含 AC-1 到 AC-12 的逐条覆盖说明
  const text = readReport();
  for (let i = 1; i <= 12; i += 1) {
    assert.ok(text.includes(`AC-${i} `) || text.includes(`AC-${i}\n`), `报告应包含 AC-${i}`);
  }
});

test('图谱登记：Work Package 2758 携带验收用例 AT-2758-13', () => {
  // GIVEN 验证测试通过并已登记图谱
  // WHEN 检查 WP 2758 的 testcases
  // THEN 存在 AT-2758-13（GIVEN-WHEN-THEN、可执行，Input 指向本测试文件）
  const wp = GRAPH.elements.find((el) => el.id === '2758');
  assert.ok(wp, 'WP 2758 应存在');
  const tc = (wp.testcases || []).find((entry) => entry.name && entry.name.includes('AT-2758-13'));
  assert.ok(tc, 'WP 2758 应携带 AT-2758-13');
  assert.match(tc.description, /GIVEN/);
  assert.match(tc.description, /WHEN/);
  assert.match(tc.description, /THEN/);
  assert.equal(tc.type, 'Acceptance Test');
  assert.ok(tc.Input && tc.Input.includes('node --test tests/ea-web-service-test-report.test.js'), 'AT-2758-13 的 Input 应指向本测试');
});
