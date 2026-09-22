'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const GOAL_ID = 'overseer-federation-vision-001';
const GOAL_NAME = '愿景延伸：联邦式组织级图谱（项目即国家，组织即联邦）';
const VIEW_ID = 'overseer-ltm-001';
const ACTOR_ID = 'project-overseer-001';
const VISION_ID = 'overseer-vision-001';

function goalElement() {
  const matches = GRAPH.elements.filter((entry) => entry.id === GOAL_ID);
  assert.equal(matches.length, 1, `exactly one element with id ${GOAL_ID} should exist`);
  return matches[0];
}

function attr(name) {
  const entry = (goalElement().attributes || []).find((a) => a.name === name);
  return entry ? entry.value : undefined;
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('overseer-federation: graph registers the federation vision direction as a Goal', () => {
  // GIVEN the human partner articulated the federation vision (projects as countries, the org as a federation)
  // WHEN the intent graph is inspected
  // THEN a Goal element exists with the expected id and name
  const el = goalElement();
  assert.equal(el.name, GOAL_NAME, 'federation vision goal name should match');
  assert.equal(el.type, 'Goal', 'federation vision direction should be a Goal');
});

test('overseer-federation: direction carries PLANNED status and T2 memory tier', () => {
  // GIVEN the direction is a vision/concept, not a committed deliverable
  // WHEN its attributes are inspected
  // THEN it is kept in T2 long-term memory and marked PLANNED
  assert.equal(attr('memoryTier'), 'T2', 'memoryTier should be T2');
  assert.equal(attr('status'), 'PLANNED', 'status should be PLANNED');
});

test('overseer-federation: description records the country/federation analogy and its three aspects', () => {
  // GIVEN the analogy must not be lost across sessions
  // WHEN the description is inspected
  // THEN it captures the country=federation mapping and all three aspects
  const desc = goalElement().description || '';
  assert.match(desc, /国家/, 'description should record the country analogy');
  assert.match(desc, /联邦/, 'description should record the federation analogy');
  assert.match(desc, /地形/, 'description should record the terrain (project attributes) aspect');
  assert.match(desc, /海关|管控/, 'description should record the customs (access control) aspect');
  assert.match(desc, /分工/, 'description should record the division-of-labor aspect');
});

test('overseer-federation: description records the reference-based method and the minimal federal law', () => {
  // GIVEN the federation must avoid copy-based drift and needs a minimal shared contract
  // WHEN the description is inspected
  // THEN it records reference (not copy), the cross-graph coordinate, the shared type language and default-deny
  const desc = goalElement().description || '';
  assert.match(desc, /引用/, 'description should record the reference-based method');
  assert.match(desc, /graphKey/, 'description should record the cross-graph coordinate (graphKey, elementId)');
  assert.match(desc, /ArchiMate/, 'description should record the shared type language');
  assert.match(desc, /默认拒绝/, 'description should record the default-deny customs baseline');
});

test('overseer-federation: element is a member of the project-overseer core LTM view', () => {
  // GIVEN the direction is the project overseer's long-term memory
  // WHEN views are inspected
  // THEN the core T2 view includes it and is mounted under the overseer actor
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.equal(view.parent_element_id, ACTOR_ID, `view ${VIEW_ID} should be mounted under ${ACTOR_ID}`);
  assert.ok(view.included_elements.includes(GOAL_ID), `${VIEW_ID} should include the federation goal`);
});

test('overseer-federation: direction is associated with the existing project vision', () => {
  // GIVEN the direction extends, and must not conflict with, the original vision
  // WHEN relationships are inspected
  // THEN an Association links the federation goal to the project vision goal
  const rel = (GRAPH.relationships || []).find(
    (r) => r.source_id === GOAL_ID && r.target_id === VISION_ID && r.type === 'Association'
  );
  assert.ok(rel, 'an Association from the federation goal to the project vision should exist');
});

test('overseer-federation: element carries an executable GIVEN-WHEN-THEN acceptance testcase', () => {
  // GIVEN every element validates itself from an external perspective
  // WHEN the testcases are inspected
  // THEN at least one testcase is written GIVEN-WHEN-THEN
  const el = goalElement();
  assert.ok(Array.isArray(el.testcases) && el.testcases.length > 0, 'element should carry testcases');
  assert.ok(
    el.testcases.some((tc) => isGivenWhenThen(tc.description || '')),
    'at least one testcase should be written GIVEN-WHEN-THEN'
  );
});
