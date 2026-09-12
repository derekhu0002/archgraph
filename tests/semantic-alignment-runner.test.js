'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isSemanticReady,
  isProjectInitialized,
  readinessRecordPath,
} = require('../argo/scripts/graph-rag/semanticAlignmentRunner.js');
const {
  withAlignmentLock,
  alignmentLockPath,
} = require('../argo/scripts/graph-rag/semanticAlignmentLock.js');

const ROOT = path.resolve(__dirname, '..');

// AT-align-01: the preheat decision is driven by the durable readiness record —
// missing/Stale = needs rebuild, Aligned+verified = no-op.
test('AT-align-01: isSemanticReady reflects the durable readiness record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-align-'));
  try {
    assert.equal(isSemanticReady(dir), false, 'missing record must mean not ready');
    const record = readinessRecordPath(dir);
    fs.mkdirSync(path.dirname(record), { recursive: true });
    fs.writeFileSync(record, JSON.stringify({ state: 'Aligned', verified: true }), 'utf8');
    assert.equal(isSemanticReady(dir), true, 'Aligned+verified must be ready');
    fs.writeFileSync(record, JSON.stringify({ state: 'Stale', verified: true }), 'utf8');
    assert.equal(isSemanticReady(dir), false, 'Stale must not be ready');
    fs.writeFileSync(record, JSON.stringify({ state: 'Aligned', verified: false }), 'utf8');
    assert.equal(isSemanticReady(dir), false, 'unverified must not be ready');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AT-align-02: the alignment must run ASYNC (never spawnSync, which freezes the
// whole MCP event loop), the query path must delegate to the runner, and the
// server must preheat it in the background at startup.
test('AT-align-02: alignment is async + de-duplicated and preheated at startup', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/semanticAlignmentRunner.js'), 'utf8');
  assert.match(runner, /spawn\(process\.execPath/, 'must use async child_process.spawn');
  assert.doesNotMatch(runner, /spawnSync\(/, 'must NOT use spawnSync (would freeze the MCP)');
  assert.match(runner, /if \(inFlight\)/, 'concurrent rebuilds must be de-duplicated');

  const retrieval = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/defaultSemanticRetrieval.js'), 'utf8');
  assert.match(retrieval, /runSemanticAlignment\(getWorkspaceRoot\(\)\)/, 'query path must delegate to the runner');
  assert.doesNotMatch(retrieval, /spawnSync\(process\.execPath, \[scriptPath\]/, 'query path must not spawnSync');

  const server = fs.readFileSync(path.join(ROOT, 'argo/scripts/argo-mcp-server.js'), 'utf8');
  assert.match(server, /preheatSemanticAlignment\(process\.env\.ARGO_REPO_ROOT\)/, 'server must preheat at startup');
});

// AT-align-03: the startup preheat must NEVER bootstrap a brand-new project --
// only reconcile an already-initialized workspace whose readiness went stale.
test('AT-align-03: preheat never bootstraps a brand-new project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-align-'));
  try {
    assert.equal(isProjectInitialized(dir), false, 'no canonical graph -> not initialized');
    fs.mkdirSync(path.join(dir, 'design', 'KG'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'design', 'KG', 'SystemArchitecture.json'), '{}');
    assert.equal(isProjectInitialized(dir), true, 'canonical graph present -> initialized');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const runner = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/semanticAlignmentRunner.js'), 'utf8');
  assert.match(runner, /!isProjectInitialized\(repositoryRoot\)/, 'preheat must guard on project initialization');
});

// AT-align-04: the heavy alignment is serialized by a cross-process lock (preheat
// vs query vs explicit argo init cannot rebuild concurrently), and a stale lock
// (crashed holder) is stolen.
test('AT-align-04: alignment lock serializes runs and steals stale locks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-lock-'));
  try {
    const order = [];
    await Promise.all([
      withAlignmentLock(dir, async () => { order.push('a-start'); await new Promise(r => setTimeout(r, 250)); order.push('a-end'); }),
      withAlignmentLock(dir, async () => { order.push('b'); }),
    ]);
    assert.deepEqual(order, ['a-start', 'a-end', 'b'], 'second acquisition must wait for the first to release');

    const lock = alignmentLockPath(dir);
    fs.writeFileSync(lock, 'stale');
    const old = Date.now() - 20 * 60 * 1000;
    fs.utimesSync(lock, new Date(old), new Date(old));
    const stolen = await withAlignmentLock(dir, async () => 'ok', { waitMs: 2000, staleMs: 60 * 1000 });
    assert.equal(stolen, 'ok', 'a stale lock must be stolen');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const harness = fs.readFileSync(path.join(ROOT, 'argo/scripts/ensureArgoHarnessEnvironment.js'), 'utf8');
  assert.match(harness, /withAlignmentLock\(workspaceRoot/, 'buildHarnessReport must serialize on the lock');
});
