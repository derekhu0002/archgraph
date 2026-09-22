'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));

// External-view acceptance tests for LTM layering: an actor's T2 memory is split
// across the core LTM view (<actor>-ltm-001) plus themed sibling layer views, all
// mounted under the actor, so no single view hits the 15-member cap. Layer view
// ids MUST NOT contain "-ltm-" because the T2 finder (actor-working-memory.js /
// memory-archive.js) locates the recall view by /-ltm-/.

const ACTOR = 'project-overseer-001';
const CORE = 'overseer-ltm-001';
const LAYERS = ['overseer-rules-001', 'overseer-retrieval-001', 'overseer-product-001'];
const CORE_REQUIRED = ['overseer-memory-tiers-001', 'overseer-vision-001', 'overseer-wiki-eval-001'];
const MEMBERS_BY_VIEW = {
  'overseer-ltm-001': [
    'overseer-memory-tiers-001', 'overseer-archimate-role-001', 'overseer-retrieval-recall-first-001',
    'overseer-wiki-eval-001', 'overseer-failure-exp-concept-001', 'overseer-vision-001',
    'overseer-default-pm-actor-001', 'overseer-federation-vision-001',
  ],
  'overseer-rules-001': [
    'overseer-graph-dedup-gate-001', 'overseer-harness-workspaceroot-fix-001', 'overseer-graph-mcp-deploy-001',
    'overseer-mcp-tool-surface-001', 'overseer-milestone-critical-reasoning-001',
    'overseer-milestone-lossless-write-001',
  ],
  'overseer-retrieval-001': [
    'overseer-semantic-seed-prefix-fix-001', 'overseer-rerank-latency-fix-001',
    'overseer-community-probe-001', 'overseer-mem-semantic-threshold-calibration-001',
    'overseer-semantic-projection-oom-001',
  ],
  'overseer-product-001': [
    'overseer-teamai-insight-001', 'overseer-homepage-v3-kglibrary-retire-001', 'overseer-community-linkage-001',
    'overseer-multiagent-delegation-plan-001', 'overseer-view-geometry-route-fix-001',
    'overseer-framework-series-001', 'overseer-agent-model-unification-001',
    'overseer-archgraph-intro-pdf-001',
  ],
};

function findView(id) {
  return (GRAPH.views || []).find(v => v.view_id === id);
}
function findElement(id) {
  return (GRAPH.elements || []).find(e => e.id === id);
}

test('AT overseer-ltm-layering: LTM is split into core + themed layers under the actor', () => {
  // GIVEN the project overseer T2 memory
  // THEN the core LTM view and three themed layer views exist, all mounted on the actor
  for (const id of [CORE, ...LAYERS]) {
    const view = findView(id);
    assert.ok(view, `${id} must exist`);
    assert.equal(view.parent_element_id, ACTOR, `${id} must be mounted under ${ACTOR}`);
  }
  // AND no view exceeds the 15-member cap
  for (const id of [CORE, ...LAYERS]) {
    const n = (findView(id).included_elements || []).length;
    assert.ok(n >= 1 && n <= 15, `${id} must hold 1..15 members (had ${n})`);
  }
});

test('AT overseer-ltm-layering: membership is exact and no memory element is lost', () => {
  // GIVEN each layer's expected membership
  // THEN each view holds exactly its expected members (set equality)
  const union = new Set();
  for (const [viewId, expected] of Object.entries(MEMBERS_BY_VIEW)) {
    const actual = findView(viewId).included_elements || [];
    assert.deepEqual([...actual].sort(), [...expected].sort(), `${viewId} membership must match`);
    for (const m of actual) {
      assert.match(m, /^overseer-/, `member ${m} must be overseer-scoped`);
      union.add(m);
    }
  }
  // AND the union preserves every memory element (none dropped)
  const total = Object.values(MEMBERS_BY_VIEW).reduce((a, b) => a + b.length, 0);
  assert.equal(union.size, total, 'no element may appear in two layers or be lost');
  for (const id of union) assert.ok(findElement(id), `member element ${id} must exist`);
});

test('AT overseer-ltm-layering: eval-required core stays in <actor>-ltm-001 and the T2 finder stays unique', () => {
  // GIVEN downstream evals read specific members from the core LTM view
  const coreMembers = findView(CORE).included_elements || [];
  for (const id of CORE_REQUIRED) {
    assert.ok(coreMembers.includes(id), `core LTM must retain eval-required member ${id}`);
  }
  // AND the recall view is uniquely resolvable by the /-ltm-/ convention
  const ltmNamed = (GRAPH.views || []).filter(v => v.parent_element_id === ACTOR && /-ltm-/.test(v.view_id));
  assert.equal(ltmNamed.length, 1, 'exactly one <actor>-ltm- view must match the T2 finder');
  assert.equal(ltmNamed[0].view_id, CORE);
  // AND new layer views never masquerade as the recall view
  for (const id of LAYERS) assert.doesNotMatch(id, /-ltm-/);
});
