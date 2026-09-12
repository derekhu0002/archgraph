'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createProductionSemanticNeo4jAdapter,
} = require('../argo/scripts/graph-rag/semantic-persistence/productionSemanticNeo4jAdapter.js');

function fakeSession() {
  const calls = [];
  return {
    calls,
    async run(cypher, parameters) { calls.push({ cypher, parameters }); return { records: [] }; },
    async close() {},
  };
}

// AT-searchtext-01: the semantic projection is extended ADDITIVELY so the future
// lexical (BM25) retrieval has a searchable text field — without touching the
// existing vector index or record contract.
test('AT-searchtext-01: upsert ensures vector AND fulltext indexes and persists searchText', async () => {
  const session = fakeSession();
  const driver = { session() { return session; } };
  const adapter = createProductionSemanticNeo4jAdapter({ driver, configuration: {} });

  await adapter.upsertRecords([{
    canonicalIdentity: 'Element:x',
    channel: 'Element',
    vector: [0.1, 0.2],
    searchText: 'hello world',
    provider: 'p',
    model: 'm',
  }]);

  const cyphers = session.calls.map(call => call.cypher).join('\n');
  assert.match(cyphers, /CREATE VECTOR INDEX/, 'the existing vector index must still be ensured');
  assert.match(cyphers, /CREATE FULLTEXT INDEX/, 'a full-text index must be ensured');
  assert.match(cyphers, /ON EACH \[semantic\.searchText\]/, 'the full-text index must target searchText');

  const upsert = session.calls.find(call => /SET semantic = record/.test(call.cypher));
  assert.ok(upsert, 'the record upsert must run');
  assert.equal(upsert.parameters.records[0].searchText, 'hello world', 'searchText must be persisted');
});

// AT-searchtext-02: both embedding paths persist searchText (source guard).
test('AT-searchtext-02: backfill and incremental lifecycle both persist searchText', () => {
  const root = path.join(__dirname, '..');
  const backfill = fs.readFileSync(path.join(root, 'argo/scripts/graph-rag/semantic-persistence/productionSemanticBackfill.js'), 'utf8');
  assert.match(backfill, /searchText,/, 'backfill record must carry searchText');
  const lifecycle = fs.readFileSync(path.join(root, 'argo/scripts/graph-rag/mutationEmbeddingVectorLifecycle.js'), 'utf8');
  assert.match(lifecycle, /searchText: content,/, 'incremental lifecycle must carry searchText');
});
