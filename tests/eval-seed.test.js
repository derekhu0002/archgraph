'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(ROOT, 'data', 'eval-seeds', 'navigation-seed.json');
const GRAPH = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
const loader = require('../scripts/eval-seed.js');

function findView(id) { return (GRAPH.views || []).find(v => v && v.view_id === id); }
function findElement(id) { return (GRAPH.elements || []).find(e => e && e.id === id); }

// External-view acceptance tests for the archived navigation evaluation SEED:
// it is the single source of truth for the dataset — versioned, structurally
// valid, every ground-truth target resolvable in the real intent graph, and
// consumed by both navigation harnesses (direct + agent) so future questions
// are added in the SEED only.

test('AT eval-seed: navigation SEED is valid (schema/version/7 dims × 28 questions)', () => {
  // GIVEN the archived navigation evaluation SEED
  // THEN it passes structural validation with full per-question metadata
  const validation = loader.validateSeed(seed);
  assert.equal(validation.ok, true, validation.errors.join(' | '));
  assert.equal(seed.schemaVersion, 1);
  assert.ok(seed.seedId && seed.version, 'seed needs id + version');
  assert.equal(seed.status, 'active');
  assert.equal(seed.questions.length, 28);
  for (const q of seed.questions) {
    for (const field of ['id', 'dimension', 'dimensionKey', 'label', 'question', 'given', 'when', 'then', 'retrievalHint']) {
      assert.ok(typeof q[field] === 'string' && q[field], `${q.id} missing ${field}`);
    }
    assert.ok(q.target && q.target.id && Array.isArray(q.target.names), `${q.id} needs target`);
    assert.ok(Array.isArray(q.retrieval) && q.retrieval.length > 0, `${q.id} needs executable retrieval`);
    assert.ok(Array.isArray(q.requirements) && q.requirements.length > 0, `${q.id} needs requirements`);
    // AND every question has a host-perspective scenario (instruction/expected/agentBehavior)
    const hs = seed.hostScenarios && seed.hostScenarios[q.id];
    assert.ok(hs && typeof hs === 'object', `${q.id} needs hostScenario`);
    for (const f of ['instruction', 'expected', 'agentBehavior']) {
      assert.ok(hs && typeof hs[f] === 'string' && hs[f], `${q.id} hostScenario.${f} required`);
    }
  }
});

test('AT eval-seed: loader exposes questions/dimensions consumed by harnesses', () => {
  // GIVEN the eval-seed loader
  // THEN it exposes 20 questions across the 4 dimensions (5 each)
  assert.equal(loader.questions.length, 28);
  assert.deepEqual([...loader.DIMENSIONS], ['定位', '可达', '视角切换', '边界内导航', '验收用例定位', '提交登记', '变更影响']);
  const EXPECTED_COUNTS = { '定位': 5, '可达': 5, '视角切换': 5, '边界内导航': 5, '验收用例定位': 3, '提交登记': 2, '变更影响': 3 };
  for (const dim of loader.DIMENSIONS) assert.equal(loader.byDimension[dim].length, EXPECTED_COUNTS[dim], `${dim} should be ${EXPECTED_COUNTS[dim]}`);
  // AND toAgentQuestion derives the agent-eval form from the target
  const aq = loader.toAgentQuestion(loader.questions[0]);
  assert.equal(aq.id, 'NV-01');
  assert.equal(aq.answer, '1962');
  assert.ok(aq.answerAlt.includes('AgentOrganization'));
});

test('AT eval-seed: every ground-truth target exists in the intent graph', () => {
  // GIVEN each question's ground-truth target (element/view id)
  // THEN the target id resolves to an element or view in the real graph
  for (const q of seed.questions) {
    const id = q.target.id;
    assert.ok(findElement(id) || findView(id), `target ${id} (${q.id}) must exist in the graph`);
  }
});

test('AT eval-seed: both harnesses consume the SEED (single source, no inline questions)', () => {
  // GIVEN the two navigation harnesses (direct + full-ArchGraph agent)
  const runSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'navigation-eval-run.js'), 'utf8');
  const agentSrc = fs.readFileSync(path.join(ROOT, 'sandbox', 'navigation-agent-eval.js'), 'utf8');
  // THEN both load the SEED and no longer inline a QUESTIONS array
  assert.match(runSrc, /require\('\.\/eval-seed\.js'\)/, 'direct harness must load the SEED');
  assert.match(agentSrc, /navigation-seed\.json/, 'agent eval must load the SEED');
  assert.ok(!/const QUESTIONS = \[/.test(runSrc), 'direct harness must not inline questions');
  assert.ok(!/const QUESTIONS = \[/.test(agentSrc), 'agent eval must not inline questions');
  // AND the agent eval's derived questions match the SEED targets (id + answer)
  const agentEval = require(path.join(ROOT, 'sandbox', 'navigation-agent-eval.js'));
  assert.equal(agentEval.QUESTIONS.length, 28);
  for (const aq of agentEval.QUESTIONS) {
    const sq = seed.questions.find(q => q.id === aq.id);
    assert.ok(sq, `seed must contain ${aq.id}`);
    assert.equal(aq.answer, sq.target.id, `${aq.id} answer should equal seed target.id`);
  }
});
