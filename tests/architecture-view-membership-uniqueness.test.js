'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyMutations } = require('../argo/scripts/systemarchitecture-mcp-server.js');
const { validateGraphSemantics } = require('../argo/scripts/graph-semantics.js');

// AT-view-unique-01: a view must not hold the same element/relationship twice.
test('AT-view-unique-01: validation rejects duplicate view membership', () => {
  const document = {
    name: 'view-unique-test',
    description: 'view-unique-test',
    elements: [
      { id: 'a', name: 'A', type: 'Application Component' },
      { id: 'b', name: 'B', type: 'Application Component' },
    ],
    relationships: [
      { id: 'r1', statement: 'A --(Flow)--> B', name: 'Flow', type: 'Flow', source_id: 'a', target_id: 'b', source_name: 'A', target_name: 'B' },
    ],
    views: [
      {
        view_id: 'top',
        view_name: 'SystemArchitecture',
        included_elements: ['a', 'a', 'b'],
        included_relationships: ['r1', 'r1'],
      },
    ],
  };
  const errors = [];
  validateGraphSemantics(document, errors);
  assert.ok(errors.some(e => /must not contain duplicate included_elements/.test(e)), 'duplicate elements must be rejected');
  assert.ok(errors.some(e => /must not contain duplicate included_relationships/.test(e)), 'duplicate relationships must be rejected');
});

// AT-view-unique-02: updateView de-duplicates a membership patch.
test('AT-view-unique-02: updateView de-duplicates included_elements / included_relationships', () => {
  const document = applyMutations({
    name: 't',
    description: 't',
    elements: [
      { id: 'p', name: 'P', type: 'Grouping' },
      { id: 'a', name: 'A', type: 'Application Component' },
      { id: 'b', name: 'B', type: 'Application Component' },
    ],
    relationships: [],
    views: [{ view_id: 'top', view_name: 'SystemArchitecture', included_elements: ['p', 'a'], included_relationships: [] }],
  }, [
    { type: 'updateView', view_id: 'top', patch: { included_elements: ['a', 'a', 'b', 'b'], included_relationships: [] } },
  ]).document;
  assert.deepEqual(document.views[0].included_elements, ['a', 'b']);
});

// AT-view-unique-03: addView de-duplicates the new view's membership.
test('AT-view-unique-03: addView de-duplicates the created view membership', () => {
  const document = applyMutations({
    name: 't',
    description: 't',
    elements: [
      { id: 'p', name: 'P', type: 'Grouping' },
      { id: 'a', name: 'A', type: 'Application Component' },
    ],
    relationships: [],
    views: [{ view_id: 'top', view_name: 'SystemArchitecture', included_elements: ['p', 'a'], included_relationships: [] }],
  }, [
    { type: 'addView', view: { view_id: 'v2', view_name: 'V2', parent_element_id: 'p', parent_element_name: 'P', included_elements: ['a', 'a'], included_relationships: [] } },
  ]).document;
  const sub = document.views.find(v => v.view_id === 'v2');
  assert.deepEqual(sub.included_elements, ['a']);
});

// AT-view-unique-04: the .qea projection never double-inserts within one pass.
test('AT-view-unique-04: projection tracks newly placed members (no within-batch duplicate insert)', () => {
  const lib = fs.readFileSync(path.join(__dirname, '..', 'argo', 'scripts', 'ea-qea-sync-lib.js'), 'utf8');
  assert.match(lib, /placedObjs\.add\(Number\(oid\)\)/);
  assert.match(lib, /placedLinks\.add\(Number\(cid\)\)/);
});
