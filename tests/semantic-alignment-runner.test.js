'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isSemanticReady,
  readinessRecordPath,
} = require('../argo/scripts/graph-rag/semanticAlignmentRunner.js');

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
