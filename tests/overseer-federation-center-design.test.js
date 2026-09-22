'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const DESIGN_ID = 'overseer-federation-center-design-001';
const DESIGN_NAME = '设计稿：联邦中心机构 + 规则内化（插拔式联邦 v0）';
const VIEW_ID = 'overseer-ltm-001';
const ACTOR_ID = 'project-overseer-001';
const GOAL_ID = 'overseer-federation-vision-001';

function designElement() {
  const matches = GRAPH.elements.filter((entry) => entry.id === DESIGN_ID);
  assert.equal(matches.length, 1, `exactly one element with id ${DESIGN_ID} should exist`);
  return matches[0];
}

function attr(name) {
  const entry = (designElement().attributes || []).find((a) => a.name === name);
  return entry ? entry.value : undefined;
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('overseer-federation-center: graph registers the center + rule-internalization design', () => {
  // GIVEN the human partner approved registering the design increment
  // WHEN the intent graph is inspected
  // THEN a Business Object design element exists with the expected id and name
  const el = designElement();
  assert.equal(el.name, DESIGN_NAME, 'design element name should match');
  assert.equal(el.type, 'Business Object', 'design draft should be a Business Object');
});

test('overseer-federation-center: design is a PLANNED T2 memory item', () => {
  // GIVEN the design is a draft concept, not a committed deliverable
  // WHEN its attributes are inspected
  // THEN it is kept in T2 long-term memory and marked PLANNED
  assert.equal(attr('memoryTier'), 'T2', 'memoryTier should be T2');
  assert.equal(attr('status'), 'PLANNED', 'status should be PLANNED');
});

test('overseer-federation-center: description records the central institution with the metadata-not-content red line', () => {
  // GIVEN the center must coordinate members without owning their content
  // WHEN the description is inspected
  // THEN it records the center, its metadata-only boundary and the Graph Store upgrade
  const desc = designElement().description || '';
  assert.match(desc, /中心/, 'description should record the central institution');
  assert.match(desc, /元数据/, 'description should record federation metadata');
  assert.match(desc, /不持有/, 'description should record the metadata-not-content red line');
  assert.match(desc, /Graph Store/, 'description should record the Graph Store carrier');
  assert.match(desc, /registry/, 'description should record the reference-registry upgrade');
});

test('overseer-federation-center: description records the three plug-in capabilities and the two interaction levels', () => {
  // GIVEN the federation rules are internalized into the graph framework as plug-in capabilities
  // WHEN the description is inspected
  // THEN it records register/discover+grant/request and both L-Read and L-Provide
  const desc = designElement().description || '';
  assert.match(desc, /register/, 'description should record the registration capability');
  assert.match(desc, /授权/, 'description should record the authorization capability');
  assert.match(desc, /请求/, 'description should record the request capability');
  assert.match(desc, /L-Read/, 'description should record the read-reference interaction level');
  assert.match(desc, /L-Provide/, 'description should record the contract-delivery interaction level');
});

test('overseer-federation-center: description records the member lifecycle and exit protocol', () => {
  // GIVEN members can be added and destroyed over time
  // WHEN the description is inspected
  // THEN it records the lifecycle and the exit protocol
  const desc = designElement().description || '';
  assert.match(desc, /生命周期/, 'description should record the member lifecycle');
  assert.match(desc, /退出/, 'description should record the exit protocol');
  assert.match(desc, /墓碑/, 'description should record the tombstone-based reconciliation');
});

test('overseer-federation-center: element is a member of the project-overseer core LTM view', () => {
  // GIVEN the design is the project overseer's long-term memory
  // WHEN views are inspected
  // THEN the core T2 view includes it and is mounted under the overseer actor
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.equal(view.parent_element_id, ACTOR_ID, `view ${VIEW_ID} should be mounted under ${ACTOR_ID}`);
  assert.ok(view.included_elements.includes(DESIGN_ID), `${VIEW_ID} should include the design element`);
});

test('overseer-federation-center: design is associated with the federation vision goal', () => {
  // GIVEN the design details the direction captured by the vision goal
  // WHEN relationships are inspected
  // THEN an Association links the design to the federation goal
  const rel = (GRAPH.relationships || []).find(
    (r) => r.source_id === DESIGN_ID && r.target_id === GOAL_ID && r.type === 'Association'
  );
  assert.ok(rel, 'an Association from the design to the federation goal should exist');
});

test('overseer-federation-center: element carries an executable GIVEN-WHEN-THEN acceptance testcase', () => {
  // GIVEN every element validates itself from an external perspective
  // WHEN the testcases are inspected
  // THEN at least one testcase is written GIVEN-WHEN-THEN
  const el = designElement();
  assert.ok(Array.isArray(el.testcases) && el.testcases.length > 0, 'element should carry testcases');
  assert.ok(
    el.testcases.some((tc) => isGivenWhenThen(tc.description || '')),
    'at least one testcase should be written GIVEN-WHEN-THEN'
  );
});
