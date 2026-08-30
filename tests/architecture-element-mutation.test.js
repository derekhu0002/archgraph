'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyMutations } = require('../argo/scripts/systemarchitecture-mcp-server.js');

function baseDocument() {
  return {
    name: 'element-mutation-test',
    description: 'element-mutation-test',
    elements: [
      { id: 'parent', name: 'Parent', type: 'Grouping' },
      { id: 'a', name: 'A', type: 'Application Component' },
      { id: 'b', name: 'B', type: 'Application Component' },
      { id: 'c', name: 'C', type: 'Application Component' },
    ],
    relationships: [
      { id: 'r1', statement: 'A --(Flow)--> B', name: 'Flow', type: 'Flow', source_id: 'a', target_id: 'b', source_name: 'A', target_name: 'B' },
    ],
    views: [
      { view_id: 'top', view_name: 'SystemArchitecture', included_elements: ['parent', 'a', 'b'], included_relationships: ['r1'] },
      { view_id: 'sub', view_name: 'Sub', parent_element_id: 'parent', parent_element_name: 'Parent', included_elements: ['a'], included_relationships: [] },
    ],
  };
}

function elementById(document, id) {
  return document.elements.find(element => element.id === id);
}

function viewById(document, viewId) {
  return document.views.find(view => view.view_id === viewId);
}

test('addElement: back-fills view.parent_element_id for declared subdiagram_views', () => {
  // GIVEN an element declared with subdiagram_views
  // WHEN addElement creates it
  // THEN the listed view points back to the new element
  const document = applyMutations(baseDocument(), [
    {
      type: 'addElement',
      element: { id: 'p2', name: 'P2', type: 'Grouping', subdiagram_views: [{ view_id: 'sub', view_name: 'Sub' }] },
      view_ids: ['top'],
    },
  ]).document;

  const view = viewById(document, 'sub');
  assert.equal(view.parent_element_id, 'p2');
  assert.equal(view.parent_element_name, 'P2');
  assert.equal(viewById(document, 'sub') === undefined, false);
});

test('updateElement: adding subdiagram_views syncs the view parent', () => {
  // GIVEN an element without children
  // WHEN updateElement sets subdiagram_views
  // THEN the listed view re-points to this element
  const document = applyMutations(baseDocument(), [
    { type: 'updateElement', id: 'parent', patch: { subdiagram_views: [{ view_id: 'sub', view_name: 'Sub' }] } },
  ]).document;

  const view = viewById(document, 'sub');
  assert.equal(view.parent_element_id, 'parent');
});

test('updateElement: removing subdiagram_views detaches the view parent', () => {
  // GIVEN an element with a mounted sub-view
  // WHEN updateElement clears subdiagram_views
  // THEN the view no longer points to this element
  const document = applyMutations(baseDocument(), [
    { type: 'updateElement', id: 'parent', patch: { subdiagram_views: [] } },
  ]).document;

  const view = viewById(document, 'sub');
  assert.equal(view.parent_element_id, undefined);
  assert.equal(view.parent_element_name, undefined);
});

test('removeElement: refuses removal while sub-views are mounted', () => {
  // GIVEN an element with a mounted sub-view
  // WHEN removeElement is attempted
  // THEN it throws instead of leaving a dangling parent_element_id
  assert.throws(
    () => applyMutations(baseDocument(), [{ type: 'removeElement', id: 'parent' }]),
    /cannot be removed.*sub-view/i,
  );
});

test('removeElement: removes an element with no sub-views', () => {
  // GIVEN a child-less element
  // WHEN removeElement is attempted
  // THEN it succeeds
  const document = applyMutations(baseDocument(), [{ type: 'removeElement', id: 'c' }]).document;
  assert.equal(elementById(document, 'c'), undefined);
});

test('updateRelationship: endpoint change removes the stale old endpoint', () => {
  // GIVEN a view whose only membership of "b" is via relationship r1
  // WHEN r1's target changes from b to c
  // THEN "c" is added and "b" is cleaned from included_elements
  const document = applyMutations(baseDocument(), [
    { type: 'updateRelationship', id: 'r1', patch: { target_id: 'c', target_name: 'C', statement: 'A --(Flow)--> C' } },
  ]).document;

  const view = viewById(document, 'top');
  assert.deepEqual(view.included_elements.sort(), ['a', 'c', 'parent']);
});

test('updateRelationship: keeps an old endpoint still used by another relationship', () => {
  // GIVEN "b" is an endpoint of two relationships in the same view
  const graph = baseDocument();
  graph.relationships.push({ id: 'r2', statement: 'A --(Flow)--> B', name: 'Flow', type: 'Flow', source_id: 'a', target_id: 'b', source_name: 'A', target_name: 'B' });
  graph.views[0].included_relationships.push('r2');

  // WHEN r1's target changes from b to c (but r2 still uses b)
  const document = applyMutations(graph, [
    { type: 'updateRelationship', id: 'r1', patch: { target_id: 'c', target_name: 'C', statement: 'A --(Flow)--> C' } },
  ]).document;

  // THEN "b" remains because r2 still references it
  const view = viewById(document, 'top');
  assert.ok(view.included_elements.includes('b'), 'b must remain (still used by r2)');
  assert.ok(view.included_elements.includes('c'), 'c must be added');
});

test('removeRelationship: clears endpoints no longer used by any relationship', () => {
  // GIVEN "a" and "b" are in the view only via r1
  // WHEN r1 is removed
  // THEN both endpoints are cleaned from included_elements
  const document = applyMutations(baseDocument(), [{ type: 'removeRelationship', id: 'r1' }]).document;

  const view = viewById(document, 'top');
  assert.deepEqual(view.included_elements, ['parent']);
  assert.deepEqual(view.included_relationships, []);
});

test('removeRelationship: keeps an endpoint still used by another relationship', () => {
  // GIVEN "b" is shared by r1 (a->b) and r2 (c->b)
  const graph = baseDocument();
  graph.relationships.push({ id: 'r2', statement: 'C --(Flow)--> B', name: 'Flow', type: 'Flow', source_id: 'c', target_id: 'b', source_name: 'C', target_name: 'B' });
  graph.views[0].included_relationships.push('r2');
  graph.views[0].included_elements.push('c');

  // WHEN r1 is removed
  const document = applyMutations(graph, [{ type: 'removeRelationship', id: 'r1' }]).document;

  // THEN "a" is removed (only used by r1), but "b" remains (used by r2)
  const view = viewById(document, 'top');
  assert.ok(!view.included_elements.includes('a'), 'a must be cleaned');
  assert.ok(view.included_elements.includes('b'), 'b must remain');
  assert.deepEqual(view.included_relationships, ['r2']);
});

test('updateElement: patch.attributes merges by name (unmentioned attributes preserved)', () => {
  // GIVEN an element carrying multiple attributes
  const graph = baseDocument();
  graph.elements[1].attributes = [
    { name: 'commit', value: 'aaa' },
    { name: 'deliveryStatus', value: 'delivered' },
  ];
  // WHEN updating only one attribute by name (targeted merge, not full replace)
  const document = applyMutations(graph, [
    { type: 'updateElement', id: 'a', patch: { attributes: [{ name: 'deliveryStatus', value: 'not_delivered' }] } },
  ]).document;
  // THEN the unmentioned attribute is preserved and the targeted one is updated
  assert.deepEqual(elementById(document, 'a').attributes, [
    { name: 'commit', value: 'aaa' },
    { name: 'deliveryStatus', value: 'not_delivered' },
  ]);
});

test('updateElement: patch.attributes upserts a new attribute and op:remove deletes by name', () => {
  // GIVEN an element with one attribute
  const graph = baseDocument();
  graph.elements[1].attributes = [{ name: 'commit', value: 'aaa' }];
  // WHEN a new attribute is added and an existing one is removed
  const document = applyMutations(graph, [
    { type: 'updateElement', id: 'a', patch: { attributes: [
      { name: 'status', value: 'COMPLETED' },
      { name: 'commit', op: 'remove' },
    ] } },
  ]).document;
  // THEN the new attribute is added and only the explicitly removed one is gone
  assert.deepEqual(elementById(document, 'a').attributes, [{ name: 'status', value: 'COMPLETED' }]);
});

test('updateElement: multi-valued commit ledger APPENDS a new sha (does not overwrite the first)', () => {
  // GIVEN an element with an existing commit ledger (two shas)
  const graph = baseDocument();
  graph.elements[1].attributes = [
    { name: 'commit', value: 'aaa' },
    { name: 'commit', value: 'bbb' },
    { name: 'deliveryStatus', value: 'delivered' },
  ];
  // WHEN registering a new commit by minimal patch (name+value)
  const document = applyMutations(graph, [
    { type: 'updateElement', id: 'a', patch: { attributes: [{ name: 'commit', value: 'ccc' }] } },
  ]).document;
  // THEN the new sha is APPENDED and both existing shas + deliveryStatus are preserved
  const sortAttrs = list => [...list].sort((a, b) => `${a.name}:${a.value}`.localeCompare(`${b.name}:${b.value}`));
  assert.deepEqual(sortAttrs(elementById(document, 'a').attributes), sortAttrs([
    { name: 'commit', value: 'aaa' },
    { name: 'commit', value: 'bbb' },
    { name: 'commit', value: 'ccc' },
    { name: 'deliveryStatus', value: 'delivered' },
  ]));
});

test('updateElement: re-registering an existing commit sha updates its description (no duplicate)', () => {
  // GIVEN an element with a commit ledger
  const graph = baseDocument();
  graph.elements[1].attributes = [{ name: 'commit', value: 'aaa', description: 'old' }];
  // WHEN the same sha is re-registered with a new description
  const document = applyMutations(graph, [
    { type: 'updateElement', id: 'a', patch: { attributes: [{ name: 'commit', value: 'aaa', description: 'new' }] } },
  ]).document;
  // THEN the entry is updated in place (still exactly one entry)
  assert.deepEqual(elementById(document, 'a').attributes, [{ name: 'commit', value: 'aaa', description: 'new' }]);
});

test('updateElement: op:remove with a value removes only that exact ledger entry', () => {
  // GIVEN an element with a multi-sha commit ledger
  const graph = baseDocument();
  graph.elements[1].attributes = [
    { name: 'commit', value: 'aaa' },
    { name: 'commit', value: 'bbb' },
    { name: 'commit', value: 'ccc' },
  ];
  // WHEN one specific sha is removed by name+value
  const document = applyMutations(graph, [
    { type: 'updateElement', id: 'a', patch: { attributes: [{ name: 'commit', value: 'bbb', op: 'remove' }] } },
  ]).document;
  // THEN only that sha is gone, the rest of the ledger survives
  assert.deepEqual(elementById(document, 'a').attributes, [
    { name: 'commit', value: 'aaa' },
    { name: 'commit', value: 'ccc' },
  ]);
});
