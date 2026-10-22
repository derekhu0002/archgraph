'use strict';

// External-view acceptance tests for skill-style principle management
// (<PrincipleIndexGuideline>):
//
//   - L0 = red lines already encoded in an always-resident rule section
//     (they stay resident; the Principle element is the rationale);
//   - L1 = judgment principles loaded on demand: only a compact index summary
//     is resident, the body is fetched from the intent graph when a load
//     trigger matches a checkpoint.
//
// The index must stay cheap (bounded size), complete (no orphan principle),
// and dependency-free (loading it must never pull principle bodies).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RULES = path.join(ROOT, 'argo', 'rules', 'archgraph.instructions.md');
const GRAPH_PATH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');

const INDEX_ID = 'principle-index-001';
const INDEX_VIEW = 'principles-index-view';
const INDEX_PARENT = 'archgraph-workflow-rules';
const INDEX_MAX_CHARS = 3000;

function readRules() {
  return fs.readFileSync(RULES, 'utf8').replace(/^\uFEFF/, '');
}

function readGraph() {
  return JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
}

function attr(element, name) {
  const hit = (element.attributes || []).find(a => a && a.name === name);
  return hit ? hit.value : undefined;
}

function principles(graph) {
  return (graph.elements || []).filter(el => el.type === 'Principle');
}

function indexElement(graph) {
  return (graph.elements || []).find(el => el.id === INDEX_ID);
}

test('AT principle-index: the rule declares the two-tier skill-style principle loading contract', () => {
  // GIVEN the always-loaded workflow rules
  const rules = readRules();
  // THEN a dedicated guideline exists and separates resident L0 red lines from on-demand L1 principles
  assert.match(rules, /<PrincipleIndexGuideline>/, 'must have a PrincipleIndexGuideline section');
  assert.match(rules, /L0 = red lines/, 'must define L0 as resident red lines');
  assert.match(rules, /L1 = judgment principles/, 'must define L1 as on-demand judgment principles');
  assert.match(rules, /MUST NOT be moved to on-demand/i, 'L0 must not be demoted to on-demand');
  // AND bodies are loaded only when a trigger matches
  assert.match(rules, /Load a body only when triggered/, 'must load bodies only when triggered');
  assert.match(rules, /getIntentElementContext/, 'must load the body through getIntentElementContext');
  // AND the checkpoints are deterministic, not self-declared
  assert.match(rules, /checkpoint/i, 'must define deterministic checkpoints');
});

test('AT principle-index: STEP 0 loads the principles index (only the index, not the bodies)', () => {
  const rules = readRules();
  // GIVEN the unconditional startup gate
  const gate = rules.match(/<WakeupGuideline>([\s\S]*?)<\/WakeupGuideline>/);
  assert.ok(gate, 'the rule must contain a <WakeupGuideline> block');
  // THEN the gate loads the principles index in the same startup step
  assert.match(gate[1], /principles index/i, 'STEP 0 must load the principles index');
  assert.match(gate[1], new RegExp(INDEX_ID), 'STEP 0 must name the index element id');
  // AND it explicitly forbids loading every principle body
  assert.match(rules, /Never bulk-load every principle/i, 'must forbid bulk-loading all principles');
});

test('AT principle-index: CoreRules makes the principle index load non-negotiable', () => {
  const rules = readRules();
  const core = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(core, 'the rule must contain a <CoreRules> block');
  // THEN the red-line list references the principle-index contract
  assert.match(core[1], /principles index/i, 'CoreRules must require loading the principles index');
  assert.match(core[1], /<PrincipleIndexGuideline>/, 'CoreRules must point at the guideline section');
});

test('AT principle-index: the graph keeps a compact index element with no dependency edges', () => {
  const graph = readGraph();
  const index = indexElement(graph);
  // GIVEN the principles index element
  assert.ok(index, `${INDEX_ID} must exist in the intent graph`);
  assert.equal(index.type, 'Business Object', 'the index is a document element (Business Object)');
  // THEN it carries every principle id exactly once (complete, no duplicates)
  const ps = principles(graph);
  assert.ok(ps.length > 0, 'the graph must carry Principle elements');
  for (const principle of ps) {
    const occurrences = (index.description || '').split(principle.id).length - 1;
    assert.equal(occurrences, 1, `${INDEX_ID} must list ${principle.id} exactly once`);
  }
  // AND it stays a bounded one-line-per-principle index
  assert.ok((index.description || '').length <= INDEX_MAX_CHARS,
    `${INDEX_ID} must stay cheap (<= ${INDEX_MAX_CHARS} chars)`);
  // AND loading it must not pull principle bodies through edges
  const touching = (graph.relationships || []).filter(r => r.source_id === INDEX_ID || r.target_id === INDEX_ID);
  assert.equal(touching.length, 0, 'the index must have no relationships (loading it must stay O(index))');
});

test('AT principle-index: every Principle is catalogued in the index view (no orphan, no stray member)', () => {
  const graph = readGraph();
  const view = (graph.views || []).find(v => v.view_id === INDEX_VIEW);
  // GIVEN the principles index view
  assert.ok(view, `${INDEX_VIEW} must exist`);
  assert.equal(view.parent_element_id, INDEX_PARENT, `the view must be mounted under ${INDEX_PARENT}`);
  const members = new Set(view.included_elements || []);
  // THEN the index element is a member and every Principle is a member
  assert.ok(members.has(INDEX_ID), 'the index element must belong to the index view');
  for (const principle of principles(graph)) {
    assert.ok(members.has(principle.id), `${principle.id} must be catalogued in ${INDEX_VIEW}`);
  }
  // AND the view contains no non-Principle payload beyond the index itself
  const byId = new Map((graph.elements || []).map(el => [el.id, el]));
  for (const member of members) {
    const el = byId.get(member);
    assert.ok(el, `view member ${member} must resolve to an element`);
    if (member === INDEX_ID) continue;
    assert.equal(el.type, 'Principle', `unexpected non-Principle member ${member} in ${INDEX_VIEW}`);
  }
});

test('AT principle-index: every Principle declares its tier, one-line summary and load trigger', () => {
  const graph = readGraph();
  for (const principle of principles(graph)) {
    // GIVEN each Principle element
    const tier = attr(principle, 'principleTier');
    const summary = attr(principle, 'summary');
    const triggers = attr(principle, 'triggerKeywords');
    // THEN the tier is one of the two managed layers
    assert.ok(tier === 'L0' || tier === 'L1', `${principle.id} must declare principleTier L0|L1`);
    // AND it carries a compact summary that the index can quote
    assert.ok(typeof summary === 'string' && summary.trim() !== '', `${principle.id} must declare a summary`);
    assert.ok(summary.length <= 160, `${principle.id} summary must stay a one-liner`);
    // AND at least one trigger decides when its body is loaded
    assert.ok(typeof triggers === 'string' && triggers.trim() !== '', `${principle.id} must declare triggerKeywords`);
  }
});

test('AT principle-index: L0 principles are genuinely encoded in a resident rule section', () => {
  const rules = readRules();
  const graph = readGraph();
  // GIVEN the L0 principles that claim to be resident red lines
  const governing = {
    'archgraph-content-storage-policy-001': '<ContentStoragePolicy>',
    'overseer-memory-tiers-001': '<MemoryTierConventions>',
  };
  for (const [id, section] of Object.entries(governing)) {
    const principle = (graph.elements || []).find(el => el.id === id);
    assert.ok(principle, `${id} must exist`);
    assert.equal(attr(principle, 'principleTier'), 'L0', `${id} must be an L0 red line`);
    // THEN the governing rule section really is always resident
    assert.match(rules, new RegExp(section.replace(/[<>]/g, '\\$&')),
      `${id} declares ${section} but that rule section is missing`);
  }
});
