'use strict';

// Framework-level acceptance tests for skill-style principle management.
//
// The contract must hold for ANY ArchGraph workspace and ANY modeling language.
// The principle catalog is a BASE capability: the framework provides defaults
// (surfaced by `queryNeo4jGraph {schema:true}` -> `principleIndex`), a workspace
// bundle may override any field, and `"principleIndex": null` disables it.
// The rule never names a concrete element id, element type or attribute.
//
//   resident tier  = red lines already encoded in an always-loaded rule section
//   onDemand tier  = judgment principles: compact index resident, body on demand
//
// The bundle declaration contract is covered by
// tests/schema-bundle-principle-index.test.js.

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
  assert.match(rules, /tiers\.resident/, 'must declare the resident tier');
  assert.match(rules, /tiers\.onDemand/, 'must declare the on-demand tier');
  assert.match(rules, /MUST NOT be moved to on-demand/i, 'resident red lines must not be demoted');
  // AND bodies are loaded only when a trigger matches a deterministic checkpoint
  assert.match(rules, /Load a body only when triggered/, 'must load bodies only when triggered');
  assert.match(rules, /getIntentElementContext/, 'must load the body through getIntentElementContext');
  assert.match(rules, /checkpoint/i, 'must define deterministic checkpoints');
});

test('AT principle-index: the catalog is a base capability, not a per-project opt-in', () => {
  const rules = readRules();
  // GIVEN it must work in every workspace without editing its bundle
  assert.match(rules, /base capability, not an opt-in/i, 'must declare the built-in capability');
  // AND the contract comes back from the schema read with framework defaults
  assert.match(rules, /queryNeo4jGraph/, 'must resolve the schema read first');
  assert.match(rules, /schema:true/, 'must read the schema bundle (schema:true)');
  assert.match(rules, /principleIndex/, 'must use the surfaced principleIndex contract');
  assert.match(rules, /indexElementId/, 'must read the returned indexElementId');
  assert.match(rules, /principlesElementType/, 'must read the returned principlesElementType');
  assert.match(rules, /tiers/, 'must read the returned tiers');
});

test('AT principle-index: a bundle may override the defaults or disable the capability', () => {
  const rules = readRules();
  assert.match(rules, /bundle may override any field/i, 'must allow bundle overrides');
  assert.match(rules, /principleIndex"?\s*:\s*null/, 'must define the explicit null opt-out');
  // AND it must not bake in this workspace's concrete locators
  for (const concrete of ['principle-index-001', 'principles-index-view', 'principleTier', 'triggerKeywords']) {
    assert.ok(!rules.includes(concrete), `the framework rule must not hardcode '${concrete}'`);
  }
});

test('AT principle-index: STEP 0 loads the index and tolerates a not-yet-created catalog', () => {
  const rules = readRules();
  const gate = rules.match(/<WakeupGuideline>([\s\S]*?)<\/WakeupGuideline>/);
  assert.ok(gate, 'the rule must contain a <WakeupGuideline> block');
  // THEN the startup gate reads the declared index element
  assert.match(gate[1], /principles index/i, 'STEP 0 must load the principles index');
  assert.match(gate[1], /indexElementId/, 'STEP 0 must use the returned indexElementId');
  assert.match(gate[1], /never every principle body/i, 'STEP 0 must load the index only');
  // AND a missing catalog is not an error
  assert.match(gate[1], /Zero rows means no catalog yet/i, 'STEP 0 must tolerate an absent catalog');
});

test('AT principle-index: CoreRules makes the catalog load non-negotiable', () => {
  const rules = readRules();
  const core = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(core, 'the rule must contain a <CoreRules> block');
  assert.match(core[1], /principles index/i, 'CoreRules must require loading the principles index');
  assert.match(core[1], /<PrincipleIndexGuideline>/, 'CoreRules must point at the guideline section');
});

test('AT principle-index: the base capability needs no bundle declaration', () => {
  // GIVEN the packaged default bundle (the built-in ArchiMate 3.2 data)
  const config = JSON.parse(fs.readFileSync(DEFAULT_BUNDLE_CONFIG, 'utf8'));
  // THEN it does not declare a catalog: the defaults live in the framework, so
  // adopting the capability never requires editing a bundle
  assert.ok(!Object.prototype.hasOwnProperty.call(config, 'principleIndex'),
    'the default bundle must not need a principleIndex declaration');
});
