'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const WP_ID = 'wp-federation-framework-side-001';
const WP_NAME = '框架侧：联邦规则 + Graph MCP 工具契约（注册/注销/发现/授权/读取）';
const WP_VIEW = '180';
const LESSON_ID = 'overseer-cross-project-dispatch-001';
const LESSON_NAME = '可复用经验：跨项目 Agent 投递机制与编码规范（OpenCode 桌面版 HTTP server）';
const RULES_VIEW = 'overseer-rules-001';
const DESIGN_ID = 'overseer-federation-center-design-001';
const ACTOR_ID = 'project-overseer-001';

function el(id) {
  const m = GRAPH.elements.filter((e) => e.id === id);
  assert.equal(m.length, 1, `exactly one element with id ${id} should exist`);
  return m[0];
}

function isGwt(t) {
  return /GIVEN/.test(t) && /WHEN/.test(t) && /THEN/.test(t);
}

function hasGwt(el) {
  return Array.isArray(el.testcases) && el.testcases.some((t) => isGwt(t.description || ''));
}

function view(id) {
  const v = (GRAPH.views || []).find((x) => x.view_id === id);
  assert.ok(v, `view ${id} should exist`);
  return v;
}

test('federation-framework: framework-side work package is registered', () => {
  // GIVEN the framework must land the federation rules and MCP tool contract
  // WHEN the graph is inspected
  // THEN a Work Package exists with the expected id/name/type and an acceptance testcase
  const wp = el(WP_ID);
  assert.equal(wp.name, WP_NAME, 'WP name should match');
  assert.equal(wp.type, 'Work Package', 'should be a Work Package');
  assert.ok(hasGwt(wp), 'WP should carry a GIVEN-WHEN-THEN acceptance testcase');
  assert.ok(view(WP_VIEW).included_elements.includes(WP_ID), `WP should be a member of view ${WP_VIEW}`);
});

test('federation-framework: WP description records rules + MCP tool contract scope', () => {
  // GIVEN the framework side owns rules and the MCP tool surface
  // WHEN the description is inspected
  // THEN it records rules, the MCP tool contract, default-deny and schema alignment
  const d = el(WP_ID).description || '';
  assert.match(d, /规则/, 'should record rules');
  assert.match(d, /MCP/, 'should record the MCP tool contract');
  assert.match(d, /默认拒绝/, 'should record default-deny');
  assert.match(d, /schema/i, 'should record schema alignment with the center');
});

test('federation-framework: cross-project dispatch lesson is a T2 memory in the rules view', () => {
  // GIVEN the cross-project dispatch mechanism and encoding norms were learned this session
  // WHEN the graph is inspected
  // THEN a T2 Business Object exists in the overseer rules layer
  const le = el(LESSON_ID);
  assert.equal(le.name, LESSON_NAME, 'lesson name should match');
  assert.equal(le.type, 'Business Object', 'lesson should be a Business Object');
  const attr = (n) => (le.attributes || []).find((a) => a.name === n);
  assert.equal(attr('memoryTier').value, 'T2', 'lesson memoryTier should be T2');
  const v = view(RULES_VIEW);
  assert.equal(v.parent_element_id, ACTOR_ID, `${RULES_VIEW} should be mounted under ${ACTOR_ID}`);
  assert.ok(v.included_elements.includes(LESSON_ID), `${RULES_VIEW} should include the lesson`);
  assert.ok(hasGwt(le), 'lesson should carry a GIVEN-WHEN-THEN acceptance testcase');
});

test('federation-framework: lesson description records the transport mechanism and encoding norms', () => {
  // GIVEN the mechanism and its pitfalls must be reusable
  // WHEN the description is inspected
  // THEN it records the desktop HTTP server mechanism, the UTF-8/Latin-1 norm and the isolation finding
  const d = el(LESSON_ID).description || '';
  assert.match(d, /OpenCode/, 'should record OpenCode');
  assert.match(d, /session/, 'should record the /session mechanism');
  assert.match(d, /UTF-8/, 'should record the UTF-8 norm');
  assert.match(d, /Latin-1/, 'should record the Latin-1 pitfall');
  assert.match(d, /隔离/, 'should record the per-project isolation finding');
});

test('federation-framework: design element records the D1b/D3 decisions and progress', () => {
  // GIVEN the human partner resolved D1b (framework/center split) and D3 (read-only first phase)
  // WHEN the design description is inspected
  // THEN it records those decisions and the graph-wiki delivery/deploy progress
  const d = el(DESIGN_ID).description || '';
  assert.match(d, /裁决/, 'should record the decision section');
  assert.match(d, /graph-wiki/, 'should record that the center lands on graph-wiki');
  assert.match(d, /内容维度/, 'should record read-only = content dimension');
});
