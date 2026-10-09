'use strict';

// Acceptance tests for cross-project graph query (federation client side).
//
// A read tool with an optional `projectId` is routed to the federation center
// (`POST <centerUrl>/graph/read`); absent, the local workspace is used unchanged.
// The center is stubbed with a local HTTP server so the tests are hermetic.

const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  EXTERNAL_READ_TOOLS,
  loadFederationIdentity,
  externalQueryRequested,
  queryExternalRead,
} = require('../argo/scripts/external-graph-query.js');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js');

function makeWorkspace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'extq-')); }
function writeFederation(ws, centerUrl, projectId = 'archgraph') {
  fs.mkdirSync(path.join(ws, '.argo'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.argo', 'federation.json'), JSON.stringify({ projectId, sourceRepo: 'x', centerUrl, branch: 'main' }));
}

function startCenter(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(body); } catch { /* ignore */ }
        requests.push(parsed);
        const { status, payload } = handler(parsed);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function callToolOnce(name, args, env) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'extq', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  // Bounded: the server may keep a keep-alive socket open after an external fetch
  // and not exit on stdin EOF; accept a captured-but-complete response set.
  const result = spawnSync(process.execPath, [SERVER], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, input, maxBuffer: 32 * 1024 * 1024, timeout: 90000, killSignal: 'SIGKILL' });
  const responses = String(result.stdout || '').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const call = responses.find((r) => r && r.id === 2);
  assert.ok(call && call.result, `no tools/call response (status=${result.status}, err=${result.error && result.error.message})`);
  return JSON.parse(call.result.content[0].text);
}

// Async spawn so the parent event loop stays free to serve the mock center.
function callToolAsync(name, args, env) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'extq', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = ''; let stderr = ''; let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch { /* ignore */ } reject(new Error(`timeout; stderr=${stderr.slice(0, 200)}`)); } }, 90000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m && m.id === 2 && m.result) {
          done = true; clearTimeout(timer);
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
          resolve(JSON.parse(m.result.content[0].text));
        }
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    child.stdin.on('error', () => { /* ignore EPIPE */ });
    child.stdin.write(input);
    child.stdin.end();
  });
}

test('AT external-query: the router only triggers for read tools + a projectId', () => {
  assert.ok(EXTERNAL_READ_TOOLS.has('getSystemArchitecture'));
  assert.ok(EXTERNAL_READ_TOOLS.has('memory_search'));
  assert.ok(!EXTERNAL_READ_TOOLS.has('addArchitectureElement'));
  assert.equal(externalQueryRequested('queryNeo4jGraph', { projectId: 'soc-demo' }), true);
  assert.equal(externalQueryRequested('queryNeo4jGraph', {}), false);
  assert.equal(externalQueryRequested('addArchitectureElement', { projectId: 'soc-demo' }), false);
});

test('AT external-query: a projectId routes to the center and passes the result through', async () => {
  // GIVEN a registered workspace pointing at a center stub
  const center = await startCenter(() => ({ status: 200, payload: { status: 'ok', requester: 'archgraph', projectId: 'soc-demo', namespaceKey: 'proj:soc-demo', tool: 'queryNeo4jGraph', result: { status: 'passed', database: 'soc-demo', records: [{ n: 386 }] } } }));
  const ws = makeWorkspace();
  writeFederation(ws, center.url);
  try {
    // WHEN queryNeo4jGraph is called WITH projectId
    const payload = await queryExternalRead({ workspaceRoot: ws, tool: 'queryNeo4jGraph', args: { projectId: 'soc-demo', cypher: 'MATCH (e:Element) RETURN count(e) AS n', workspaceRoot: ws } });
    // THEN the native result is returned with namespaceKey, and the forwarded body is correct
    assert.equal(payload.status, 'passed');
    assert.equal(payload.database, 'soc-demo');
    assert.equal(payload.namespaceKey, 'proj:soc-demo');
    const sent = center.requests[0];
    assert.equal(sent.requester, 'archgraph');
    assert.equal(sent.projectId, 'soc-demo');
    assert.equal(sent.tool, 'queryNeo4jGraph');
    assert.equal(sent.args.cypher, 'MATCH (e:Element) RETURN count(e) AS n');
    assert.equal(sent.args.projectId, undefined, 'projectId must not be forwarded');
    assert.equal(sent.args.workspaceRoot, undefined, 'workspaceRoot is local-only');
  } finally { center.server.close(); }
});

test('AT external-query: a denied external read surfaces the reason (no silent fallback)', async () => {
  const center = await startCenter(() => ({ status: 403, payload: { status: 'denied', reason: 'not_authorized', requester: 'archgraph', projectId: 'soc-demo' } }));
  const ws = makeWorkspace();
  writeFederation(ws, center.url);
  try {
    const payload = await queryExternalRead({ workspaceRoot: ws, tool: 'memory_search', args: { projectId: 'soc-demo', query: 'x' } });
    assert.equal(payload.status, 'failed');
    assert.equal(payload.error.category, 'EXTERNAL_QUERY_DENIED');
    assert.equal(payload.error.reason, 'not_authorized');
  } finally { center.server.close(); }
});

test('AT external-query: no federation identity fails with register-first (never guesses)', async () => {
  const ws = makeWorkspace();
  assert.equal(loadFederationIdentity(ws), null);
  const payload = await queryExternalRead({ workspaceRoot: ws, tool: 'getSystemArchitecture', args: { projectId: 'soc-demo', query: { purpose: 'general', intent: 'x' } } });
  assert.equal(payload.status, 'failed');
  assert.equal(payload.error.category, 'EXTERNAL_QUERY_NOT_REGISTERED');
});

test('AT external-query: no projectId keeps the local path (no center call)', async () => {
  // GIVEN a workspace with NO federation identity
  const ws = makeWorkspace();
  // WHEN queryNeo4jGraph schema mode is called WITHOUT projectId (spawned server)
  const payload = callToolOnce('queryNeo4jGraph', { schema: true, workspaceRoot: ws }, { ARGO_REPO_ROOT: ws });
  // THEN it is served locally (default ArchiMate 3.2 schema) and never routed
  assert.equal(payload.status, 'passed');
  assert.equal(payload.schema.schemaKind, 'default');
});

test('AT external-query: an external getSystemArchitecture works even with no local graph', async () => {
  // GIVEN a registered workspace that has NO local design/KG graph, and a center stub
  const center = await startCenter(() => ({ status: 200, payload: { status: 'ok', requester: 'archgraph', projectId: 'soc-demo', namespaceKey: 'proj:soc-demo', tool: 'getSystemArchitecture', result: { status: 'passed', query: { mode: 'semantic-query' }, document: { elements: [{ id: 'soc-x', name: 'X', type: 'Business Object' }] } } } }));
  const ws = makeWorkspace();
  writeFederation(ws, center.url);
  try {
    // WHEN getSystemArchitecture is called WITH projectId (the external path must
    // not try to build a LOCAL semantic journey first)
    const payload = await callToolAsync('getSystemArchitecture', { projectId: 'soc-demo', query: { purpose: 'general', intent: 'x' }, workspaceRoot: ws }, { ARGO_REPO_ROOT: ws });
    // THEN it routes to the center and returns the external semantic result
    assert.equal(payload.status, 'passed');
    assert.equal(payload.namespaceKey, 'proj:soc-demo');
    assert.equal(payload.query.mode, 'semantic-query');
    assert.equal(center.requests.length, 1);
  } finally { center.server.close(); }
});

test('AT external-query: the MCP routes a projectId call through the center end-to-end', async () => {
  const center = await startCenter(() => ({ status: 200, payload: { status: 'ok', requester: 'archgraph', projectId: 'soc-demo', namespaceKey: 'proj:soc-demo', tool: 'queryNeo4jGraph', result: { status: 'passed', database: 'soc-demo', records: [{ n: 1 }] } } }));
  const ws = makeWorkspace();
  writeFederation(ws, center.url);
  try {
    const payload = await callToolAsync('queryNeo4jGraph', { projectId: 'soc-demo', cypher: 'MATCH (e:Element) RETURN count(e) AS n', workspaceRoot: ws }, { ARGO_REPO_ROOT: ws });
    assert.equal(payload.status, 'passed');
    assert.equal(payload.database, 'soc-demo');
    assert.equal(payload.namespaceKey, 'proj:soc-demo');
    assert.equal(center.requests.length, 1);
  } finally { center.server.close(); }
});

// Like callToolAsync, but resolves the FULL tools/call result object (so the
// declared outputSchema contract — structuredContent — can be asserted).
function callToolRawAsync(name, args, env) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'extq', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = ''; let stderr = ''; let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch { /* ignore */ } reject(new Error(`timeout; stderr=${stderr.slice(0, 200)}`)); } }, 90000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m && m.id === 2 && m.result) {
          done = true; clearTimeout(timer);
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
          resolve(m.result);
        }
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    child.stdin.on('error', () => { /* ignore EPIPE */ });
    child.stdin.write(input);
    child.stdin.end();
  });
}

const GET_SA_ERROR_KEYS = ['category', 'message', 'action', 'fullSnapshotFallback', 'state', 'canonicalVersion', 'contentVersion', 'indexVersion', 'completedChannels', 'missingChannels', 'mismatchedChannels'];

test('AT external-query: cross-project getSystemArchitecture returns schema-conformant structuredContent', async () => {
  // GIVEN a center stub returning a native getSystemArchitecture result
  const center = await startCenter(() => ({
    status: 200,
    payload: {
      status: 'ok', requester: 'archgraph', projectId: 'abot', namespaceKey: 'proj:abot', tool: 'getSystemArchitecture',
      result: { status: 'passed', query: { purpose: 'general', intent: 'x', mode: 'semantic-query', semanticRetrieval: 'invoked' }, document: { elements: [{ id: 'abot-vision-001', name: 'Vision', type: 'Business Object' }] } },
    },
  }));
  const ws = makeWorkspace();
  writeFederation(ws, center.url);
  try {
    // WHEN getSystemArchitecture is called WITH projectId
    const result = await callToolRawAsync('getSystemArchitecture', { projectId: 'abot', query: { purpose: 'general', intent: 'x' }, workspaceRoot: ws }, { ARGO_REPO_ROOT: ws });
    // THEN the result carries structuredContent matching the declared outputSchema
    const sc = result.structuredContent;
    assert.ok(sc, 'structuredContent must be present when the tool declares an outputSchema');
    assert.equal(sc.version, '1.0');
    assert.equal(sc.mode, 'semantic-query');
    assert.equal(sc.error, null);
    assert.equal(sc.query.mode, 'semantic-query');
    assert.ok(sc.document && Array.isArray(sc.document.elements));
    assert.equal(sc.namespaceKey, undefined, 'structuredContent must match the schema (additionalProperties:false); namespaceKey stays in the text payload');
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.namespaceKey, 'proj:abot');
  } finally { center.server.close(); }
});

test('AT external-query: a denied cross-project getSystemArchitecture still returns an error structuredContent', async () => {
  const center = await startCenter(() => ({ status: 403, payload: { status: 'denied', reason: 'not_authorized', requester: 'archgraph', projectId: 'abot' } }));
  const ws = makeWorkspace();
  writeFederation(ws, center.url);
  try {
    const result = await callToolRawAsync('getSystemArchitecture', { projectId: 'abot', query: { purpose: 'general', intent: 'x' }, workspaceRoot: ws }, { ARGO_REPO_ROOT: ws });
    const sc = result.structuredContent;
    assert.ok(sc, 'structuredContent must be present even on failure');
    assert.equal(sc.version, '1.0');
    assert.equal(sc.mode, 'error');
    assert.equal(sc.document, null);
    assert.equal(sc.query, null);
    assert.equal(sc.error.category, 'EXTERNAL_QUERY_DENIED');
    assert.ok(typeof sc.error.message === 'string' && sc.error.message.length > 0);
    for (const k of Object.keys(sc.error)) {
      assert.ok(GET_SA_ERROR_KEYS.includes(k), `error key '${k}' is not allowed by the outputSchema`);
    }
  } finally { center.server.close(); }
});
