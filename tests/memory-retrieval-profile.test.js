'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ab = require('../scripts/memory-retrieval-ab.js');

const SCENARIOS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
const SCALES = ['small', 'large'];

// External-view acceptance tests for the scenario-based capability profile:
// every task carries a scenario (S1..S8) and a repo scale (small/large), and the
// harness aggregates the SAME metric set per scenario × arm — a profile, not one
// global number.

test('AT-memory-retrieval-profile-01: every task is tagged with a valid scenario and scale', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'eval-seeds', 'agent-cost-seed.json'), 'utf8'));
  for (const q of seed.questions) {
    assert.ok(SCENARIOS.includes(q.scenario), `${q.id} scenario must be one of ${SCENARIOS.join(',')}`);
    assert.ok(SCALES.includes(q.scale), `${q.id} scale must be one of ${SCALES.join(',')}`);
  }
});

test('AT-memory-retrieval-profile-02: the harness aggregates a metric profile per scenario × arm', () => {
  const rows = [
    { scenario: 'S4', scale: 'small', arm: 'off', success: true, evidenceRecall: 1, tokens: 100, wallMs: 1000, modelMs: 800, mcpToolMs: 0, repoToolMs: 200, toolErrors: 0 },
    { scenario: 'S4', scale: 'small', arm: 'on', success: false, evidenceRecall: 0.5, tokens: 300, wallMs: 2000, modelMs: 1200, mcpToolMs: 600, repoToolMs: 200, toolErrors: 1 },
    { scenario: 'S1', scale: 'small', arm: 'on', success: true, evidenceRecall: 1, tokens: 50, wallMs: 300, modelMs: 250, mcpToolMs: 40, repoToolMs: 0, toolErrors: 0 },
  ];
  const prof = ab.groupByScenario(rows);
  assert.ok(prof.S4 && prof.S1);
  assert.equal(prof.S4.tasks, 2);
  assert.equal(prof.S4.byArm.off.tokens, 100);
  assert.equal(prof.S4.byArm.on.tokens, 300);
  assert.equal(prof.S4.byArm.on.toolErrors, 1, 'the on-arm semantic error is surfaced in the profile');
  assert.equal(prof.S4.byArm.on.modelMs, 1200);
  assert.equal(prof.S4.byArm.on.mcpToolMs, 600, 'MCP tool time is separated from model time');
  assert.equal(prof.S1.byArm.on.mcpToolMs, 40);
});

test('AT-memory-retrieval-profile-03: the two comparison designs are documented (E1 mechanism, E2 regime)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'memory-retrieval-ab.js'), 'utf8');
  // the harness is the E1 (same-repo, MCP off/on) mechanism rig; the E2 regime
  // comparison (A-repo vs B-repo) is a distinct design recorded in the KG.
  assert.match(src, /single variable = the memory backend/i, 'harness must state its single-variable design');
});

test('AT-framework-optimization-cross-scenario-01: the no-cross-scenario-regression principle is recorded', () => {
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
  const el = (graph.elements || []).find(e => e.id === 'framework-optimization-cross-scenario-001');
  assert.ok(el, 'the cross-scenario principle element must exist');
  assert.equal(el.type, 'Principle');
  const d = el.description || '';
  for (const k of ['场景', '规模', '劣化', '召回']) assert.ok(d.includes(k), `principle must mention ${k}`);
});

test('AT-memory-retrieval-profile-04: the regime/interaction boundary (why Graph gain is hard to isolate) is recorded', () => {
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
  const els = graph.elements || [];
  const boundary = els.find(e => e.id === 'graph-gain-regime-boundary-001');
  assert.ok(boundary, 'the regime/interaction boundary element must exist');
  const d = boundary.description || '';
  for (const k of ['交互协议', '知识库质量', '纵向', '重建', '捕获']) {
    assert.ok(d.includes(k), `boundary note must mention ${k}`);
  }
  // the refined claim is: produce a better-retrievable KB that does not degrade at scale
  assert.ok(d.includes('更好检索') || d.includes('不退化'), 'boundary note must reframe the claim');
  const fw = els.find(e => e.id === 'memory-retrieval-eval-framework-001');
  assert.ok(fw, 'the scenario×scale×metric profile framework element must exist');
});
