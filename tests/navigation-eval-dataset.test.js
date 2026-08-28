'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'navigation-eval-dataset.md');
const GRAPH = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));

function findView(id) { return (GRAPH.views || []).find(v => v && v.view_id === id); }
function findElement(id) { return (GRAPH.elements || []).find(e => e && e.id === id); }

// External-view acceptance tests for the navigation-capability eval dataset:
// an agent holding an ArchiMate-schema map should be able to navigate (locate /
// reach / switch viewpoint / stay in scope) — the dataset's ground truths must
// all be verifiable against the real intent graph.

test('AT navigation-eval: dataset doc exists with 4 navigation dimensions', () => {
  // GIVEN the navigation eval dataset document
  const doc = fs.readFileSync(DOC, 'utf8');
  // THEN it declares the four navigation capability dimensions
  assert.match(doc, /定位.*Locate/s, 'should have Locate dimension');
  assert.match(doc, /可达.*Reachability/s, 'should have Reachability dimension');
  assert.match(doc, /视角切换.*Viewpoint/s, 'should have Viewpoint dimension');
  assert.match(doc, /边界内导航.*Scoped Navigation/s, 'should have Scoped Navigation dimension');
  // AND uses GIVEN/WHEN/THEN + retrieval-path format
  assert.match(doc, /GIVEN/, 'questions use GIVEN');
  assert.match(doc, /WHEN/, 'questions use WHEN');
  assert.match(doc, /THEN/, 'questions use THEN');
  assert.match(doc, /检索提示/, 'questions carry a retrieval hint');
});

test('AT navigation-eval: 20 questions across 4 dimensions', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const qids = doc.match(/NV-\d{2}/g) || [];
  const unique = new Set(qids);
  // THEN exactly 20 navigation questions (NV-01..NV-20)
  assert.equal(unique.size, 20, 'expected 20 unique NV-xx ids');
  for (let i = 1; i <= 20; i += 1) {
    const id = `NV-${String(i).padStart(2, '0')}`;
    assert.ok(unique.has(id), `missing ${id}`);
  }
  // AND all four dimension headers present in the question body
  assert.match(doc, /### 维度 1：定位/);
  assert.match(doc, /### 维度 2：可达/);
  assert.match(doc, /### 维度 3：视角切换/);
  assert.match(doc, /### 维度 4：边界内导航/);
});

test('AT navigation-eval: locate/reach ground truths exist in the graph', () => {
  // GIVEN the ground-truth targets referenced by the navigation questions
  // THEN every key id/name is present in the real intent graph
  const elementIds = ['1962', 'project-overseer-001', 'overseer-vision-001', 'overseer-archimate-role-001', '2760'];
  for (const id of elementIds) {
    assert.ok(findElement(id), `element ${id} must exist in the graph`);
  }
  const viewIds = ['memory-eval-view-001', 'overseer-ltm-001', '299', '433', '1800', '180', 'video-team-001', 'self-evolution-sandbox-view-001'];
  for (const id of viewIds) {
    assert.ok(findView(id), `view ${id} must exist in the graph`);
  }
});

test('AT navigation-eval: scoped (boundary) ground truths are exact', () => {
  // GIVEN the memory-eval view boundary (NV-16)
  const mv = findView('memory-eval-view-001');
  // THEN its membership is exactly the three eval work packages
  const members = (mv && mv.included_elements) || [];
  assert.deepEqual([...members].sort(), ['memory-eval-bench-wp-001', 'memory-eval-dataset-wp-001', 'memory-eval-run-wp-001'].sort());
  // AND the project overseer LTM (NV-17) members are all overseer-* memories
  const ltm = findView('overseer-ltm-001');
  const ltmMembers = (ltm && ltm.included_elements) || [];
  assert.ok(ltmMembers.length >= 1);
  for (const m of ltmMembers) assert.match(m, /^overseer-/, `LTM member ${m} should be overseer-scoped`);
  // AND AgentOrganization (1962, NV-18) owns the 4 team views + its own view
  const a1962 = findElement('1962');
  const subviews = ((a1962 && a1962.subdiagram_views) || []).map(s => s && s.view_id);
  for (const expected of ['299', '430', '433', 'media-team-001', 'video-team-001']) {
    assert.ok(subviews.includes(expected), `1962 subview should include ${expected}`);
  }
});
