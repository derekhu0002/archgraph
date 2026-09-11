'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildSemanticDedupAdvisory } = require('../argo/scripts/systemarchitecture-mcp-server.js');

function baseDocument() {
  return {
    name: 'semantic-dedup-test',
    description: 'semantic-dedup-test',
    elements: [
      { id: 'w1', name: 'Widget', type: 'Application Component', description: 'existing widget' },
      { id: 'w2', name: 'Gadget', type: 'Application Component' },
      { id: 'r1', name: 'Widget', type: 'Business Role' },
    ],
    relationships: [],
    views: [
      { view_id: 'v1', view_name: 'V1', included_elements: ['w1'], included_relationships: [] },
      { view_id: 'v2', view_name: 'V2', included_elements: [], included_relationships: [] },
    ],
  };
}

function context(document) {
  return { workspaceRoot: process.cwd(), document };
}

function addWidgetMutation(overrides = {}) {
  return {
    type: 'addElement',
    element: { id: 'w3', name: 'Widget Prime', type: 'Application Component' },
    view_ids: ['v1'],
    ...overrides,
  };
}

// AT-dedup-L1-01
test('L1 advisory: returns same-type, in-scope, above-threshold semantic candidates (advisory only)', async () => {
  // GIVEN a new Application Component is about to be added to view v1
  const document = baseDocument();
  const journey = {
    query: async () => ({
      result: {
        elements: [
          { ...document.elements[0], semanticScore: 0.93 }, // same type, in v1, high
          { ...document.elements[1], semanticScore: 0.90 }, // same type, NOT in v1 (out of scope)
          { ...document.elements[2], semanticScore: 0.95 }, // different type
        ],
      },
    }),
  };
  // WHEN the advisory is built with a scoped, high-threshold contract
  const advisory = await buildSemanticDedupAdvisory(
    context(document),
    [addWidgetMutation()],
    { semanticOperatorJourney: journey },
  );
  // THEN it passes, is marked advisory-only, and returns only the in-scope same-type match
  assert.equal(advisory.status, 'passed');
  assert.equal(advisory.advisoryOnly, true);
  assert.equal(advisory.threshold, 0.85);
  assert.equal(advisory.has_suggestions, true);
  assert.deepEqual(advisory.candidates[0].matches.map(match => match.id), ['w1']);
  assert.equal(advisory.candidates[0].matches[0].in_target_views, true);
});

test('L1 advisory: never rejects or throws when the semantic backend fails (degrades)', async () => {
  // GIVEN the semantic journey throws (offline / not ready)
  const document = baseDocument();
  const journey = {
    query: async () => { throw Object.assign(new Error('semantic not ready'), { category: 'SEMANTIC_READINESS_FAILED' }); },
  };
  // WHEN the advisory is built
  const advisory = await buildSemanticDedupAdvisory(
    context(document),
    [addWidgetMutation()],
    { semanticOperatorJourney: journey },
  );
  // THEN it degrades to an explicit unavailable entry and never throws
  assert.equal(advisory.status, 'passed');
  assert.equal(advisory.candidates[0].status, 'unavailable');
  assert.equal(advisory.candidates[0].reason, 'SEMANTIC_READINESS_FAILED');
  assert.deepEqual(advisory.candidates[0].matches, []);
  assert.equal(advisory.has_suggestions, false);
});

test('L1 advisory: below-threshold and out-of-scope candidates are filtered out', async () => {
  // GIVEN only low-score / out-of-scope semantic neighbours
  const document = baseDocument();
  const journey = {
    query: async () => ({
      result: {
        elements: [
          { ...document.elements[0], semanticScore: 0.50 }, // below threshold
          { ...document.elements[1], semanticScore: 0.99 }, // same type but out of scope (not in v1)
        ],
      },
    }),
  };
  // WHEN the advisory is built for an add into v1
  const advisory = await buildSemanticDedupAdvisory(
    context(document),
    [addWidgetMutation()],
    { semanticOperatorJourney: journey },
  );
  // THEN no suggestions are produced
  assert.equal(advisory.has_suggestions, false);
  assert.deepEqual(advisory.candidates[0].matches, []);
});

test('L1 advisory: skipped when there is no element add, or the add is a reuse', async () => {
  // GIVEN a reuse add and a non-add mutation
  const journey = { query: async () => { throw new Error('must not be called'); } };
  // WHEN the advisory is built
  const reused = await buildSemanticDedupAdvisory(
    context(baseDocument()),
    [addWidgetMutation({ onConflict: 'reuse' })],
    { semanticOperatorJourney: journey },
  );
  const nonAdd = await buildSemanticDedupAdvisory(
    context(baseDocument()),
    [{ type: 'updateElement', id: 'w1', patch: { description: 'x' } }],
    { semanticOperatorJourney: journey },
  );
  // THEN it is a no-op (undefined) and the journey is never queried
  assert.equal(reused, undefined);
  assert.equal(nonAdd, undefined);
});

test('L1 advisory: threshold is configurable via environment', async () => {
  // GIVEN a lowered threshold
  const previous = process.env.ARGO_SEMANTIC_DEDUP_THRESHOLD;
  process.env.ARGO_SEMANTIC_DEDUP_THRESHOLD = '0.4';
  try {
    const document = baseDocument();
    const journey = {
      query: async () => ({ result: { elements: [{ ...document.elements[0], semanticScore: 0.5 }] } }),
    };
    // WHEN the advisory is built
    const advisory = await buildSemanticDedupAdvisory(
      context(document),
      [addWidgetMutation()],
      { semanticOperatorJourney: journey },
    );
    // THEN the env threshold is honored
    assert.equal(advisory.threshold, 0.4);
    assert.deepEqual(advisory.candidates[0].matches.map(match => match.id), ['w1']);
  } finally {
    if (previous === undefined) {
      delete process.env.ARGO_SEMANTIC_DEDUP_THRESHOLD;
    } else {
      process.env.ARGO_SEMANTIC_DEDUP_THRESHOLD = previous;
    }
  }
});
