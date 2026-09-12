'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGolden,
  cosine,
  CHANNELS,
  topK,
} = require('../scripts/eval-retrieval.js');

// AT-retrieval-eval-01: the retrieval evaluation harness builds a reproducible
// golden set from the canonical graph and exposes the vector channels it scores.
test('AT-retrieval-eval-01: buildGolden derives name/description queries with canonicalIdentity targets', () => {
  const graph = {
    elements: [
      { id: 'e1', name: 'Widget Handler', description: 'Handles widgets end to end, across the lifecycle.' },
      { id: 'e2', name: 'Thing' }, // no description -> name query only
    ],
    relationships: [
      { id: 'r1', statement: 'A --(Flow)--> B', description: 'flows from A to B over the wire' },
    ],
    views: [
      { view_id: 'v1', view_name: 'Harness', description: 'the harness view for agents' },
    ],
  };
  const queries = buildGolden(graph);
  const byTarget = new Map();
  for (const q of queries) byTarget.set(q.target + '|' + q.family, q);

  // name queries carry the channel-prefixed canonical identity used by the vector index
  assert.equal(byTarget.get('Element:e1|name').q, 'Widget Handler');
  assert.equal(byTarget.get('Element:e2|name').q, 'Thing');
  assert.equal(byTarget.get('ArchitectureRelationship:r1|name').q, 'A --(Flow)--> B');
  assert.equal(byTarget.get('View:v1|name').q, 'Harness');
  // description queries only appear when the description is non-trivial (>=24 chars)
  assert.equal(byTarget.get('Element:e1|desc').q, 'Handles widgets end to end, across the lifecycle.');
  assert.equal(byTarget.has('Element:e2|desc'), false, 'short/absent description must not produce a desc query');
  // every target is channel-prefixed
  for (const q of queries) assert.match(q.target, /^(Element|ArchitectureRelationship|View):/);
});

test('AT-retrieval-eval-01b: channels and cosine are stable', () => {
  assert.deepEqual(CHANNELS.map(c => c.channel), ['Element', 'ArchitectureRelationship', 'View']);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(cosine([1, 0], [1, 0]) > 0.999);
  assert.ok(Number.isInteger(topK()) && topK() > 0);
});
