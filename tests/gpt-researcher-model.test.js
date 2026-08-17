'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const byId = new Map(GRAPH.elements.map((e) => [e.id, e]));
const relsOfType = (type) => GRAPH.relationships.filter((r) => r.type === type);

test('gpt-researcher-model: course of action and five processes exist', () => {
  // GIVEN the graph models GPT-Researcher multi-agent research
  // WHEN a reader inspects view 177
  // THEN a Course of Action and five Business Processes form the pipeline
  const coa = byId.get('1336');
  assert.ok(coa, 'course of action should exist');
  assert.equal(coa.type, 'Course of Action');

  const processNames = [
    'Plan Research',
    'Conduct Sub-research',
    'Write Report',
    'Review Report',
    'Publish Report',
  ];
  for (const name of processNames) {
    const p = GRAPH.elements.find((e) => e.name === name && e.type === 'Business Process');
    assert.ok(p, `process "${name}" should exist`);
  }
});

test('gpt-researcher-model: triggering chain links the five processes', () => {
  // GIVEN the five processes exist
  // WHEN inspecting Triggering relationships
  // THEN Plan -> Conduct -> Write -> Review -> Publish form a chain
  const trig = relsOfType('Triggering');
  assert.equal(trig.length, 4, 'should have four triggering links');
  const expected = [
    ['Plan Research', 'Conduct Sub-research'],
    ['Conduct Sub-research', 'Write Report'],
    ['Write Report', 'Review Report'],
    ['Review Report', 'Publish Report'],
  ];
  for (const [source, target] of expected) {
    assert.ok(
      trig.some((r) => r.source_name === source && r.target_name === target),
      `should trigger ${source} -> ${target}`
    );
  }
});

test('gpt-researcher-model: five roles assigned to their processes', () => {
  // GIVEN the five roles exist
  // WHEN inspecting Assignment relationships
  // THEN each role is assigned to its process (role -> process)
  const assign = relsOfType('Assignment');
  assert.equal(assign.length, 5, 'should have five assignments');
  const expected = [
    ['Planner', 'Plan Research'],
    ['Researcher', 'Conduct Sub-research'],
    ['Editor', 'Write Report'],
    ['Reviewer', 'Review Report'],
    ['Publisher', 'Publish Report'],
  ];
  for (const [role, proc] of expected) {
    assert.ok(
      assign.some((r) => r.source_name === role && r.target_name === proc),
      `should assign ${role} -> ${proc}`
    );
  }
});

test('gpt-researcher-model: deliverable realizes goal under constraint and principle', () => {
  // GIVEN deliverable, goal, constraint and principle exist
  // WHEN inspecting Realization / Association / Influence relationships
  // THEN the report realizes the objective goal, under local and global constraints
  const del = byId.get('1347');
  const goal = byId.get('1348');
  const con = byId.get('1349');
  const prin = byId.get('1350');
  assert.equal(del.type, 'Deliverable');
  assert.equal(goal.type, 'Goal');
  assert.equal(con.type, 'Constraint');
  assert.equal(prin.type, 'Principle');

  assert.ok(
    GRAPH.relationships.some(
      (r) => r.type === 'Realization' && r.source_id === '1347' && r.target_id === '1348'
    ),
    'research report should realize the objective goal'
  );
  assert.ok(
    GRAPH.relationships.some(
      (r) => r.type === 'Influence' && r.source_id === '1350' && r.target_id === '1348'
    ),
    'principle should influence the objective goal'
  );
  assert.ok(
    GRAPH.relationships.some(
      (r) => r.type === 'Association' && r.source_id === '1349' && r.target_id === '1338'
    ),
    'citation constraint should apply to sub-research'
  );
});
