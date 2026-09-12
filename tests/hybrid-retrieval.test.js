'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_RRF_K,
  DEFAULT_HYBRID_TOP_K,
  isHybridEnabled,
  hybridTopK,
  rrfK,
  rrfFuse,
  fuseChannelSeeds,
  sanitizeFulltextQuery,
} = require('../argo/scripts/graph-rag/hybridRetrieval.js');

// AT-hybrid-01: hybrid is OFF by default (zero behavior change) and gated by env.
test('AT-hybrid-01: hybrid switch defaults OFF (env-gated, kill switch)', () => {
  assert.equal(isHybridEnabled({}), false, 'default must be OFF');
  assert.equal(isHybridEnabled({ ARGO_SEMANTIC_HYBRID: '0' }), false);
  assert.equal(isHybridEnabled({ ARGO_SEMANTIC_HYBRID: '1' }), true);
  assert.equal(hybridTopK({}), DEFAULT_HYBRID_TOP_K);
  assert.equal(hybridTopK({ ARGO_SEMANTIC_HYBRID_TOP_K: '30' }), 30);
  assert.equal(rrfK({}), DEFAULT_RRF_K);
  assert.equal(rrfK({ ARGO_SEMANTIC_HYBRID_RRF_K: '10' }), 10);
});

// AT-hybrid-02: RRF fuses two ranked lists by id, boosting items seen in both.
test('AT-hybrid-02: rrfFuse keeps the union and boosts cross-list items', () => {
  const vector = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.8 }, { id: 'c', score: 0.7 }];
  const lexical = [{ id: 'c', score: 7.0 }, { id: 'a', score: 5.0 }, { id: 'd', score: 4.0 }];
  const fused = rrfFuse([vector, lexical], { k: 60 });

  // union retained (recall can only increase)
  assert.deepEqual(fused.map(x => x.id).sort(), ['a', 'b', 'c', 'd']);
  // items present in BOTH lists get matchedLists=2 and outrank the single-list item 'd'
  const a = fused.find(x => x.id === 'a');
  const d = fused.find(x => x.id === 'd');
  assert.equal(a.matchedLists, 2);
  assert.equal(d.matchedLists, 1);
  assert.ok(a.score > d.score, 'cross-list item must outrank a single-list-only item');
  // single-list fusion preserves order
  assert.deepEqual(rrfFuse([vector], { k: 60 }).map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(rrfFuse([], { k: 60 }), []);
});

// AT-hybrid-03: fuseChannelSeeds never drops a vector seed (recall non-decreasing)
// and with no lexical hits behaves like the vector list.
test('AT-hybrid-03: fused seeds are a superset of the vector seeds', () => {
  const vectorSeeds = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.8 }];
  const lexicalSeeds = [{ id: 'c', score: 3.1 }, { id: 'a', score: 2.2 }];
  const fused = fuseChannelSeeds({ vectorSeeds, lexicalSeeds, k: 60, limit: 20 });
  for (const v of vectorSeeds) assert.ok(fused.some(f => f.id === v.id), `vector seed ${v.id} must remain`);
  assert.ok(fused.some(f => f.id === 'c'), 'lexical-only seed must be added');

  const vectorOnlyOrder = fuseChannelSeeds({ vectorSeeds, lexicalSeeds: [], k: 60, limit: 20 });
  assert.deepEqual(vectorOnlyOrder.map(f => f.id), ['a', 'b']);
});

// AT-hybrid-04: the production retrieval only calls the lexical path when the
// switch is on (parity guard for the default-OFF release).
test('AT-hybrid-04: production retrieval gates the lexical path behind the switch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'argo/scripts/graph-rag/defaultSemanticRetrieval.js'), 'utf8');
  assert.match(src, /const hybrid = isHybridEnabled\(\)/, 'must read the switch once per retrieval');
  assert.match(src, /if \(hybrid\) \{/, 'lexical retrieval must be gated by the switch');
  assert.match(src, /exhaustLexicalChannel/, 'lexical channel retrieval must exist');
  assert.match(src, /kind: 'semantic-lexical-query'/, 'lexical query must use the full-text index path');
});

// AT-hybrid-05: raw punctuation (names/statements) must be escaped before it
// reaches the Lucene full-text parser.
test('AT-hybrid-05: sanitizeFulltextQuery escapes reserved Lucene characters', () => {
  assert.equal(sanitizeFulltextQuery(''), '');
  assert.equal(sanitizeFulltextQuery('   '), '');
  assert.equal(sanitizeFulltextQuery('hello world'), 'hello world');
  const escaped = sanitizeFulltextQuery('A --(Flow)--> B');
  assert.ok(escaped.includes('\\('), 'parentheses must be escaped');
  assert.ok(escaped.includes('\\)'), 'parentheses must be escaped');
  assert.ok(escaped.includes('\\-'), 'dashes must be escaped');
});
