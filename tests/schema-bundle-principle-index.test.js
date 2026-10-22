'use strict';

// Framework-level acceptance tests for the principle catalog contract.
//
// The catalog is a BASE capability: the framework supplies ontology-neutral
// defaults (no principle element type, neutral tier tokens), so a workspace gets
// it without declaring anything. A bundle may override any field (a profile may
// rename locators/tokens) or disable it with `"principleIndex": null`. Malformed
// declarations fail the bundle closed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadSchemaBundleAndOntology,
  resolvePrincipleIndex,
  DEFAULT_PRINCIPLE_INDEX,
} = require('../argo/scripts/schema-bundle.js');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SCHEMA = path.join(ROOT, 'argo', 'schema', 'SystemArchitecture.schema.json');

function makeWorkspace(config) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'principle-index-bundle-'));
  const schemaDir = path.join(workspaceRoot, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.copyFileSync(DEFAULT_SCHEMA, path.join(schemaDir, 'SystemArchitecture.schema.json'));
  const base = { language: 'Test Ontology', actorElementType: 'Business Actor' };
  fs.writeFileSync(
    path.join(schemaDir, 'schema-bundle.config.json'),
    JSON.stringify({ ...base, ...config }, null, 2),
  );
  return workspaceRoot;
}

test('AT bundle-principle-index: the catalog is on by default (no declaration required)', () => {
  // GIVEN a workspace bundle that declares nothing
  const workspaceRoot = makeWorkspace({});
  // WHEN the bundle is resolved
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  // THEN the framework defaults apply and the bundle is valid
  assert.deepEqual(ontology.principleIndex, DEFAULT_PRINCIPLE_INDEX);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT bundle-principle-index: an explicit null disables the capability', () => {
  const workspaceRoot = makeWorkspace({ principleIndex: null });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  assert.equal(ontology.principleIndex, null);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT bundle-principle-index: a partial override keeps the framework defaults for the rest', () => {
  // GIVEN a bundle that only renames the index element id
  const workspaceRoot = makeWorkspace({ principleIndex: { indexElementId: 'my-principles' } });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  // THEN the override applies and every other locator falls back to the default
  assert.equal(ontology.principleIndex.indexElementId, 'my-principles');
  assert.deepEqual(ontology.principleIndex.tiers, DEFAULT_PRINCIPLE_INDEX.tiers);
  assert.deepEqual(ontology.principleIndex.attributes, DEFAULT_PRINCIPLE_INDEX.attributes);
  assert.equal(ontology.principleIndex.principlesElementType, null);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT bundle-principle-index: a full override is resolved as data (no core hardcoding)', () => {
  const declaration = {
    indexElementId: 'p-index',
    principlesElementType: 'Principle',
    viewId: 'p-view',
    attributes: { tier: 't', summary: 's', trigger: 'k' },
    tiers: { resident: 'R', onDemand: 'D' },
  };
  const workspaceRoot = makeWorkspace({ principleIndex: declaration });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  assert.deepEqual(ontology.principleIndex, declaration);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT bundle-principle-index: an inheriting bundle keeps its override through extends', () => {
  // GIVEN a workspace bundle that extends the built-in default (the common shape)
  const workspaceRoot = makeWorkspace({
    extends: 'default',
    principleIndex: { indexElementId: 'profile-principles', tiers: { resident: 'base', onDemand: 'lean' } },
  });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  // THEN the child override survives and the untouched fields stay default
  assert.equal(ontology.principleIndex.indexElementId, 'profile-principles');
  assert.deepEqual(ontology.principleIndex.tiers, { resident: 'base', onDemand: 'lean' });
  assert.deepEqual(ontology.principleIndex.attributes, DEFAULT_PRINCIPLE_INDEX.attributes);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT bundle-principle-index: an unknown principles element type fails the bundle (fail-closed)', () => {
  const workspaceRoot = makeWorkspace({ principleIndex: { principlesElementType: 'Not A Real Type' } });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(
    ontology.bundleValidation.errors.some(error => error.includes('principlesElementType')),
    'the error must name the offending field',
  );
});

test('AT bundle-principle-index: a malformed override fails the bundle (fail-closed)', () => {
  const workspaceRoot = makeWorkspace({ principleIndex: { attributes: { tier: 42 } } });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(ontology.bundleValidation.errors.some(error => error.includes('attributes.tier')));
});

test('AT bundle-principle-index: identical tier tokens fail the bundle (tiers must be distinguishable)', () => {
  const workspaceRoot = makeWorkspace({ principleIndex: { tiers: { resident: 'same', onDemand: 'same' } } });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(ontology.bundleValidation.errors.some(error => error.includes('must be distinct')));
});

test('AT bundle-principle-index: the resolver is a pure, defensive read', () => {
  // GIVEN absent / disabled declarations
  assert.deepEqual(resolvePrincipleIndex(undefined), DEFAULT_PRINCIPLE_INDEX);
  assert.deepEqual(resolvePrincipleIndex({}), DEFAULT_PRINCIPLE_INDEX);
  assert.equal(resolvePrincipleIndex({ principleIndex: null }), null);
  // AND a partial declaration merges with the defaults without mutating them
  const resolved = resolvePrincipleIndex({ principleIndex: { indexElementId: 'x' } });
  assert.equal(resolved.indexElementId, 'x');
  assert.equal(DEFAULT_PRINCIPLE_INDEX.indexElementId, 'principle-index-001');
  assert.notEqual(resolved.attributes, DEFAULT_PRINCIPLE_INDEX.attributes);
});
