'use strict';

// Acceptance tests for issue #3: per-element-type attribute contracts
// (attributesByElementType) — required attributes, controlled vocabulary
// (enumByAttr) and per-attribute uniqueness — enforced natively by the validator
// and by the write path, via the shared graph-semantics rule.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateAttributeContracts } = require('../argo/scripts/graph-semantics.js');
const { loadSchemaBundleAndOntology } = require('../argo/scripts/schema-bundle.js');

const ONTOLOGY = {
  attributesByElementType: {
    Rule: {
      required: ['ruleId', 'normativity'],
      unique: ['ruleId'],
      enumByAttr: { normativity: ['MUST', 'SHOULD', 'MAY', 'MUST_NOT'] },
    },
  },
};

function rule(id, attrs) {
  return { id, name: id, type: 'Rule', attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })) };
}
function errorsFor(elements) {
  const errors = [];
  validateAttributeContracts({ elements }, errors, ONTOLOGY);
  return errors;
}

test('AT attribute-contracts-01: a missing required attribute fails and names the element + attribute', () => {
  const errors = errorsFor([rule('r1', { ruleId: 'R-1' })]); // no normativity
  assert.equal(errors.length, 1);
  assert.match(errors[0], /r1/);
  assert.match(errors[0], /normativity/);
});

test('AT attribute-contracts-02: an out-of-vocabulary value fails and lists the allowed values', () => {
  const errors = errorsFor([rule('r1', { ruleId: 'R-1', normativity: 'SHOULD_MAYBE' })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /SHOULD_MAYBE/);
  assert.match(errors[0], /MUST/);
});

test('AT attribute-contracts-03: a duplicated unique value fails', () => {
  const errors = errorsFor([
    rule('r1', { ruleId: 'R-1', normativity: 'MUST' }),
    rule('r2', { ruleId: 'R-1', normativity: 'MAY' }),
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ruleId/);
  assert.match(errors[0], /R-1/);
});

test('AT attribute-contracts-04: a fully compliant graph has no errors; other types are unconstrained', () => {
  const errors = [];
  validateAttributeContracts({
    elements: [
      rule('r1', { ruleId: 'R-1', normativity: 'MUST' }),
      rule('r2', { ruleId: 'R-2', normativity: 'MAY' }),
      { id: 'c1', name: 'C1', type: 'Application Component' }, // no contract
    ],
  }, errors, ONTOLOGY);
  assert.deepEqual(errors, []);
});

test('AT attribute-contracts-05: a bundle declaring a contract for an unknown element type fails bundle validation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-'));
  fs.writeFileSync(path.join(dir, 'SystemArchitecture.schema.json'), '{}');
  fs.writeFileSync(path.join(dir, 'schema-bundle.config.json'), JSON.stringify({
    language: 'Contracts Test',
    elementTypes: ['Rule'],
    relationshipTypes: ['Association'],
    attributesByElementType: { Rule: { required: ['ruleId'] }, Ghost: { required: ['x'] } },
  }));
  const { ontology } = loadSchemaBundleAndOntology(dir, { schemaDir: dir });
  assert.ok(ontology.attributesByElementType && ontology.attributesByElementType.Rule, 'contract must be exposed on the ontology');
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(ontology.bundleValidation.errors.some((error) => /Ghost/.test(error)));
});
