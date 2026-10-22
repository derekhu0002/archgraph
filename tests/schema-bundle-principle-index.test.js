'use strict';

// Framework-level acceptance tests for the OPT-IN principle catalog declaration.
//
// `principleIndex` is bundle data, never a core assumption: a workspace schema
// bundle declares where its principles live (index element id, principle element
// type, optional view, attribute names, tier tokens). The core only knows the
// generic contract and validates it fail-closed. A bundle without the
// declaration yields `principleIndex === null` (unchanged default behavior).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadSchemaBundleAndOntology, resolvePrincipleIndex } = require('../argo/scripts/schema-bundle.js');

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

const VALID = {
  indexElementId: 'principle-index-001',
  principlesElementType: 'Principle',
  viewId: 'principles-index-view',
  attributes: { tier: 'principleTier', summary: 'summary', trigger: 'triggerKeywords' },
  tiers: { resident: 'L0', onDemand: 'L1' },
};

test('AT bundle-principle-index: absent declaration resolves to null and keeps the bundle valid', () => {
  // GIVEN a workspace bundle that does not declare a principle catalog
  const workspaceRoot = makeWorkspace({});
  // WHEN the bundle is resolved
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  // THEN the core sees no catalog and the bundle still validates
  assert.equal(ontology.principleIndex, null);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT bundle-principle-index: a declared catalog is resolved as data (no core hardcoding)', () => {
  // GIVEN a bundle declaring its own locators and tier tokens
  const workspaceRoot = makeWorkspace({ principleIndex: VALID });
  // WHEN resolved
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  // THEN the declaration is surfaced verbatim for the workflow to follow
  assert.deepEqual(ontology.principleIndex, VALID);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT bundle-principle-index: an inheriting bundle keeps its declaration through extends', () => {
  // GIVEN a workspace bundle that extends the built-in default (the common shape)
  const workspaceRoot = makeWorkspace({ extends: 'default', principleIndex: VALID });
  // WHEN the extends chain is merged
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  // THEN the child declaration survives the merge
  assert.deepEqual(ontology.principleIndex, VALID);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT bundle-principle-index: an unknown principles element type fails the bundle (fail-closed)', () => {
  const workspaceRoot = makeWorkspace({
    principleIndex: { ...VALID, principlesElementType: 'Not A Real Type' },
  });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(
    ontology.bundleValidation.errors.some(error => error.includes('principlesElementType')),
    'the error must name the offending field',
  );
});

test('AT bundle-principle-index: a partial declaration fails the bundle (fail-closed)', () => {
  const workspaceRoot = makeWorkspace({
    principleIndex: {
      ...VALID,
      attributes: { tier: 'principleTier', summary: 'summary' },
    },
  });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(ontology.bundleValidation.errors.some(error => error.includes('attributes.trigger')));
});

test('AT bundle-principle-index: identical tier tokens fail the bundle (tiers must be distinguishable)', () => {
  const workspaceRoot = makeWorkspace({
    principleIndex: { ...VALID, tiers: { resident: 'L0', onDemand: 'L0' } },
  });
  const { ontology } = loadSchemaBundleAndOntology(workspaceRoot);
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(ontology.bundleValidation.errors.some(error => error.includes('must be distinct')));
});

test('AT bundle-principle-index: the resolver is a pure, defensive read of the config', () => {
  // GIVEN malformed / absent declarations
  assert.equal(resolvePrincipleIndex(undefined), null);
  assert.equal(resolvePrincipleIndex({}), null);
  assert.equal(resolvePrincipleIndex({ principleIndex: null }), null);
  assert.equal(resolvePrincipleIndex({ principleIndex: [] }), null);
  // AND a declaration without an explicit principlesElementType defaults to null (no principle type assumed)
  const resolved = resolvePrincipleIndex({ principleIndex: { indexElementId: 'x' } });
  assert.equal(resolved.principlesElementType, null);
  assert.equal(resolved.attributes, null);
  assert.equal(resolved.tiers, null);
});
