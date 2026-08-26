'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createProductionSemanticBackfill,
} = require('../argo/scripts/graph-rag/semantic-persistence/productionSemanticBackfill.js');

// External-view acceptance tests for the full semantic backfill reconciliation:
// after `argo init` runs the semantic lifecycle, the Neo4j semantic projection
// must match the local JSON snapshot exactly — stale records whose canonical
// identity no longer exists in the JSON are tombstoned, valid records survive.

const QUALIFICATION = Object.freeze({
  approvedByHuman: true,
  provider: 'test-provider',
  model: 'test-model',
  version: 'qualification-test',
  dimensions: 4,
});

const CONFIG = Object.freeze({
  neo4jDatabaseUrl: 'neo4j://localhost:7687',
  neo4jDatabaseUsername: 'neo4j',
  neo4jDatabasePassword: 'secret',
  embeddingCredential: 'test-credential',
});

const VECTOR = Object.freeze([0.1, 0.2, 0.3, 0.4]);

function createInMemoryStore(initial = []) {
  const records = new Map();
  for (const r of initial) records.set(r.canonicalIdentity, { ...r });
  const calls = { upserts: 0, tombstones: 0, tombstonesList: [] };
  return {
    calls,
    records,
    async upsertRecords(recordsToWrite) {
      calls.upserts += recordsToWrite.length;
      for (const r of recordsToWrite) records.set(r.canonicalIdentity, { ...r });
      return { count: recordsToWrite.length };
    },
    async deleteTombstones(tombstones) {
      calls.tombstones += tombstones.length;
      calls.tombstonesList.push(...tombstones.map(t => t.canonicalIdentity));
      for (const t of tombstones) records.delete(t.canonicalIdentity);
      return { count: tombstones.length };
    },
    async readRecords() {
      return [...records.values()];
    },
  };
}

function createCheckpointStore() {
  const checkpoints = new Map();
  return {
    async readCheckpoint(channel) {
      const cp = checkpoints.get(channel);
      return cp ? JSON.parse(JSON.stringify(cp)) : null;
    },
    async writeCheckpoint(checkpoint) {
      checkpoints.set(checkpoint.channel, JSON.parse(JSON.stringify(checkpoint)));
      return { channel: checkpoint.channel };
    },
  };
}

function embedResult(records) {
  return {
    vectors: records.map(r => ({ canonicalIdentity: r.canonicalIdentity, vector: [...VECTOR] })),
    failures: [],
  };
}

function makeBackfill({ elements, relationships = [], views = [], store }) {
  const canonicalSource = {
    async readSnapshot() {
      return { version: 'v1', elements, relationships, views };
    },
  };
  const structuralProjection = {
    async requireComplete() {
      return { status: 'complete', canonicalVersion: 'v1' };
    },
  };
  const embeddingProvider = {
    async embedBatch(batch) {
      return embedResult(batch);
    },
  };
  const checkpointStore = createCheckpointStore();
  const backfill = createProductionSemanticBackfill({
    canonicalSource,
    structuralProjection,
    embeddingProvider,
    projectionStore: store,
    checkpointStore,
    configuration: CONFIG,
    qualification: QUALIFICATION,
    batchSize: 2,
  });
  return { backfill, store };
}

function record(identity, channel) {
  return {
    canonicalIdentity: identity,
    channel,
    canonicalVersion: 'v1',
    contentVersion: 'content:abc',
    indexVersion: 'index:abc',
    provider: QUALIFICATION.provider,
    model: QUALIFICATION.model,
    modelVersion: QUALIFICATION.version,
    dimensions: QUALIFICATION.dimensions,
    vector: [...VECTOR],
  };
}

test('AT semantic backfill reconciles removals: stale records are tombstoned', async () => {
  // GIVEN the canonical snapshot contains only element e1
  //   AND the projection store still holds a stale record Element:stale1
  const store = createInMemoryStore([
    record('Element:e1', 'Element'),
    record('Element:stale1', 'Element'),
  ]);
  const { backfill } = makeBackfill({ elements: [{ id: 'e1', name: 'one' }], store });

  // WHEN the semantic backfill runs to completion
  const result = await backfill.execute({ explicitOptIn: true });

  // THEN the stale record is tombstoned and the store matches the snapshot
  assert.equal(result.status, 'passed');
  assert.ok(store.calls.tombstonesList.includes('Element:stale1'), 'stale record must be tombstoned');
  assert.ok(!store.records.has('Element:stale1'), 'stale record must be deleted');
  assert.ok(store.records.has('Element:e1'), 'current record must survive');
  assert.equal(store.records.size, 1);
});

test('AT semantic backfill keeps valid records and issues no tombstones when nothing is stale', async () => {
  // GIVEN every record in the store still exists in the snapshot
  const store = createInMemoryStore([
    record('Element:e1', 'Element'),
    record('ArchitectureRelationship:r1', 'ArchitectureRelationship'),
    record('View:v1', 'View'),
  ]);
  const { backfill } = makeBackfill({
    elements: [{ id: 'e1', name: 'one' }],
    relationships: [{ id: 'r1', name: 'rel' }],
    views: [{ view_id: 'v1', view_name: 'view' }],
    store,
  });

  // WHEN the backfill runs
  const result = await backfill.execute({ explicitOptIn: true });

  // THEN no tombstone is issued and all records remain
  assert.equal(result.status, 'passed');
  assert.equal(store.calls.tombstones, 0, 'no tombstones when the store is consistent');
  assert.equal(store.records.size, 3);
});

test('AT semantic backfill removes only stale records in a mixed store', async () => {
  // GIVEN a store holding two current records and one stale record
  const store = createInMemoryStore([
    record('Element:e1', 'Element'),
    record('Element:e2', 'Element'),
    record('Element:gone1', 'Element'),
  ]);
  const { backfill } = makeBackfill({ elements: [{ id: 'e1' }, { id: 'e2' }], store });

  // WHEN the backfill runs
  const result = await backfill.execute({ explicitOptIn: true });

  // THEN only the stale record is deleted
  assert.equal(result.status, 'passed');
  assert.equal(store.calls.tombstones, 1);
  assert.equal(store.calls.tombstonesList[0], 'Element:gone1');
  assert.deepEqual([...store.records.keys()].sort(), ['Element:e1', 'Element:e2']);
});
