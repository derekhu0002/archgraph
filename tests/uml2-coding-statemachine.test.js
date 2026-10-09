'use strict';

// Acceptance tests for the rebuilt UML 2 coding-agent state machine.
//
// GIVEN-WHEN-THEN, external view: the graph must express the corrected
// condition-based state machine (Idle / Running with observability substates /
// AwaitingUser / Stopped), attach each performance metric to the ACTION whose
// result it measures, and model background tasks as an orthogonal region that
// can wake the main region.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
const elementById = new Map((graph.elements || []).map(e => [e.id, e]));
const viewById = new Map((graph.views || []).map(v => [v.view_id, v]));
const relationships = graph.relationships || [];

test('AT-uml2-sm-model-01: the top-level state machine has the 4 corrected states', () => {
  const view = viewById.get('uml2-coding-statemachine-view-002');
  assert.ok(view, 'top-level state machine view exists');
  assert.equal(elementById.get('aos-idle').type, 'State');
  assert.equal(elementById.get('aos-running').type, 'Composite State');
  assert.equal(elementById.get('aos-awaiting-user').type, 'State');
  assert.equal(elementById.get('aos-stopped').type, 'State');
  // states are conditions, not process steps: no activity-named states remain
  for (const id of ['aos-idle', 'aos-running', 'aos-awaiting-user', 'aos-stopped']) {
    assert.ok(view.included_elements.includes(id), `${id} in the top view`);
  }
});

test('AT-uml2-sm-model-02: Running is a composite state with observability substates', () => {
  const view = viewById.get('uml2-coding-running-view-002');
  assert.ok(view, 'running sub-view exists');
  for (const id of ['aos-reasoning', 'aos-retrieving', 'aos-acting', 'aos-verifying', 'aos-awaiting-result', 'aos-finalizing']) {
    assert.equal(elementById.get(id).type, 'State', `${id} is a State`);
    assert.equal(elementById.get(id).parent, 'aos-running', `${id} is nested under Running`);
  }
});

test('AT-uml2-sm-model-03: each metric is associated to the action whose result it measures', () => {
  const expected = {
    'aos-as-plan': 'aos-reasoning',
    'aos-as-retrieve': 'aos-retrieving',
    'aos-as-tool': 'aos-acting',
    'aos-as-write': 'aos-acting',
    'aos-as-verify': 'aos-verifying',
    'aos-as-wait': 'aos-awaiting-result',
    'aos-as-commit': 'aos-finalizing',
    'aos-as-memory': 'aos-finalizing',
    'aos-as-success': 'aos-machine',
    'aos-as-e2e': 'aos-machine',
    'aos-as-idle': 'aos-idle',
    'aos-as-hitl': 'aos-awaiting-user',
  };
  for (const [metric, state] of Object.entries(expected)) {
    const link = relationships.find(r => r.type === 'Association' && r.source_id === state && r.target_id === metric);
    assert.ok(link, `${state} --measures--> ${metric}`);
    assert.equal(elementById.get(metric).type, 'Assessment', `${metric} is an Assessment`);
  }
});

test('AT-uml2-sm-model-04: background tasks are an orthogonal region that can wake the main region', () => {
  const view = viewById.get('uml2-coding-background-view-002');
  assert.ok(view, 'background region view exists');
  assert.equal(elementById.get('aos-bg-machine').type, 'Composite State');
  const wake = relationships.find(r => r.id === 'aos-t-bg-done-running');
  assert.ok(wake, 'BG.Done -> Running wake transition exists');
  assert.equal(wake.type, 'Transition');
  assert.equal(wake.target_id, 'aos-running');
});

test('AT-uml2-sm-model-05: the previous (conflated activity-as-state) model is gone', () => {
  for (const id of ['sm-locate', 'sm-implement', 'sm-write-gate', 'sm-gate-blocked', 'as-locate', 'as-write-gate']) {
    assert.equal(elementById.get(id), undefined, `${id} must be removed`);
  }
});

test('AT-uml2-sm-model-06: industry whole-task benchmarks are anchored on the state-machine subject', () => {
  const view = viewById.get('uml2-coding-benchmark-view-002');
  assert.ok(view, 'industry benchmark view exists');
  const benchmarks = [
    'aos-as-swebench',
    'aos-as-sweverified',
    'aos-as-terminalbench',
    'aos-as-codegen',
    'aos-as-livecodebench',
    'aos-as-gaia',
    'aos-as-taubench',
    'aos-as-agentbench',
  ];
  for (const id of benchmarks) {
    assert.equal(elementById.get(id).type, 'Assessment', `${id} is an Assessment`);
    const link = relationships.find(r => r.type === 'Association' && r.source_id === 'aos-machine' && r.target_id === id);
    assert.ok(link, `state-machine subject --measures--> ${id}`);
  }
});

test('AT-uml2-sm-model-07: local (leading) metrics influence the overall (outcome) metrics', () => {
  // GIVEN the two metric-decomposition views exist
  for (const viewId of ['uml2-metric-decomp-code-view-002', 'uml2-metric-decomp-agent-view-002']) {
    assert.ok(viewById.get(viewId), `${viewId} exists`);
  }
  // THEN the relationship is modeled as Influence (Assessment -> Assessment)
  const influences = relationships.filter(r => r.type === 'Influence'
    && String(r.source_id).startsWith('aos-as-')
    && String(r.target_id).startsWith('aos-as-'));
  assert.ok(influences.length >= 30, `expected many local->overall influence edges, got ${influences.length}`);
  // AND concrete representative edges exist
  const has = (s, t) => influences.some(r => r.source_id === s && r.target_id === t);
  assert.ok(has('aos-as-plan', 'aos-as-swebench'), 'plan -> SWE-bench');
  assert.ok(has('aos-as-retrieve', 'aos-as-swebench'), 'retrieve -> SWE-bench');
  assert.ok(has('aos-as-tool', 'aos-as-terminalbench'), 'tool -> Terminal-Bench');
  assert.ok(has('aos-as-verify', 'aos-as-success'), 'verify -> task success');
  assert.ok(has('aos-as-wait', 'aos-as-e2e'), 'wait -> e2e latency/cost');
});

test('AT-uml2-sm-model-08: influence polarity (+/-) and local-local tradeoffs are modeled', () => {
  // GIVEN the decision-support tradeoff view
  assert.ok(viewById.get('uml2-metric-tradeoff-view-002'), 'tradeoff view exists');
  // AND every local->overall influence carries a strength attribute (polarity)
  const influences = relationships.filter(r => r.type === 'Influence');
  const withStrength = influences.filter(r => Array.isArray(r.attributes) && r.attributes.some(a => /^strength:[+-]$/.test(a.name)));
  assert.equal(withStrength.length, influences.length, 'every Influence must carry strength:+/strength:-');
  // AND both polarities exist explicitly
  const pos = influences.filter(r => r.attributes.some(a => a.name === 'strength:+'));
  const neg = influences.filter(r => r.attributes.some(a => a.name === 'strength:-'));
  assert.ok(pos.length >= 33, `expected >=33 positive influences, got ${pos.length}`);
  assert.ok(neg.length >= 5, `expected >=5 negative (tradeoff) influences, got ${neg.length}`);
  // AND local-local tradeoff edges exist in both directions
  const byId = new Map(relationships.map(r => [r.id, r]));
  assert.equal(byId.get('aos-i-retrieve-wait').name, 'influences (-)', 'retrieval raises wait (negative)');
  assert.equal(byId.get('aos-i-tool-wait').name, 'influences (-)', 'tools raise wait (negative)');
  assert.equal(byId.get('aos-i-memory-retrieve').name, 'influences (+)', 'memory improves retrieval (positive)');
  assert.equal(byId.get('aos-i-plan-tool').name, 'influences (+)', 'plan improves tool success (positive)');
});

