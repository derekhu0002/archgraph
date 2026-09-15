'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const PLAN_ID = 'overseer-multiagent-delegation-plan-001';
const PLAN_NAME = '待规划：框架级自相似递归分身机制（self-similar recursive sub-agents）';
const VIEW_ID = 'overseer-product-001';
const ACTOR_ID = 'project-overseer-001';
const INSIGHT_ID = 'insight-lead-milestone-multiagent-delegation-001';

function planElement() {
  const matches = GRAPH.elements.filter((entry) => entry.id === PLAN_ID);
  assert.equal(matches.length, 1, `exactly one element with id ${PLAN_ID} should exist`);
  return matches[0];
}

function attr(name) {
  const el = planElement();
  const entry = (el.attributes || []).find((a) => a.name === name);
  return entry ? entry.value : undefined;
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('overseer-plan: graph registers the multi-agent delegation planning item', () => {
  // GIVEN the human partner asked to record the insight and register it as a to-be-planned item
  // WHEN the intent graph is inspected
  // THEN a Business Object exists with the expected id, name and type
  const el = planElement();
  assert.equal(el.name, PLAN_NAME, 'planning element name should match');
  assert.equal(el.type, 'Business Object', 'planning item should be a Business Object');
});

test('overseer-plan: planning item carries PLANNED status and T2 memory tier', () => {
  // GIVEN the item is a to-be-planned entry (not delivered)
  // WHEN its attributes are inspected
  // THEN it is marked PLANed, kept in T2 long-term memory and linked to the source insight
  assert.equal(attr('status'), 'PLANNED', 'status should be PLANNED');
  assert.equal(attr('memoryTier'), 'T2', 'memoryTier should be T2');
  assert.equal(attr('planningState'), '待规划', 'planningState should be 待规划');
  assert.equal(attr('sourceInsight'), INSIGHT_ID, 'sourceInsight should reference the insight milestone');
});

test('overseer-plan: description records the insight outcome and the agreed mechanism', () => {
  // GIVEN the insight conclusion plus the agreed design consensus must not be lost
  // WHEN the description is inspected
  // THEN it captures the industry verdict, the self-similar clone model, the spawn controls and open questions
  const el = planElement();
  const desc = el.description || '';
  assert.match(desc, /部分有/, 'description should record the industry verdict');
  assert.match(desc, /自相似/, 'description should record the self-similar clone model');
  assert.match(desc, /分身/, 'description should record the clone concept');
  assert.match(desc, /深度上限 3|深度上限3/, 'description should record the depth bound of 3');
  assert.match(desc, /扇出/, 'description should record the fan-out bound');
  assert.match(desc, /hard|harness|硬/, 'description should record that the bounds are enforced by the harness');
  assert.match(desc, /scope/, 'description should record scope-narrowed permissions');
  assert.match(desc, /fallback/, 'description should record the fallback path');
  assert.match(desc, /未决/, 'description should record the remaining open questions');
});

test('overseer-plan: element is a member of the project-overseer T2 sub-view', () => {
  // GIVEN the item is the project overseer's long-term memory
  // WHEN views are inspected
  // THEN the overseer product/team T2 sub-view includes it and is mounted under the overseer actor
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.equal(view.parent_element_id, ACTOR_ID, `view ${VIEW_ID} should be mounted under ${ACTOR_ID}`);
  assert.ok(view.included_elements.includes(PLAN_ID), `${VIEW_ID} should include the planning item`);
});

test('overseer-plan: links to the insight without polluting the actor T2 view', () => {
  // GIVEN the reference must be recorded without dragging another actor's element into the overseer view
  // WHEN the attribute and the view membership are inspected
  // THEN the linkage lives on the sourceInsight attribute and the T2 view stays overseer-scoped
  assert.equal(attr('sourceInsight'), INSIGHT_ID, 'sourceInsight should reference the insight milestone');
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  for (const member of view.included_elements || []) {
    assert.match(member, /^overseer-/, `member ${member} must be overseer-scoped`);
  }
  assert.ok(!(view.included_elements || []).includes(INSIGHT_ID), 'insight element must not enter the overseer T2 view');
});

test('overseer-plan: element carries an executable GIVEN-WHEN-THEN acceptance testcase', () => {
  // GIVEN every element validates itself from an external perspective
  // WHEN the testcases are inspected
  // THEN at least one testcase is written GIVEN-WHEN-THEN
  const el = planElement();
  assert.ok(Array.isArray(el.testcases) && el.testcases.length > 0, 'element should carry testcases');
  assert.ok(
    el.testcases.some((tc) => isGivenWhenThen(tc.description || '')),
    'at least one testcase should be written GIVEN-WHEN-THEN'
  );
});
