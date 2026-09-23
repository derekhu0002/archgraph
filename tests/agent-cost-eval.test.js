'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  loadSeed, validateSeed, graphIds, buildUniverse, normPath,
  backendOf, parseTrajectory, scoreTask, buildCurve, aggregate, estimateTokens, GRAPH_PATH, SEED_PATH,
} = require('../scripts/agent-cost-eval.js');

// External-view acceptance tests for the R7 Agent cost/recall harness: it scores
// a real agent session (opencode run NDJSON) against a per-task ORACLE evidence
// set, and its whole reason to exist is to PROVE that an optimisation did not
// shrink recall. So the tests assert both the happy path (all oracle evidence
// retrieved) and the guardrail (a recall-shrinking run MUST be surfaced).

function ndjson(events) {
  return events.map(e => JSON.stringify(e)).join('\n') + '\n';
}

const TASK = {
  id: 'AC-X1', dimension: '图仓联合', dimensionKey: 'joint',
  oracle: { elements: ['overseer-vision-001'], repoPaths: ['docs/actor-memory-tiers.md'] },
};
const UNIVERSE = {
  ids: new Set(['overseer-vision-001', 'decoy-element-999']),
  paths: new Set(['docs/actor-memory-tiers.md', 'docs/decoy.md']),
};

// A full run: one graph call (hits the element) then one repo call (hits the file).
const FULL_RUN = ndjson([
  { type: 'step_start', part: { type: 'step-start' }, time: { start: 1000, end: 1000 } },
  { type: 'message.part', part: { type: 'tool', tool: 'argo_getSystemArchitecture', state: { output: 'found overseer-vision-001 (项目愿景)' } } },
  { type: 'message.part', part: { type: 'tool', tool: 'read', state: { output: 'docs/actor-memory-tiers.md: T1/T2/T3 记忆分层' } } },
  { type: 'message.part', part: { type: 'text', text: '证据：overseer-vision-001 + docs/actor-memory-tiers.md' } },
  { type: 'step_finish', part: { finish: { cost: 0.02, tokens: { input: 100, output: 20, reasoning: 5 } } }, time: { start: 1000, end: 5000 } },
]);

// A recall-shrinking run: only the graph was searched; the repo evidence is missing.
const GRAPH_ONLY_RUN = ndjson([
  { type: 'step_start', part: { type: 'step-start' } },
  { type: 'message.part', part: { type: 'tool', tool: 'argo_getSystemArchitecture', state: { output: 'found overseer-vision-001' } } },
  { type: 'step_finish', part: { finish: { tokens: { input: 50, output: 10 } } } },
]);

test('AT-agent-cost-eval-01: SEED is valid and every oracle resolves in the real graph / repo', () => {
  const seed = loadSeed(SEED_PATH);
  const validation = validateSeed(seed);
  assert.equal(validation.ok, true, validation.errors.join(' | '));
  assert.equal(seed.schemaVersion, 1);
  assert.ok(seed.questions.length >= 10, 'seed must carry a real task corpus');
  const ids = new Set(graphIds(GRAPH_PATH));
  for (const q of seed.questions) {
    for (const id of q.oracle.elements) assert.ok(ids.has(id), `${q.id} oracle element ${id} must exist in the graph`);
    for (const p of q.oracle.repoPaths) assert.ok(fs.existsSync(path.join(ROOT, p)), `${q.id} oracle repo path ${p} must exist`);
    assert.ok(q.oracle.elements.length + q.oracle.repoPaths.length >= 1, `${q.id} needs at least one oracle evidence`);
  }
});

test('AT-agent-cost-eval-02: backend classification and trajectory parsing', () => {
  // GIVEN the graph/repo tool names used in a session
  assert.equal(backendOf('argo_getSystemArchitecture'), 'graph');
  assert.equal(backendOf('argo_queryNeo4jGraph'), 'graph');
  assert.equal(backendOf('read'), 'repo');
  assert.equal(backendOf('grep'), 'repo');
  assert.equal(backendOf('glob'), 'repo');
  assert.equal(backendOf('something-else'), 'other');
  // WHEN the full run NDJSON is parsed
  const t = parseTrajectory(FULL_RUN);
  // THEN turns/tokens/latency are extracted and both backends are seen
  assert.equal(t.steps, 1);
  assert.equal(t.tokensIn, 100);
  assert.equal(t.tokensOut, 20);
  assert.equal(t.tokensReasoning, 5);
  assert.equal(t.tokens, 125);
  assert.equal(t.toolCalls.length, 2);
  assert.deepEqual(t.toolCalls.map(c => c.backend), ['graph', 'repo']);
  assert.equal(t.latencyMs, 4000);
});

test('AT-agent-cost-eval-03: scoreTask matches oracle evidence and counts backend round-trips', () => {
  const scored = scoreTask(parseTrajectory(FULL_RUN), TASK, UNIVERSE);
  // recall = both oracle evidence retrieved; precision = 2 hits / (2 hits + 0 decoys)
  assert.equal(scored.success, true);
  assert.equal(scored.evidenceRecall, 1);
  assert.equal(scored.evidencePrecision, 1);
  assert.deepEqual(scored.missing, []);
  // one graph→repo transition = one round-trip
  assert.equal(scored.roundTrips, 1);
  assert.deepEqual(scored.byBackend, { graph: 1, repo: 1, other: 0 });
  assert.equal(scored.firstHitIndex, 0);
  // decoys that were surfaced lower precision (they were not required)
  const noisy = scoreTask(parseTrajectory(ndjson([
    { type: 'message.part', part: { type: 'tool', tool: 'read', state: { output: 'overseer-vision-001 docs/actor-memory-tiers.md docs/decoy.md decoy-element-999' } } },
  ])), TASK, UNIVERSE);
  assert.equal(noisy.evidenceRecall, 1);
  assert.equal(noisy.evidencePrecision, 0.5);
});

test('AT-agent-cost-eval-04: a recall-shrinking run is surfaced, never hidden', () => {
  // GIVEN a run that searched only the graph (the repo evidence was skipped)
  const scored = scoreTask(parseTrajectory(GRAPH_ONLY_RUN), TASK, UNIVERSE);
  // THEN recall drops below 1 and the missing evidence is named
  assert.equal(scored.success, false);
  assert.equal(scored.evidenceRecall, 0.5);
  assert.deepEqual(scored.missing, ['docs/actor-memory-tiers.md']);
  assert.equal(scored.roundTrips, 0);
  // AND the aggregate exposes it under failedTasks (the guardrail)
  const summary = aggregate([scored]);
  assert.equal(summary.successCount, 0);
  assert.equal(summary.failedTasks.length, 1);
  assert.deepEqual(summary.failedTasks[0].missing, ['docs/actor-memory-tiers.md']);
});

test('AT-agent-cost-eval-05: cost/recall curve is monotonic in cumulative tokens', () => {
  const cheap = scoreTask(parseTrajectory(GRAPH_ONLY_RUN), TASK, UNIVERSE);
  const full = scoreTask(parseTrajectory(FULL_RUN), TASK, UNIVERSE);
  const curve = buildCurve([full, cheap]);
  assert.equal(curve.length, 2);
  // sorted cheap→expensive; cumulative tokens never decrease
  assert.ok(curve[1].cumulativeTokens >= curve[0].cumulativeTokens);
  assert.equal(curve[0].taskId, 'AC-X1');
  assert.ok(curve[0].evidenceRecall <= 1 && curve[0].evidenceRecall >= 0);
  // estimateTokens is a deterministic heuristic (CJK ≈ 1 token/char)
  assert.ok(estimateTokens('中文ab') >= 3);
});

test('AT-agent-cost-eval-06: universe builder merges graph ids and repo paths', () => {
  const u = buildUniverse({ graphPath: GRAPH_PATH, repoRoot: ROOT });
  assert.ok(u.ids.has('project-overseer-001'), 'graph ids must be in the universe');
  assert.ok(u.paths.has('docs/actor-memory-tiers.md'), 'repo paths must be in the universe');
  assert.equal(normPath('a\\b\\c'), 'a/b/c');
});
