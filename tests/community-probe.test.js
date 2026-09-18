'use strict';

// AT-community-probe-01 / AT-community-probe-02 (component community-index-001)
//
// P0 read-only community probe (scripts/eval-communities.js). These acceptance
// tests validate the probe from the outside: determinism of the community
// partition assembly and the hard read-only / graphKey-isolation guarantees of
// its Cypher plan. They do NOT require a live Neo4j (offline deterministic).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const probe = require(path.join(__dirname, '..', 'scripts', 'eval-communities.js'));

const SOURCE_PATH = path.join(__dirname, '..', 'scripts', 'eval-communities.js');

test('AT-community-probe-01: community probe is deterministic (pinned concurrency, order-independent assembly)', () => {
  // GIVEN a pinned determinism setting exported by the probe
  assert.equal(probe.DETERMINISM_CONCURRENCY, 1, 'single-threaded execution pins determinism');

  const plan = probe.buildProbePlan({ graphKey: probe.GRAPH_KEY });
  const algorithm = plan.steps.find(step => step.kind === 'algorithm');

  // THEN the algorithm call pins the determinism setting
  assert.ok(algorithm, 'plan exposes an algorithm step');
  assert.equal(plan.determinism.concurrency, probe.DETERMINISM_CONCURRENCY);
  assert.match(algorithm.cypher, new RegExp(`concurrency:\\s*${probe.DETERMINISM_CONCURRENCY}`));

  // AND repeated plan builds are byte-for-byte identical (no hidden time/random state)
  assert.deepEqual(probe.buildProbePlan({ graphKey: probe.GRAPH_KEY }), plan);

  // AND the partition signature is order-independent
  const a = [{ id: 'x', communityId: 1 }, { id: 'y', communityId: 2 }];
  const b = [{ id: 'y', communityId: 2 }, { id: 'x', communityId: 1 }];
  assert.equal(probe.partitionSignature(a), probe.partitionSignature(b));

  // AND summarizing the same partition twice is stable
  assert.deepEqual(probe.summarizePartition(a), probe.summarizePartition(b));

  // AND view overlap + verdict helpers are pure and deterministic
  const overlap = probe.viewCommunityOverlap(
    [{ id: '1', communityId: 0 }, { id: '2', communityId: 0 }, { id: '3', communityId: 1 }],
    [{ view_id: 'v', view_name: 'V', included_elements: ['1', '2', '3'] }],
  );
  assert.equal(overlap[0].dominantCommunity, 0);
  assert.equal(overlap[0].purity, +(2 / 3).toFixed(3));
  assert.equal(probe.stopVerdict({ communityCount: 1, memberCount: 10 }).stop, true);
  assert.equal(probe.stopVerdict({ communityCount: 2, memberCount: 10 }).stop, false);
  // AND a singleton-dominated graph (isolated-majority) is a stop verdict
  assert.equal(probe.summarizePartition([
    { id: '1', communityId: 0 }, { id: '2', communityId: 1 }, { id: '3', communityId: 2 },
  ]).singletonNodeRatio, 1);
  assert.equal(probe.stopVerdict({ communityCount: 2, memberCount: 10, singletonNodeRatio: 0.8 }).stop, true);
});

test('AT-community-probe-02: community probe is read-only and graphKey-scoped', () => {
  const plan = probe.buildProbePlan({ graphKey: probe.GRAPH_KEY });

  // THEN the plan is declared read-only
  assert.equal(plan.readOnly, true);

  // THEN no step carries a persistent write clause
  for (const step of plan.steps) {
    assert.doesNotMatch(
      step.cypher,
      /\b(CREATE|MERGE|DELETE|SET|REMOVE|LOAD\s+CSV|IN\s+TRANSACTIONS)\b/i,
      `step '${step.kind}' must not contain a persistent write clause`,
    );
    assert.doesNotMatch(
      step.cypher,
      /gds\.[\w.]*(write|mutate)/i,
      `step '${step.kind}' must not call a GDS write/mutate procedure`,
    );
  }

  // AND the projection is scoped to the graphKey (multi-project isolation)
  const project = plan.steps.find(step => step.kind === 'project');
  assert.equal(project.params.graphKey, probe.GRAPH_KEY);
  assert.ok(project.params.nodeQuery.includes(probe.GRAPH_KEY), 'node query pins the graphKey literal');
  assert.ok(project.params.relQuery.includes(probe.GRAPH_KEY), 'relationship query pins the graphKey literal');
  assert.match(project.params.nodeQuery, /graphKey/);
  assert.match(project.params.relQuery, /graphKey/);

  // AND the module source never writes files (canonical JSON is untouched)
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  assert.doesNotMatch(source, /writeFileSync|appendFileSync|createWriteStream/);
});
