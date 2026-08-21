'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyMutations } = require('../argo/scripts/systemarchitecture-mcp-server.js');

function baseDocument() {
  return {
    name: 'mutation-test',
    description: 'mutation-test',
    elements: [
      { id: 'e1', name: 'ParentOne', type: 'Grouping' },
      { id: 'e2', name: 'ParentTwo', type: 'Grouping' },
    ],
    relationships: [],
    views: [
      {
        view_id: 'vTop',
        view_name: 'SystemArchitecture',
        included_elements: ['e1', 'e2'],
        included_relationships: [],
      },
    ],
  };
}

function elementById(document, id) {
  return document.elements.find(element => element.id === id);
}

function subviewIds(element) {
  return (element.subdiagram_views || []).map(entry => entry.view_id);
}

function addView(document, view) {
  return applyMutations(document, [{ type: 'addView', view }]).document;
}

test('addView: mounts the new sub-view under the parent element subdiagram_views', () => {
  // GIVEN a parent element with no child views
  // WHEN addView writes a view whose parent_element_id points at that element
  // THEN the parent element gains the matching subdiagram_views entry
  const document = addView(baseDocument(), {
    view_id: 'vSub',
    view_name: 'Sub',
    parent_element_id: 'e1',
    parent_element_name: 'ParentOne',
    included_elements: [],
    included_relationships: [],
  });

  const parent = elementById(document, 'e1');
  assert.ok(parent, 'parent element must still exist');
  assert.deepEqual(subviewIds(parent), ['vSub']);
  assert.deepEqual(parent.subdiagram_views[0], { view_id: 'vSub', view_name: 'Sub' });

  const untouched = elementById(document, 'e2');
  assert.deepEqual(subviewIds(untouched), [], 'unrelated parent must not be touched');
});

test('updateView: re-parenting syncs subdiagram_views between old and new parent', () => {
  // GIVEN a sub-view mounted under the old parent
  // WHEN updateView patches parent_element_id to a new parent
  // THEN the old parent loses the entry and the new parent gains it
  let document = addView(baseDocument(), {
    view_id: 'vSub',
    view_name: 'Sub',
    parent_element_id: 'e1',
    parent_element_name: 'ParentOne',
    included_elements: [],
    included_relationships: [],
  });

  document = applyMutations(document, [
    { type: 'updateView', view_id: 'vSub', patch: { parent_element_id: 'e2', parent_element_name: 'ParentTwo' } },
  ]).document;

  assert.deepEqual(subviewIds(elementById(document, 'e1')), [], 'old parent entry removed');
  assert.deepEqual(elementById(document, 'e2').subdiagram_views, [
    { view_id: 'vSub', view_name: 'Sub' },
  ], 'new parent entry added');
});

test('updateView: renaming a view keeps the parent entry view_name in sync', () => {
  // GIVEN a sub-view mounted under a parent
  // WHEN updateView renames the view without changing its parent
  // THEN the parent entry view_name follows the rename
  let document = addView(baseDocument(), {
    view_id: 'vSub',
    view_name: 'Sub',
    parent_element_id: 'e1',
    parent_element_name: 'ParentOne',
    included_elements: [],
    included_relationships: [],
  });

  document = applyMutations(document, [
    { type: 'updateView', view_id: 'vSub', patch: { view_name: 'SubRenamed' } },
  ]).document;

  assert.deepEqual(elementById(document, 'e1').subdiagram_views, [
    { view_id: 'vSub', view_name: 'SubRenamed' },
  ]);
});

test('removeView: removes the entry from the parent subdiagram_views', () => {
  // GIVEN a sub-view mounted under a parent
  // WHEN removeView deletes the view
  // THEN the parent element no longer references the removed view
  let document = addView(baseDocument(), {
    view_id: 'vSub',
    view_name: 'Sub',
    parent_element_id: 'e1',
    parent_element_name: 'ParentOne',
    included_elements: [],
    included_relationships: [],
  });

  document = applyMutations(document, [{ type: 'removeView', view_id: 'vSub' }]).document;

  assert.deepEqual(subviewIds(elementById(document, 'e1')), []);
  assert.equal(document.views.some(view => view.view_id === 'vSub'), false, 'view must be removed');
});
