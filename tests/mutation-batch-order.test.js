'use strict';

// Acceptance tests for issue #5: applySystemArchitectureMutation batches must be
// order-independent (a mutation may reference an object created later in the same
// batch); a genuine cycle reports the offending id chain.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyMutations } = require('../argo/scripts/systemarchitecture-mcp-server.js');

function baseDocument() {
  return {
    name: 'batch-order-test',
    description: 'batch-order-test',
    elements: [],
    relationships: [],
    views: [
      { view_id: 'root', view_name: 'SystemArchitecture', included_elements: [], included_relationships: [] },
    ],
  };
}

function viewById(document, viewId) {
  return document.views.find(view => view.view_id === viewId);
}

test('AT batch-order-01: addElement(view_ids=[later view]) before addView succeeds', () => {
  // GIVEN a batch whose addElement joins a view that is only added afterwards
  // WHEN applied
  // THEN it succeeds and both the element and view are wired together
  const document = applyMutations(baseDocument(), [
    { type: 'addElement', element: { id: 'e1', name: 'E1', type: 'Application Component' }, view_ids: ['v-new'] },
    { type: 'addView', view: { view_id: 'v-new', view_name: 'New', included_elements: [], included_relationships: [] } },
  ]).document;

  assert.ok(document.elements.find(element => element.id === 'e1'));
  assert.ok(viewById(document, 'v-new').included_elements.includes('e1'));
});

test('AT batch-order-02: a batch is order-independent (reversed input equals forward)', () => {
  // GIVEN a mutually-referencing batch
  const batch = [
    { type: 'addView', view: { view_id: 'v-new', view_name: 'New', included_elements: [], included_relationships: [] } },
    { type: 'addElement', element: { id: 'e1', name: 'E1', type: 'Application Component' }, view_ids: ['v-new'] },
  ];
  // WHEN applied forward vs reversed
  const forward = applyMutations(baseDocument(), batch).document;
  const reversed = applyMutations(baseDocument(), [...batch].reverse()).document;
  // THEN the resulting documents are identical
  assert.deepEqual(forward, reversed);
});

test('AT batch-order-03: addRelationship resolves same-batch endpoint elements and views', () => {
  // GIVEN a batch adding a relationship before its endpoints and view
  const document = applyMutations(baseDocument(), [
    { type: 'addRelationship', relationship: { id: 'r1', type: 'Flow', source_id: 'e1', target_id: 'e2', name: 'Flow', statement: 'E1 --(Flow)--> E2' }, view_ids: ['v2'] },
    { type: 'addView', view: { view_id: 'v2', view_name: 'V2', included_elements: [], included_relationships: [] } },
    { type: 'addElement', element: { id: 'e1', name: 'E1', type: 'Application Component' }, view_ids: ['v2'] },
    { type: 'addElement', element: { id: 'e2', name: 'E2', type: 'Application Component' }, view_ids: ['v2'] },
  ]).document;

  // THEN the relationship exists and its view holds both endpoints + the edge
  assert.ok(document.relationships.find(relationship => relationship.id === 'r1'));
  const view = viewById(document, 'v2');
  assert.ok(view.included_elements.includes('e1') && view.included_elements.includes('e2'));
  assert.ok(view.included_relationships.includes('r1'));
});

test('AT batch-order-04: a genuine dependency cycle throws with the id chain', () => {
  // GIVEN an element that joins its own sub-view which is parented by it
  assert.throws(
    () => applyMutations(baseDocument(), [
      { type: 'addElement', element: { id: 'g', name: 'G', type: 'Grouping' }, view_ids: ['g-sub'] },
      { type: 'addView', view: { view_id: 'g-sub', view_name: 'GSub', parent_element_id: 'g', included_elements: [], included_relationships: [] } },
    ]),
    /Cyclic mutation dependencies in batch: .*(g|g-sub).*(g|g-sub)/,
  );
});
