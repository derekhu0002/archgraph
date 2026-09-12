'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSemanticDedupAdvisory,
  selectCreatedElementAdds,
  evaluateSemanticDedupGate,
} = require('../argo/scripts/systemarchitecture-mcp-server.js');

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
test('semantic candidates: whole graph, same type, above threshold, large window', async () => {
  // GIVEN a new Application Component is about to be added
  const document = baseDocument();
  let seenTopK;
  let seenRerank;
  const journey = {
    query: async (request) => {
      seenTopK = request.topK;
      seenRerank = request.rerank;
      return {
        result: {
          elements: [
            { ...document.elements[0], semanticScore: 0.93 }, // same type (in v1)
            { ...document.elements[1], semanticScore: 0.90 }, // same type (in another view)
            { ...document.elements[2], semanticScore: 0.95 }, // different type
          ],
        },
      };
    },
  };
  // WHEN candidates are built
  const advisory = await buildSemanticDedupAdvisory(
    context(document),
    [addWidgetMutation()],
    { semanticOperatorJourney: journey },
  );
  // THEN same-type matches from anywhere in the graph are returned (no view filter)
  assert.equal(advisory.status, 'passed');
  assert.equal(advisory.threshold, 0.85);
  assert.equal(advisory.scope, 'whole graph, same type');
  assert.equal(advisory.has_suggestions, true);
  assert.deepEqual(advisory.candidates[0].matches.map(match => match.id), ['w1', 'w2']);
  assert.equal(advisory.candidates[0].matches.find(m => m.id === 'w1').in_target_views, true);
  assert.equal(advisory.candidates[0].matches.find(m => m.id === 'w2').in_target_views, false);
  assert.ok(Number.isInteger(seenTopK) && seenTopK >= 8, 'gate must request a large candidate window');
  assert.equal(seenRerank, false, 'write-path dedup advisory must disable rerank (latency; ordering is irrelevant to the gate)');
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

test('semantic candidates: below-threshold and different-type candidates are filtered out', async () => {
  // GIVEN only a low-score same-type neighbour and a high-score different-type neighbour
  const document = baseDocument();
  const journey = {
    query: async () => ({
      result: {
        elements: [
          { ...document.elements[0], semanticScore: 0.50 }, // below threshold
          { ...document.elements[2], semanticScore: 0.99 }, // different type
        ],
      },
    }),
  };
  // WHEN candidates are built
  const advisory = await buildSemanticDedupAdvisory(
    context(document),
    [addWidgetMutation()],
    { semanticOperatorJourney: journey },
  );
  // THEN no suggestions are produced
  assert.equal(advisory.has_suggestions, false);
  assert.deepEqual(advisory.candidates[0].matches, []);
});

// AT-dedup-L1-03: real Neo4j evidence carries channel-prefixed ids. The gate's
// rank-derived score (0.80..0.99) is attached to the closure element, while the
// fused seed (RRF) shares the same prefixed identity. The rank-derived score
// must win for the SAME element, otherwise every real dedup score collapses to
// the tiny RRF score and the 0.85 gate never fires.
test('AT-dedup-L1-03: prefixed evidence id surfaces the rank-derived score', async () => {
  // GIVEN a fused seed (RRF 0.05) and a semantic closure element (rank-derived 0.99)
  // that share the real channel-prefixed identity "Element:w1"
  const document = baseDocument();
  const journey = {
    query: async () => ({
      seedsByType: {
        elements: [{ id: 'Element:w1', canonicalIdentity: 'Element:w1', score: 0.05, rrfScore: 0.05, matchedLists: 2 }],
      },
      closure: {
        elements: [{ id: 'Element:w1', firstInclusionReason: 'semantic-seed', semanticScore: 0.99 }],
      },
    }),
  };
  // WHEN candidates are built
  const advisory = await buildSemanticDedupAdvisory(
    context(document),
    [addWidgetMutation()],
    { semanticOperatorJourney: journey },
  );
  // THEN the bare canonical element w1 is surfaced with the rank-derived score
  assert.equal(advisory.has_suggestions, true, 'the rank-derived score must reach the gate');
  assert.deepEqual(advisory.candidates[0].matches.map(match => match.id), ['w1']);
  assert.equal(advisory.candidates[0].matches[0].score, 0.99);
});

test('semantic gate: a created element is blocked unless allowDuplicate overrides it', () => {
  const advisory = {
    status: 'passed',
    candidates: [
      { requested: { id: 'n1', name: 'Widget Prime', type: 'Application Component' }, matches: [{ id: 'w1' }] },
    ],
  };
  // default (reuse) is blocked
  const blocked = evaluateSemanticDedupGate(advisory, [
    { type: 'addElement', element: { id: 'n1' }, view_ids: ['v1'] },
  ]);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.conflicts.length, 1);
  // allowDuplicate overrides
  const overridden = evaluateSemanticDedupGate(advisory, [
    { type: 'addElement', element: { id: 'n1' }, onConflict: 'allowDuplicate', justification: 'distinct' },
  ]);
  assert.equal(overridden.blocked, false);
  // no matches -> not blocked
  const noMatches = evaluateSemanticDedupGate(
    { status: 'passed', candidates: [{ requested: { id: 'n1' }, matches: [] }] },
    [{ type: 'addElement', element: { id: 'n1' } }],
  );
  assert.equal(noMatches.blocked, false);
});

test('L1 advisory: skipped when there is no element add', async () => {
  // GIVEN a non-add mutation
  const journey = { query: async () => { throw new Error('must not be called'); } };
  // WHEN the advisory is built
  const nonAdd = await buildSemanticDedupAdvisory(
    context(baseDocument()),
    [{ type: 'updateElement', id: 'w1', patch: { description: 'x' } }],
    { semanticOperatorJourney: journey },
  );
  // THEN it is a no-op (undefined) and the journey is never queried
  assert.equal(nonAdd, undefined);
});

test('L1 advisory selection: by what was actually created, not by the onConflict parameter', () => {
  // GIVEN three element adds: an exact-key reuse (created nothing), a reuse that
  // fell through to creation, and a plain create
  const mutations = [
    { type: 'addElement', element: { id: 'new-a', name: 'A', type: 'Application Component' }, onConflict: 'reuse' },
    { type: 'addElement', element: { id: 'new-b', name: 'B', type: 'Application Component' }, onConflict: 'reuse' },
    { type: 'addElement', element: { id: 'new-c', name: 'C', type: 'Application Component' } },
  ];
  const summaries = [
    { type: 'addElement', id: 'existing-w1', created: false, reused: true, reusedId: 'existing-w1' },
    { type: 'addElement', id: 'new-b', created: true },
    { type: 'addElement', id: 'new-c', created: true },
  ];
  // WHEN the created adds are selected
  const selected = selectCreatedElementAdds(mutations, summaries).map(m => m.element.id);
  // THEN only the actually-created adds remain (the reuse-that-reused is dropped)
  assert.deepEqual(selected, ['new-b', 'new-c']);
});

test('L1 advisory: onConflict reuse is no longer special-cased in the advisory filter', () => {
  const server = fs.readFileSync(
    path.join(__dirname, '..', 'argo', 'scripts', 'systemarchitecture-mcp-server.js'),
    'utf8',
  );
  assert.doesNotMatch(server, /mutation\.onConflict !== 'reuse'/);
  assert.match(server, /selectCreatedElementAdds\(mutations, mutationResult\.mutationSummaries\)/);
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
