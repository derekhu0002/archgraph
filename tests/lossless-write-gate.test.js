'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { applyMutations } = require('../argo/scripts/systemarchitecture-mcp-server.js');
const gate = require('../argo/scripts/lossless-write-gate.js');

function baseDocument() {
  return {
    name: 'lossless-write-gate-test',
    description: 'lossless-write-gate-test',
    elements: [
      { id: 'parent', name: 'Parent', type: 'Grouping' },
      {
        id: 'a',
        name: 'A',
        type: 'Application Component',
        description: 'Line one keeps.\nLine two is valuable.\nLine three is valuable too.',
        attributes: [{ name: 'note', value: 'unchanged' }],
        testcases: [
          { name: 'AT-1', type: 'Acceptance Test', description: 'GIVEN x WHEN y THEN z', Input: 'tests/a.test.js', acceptanceCriteria: 'tests/a.test.js' },
          { name: 'AT-2', type: 'Acceptance Test', description: 'GIVEN x WHEN y THEN w', Input: 'tests/b.test.js', acceptanceCriteria: 'tests/b.test.js' },
        ],
      },
      { id: 'b', name: 'B', type: 'Application Component' },
    ],
    relationships: [
      { id: 'r1', statement: 'A --(Flow)--> B', name: 'Flow', type: 'Flow', source_id: 'a', target_id: 'b', source_name: 'A', target_name: 'B', attributes: [{ name: 'keep', description: 'keep me' }] },
    ],
    views: [
      { view_id: 'top', view_name: 'SystemArchitecture', included_elements: ['parent', 'a', 'b'], included_relationships: ['r1'] },
      { view_id: 'sub', view_name: 'Sub', parent_element_id: 'parent', parent_element_name: 'Parent', included_elements: ['a', 'b'], included_relationships: [] },
    ],
  };
}

function elementById(document, id) {
  return document.elements.find(element => element.id === id);
}

// ── G1: structured fields merge (omission never means deletion) ──

test('AT-lossless-01: updateElement.testcases merge by name (omission preserved, op:remove deletes)', () => {
  // GIVEN an element with two testcases
  const base = baseDocument();
  // WHEN one testcase is updated and one added (omitting the second)
  const result = applyMutations(base, [
    { type: 'updateElement', id: 'a', patch: { testcases: [
      { name: 'AT-1', type: 'Acceptance Test', description: 'GIVEN x WHEN y THEN z2', Input: 'tests/a.test.js', acceptanceCriteria: 'tests/a.test.js' },
      { name: 'AT-3', type: 'Acceptance Test', description: 'GIVEN p WHEN q THEN r', Input: 'tests/c.test.js', acceptanceCriteria: 'tests/c.test.js' },
    ] } },
  ]).document;
  // THEN the omitted testcase survives and the named one is upserted
  const names = elementById(result, 'a').testcases.map(tc => tc.name).sort();
  assert.deepEqual(names, ['AT-1', 'AT-2', 'AT-3']);
  assert.match(elementById(result, 'a').testcases.find(tc => tc.name === 'AT-1').description, /z2/);
  // AND an explicit op:remove is the only way to delete a testcase
  const removed = applyMutations(base, [
    { type: 'updateElement', id: 'a', patch: { testcases: [{ name: 'AT-2', op: 'remove' }] } },
  ]).document;
  assert.deepEqual(elementById(removed, 'a').testcases.map(tc => tc.name), ['AT-1']);
});

test('AT-lossless-02: updateRelationship.attributes merge by name (unmentioned preserved)', () => {
  // GIVEN a relationship with an attribute
  const base = baseDocument();
  // WHEN a new attribute is upserted without mentioning the existing one
  const result = applyMutations(base, [
    { type: 'updateRelationship', id: 'r1', patch: { attributes: [{ name: 'added', description: 'new' }] } },
  ]).document;
  // THEN both attributes are present
  const attrs = result.relationships.find(r => r.id === 'r1').attributes.map(a => a.name).sort();
  assert.deepEqual(attrs, ['added', 'keep']);
});

test('AT-lossless-03: updateView membership supports lossless delta { add, remove }', () => {
  // GIVEN a view with members a and b
  const base = baseDocument();
  // WHEN membership is patched as an explicit delta
  const result = applyMutations(base, [
    { type: 'updateView', view_id: 'sub', patch: { included_elements: { remove: ['b'], add: ['parent'] } } },
  ]).document;
  // THEN only the explicitly removed member is gone, and the added one is present
  const members = result.views.find(v => v.view_id === 'sub').included_elements;
  assert.ok(members.includes('parent') && members.includes('a') && !members.includes('b'));
});

// ── G2: scalar text loss is blocked unless acknowledged ──

test('AT-lossless-04: unacknowledged description shrink is blocked; acknowledgeLoss allows; major requires justification', () => {
  // GIVEN an element with a multi-line description
  const base = baseDocument();
  // WHEN the description is rewritten to drop valuable lines without acknowledgement
  const dropped = applyMutations(base, [
    { type: 'updateElement', id: 'a', patch: { description: 'Line one keeps.' } },
  ]).lossReport;
  // THEN the loss is detected and blocks the write
  assert.equal(dropped.blocked, true);
  assert.ok(dropped.text.length >= 1);
  assert.match(dropped.reasons.join('\n'), /Unacknowledged text loss/);
  // AND an explicit acknowledgement is accepted (loss recorded, not blocked)
  const acked = applyMutations(base, [
    { type: 'updateElement', id: 'a', patch: { description: 'Line one keeps.' }, acknowledgeLoss: true },
  ]).lossReport;
  assert.equal(acked.blocked, false);
  assert.equal(acked.text[0].acknowledged, true);
  // AND a pure addition/expansion is never a loss
  const expanded = applyMutations(base, [
    { type: 'updateElement', id: 'a', patch: { description: `${elementById(base, 'a').description}\nLine four is new.` } },
  ]).lossReport;
  assert.equal(expanded.text.length, 0);
  // AND an in-line REWORD (kept tokens dominate) is a modification, not a loss
  const reworded = applyMutations(base, [
    { type: 'updateElement', id: 'a', patch: { description: 'Line one keeps.\nLine two is critical.\nLine three is valuable too.' } },
  ]).lossReport;
  assert.equal(reworded.blocked, false);
  assert.equal(reworded.text.length, 0);
  assert.equal(reworded.modifications.length, 1);
  // AND a major loss requires a justification, not just acknowledgement
  const majorShrink = gate.buildLossReport({
    baseDocument: { elements: [{ id: 'd', name: 'D', type: 'Business Object', description: 'x'.repeat(400) }], relationships: [], views: [] },
    mutations: [{ type: 'updateElement', id: 'd', patch: { description: 'short' }, acknowledgeLoss: true }],
    nextDocument: { elements: [{ id: 'd', name: 'D', type: 'Business Object', description: 'short' }], relationships: [], views: [] },
  });
  assert.equal(majorShrink.blocked, true);
  assert.match(majorShrink.reasons.join('\n'), /lossJustification/);
});

// ── G3: destructive removal is acknowledged ──

test('AT-lossless-05: membership removal and object removal require an explicit acknowledgement', () => {
  // GIVEN a view with members
  const base = baseDocument();
  // WHEN membership is replaced by a shorter list without acknowledgement
  const implicit = applyMutations(base, [
    { type: 'updateView', view_id: 'sub', patch: { included_elements: ['a'] } },
  ]).lossReport;
  // THEN the implicit removal blocks
  assert.equal(implicit.blocked, true);
  assert.match(implicit.reasons.join('\n'), /membership removal/);
  // AND an explicit delta remove is allowed without the blanket ack
  const explicit = applyMutations(base, [
    { type: 'updateView', view_id: 'sub', patch: { included_elements: { remove: ['b'] } } },
  ]).lossReport;
  assert.equal(explicit.blocked, false);
  // AND removing a whole element requires acknowledgement
  const removeBlocked = applyMutations(base, [{ type: 'removeElement', id: 'b' }]).lossReport;
  assert.equal(removeBlocked.blocked, true);
  assert.equal(removeBlocked.objectsRemoved.length, 1);
  const removeAcked = applyMutations(base, [{ type: 'removeElement', id: 'b', acknowledgeLoss: true }]).lossReport;
  assert.equal(removeAcked.blocked, false);
});

test('AT-lossless-07: batch-level acknowledgement confirms a whole mutation set at once', () => {
  // GIVEN a set that removes one object and shrinks another element's text
  const base = baseDocument();
  const mutations = [
    { type: 'removeElement', id: 'b' },
    { type: 'updateElement', id: 'a', patch: { description: 'rewritten without the old lines' } },
  ];
  // WHEN no acknowledgement is given
  const blocked = applyMutations(base, mutations).lossReport;
  // THEN the whole set is blocked (each mutation reported)
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.objectsRemoved.length, 1);
  assert.equal(blocked.text.length, 1);
  // AND a single batch-level acknowledgement unblocks every mutation at once
  const acked = applyMutations(base, mutations, { lossAck: { acknowledgeLoss: true } }).lossReport;
  assert.equal(acked.blocked, false);
  assert.equal(acked.acknowledged, true);
});

test('AT-lossless-06: tombstone ledger records the full removed object (recoverable)', () => {
  // GIVEN a removal and a temp graph location
  const base = baseDocument();
  const next = applyMutations(base, [{ type: 'removeElement', id: 'b', acknowledgeLoss: true }]).document;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-tombstone-'));
  const graphPath = path.join(dir, 'SystemArchitecture.json');
  // WHEN tombstones are appended
  const removed = gate.collectRemovedObjects(base, [{ type: 'removeElement', id: 'b' }], next);
  assert.equal(removed.length, 1);
  const written = gate.appendTombstones(graphPath, removed);
  // THEN the ledger holds the full object for recovery
  assert.equal(written.count, 1);
  const ledger = JSON.parse(fs.readFileSync(written.path, 'utf8'));
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].object.id, 'b');
  assert.equal(ledger.entries[0].object.name, 'B');
  fs.rmSync(dir, { recursive: true, force: true });
});
