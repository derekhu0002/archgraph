'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  installCrashDiagnostics,
  markPhase,
  readLastPhase,
  crashLogFilePath,
} = require('../argo/scripts/graph-rag/mcpCrashDiagnostics.js');

const ROOT = path.resolve(__dirname, '..');

// AT-crash-01: a synchronous phase breadcrumb is always recoverable, even if a
// native abort never fires any JS handler.
test('AT-crash-01: phase breadcrumbs are persisted synchronously', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-crash-'));
  try {
    installCrashDiagnostics(dir);
    assert.ok(String(crashLogFilePath()).includes('mcp-crash.log'), 'crash log path is set');
    markPhase('mutation:qeaProjection');
    assert.equal(readLastPhase(dir), 'mutation:qeaProjection');
    markPhase('mutation:embeddingLifecycle');
    assert.equal(readLastPhase(dir), 'mutation:embeddingLifecycle');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AT-crash-02: the mutation/retrieval phases are marked, the server installs
// diagnostics, and the qea projection runs SYNCHRONOUSLY (no lingering async
// child handle racing the following fetch/neo4j work).
test('AT-crash-02: phases marked + synchronous qea projection + diagnostics installed', () => {
  const server = fs.readFileSync(path.join(ROOT, 'argo/scripts/systemarchitecture-mcp-server.js'), 'utf8');
  for (const phase of [
    'mutation:qeaProjection',
    'mutation:neo4jSync',
    'mutation:embeddingLifecycle',
    'mutation:done',
    'mutation:semanticDedup',
  ]) {
    assert.ok(server.includes(`markPhase('${phase}')`), `phase ${phase} must be marked`);
  }
  const qea = server.slice(server.indexOf('function runQeaProjection'), server.indexOf('function writeGraph'));
  assert.match(qea, /spawnSync\(process\.execPath/, 'qea projection must use synchronous spawnSync');
  assert.doesNotMatch(qea, /new Promise/, 'qea projection must not leave an async child handle');

  const retrieval = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/defaultSemanticRetrieval.js'), 'utf8');
  assert.ok(retrieval.includes("markPhase('retrieval:embed')"), 'retrieval embed phase must be marked');
  assert.ok(retrieval.includes("markPhase('retrieval:rerank')"), 'retrieval rerank phase must be marked');

  const argo = fs.readFileSync(path.join(ROOT, 'argo/scripts/argo-mcp-server.js'), 'utf8');
  assert.ok(argo.includes('installCrashDiagnostics('), 'server must install crash diagnostics');
  assert.ok(argo.includes("markPhase('tool:' + name)"), 'tool entry phase must be marked');
});
