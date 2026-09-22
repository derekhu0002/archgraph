'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  exhaustChannel,
  exhaustLexicalChannel,
} = require('../argo/scripts/graph-rag/defaultSemanticRetrieval.js');

const ELEMENT_CHANNEL = {
  channel: 'Element',
  objectType: 'Element',
  indexName: 'argo_production_semantic_element_vector',
};

const VECTOR_LENGTH = 1536;

function makeVector(seed) {
  const vector = new Array(VECTOR_LENGTH);
  for (let i = 0; i < VECTOR_LENGTH; i += 1) vector[i] = ((seed + i) % 97) / 97;
  return vector;
}

// A Cypher query is projected through the explicit metadata allowlist ONLY when
// it neither ships the whole node map nor touches node.vector.
function isAllowlistCypher(cypher) {
  const text = String(cypher);
  return !/properties\(\s*node\s*\)/.test(text) && !/node\.vector/.test(text);
}

function stripHeavyFields(record) {
  const { vector, content, ...rest } = record;
  return rest;
}

// JSON.stringify of an array of records = "[" + joined records + "]": exact byte
// length is 2 + sum(recordJsonLength) + (recordCount - 1). Precomputed prefix
// sums keep payload measurement O(1) per window (so a 20000-record scan stays
// fast) while still reporting the exact JSON.stringify(payload).length.
function arrayJsonLength(prefix, count) {
  if (count <= 0) return 2;
  return 2 + prefix[count] + (count - 1);
}

function buildViewCache() {
  const rawCache = new WeakMap();
  const strippedCache = new WeakMap();
  function viewFor(list, stripped) {
    const cache = stripped ? strippedCache : rawCache;
    let view = cache.get(list);
    if (!view) {
      const records = stripped ? list.map(stripHeavyFields) : list;
      const prefix = new Array(records.length + 1).fill(0);
      for (let i = 0; i < records.length; i += 1) {
        prefix[i + 1] = prefix[i] + JSON.stringify(records[i]).length;
      }
      view = { records, prefix };
      cache.set(list, view);
    }
    return view;
  }
  return viewFor;
}

// Fake Neo4j driver emulating the production window contract:
//   - records the returned cypher/kind for every operation;
//   - returns the first `topK` records of a fixed channel-keyed list, filtered by
//     `parameters.canonicalIdentities` when present;
//   - computes windowEvidence exactly like runOperationOnSession;
//   - tracks the max serialized single-window payload;
//   - strips vector/content ONLY when the cypher is the allowlist form, so a
//     revert to properties(node) re-materializes the 1536-dim vector and fails.
function createFakeDriver(channelLists) {
  const operations = [];
  const viewFor = buildViewCache();
  let maxWindowPayloadBytes = 0;
  let sawVectorOnReturnedRecord = false;
  return {
    operations,
    get maxWindowPayloadBytes() {
      return maxWindowPayloadBytes;
    },
    get sawVectorOnReturnedRecord() {
      return sawVectorOnReturnedRecord;
    },
    async execute(operation) {
      operations.push({ kind: operation.kind, cypher: operation.cypher });
      const parameters = operation.parameters || {};
      const list = channelLists[parameters.channel] || [];
      const topK = Number.isInteger(parameters.topK) ? parameters.topK : list.length;
      const allowlist = isAllowlistCypher(operation.cypher);
      const scoped = Array.isArray(parameters.canonicalIdentities)
        && parameters.canonicalIdentities.length > 0;

      let page;
      let payloadLength;
      if (!scoped) {
        const view = viewFor(list, allowlist);
        const count = Math.min(topK, view.records.length);
        page = view.records.slice(0, count);
        payloadLength = arrayJsonLength(view.prefix, count);
      } else {
        const allowed = new Set(parameters.canonicalIdentities);
        let filtered = list.filter(record => allowed.has(record.canonicalIdentity));
        if (allowlist) filtered = filtered.map(stripHeavyFields);
        page = filtered.slice(0, topK);
        payloadLength = JSON.stringify(page).length;
      }

      for (const record of page) {
        if (Array.isArray(record.vector)) sawVectorOnReturnedRecord = true;
      }
      if (payloadLength > maxWindowPayloadBytes) maxWindowPayloadBytes = payloadLength;

      if (operation.kind === 'semantic-lexical-query') {
        return { records: page };
      }
      const offset = parameters.offset;
      const windowSize = parameters.windowSize;
      const returnedCount = Math.max(0, page.length - offset);
      const hasMore = page.length === topK;
      return {
        records: page,
        windowEvidence: {
          offset,
          windowSize,
          returnedCount,
          hasMore,
          nextOffset: hasMore ? topK : null,
          windowExhausted: !hasMore,
        },
      };
    },
  };
}

function buildScoredList({ heavy }) {
  const scores = [0.95, 0.90, 0.82, 0.78, 0.70, 0.65];
  return scores.map((score, index) => {
    const record = { canonicalIdentity: `Element:e${index + 1}`, score };
    if (heavy) {
      record.vector = makeVector(index + 1);
      record.content = 'x'.repeat(256);
    }
    return record;
  });
}

test('AT semantic retrieval vector projection AC-1/AC-2: explicit allowlist projection excludes vector (vector + lexical cypher)', async () => {
  // GIVEN an Element channel whose stored records carry a 1536-dim vector + content
  const driver = createFakeDriver({
    Element: [{ canonicalIdentity: 'Element:e1', score: 0.95, vector: makeVector(1), content: 'c1' }],
  });

  // WHEN the vector channel is exhausted
  await exhaustChannel({
    channel: ELEMENT_CHANNEL,
    neo4jDriver: driver,
    vector: makeVector(9),
    threshold: 0.5,
    maxSeeds: 1,
  });
  // AND the lexical channel is exhausted with a non-blank query
  await exhaustLexicalChannel({
    channel: ELEMENT_CHANNEL,
    neo4jDriver: driver,
    queryText: 'hello world',
    maxSeeds: 3,
  });

  // THEN the actual captured vector + lexical cyphers project the allowlist only
  const vectorCypher = driver.operations.find(o => o.kind === 'semantic-vector-window-query').cypher;
  const lexicalCypher = driver.operations.find(o => o.kind === 'semantic-lexical-query').cypher;
  for (const cypher of [vectorCypher, lexicalCypher]) {
    assert.equal(/properties\(\s*node\s*\)/.test(cypher), false, 'properties(node) must not be returned');
    assert.equal(/node\.vector/.test(cypher), false, 'node.vector must not be referenced');
    assert.ok(cypher.includes('canonicalIdentity: node.canonicalIdentity'), 'canonicalIdentity must be projected');
    assert.ok(cypher.includes('searchText: node.searchText'), 'searchText must be projected');
  }
  // AND (vector) no `, vector` property entry is returned
  assert.equal(vectorCypher.includes(', vector'), false, 'the vector property must not appear in the projection');
});

test('AT semantic retrieval vector projection AC-3: accepted (id, score) sequence is identical with and without heavy vector/content fields', async () => {
  // GIVEN a fixed sorted record list in TWO flavors: heavy (vector 1536 + content) and clean
  async function accepted(options, heavy) {
    const driver = createFakeDriver({ Element: buildScoredList({ heavy }) });
    const seeds = await exhaustChannel({
      channel: ELEMENT_CHANNEL,
      neo4jDriver: driver,
      vector: makeVector(0),
      threshold: 0.85,
      maxSeeds: 5,
      ...options,
    });
    return seeds.map(seed => [seed.id, seed.score]);
  }

  // WHEN exhaustChannel runs unscoped
  const heavyUnscoped = await accepted({}, true);
  const cleanUnscoped = await accepted({}, false);
  // THEN the accepted (id, score) sequence is identical across both flavors
  assert.deepEqual(heavyUnscoped, cleanUnscoped);
  assert.deepEqual(heavyUnscoped, [['e1', 0.95], ['e2', 0.90]]);

  // AND WHEN exhaustChannel runs scoped
  const scope = { canonicalIdentities: ['Element:e2', 'Element:e4', 'Element:e6'] };
  const heavyScoped = await accepted(scope, true);
  const cleanScoped = await accepted(scope, false);
  // THEN the accepted (id, score) sequence is again identical across both flavors
  assert.deepEqual(heavyScoped, cleanScoped);
  assert.deepEqual(heavyScoped, [['e2', 0.90]]);
});

test('AT semantic retrieval vector projection AC-4: single-window payload stays bounded over 20000 records (no vector materialized)', async () => {
  // GIVEN 20000 logical records each carrying a 1536-dim vector (ONE shared vector
  // reference, never deep-cloned) all below the seed threshold so the scan runs to
  // the end (maxSeeds: 1 never satisfied)
  const sharedVector = makeVector(1);
  const records = [];
  for (let i = 0; i < 20000; i += 1) {
    records.push({ canonicalIdentity: `Element:e${i}`, score: 0.5, vector: sharedVector });
  }
  const driver = createFakeDriver({ Element: records });

  // WHEN exhaustChannel scans every window
  await exhaustChannel({
    channel: ELEMENT_CHANNEL,
    neo4jDriver: driver,
    vector: makeVector(2),
    threshold: 0.85,
    maxSeeds: 1,
  });

  // THEN no record the driver returned carries the vector array
  assert.equal(driver.sawVectorOnReturnedRecord, false, 'the projection must strip the vector before returning');
  // AND the max serialized single-window payload stays bounded (no vector materialized)
  const measured = driver.maxWindowPayloadBytes;
  console.log(`AC-4 max single-window payload bytes: ${measured}`);
  assert.ok(measured > 0, 'at least one window payload must be measured');
  assert.ok(measured < 20000 * 1024, `window payload ${measured} must stay below 20480000 bytes`);
});
