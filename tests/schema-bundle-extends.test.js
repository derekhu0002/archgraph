'use strict';

// Acceptance tests for issue #4: schema-bundle `extends` inheritance — a Profile
// composes on top of a base bundle (default ArchiMate 3.2) with an
// addElementTypes / addRelationships / overrideMatrix delta instead of forking.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveSchemaBundle, loadSchemaBundleAndOntology } = require('../argo/scripts/schema-bundle.js');

function makeExtendsBundle(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-'));
  fs.writeFileSync(path.join(dir, 'schema-bundle.config.json'), JSON.stringify(config));
  return dir;
}

test('AT extends-01: a Profile inheriting default exposes base ∪ add element types', () => {
  // GIVEN a bundle that only declares extends + one added element type
  const dir = makeExtendsBundle({
    extends: 'default',
    language: 'HarmonyOS Profile',
    addElementTypes: { 'Coding Rule': { class: 'Rule', layer: 'Other', aspect: 'Active Structure' } },
  });
  // WHEN resolved
  const { ontology } = loadSchemaBundleAndOntology(dir, { schemaDir: dir });
  // THEN the universe is the default types plus the added one, and it is valid
  assert.ok(ontology.elementTypes.includes('Coding Rule'), 'added type must be present');
  assert.ok(ontology.elementTypes.includes('Business Actor'), 'base type must be inherited');
  assert.equal(ontology.dialect, 'archimate-class-matrix');
  assert.equal(ontology.language, 'HarmonyOS Profile');
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT extends-02: overrideMatrix overrides one endpoint while the rest stays base', () => {
  const dir = makeExtendsBundle({
    extends: 'default',
    overrideMatrix: { Access: { BusinessActor: ['BusinessObject'] } },
  });
  const bundle = resolveSchemaBundle(dir, { schemaDir: dir });
  // THEN the overridden endpoint wins
  assert.deepEqual(bundle.rules.relationshipTargetMatrix.Access.BusinessActor, ['BusinessObject']);
  // AND unrelated base entries survive
  assert.ok(Object.keys(bundle.rules.relationshipTargetMatrix).length > 1);
  assert.ok(bundle.rules.elementTypeMetadata['Business Actor'], 'base metadata inherited');
});

test('AT extends-03: addElementTypes contributes a class mapping merged onto base metadata', () => {
  const dir = makeExtendsBundle({
    extends: 'default',
    addElementTypes: { 'Coding Rule': { class: 'Rule', layer: 'Other', aspect: 'Active Structure' } },
  });
  const bundle = resolveSchemaBundle(dir, { schemaDir: dir });
  assert.equal(bundle.rules.archimateClassByElementType['Coding Rule'], 'Rule');
  // base class map intact
  assert.ok(bundle.rules.archimateClassByElementType['Business Actor']);
});
