'use strict';

// Acceptance tests for the workspace schema bundle
// `<repo>/.argo/schema` = "Acme + UML 2 State Machine".
//
// GIVEN-WHEN-THEN, external view: the workspace bundle must extend the built-in
// default bundle (the "Acme"/ArchiMate 3.2 base), expose the UML 2 state-machine
// profile, keep the whole base universe valid, and let a UML Transition connect
// two States — so an existing ArchiMate graph stays valid while the coding
// business process can be modeled as a UML 2 state machine.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  resolveSchemaBundle,
  loadSchemaBundleAndOntology,
} = require('../argo/scripts/schema-bundle.js');
const { validateArchiMateEndpointMatrix } = require('../argo/scripts/graph-semantics.js');

const ROOT = path.resolve(__dirname, '..');
const UML2_ELEMENT_TYPES = [
  'State',
  'Initial State',
  'Final State',
  'Composite State',
  'Choice',
  'Entry Point',
  'Exit Point',
];
const UML2_RELATIONSHIP_TYPES = ['Transition'];

test('AT-uml2-sm-01: the workspace bundle extends the Acme base and is the active schema', () => {
  // GIVEN the repository ships its own schema bundle under .argo/schema
  // WHEN the schema bundle is resolved for this workspace
  const bundle = resolveSchemaBundle(ROOT);
  // THEN the workspace bundle wins, and it extends the language-neutral default
  assert.equal(bundle.kind, 'workspace');
  assert.equal(bundle.config.extends, 'default');
  assert.equal(bundle.config.language, 'Acme + UML 2 State Machine');
});

test('AT-uml2-sm-02: the element/relationship universe is base union UML 2 state machine', () => {
  // WHEN the ontology is built
  const { ontology } = loadSchemaBundleAndOntology(ROOT);
  // THEN every UML 2 state-machine type is present...
  for (const type of UML2_ELEMENT_TYPES) {
    assert.ok(ontology.elementTypes.includes(type), `missing UML element type ${type}`);
  }
  for (const type of UML2_RELATIONSHIP_TYPES) {
    assert.ok(ontology.relationshipTypes.includes(type), `missing UML relationship type ${type}`);
  }
  // AND the inherited base universe is intact (single source of truth)
  for (const type of ['Business Actor', 'Assessment', 'Business Process', 'Grouping']) {
    assert.ok(ontology.elementTypes.includes(type), `base element type ${type} must be inherited`);
  }
  for (const type of ['Triggering', 'Association', 'Composition']) {
    assert.ok(ontology.relationshipTypes.includes(type), `base relationship ${type} must be inherited`);
  }
  // AND the actor contract and bundle validation hold
  assert.equal(ontology.actorElementType, 'Business Actor');
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT-uml2-sm-03: added UML types are structurally valid in the inherited schema enum', () => {
  // WHEN the resolved bundle (which inherits the base schema document) is inspected
  const bundle = resolveSchemaBundle(ROOT);
  const elementEnum = bundle.schemaDocument.$defs.archimateElementType.enum;
  const relationshipEnum = bundle.schemaDocument.$defs.archimateRelationshipType.enum;
  // THEN the added types are part of the JSON-Schema type enum too (whole-graph
  // validation accepts elements/relationships of the added types)
  for (const type of UML2_ELEMENT_TYPES) {
    assert.ok(elementEnum.includes(type), `schema enum must include ${type}`);
  }
  for (const type of UML2_RELATIONSHIP_TYPES) {
    assert.ok(relationshipEnum.includes(type), `schema enum must include ${type}`);
  }
  assert.ok(elementEnum.includes('Business Actor'), 'base types must remain');
});

test('AT-uml2-sm-04: a UML Transition between two States is an allowed endpoint', () => {
  // GIVEN the workspace ontology
  const { ontology } = loadSchemaBundleAndOntology(ROOT);
  const source = { id: 's1', type: 'State', name: 'State 1' };
  const target = { id: 's2', type: 'State', name: 'State 2' };
  const transition = { id: 't1', type: 'Transition', source_id: 's1', target_id: 's2' };
  const errors = [];
  // WHEN the endpoint matrix is validated
  validateArchiMateEndpointMatrix(
    { elements: [source, target], relationships: [transition] },
    errors,
    { ontology },
  );
  // THEN the UML transition between two States is accepted
  assert.deepEqual(errors, []);
});
