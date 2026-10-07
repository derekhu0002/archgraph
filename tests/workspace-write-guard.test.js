'use strict';

// Acceptance tests for the cross-project workspace WRITE guard.
//
// The per-call `workspaceRoot` override may READ another local project's graph,
// but a WRITE tool must only ever target the server's HOME workspace. These are
// GIVEN-WHEN-THEN functional tests through the real MCP server (external view):
//   - a foreign-workspace WRITE is denied and the foreign graph is untouched;
//   - a foreign-workspace READ still resolves (the guard never blocks reads).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  WRITE_TOOLS,
  isWriteTool,
  authorizeWorkspaceWrite,
} = require('../argo/scripts/workspace-write-guard.js');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js');
const REPO_GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const STABLE_ELEMENT = 'overseer-vision-001';

function makeDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedWorkspace(dir) {
  fs.mkdirSync(path.join(dir, 'design', 'KG'), { recursive: true });
  fs.copyFileSync(REPO_GRAPH, path.join(dir, 'design', 'KG', 'SystemArchitecture.json'));
}

// Run one tool call through the real stdio MCP server and return its decoded payload.
function callToolOnce(name, args, env) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'write-guard', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [SERVER], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 90000,
    killSignal: 'SIGKILL',
  });
  const responses = String(result.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
  const call = responses.find((r) => r && r.id === 2);
  assert.ok(call && call.result, `no tools/call response (status=${result.status}, err=${result.error && result.error.message})`);
  return JSON.parse(call.result.content[0].text);
}

test('AT workspace-write-guard: classifies write tools (dry-run is not a write)', () => {
  // GIVEN the set of mutating MCP tools
  assert.ok(WRITE_TOOLS.has('applySystemArchitectureMutation'));
  assert.ok(WRITE_TOOLS.has('addArchitectureElement'));
  assert.ok(WRITE_TOOLS.has('initializeWorkspace'));
  assert.ok(WRITE_TOOLS.has('runArchitectureTests'));
  // WHEN classified
  assert.equal(isWriteTool('addArchitectureElement', {}), true);
  assert.equal(isWriteTool('applySystemArchitectureMutation', {}), true);
  assert.equal(isWriteTool('initializeWorkspace', {}), true);
  // THEN a focused dry-run validates only and is not a write
  assert.equal(isWriteTool('addArchitectureElement', { dryRun: true }), false);
  // AND read tools are never writes
  assert.equal(isWriteTool('getSystemArchitecture', {}), false);
  assert.equal(isWriteTool('getIntentElementContext', {}), false);
  assert.equal(isWriteTool('getArchitectureViewContext', {}), false);
  assert.equal(isWriteTool('queryNeo4jGraph', {}), false);
  assert.equal(isWriteTool('memory_search', {}), false);
  assert.equal(isWriteTool('previewSystemArchitectureMutation', {}), false);
});

test('AT workspace-write-guard: authorizes only the home workspace', () => {
  // GIVEN a server bound to /home
  const home = path.resolve('/tmp/ws-home');
  // WHEN a write targets home (explicitly or implicitly)
  assert.equal(authorizeWorkspaceWrite({ tool: 'addArchitectureElement', args: {}, homeRoot: home }).allowed, true);
  assert.equal(authorizeWorkspaceWrite({ tool: 'addArchitectureElement', args: { workspaceRoot: home }, homeRoot: home }).allowed, true);
  // THEN a foreign target is denied fail-closed
  const foreign = authorizeWorkspaceWrite({ tool: 'addArchitectureElement', args: { workspaceRoot: '/tmp/ws-foreign' }, homeRoot: home });
  assert.equal(foreign.allowed, false);
  assert.equal(foreign.category, 'WORKSPACE_WRITE_DENIED');
  // AND an explicit opt-out disables the guard (trusted multi-workspace host)
  assert.equal(
    authorizeWorkspaceWrite({ tool: 'addArchitectureElement', args: { workspaceRoot: '/tmp/ws-foreign' }, homeRoot: home, env: { ARGO_WORKSPACE_WRITE_GUARD: '0' } }).allowed,
    true,
  );
});

test('AT workspace-write-guard: a write through the MCP server to a foreign workspace is denied and the target is untouched', () => {
  const tempRoot = makeDir('argo-write-guard-');
  try {
    const home = path.join(tempRoot, 'home');
    const foreign = path.join(tempRoot, 'foreign');
    fs.mkdirSync(home, { recursive: true });
    seedWorkspace(foreign);
    const foreignGraph = path.join(foreign, 'design', 'KG', 'SystemArchitecture.json');
    const before = fs.readFileSync(foreignGraph);
    const rootViewId = JSON.parse(before.toString('utf8')).views[0].view_id;

    // GIVEN an MCP server whose HOME workspace is `home`, and a real foreign graph
    // WHEN addArchitectureElement is asked to write into the foreign workspace
    const payload = callToolOnce(
      'addArchitectureElement',
      { element: { type: 'Requirement', name: 'Rogue Cross-Project Write' }, view_ids: [rootViewId], workspaceRoot: foreign },
      { ARGO_REPO_ROOT: home },
    );

    // THEN the write is refused with a clear category ...
    assert.equal(payload.status, 'failed');
    assert.equal(payload.error.category, 'WORKSPACE_WRITE_DENIED');
    assert.equal(payload.error.tool, 'addArchitectureElement');
    // AND the foreign workspace is byte-for-byte untouched
    assert.ok(fs.readFileSync(foreignGraph).equals(before), 'foreign graph must be unchanged');
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test('AT workspace-write-guard: a READ through the MCP server still resolves a foreign workspace', () => {
  const tempRoot = makeDir('argo-write-guard-read-');
  try {
    const home = path.join(tempRoot, 'home');
    const foreign = path.join(tempRoot, 'foreign');
    fs.mkdirSync(home, { recursive: true });
    seedWorkspace(foreign);

    // GIVEN an MCP server whose HOME workspace is `home`
    // WHEN a READ tool targets the foreign workspace
    const payload = callToolOnce(
      'getIntentElementContext',
      { elementId: STABLE_ELEMENT, workspaceRoot: foreign },
      { ARGO_REPO_ROOT: home },
    );

    // THEN the guard does not block it: the read resolves the foreign graph
    assert.notEqual(payload.error && payload.error.category, 'WORKSPACE_WRITE_DENIED');
    assert.equal(payload.status, 'passed');
    assert.equal(payload.focusElementId, STABLE_ELEMENT);
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
