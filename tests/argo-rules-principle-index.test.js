'use strict';

// Framework-level acceptance tests for skill-style principle management.
//
// The contract must hold for ANY ArchGraph workspace and ANY modeling language:
// the core rule never names a concrete element id, element type or attribute —
// it reads the locators from the workspace schema bundle (`principleIndex`).
// A workspace without the declaration keeps the unchanged default behavior.
//
//   resident tier  = red lines already encoded in an always-loaded rule section
//   onDemand tier  = judgment principles: compact index resident, body on demand
//
// The project-side catalog itself is covered by tests/principles-index-catalog.test.js;
// the bundle declaration contract by tests/schema-bundle-principle-index.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RULES = path.join(ROOT, 'argo', 'rules', 'archgraph.instructions.md');
const DEFAULT_BUNDLE_CONFIG = path.join(ROOT, 'argo', 'schema', 'schema-bundle.config.json');

function readRules() {
  return fs.readFileSync(RULES, 'utf8').replace(/^\uFEFF/, '');
}

test('AT principle-index: the rule declares the skill-style principle loading contract', () => {
  const rules = readRules();
  // GIVEN the always-loaded workflow rules
  // THEN a dedicated guideline exists and forbids bulk-loading
  assert.match(rules, /<PrincipleIndexGuideline>/, 'must have a PrincipleIndexGuideline section');
  assert.match(rules, /Never bulk-load every principle/i, 'must forbid bulk-loading all principles');
  // AND it describes the two managed tiers generically
  assert.match(rules, /resident tier|tiers\.resident/, 'must declare the resident tier');
  assert.match(rules, /onDemand|on-demand/, 'must declare the on-demand tier');
  assert.match(rules, /MUST NOT be moved to on-demand/i, 'resident red lines must not be demoted');
  // AND bodies are loaded only when a trigger matches a deterministic checkpoint
  assert.match(rules, /Load a body only when triggered/, 'must load bodies only when triggered');
  assert.match(rules, /getIntentElementContext/, 'must load the body through getIntentElementContext');
  assert.match(rules, /checkpoint/i, 'must define deterministic checkpoints');
});

test('AT principle-index: the rule resolves the catalog from the schema bundle, not a hardcoded name', () => {
  const rules = readRules();
  // GIVEN the framework must stay project- and language-agnostic
  // THEN the rule points at the bundle declaration and its generic locators
  assert.match(rules, /queryNeo4jGraph/, 'must resolve the schema bundle first');
  assert.match(rules, /schema:true/, 'must read the schema bundle (schema:true) before loading a catalog');
  assert.match(rules, /principleIndex/, 'must reference the bundle principleIndex declaration');
  assert.match(rules, /indexElementId/, 'must read the declared indexElementId');
  assert.match(rules, /principlesElementType/, 'must read the declared principlesElementType');
  assert.match(rules, /tiers/, 'must read the declared tiers');
  // AND it must not bake in this workspace's concrete locators
  for (const concrete of ['principle-index-001', 'principles-index-view', 'principleTier', 'triggerKeywords']) {
    assert.ok(!rules.includes(concrete), `the framework rule must not hardcode '${concrete}'`);
  }
});

test('AT principle-index: the catalog is opt-in and skipped when not declared', () => {
  const rules = readRules();
  // GIVEN a workspace whose bundle declares no catalog
  // THEN the rule explicitly skips instead of hunting for a principles view
  assert.match(rules, /If it is null|If `principleIndex` is null/, 'must define behavior when the declaration is null');
  assert.match(rules, /skip/i, 'must skip when not declared');
  assert.match(rules, /do not hunt for a principles view/i, 'must not hunt for an undeclared catalog');
  assert.match(rules, /opt-in/i, 'must state that the catalog is opt-in');
});

test('AT principle-index: STEP 0 loads the declared index (only the index, not the bodies)', () => {
  const rules = readRules();
  const gate = rules.match(/<WakeupGuideline>([\s\S]*?)<\/WakeupGuideline>/);
  assert.ok(gate, 'the rule must contain a <WakeupGuideline> block');
  // THEN the startup gate is conditional on the bundle declaration
  assert.match(gate[1], /only if the workspace schema bundle declares one/i, 'STEP 0 must be conditional');
  assert.match(gate[1], /principleIndex/, 'STEP 0 must reference the bundle declaration');
  assert.match(gate[1], /indexElementId/, 'STEP 0 must use the declared indexElementId');
  assert.match(gate[1], /never every principle body/i, 'STEP 0 must load the index only');
});

test('AT principle-index: CoreRules makes the catalog load non-negotiable when declared', () => {
  const rules = readRules();
  const core = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(core, 'the rule must contain a <CoreRules> block');
  assert.match(core[1], /principle catalog/i, 'CoreRules must require loading the declared catalog');
  assert.match(core[1], /<PrincipleIndexGuideline>/, 'CoreRules must point at the guideline section');
});

test('AT principle-index: the default bundle keeps the unchanged behavior (no catalog declared)', () => {
  // GIVEN the packaged default bundle (the built-in ArchiMate 3.2 data)
  const config = JSON.parse(fs.readFileSync(DEFAULT_BUNDLE_CONFIG, 'utf8'));
  // THEN it declares no principle catalog: default behavior stays byte-identical
  assert.ok(!Object.prototype.hasOwnProperty.call(config, 'principleIndex'),
    'the default bundle must not opt into a principle catalog');
});
