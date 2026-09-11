'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyMutations } = require('../argo/scripts/systemarchitecture-mcp-server.js');

function baseDocument() {
  return {
    name: 'dedup-gate-test',
    description: 'dedup-gate-test',
    elements: [
      { id: 'parent', name: 'Parent', type: 'Grouping' },
      { id: 'x1', name: 'Widget', type: 'Application Component' },
      { id: 'a', name: 'A', type: 'Application Component' },
      { id: 'b', name: 'B', type: 'Application Component' },
    ],
    relationships: [
      { id: 'r1', name: 'Flow', type: 'Flow', source_id: 'a', target_id: 'b', source_name: 'A', target_name: 'B', statement: 'A --(Flow)--> B' },
    ],
    views: [
      { view_id: 'top', view_name: 'SystemArchitecture', included_elements: ['parent', 'x1', 'a', 'b'], included_relationships: ['r1'] },
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

// AT-dedup-01
test('addElement: exact (type, normalized name) duplicate is rejected with candidates', () => {
  // GIVEN an element of type 'Application Component' named 'Widget' already exists
  // WHEN addElement creates a new id with the same type + name under the default policy
  // THEN it throws and the error carries the existing candidate, and nothing is created
  let error;
  try {
    applyMutations(baseDocument(), [
      { type: 'addElement', element: { id: 'x2', name: 'Widget', type: 'Application Component' }, view_ids: ['sub'] },
    ]);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'a duplicate add must be rejected');
  assert.ok(Array.isArray(error.duplicateConflicts), 'error must carry duplicateConflicts');
  assert.deepEqual(error.duplicateConflicts, [
    { id: 'x1', type: 'Application Component', name: 'Widget' },
  ]);
});

// AT-dedup-02
test('addElement: onConflict reuse is find-or-create (no duplicate, existing id attached)', () => {
  // GIVEN the existing element is not yet a member of the target view
  // WHEN addElement runs with onConflict:'reuse'
  // THEN no new element is created and the existing id is attached to the target view
  const result = applyMutations(baseDocument(), [
    { type: 'addElement', element: { id: 'x2', name: 'Widget', type: 'Application Component' }, view_ids: ['sub'], onConflict: 'reuse' },
  ]);
  const document = result.document;
  assert.equal(elementById(document, 'x2'), undefined, 'a duplicate element must not be created');
  assert.ok(viewById(document, 'sub').included_elements.includes('x1'), 'existing element must be attached to the view');
  const summary = result.mutationSummaries.find(entry => entry.type === 'addElement');
  assert.equal(summary.reused, true);
  assert.equal(summary.reusedId, 'x1');
  assert.equal(summary.created, false);
});

// AT-dedup-03
test('addElement: allowDuplicate requires a non-empty justification', () => {
  // GIVEN a same-key element already exists
  // WHEN allowDuplicate is requested without justification
  assert.throws(
    () => applyMutations(baseDocument(), [
      { type: 'addElement', element: { id: 'x2', name: 'Widget', type: 'Application Component' }, view_ids: ['sub'], onConflict: 'allowDuplicate' },
    ]),
    /requires a non-empty justification/,
  );
  // AND WHEN allowDuplicate is requested with a justification
  const document = applyMutations(baseDocument(), [
    { type: 'addElement', element: { id: 'x2', name: 'Widget', type: 'Application Component' }, view_ids: ['sub'], onConflict: 'allowDuplicate', justification: 'distinct component sharing the same display name' },
  ]).document;
  // THEN the new element is created alongside the existing one
  assert.ok(elementById(document, 'x2'), 'justified duplicate must be created');
  assert.ok(elementById(document, 'x1'), 'existing element must remain');
});

// AT-dedup-04
test('addElement: normalization folds case, whitespace, and full-width forms', () => {
  // GIVEN an element named 'Widget'
  // WHEN a new element differs only by case/whitespace/full-width
  // THEN it collides with the same natural key
  for (const name of [' widget ', 'WIDGET', 'Ｗｉｄｇｅｔ']) {
    assert.throws(
      () => applyMutations(baseDocument(), [
        { type: 'addElement', element: { id: 'xN', name, type: 'Application Component' }, view_ids: ['sub'] },
      ]),
      /Duplicate element/,
      `name '${name}' must collide with 'Widget'`,
    );
  }
});

// AT-dedup-05
test('addRelationship: exact (source, type, target, name) is gated; a distinct name is allowed', () => {
  // GIVEN a Flow a -> b named 'Flow' exists
  // WHEN the same (source, type, target, name) is added
  assert.throws(
    () => applyMutations(baseDocument(), [
      { type: 'addRelationship', relationship: { id: 'r2', name: 'Flow', type: 'Flow', source_id: 'a', target_id: 'b', source_name: 'A', target_name: 'B' }, view_ids: ['top'] },
    ]),
    /Duplicate relationship/,
  );
  // AND WHEN the same triple carries a different name
  const document = applyMutations(baseDocument(), [
    { type: 'addRelationship', relationship: { id: 'r3', name: 'Sync', type: 'Flow', source_id: 'a', target_id: 'b', source_name: 'A', target_name: 'B' }, view_ids: ['top'] },
  ]).document;
  // THEN it is allowed (a distinct meaning between the same endpoints)
  assert.ok(document.relationships.some(entry => entry.id === 'r3'), 'distinct-named relationship must be created');
});

// AT-dedup-06
test('addView: duplicate (parent, view_name) is gated, and reuse returns the existing view', () => {
  // GIVEN a view named 'Sub' is mounted under parent 'parent'
  // WHEN another view with the same name is added under the same parent
  assert.throws(
    () => applyMutations(baseDocument(), [
      { type: 'addView', view: { view_id: 'vSub2', view_name: 'Sub', parent_element_id: 'parent', parent_element_name: 'Parent', included_elements: [], included_relationships: [] } },
    ]),
    /Duplicate view/,
  );
  // AND WHEN onConflict:'reuse' is requested
  const result = applyMutations(baseDocument(), [
    { type: 'addView', view: { view_id: 'vSub2', view_name: 'Sub', parent_element_id: 'parent', parent_element_name: 'Parent', included_elements: [], included_relationships: [] }, onConflict: 'reuse' },
  ]);
  // THEN no new view is created and the existing one is reused
  assert.equal(result.document.views.some(view => view.view_id === 'vSub2'), false);
  const summary = result.mutationSummaries.find(entry => entry.type === 'addView');
  assert.equal(summary.reusedId, 'sub');
});

// AT-dedup-07
test('updateElement is never gated (duplicate check applies to add only)', () => {
  // GIVEN an element whose name collides with another element
  const graph = baseDocument();
  graph.elements.push({ id: 'x9', name: 'Widget', type: 'Application Component' });
  // WHEN an update targets it
  const document = applyMutations(graph, [
    { type: 'updateElement', id: 'x9', patch: { description: 'renamed semantics kept' } },
  ]).document;
  // THEN the update succeeds (the dedup gate never blocks update*)
  assert.equal(elementById(document, 'x9').description, 'renamed semantics kept');
});

test('addElement: invalid onConflict policy is rejected', () => {
  assert.throws(
    () => applyMutations(baseDocument(), [
      { type: 'addElement', element: { id: 'x2', name: 'Widget', type: 'Application Component' }, view_ids: ['sub'], onConflict: 'bogus' },
    ]),
    /onConflict must be one of/,
  );
});
