'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  digestCanonicalArchitecture,
  isNeo4jGraphSyncStale,
} = require('../argo/scripts/neo4j-system-architecture-store.js');

test('isNeo4jGraphSyncStale returns false when digest matches', () => {
  // GIVEN a sync state whose canonicalDigest equals the current file digest
  const syncState = { canonicalDigest: 'abc123', dirty: false, lastSuccessAt: '2026-01-01T00:00:00Z' };
  // WHEN staleness is evaluated with the matching digest
  // THEN it is not stale
  assert.equal(isNeo4jGraphSyncStale(syncState, 'abc123'), false);
});

test('isNeo4jGraphSyncStale returns true when digest differs', () => {
  // GIVEN a sync state whose canonicalDigest differs from the current digest
  const syncState = { canonicalDigest: 'abc123', dirty: false };
  // WHEN staleness is evaluated with a different digest
  // THEN it is stale, so the structural projection re-syncs
  assert.equal(isNeo4jGraphSyncStale(syncState, 'def456'), true);
});

test('isNeo4jGraphSyncStale triggers a backfill re-sync for legacy state without a digest', () => {
  // GIVEN a legacy sync state that has lastSuccessAt but no canonicalDigest
  const syncState = { dirty: false, lastSuccessAt: '2026-01-01T00:00:00Z' };
  // WHEN staleness is evaluated
  // THEN it is stale, so one re-sync seeds canonicalDigest and repairs drift
  assert.equal(isNeo4jGraphSyncStale(syncState, 'whatever'), true);
});

test('isNeo4jGraphSyncStale returns false for a fresh state with no digest and no lastSuccessAt', () => {
  // GIVEN a fresh sync state with neither canonicalDigest nor lastSuccessAt
  const syncState = { dirty: false };
  // WHEN staleness is evaluated
  // THEN it is not stale (initial sync is driven by harness init, not recovery)
  assert.equal(isNeo4jGraphSyncStale(syncState, 'whatever'), false);
});

test('isNeo4jGraphSyncStale returns false when the current digest is missing', () => {
  // GIVEN any sync state
  const syncState = { canonicalDigest: 'abc123' };
  // WHEN the current digest cannot be computed
  // THEN it is not stale (recovery must not fire on a missing file)
  assert.equal(isNeo4jGraphSyncStale(syncState, null), false);
});

test('digestCanonicalArchitecture reflects the canonical file content', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neo4j-digest-'));
  const previous = process.env.ARGO_REPO_ROOT;
  process.env.ARGO_REPO_ROOT = tempRoot;
  try {
    const kgDir = path.join(tempRoot, 'design', 'KG');
    fs.mkdirSync(kgDir, { recursive: true });
    const graphPath = path.join(kgDir, 'SystemArchitecture.json');

    // GIVEN a canonical graph document
    fs.writeFileSync(graphPath, JSON.stringify({ name: 'System', elements: [] }), 'utf8');
    const first = digestCanonicalArchitecture();

    // WHEN the document content changes
    fs.writeFileSync(graphPath, JSON.stringify({ name: 'System', elements: [{ id: '1' }] }), 'utf8');
    const second = digestCanonicalArchitecture();

    // THEN the digest changes, so drift is detectable
    assert.ok(typeof first === 'string' && first.length > 0);
    assert.notEqual(first, second);

    // GIVEN a missing canonical file
    fs.rmSync(graphPath, { force: true });
    // WHEN the digest is computed
    // THEN it returns null (no false staleness on a missing file)
    assert.equal(digestCanonicalArchitecture(), null);
  } finally {
    if (previous === undefined) delete process.env.ARGO_REPO_ROOT;
    else process.env.ARGO_REPO_ROOT = previous;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
