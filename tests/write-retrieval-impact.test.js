'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  applyMutations,
  evaluateSemanticDedupGate,
} = require('../argo/scripts/systemarchitecture-mcp-server.js');
const {
  fuseChannelSeeds,
  DEFAULT_VECTOR_WEIGHT,
  DEFAULT_LEXICAL_WEIGHT,
  DEFAULT_HYBRID_TOP_K,
  DEFAULT_RRF_K,
} = require('../argo/scripts/graph-rag/hybridRetrieval.js');

const ROOT = path.resolve(__dirname, '..');

function baseDocument() {
  return {
    name: 'write-impact-test',
    description: 'write-impact-test',
    elements: [
      { id: 'p', name: 'Parent', type: 'Grouping' },
      { id: 'x1', name: 'Widget', type: 'Application Component' },
    ],
    relationships: [],
    views: [
      { view_id: 'v', view_name: 'V', parent_element_id: 'p', parent_element_name: 'Parent', included_elements: ['x1'], included_relationships: [] },
    ],
  };
}

function addDuplicate() {
  return applyMutations(baseDocument(), [
    { type: 'addElement', element: { id: 'x2', name: 'Widget', type: 'Application Component' }, view_ids: ['v'] },
  ]);
}

function withHybrid(value, fn) {
  const previous = process.env.ARGO_SEMANTIC_HYBRID;
  if (value === undefined) delete process.env.ARGO_SEMANTIC_HYBRID;
  else process.env.ARGO_SEMANTIC_HYBRID = value;
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.ARGO_SEMANTIC_HYBRID;
    else process.env.ARGO_SEMANTIC_HYBRID = previous;
  }
}

// AT-write-impact-01: L0 exact write dedup is deterministic and independent of
// the retrieval switch (writes never route through semantic retrieval for the
// exact natural-key check).
test('AT-write-impact-01: exact write dedup is identical with hybrid OFF and ON', () => {
  const off = withHybrid(undefined, addDuplicate);
  const on = withHybrid('1', addDuplicate);
  for (const result of [off, on]) {
    assert.equal(result.document.elements.some(e => e.id === 'x2'), false, 'no duplicate element created');
    const summary = result.mutationSummaries.find(s => s.type === 'addElement');
    assert.equal(summary.reused, true);
    assert.equal(summary.reusedId, 'x1');
    assert.equal(summary.created, false);
  }
  assert.deepEqual(on.mutationSummaries, off.mutationSummaries, 'hybrid must not change the exact-dedup outcome');
});

// AT-write-impact-02: hybrid RRF must never shrink the write gate's vector
// candidate set — every vector seed the OFF path would surface stays in the
// fused result (so enabling hybrid cannot make the semantic gate MISS a vector
// near-duplicate). Guaranteed by vector-dominant weighting at the default limit.
test('AT-write-impact-02: fused write-gate candidates retain every vector seed', () => {
  const vectorSeeds = Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, score: 1 - i * 0.01 }));
  const lexicalSeeds = Array.from({ length: 16 }, (_, i) => ({ id: `l${i}`, score: 100 - i }));
  const fused = fuseChannelSeeds({
    vectorSeeds,
    lexicalSeeds,
    k: DEFAULT_RRF_K,
    limit: DEFAULT_HYBRID_TOP_K,
    weights: [DEFAULT_VECTOR_WEIGHT, DEFAULT_LEXICAL_WEIGHT],
  });
  for (const seed of vectorSeeds) {
    assert.ok(fused.some(f => f.id === seed.id), `vector candidate ${seed.id} must remain in the fused set`);
  }
});

// AT-write-impact-03: the semantic gate decision depends only on the candidate
// matches + the caller's onConflict policy, not on the score scale — so a fused
// (RRF) candidate behaves exactly like a vector candidate.
test('AT-write-impact-03: gate decision is retrieval-flavor independent', () => {
  const advisory = {
    status: 'passed',
    candidates: [{
      requested: { id: 'n1', name: 'Widget Prime', type: 'Application Component' },
      // a fused candidate carries rrfScore/matchedLists; only `matches` matters to the gate
      matches: [{ id: 'x1', score: 0.99, rrfScore: 0.05, matchedLists: 2 }],
    }],
  };
  const blocked = evaluateSemanticDedupGate(advisory, [{ type: 'addElement', element: { id: 'n1' }, view_ids: ['v'] }]);
  assert.equal(blocked.blocked, true, 'default (reuse) must block on a semantic candidate');
  const overridden = evaluateSemanticDedupGate(advisory, [{ type: 'addElement', element: { id: 'n1' }, onConflict: 'allowDuplicate', justification: 'distinct' }]);
  assert.equal(overridden.blocked, false, 'allowDuplicate must override regardless of score scale');
  const noMatch = evaluateSemanticDedupGate({ status: 'passed', candidates: [{ requested: { id: 'n1' }, matches: [] }] }, [{ type: 'addElement', element: { id: 'n1' } }]);
  assert.equal(noMatch.blocked, false);
});

// AT-write-impact-04: the write gate's dedup score is rank-derived (0.80..0.99),
// not the raw similarity score — so hybrid re-orders candidates but never breaks
// the 0.85 threshold scale (source contract guard).
test('AT-write-impact-04: write-gate semanticScore is rank-derived, not raw similarity', () => {
  const runtime = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/productionGraphRagRuntime.js'), 'utf8');
  assert.match(runtime, /semanticScore: Math\.max\(0\.99 - \(index \* 0\.01\), 0\.8\)/, 'semantic seeds carry a rank-derived score');
  const server = fs.readFileSync(path.join(ROOT, 'argo/scripts/systemarchitecture-mcp-server.js'), 'utf8');
  assert.match(server, /candidate\.semanticScore >= threshold/, 'the gate compares the rank-derived score against the threshold');
});
