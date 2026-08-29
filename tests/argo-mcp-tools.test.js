'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js');

function listTools() {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'argo-mcp-tools-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(r => JSON.stringify(r)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [SERVER], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ARGO_REPO_ROOT: ROOT },
    input,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `server exited ${result.status}: ${String(result.stderr || '').slice(0, 500)}`);
  const responses = String(result.stdout || '').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const toolsList = responses.find(r => r && r.id === 2);
  return (toolsList && toolsList.result && toolsList.result.tools || []).map(t => t.name);
}

// External-view acceptance tests for the ARGO MCP tool surface consolidation.
// Step 1: validateStageHandoff / validateTraceProposal are removed; the core
// validator + architecture tools stay. Guards against accidental re-registration.

test('AT argo-mcp-tools: removed handoff/trace-proposal validators are gone from tools/list', () => {
  // GIVEN the ARGO MCP server advertises its tool set
  const toolNames = listTools();
  // THEN the two consolidated-away validators are no longer exposed
  assert.ok(!toolNames.includes('validateStageHandoff'), 'validateStageHandoff must be removed');
  assert.ok(!toolNames.includes('validateTraceProposal'), 'validateTraceProposal must be removed');
});

test('AT argo-mcp-tools: kept validators and architecture tools are still advertised', () => {
  const toolNames = listTools();
  // THEN the remaining validators and the full architecture surface are present
  for (const kept of [
    'validateSystemArchitecture',
    'runArchitectureTests',
    'initializeWorkspace',
    'getSystemArchitecture',
    'getIntentElementContext',
    'getArchitectureViewContext',
    'queryNeo4jGraph',
    'memory_search',
    'previewSystemArchitectureMutation',
    'applySystemArchitectureMutation',
    'addArchitectureElement',
    'updateArchitectureElement',
    'removeArchitectureElement',
    'addArchitectureRelationship',
    'updateArchitectureRelationship',
    'removeArchitectureRelationship',
    'addArchitectureView',
    'updateArchitectureView',
    'removeArchitectureView',
    'generateArchitectureDiffPlantuml',
  ]) {
    assert.ok(toolNames.includes(kept), `tool ${kept} must still be advertised`);
  }
});

function callToolOnce(name, callArguments) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'argo-mcp-tools-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: callArguments } },
  ].map(r => JSON.stringify(r)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [SERVER], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ARGO_REPO_ROOT: ROOT },
    input,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `server exited ${result.status}: ${String(result.stderr || '').slice(0, 500)}`);
  const responses = String(result.stdout || '').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const call = responses.find(r => r && r.id === 2);
  assert.ok(call && call.result, 'tools/call must respond');
  return JSON.parse(call.result.content[0].text);
}

test('AT argo-mcp-tools: getSystemArchitecture requires a query (no full-graph snapshot)', () => {
  // GIVEN the getSystemArchitecture tool no longer exposes an omitted-query full snapshot
  // WHEN called with no query
  const payload = callToolOnce('getSystemArchitecture', {});
  // THEN it is rejected with QUERY_REQUIRED instead of returning the whole document
  assert.equal(payload.status, 'failed');
  assert.equal(payload.error && payload.error.category, 'QUERY_REQUIRED');
});

test('AT argo-mcp-tools: graph-tidy purpose is rejected (no full-snapshot bypass)', () => {
  // GIVEN graph-tidy was removed from the legal purpose enum
  // WHEN a graph-tidy query is submitted
  const payload = callToolOnce('getSystemArchitecture', { query: { purpose: 'graph-tidy', intent: 'x' } });
  // THEN it is rejected as an invalid purpose
  assert.equal(payload.status, 'failed');
  assert.equal(payload.error && payload.error.category, 'QUERY_PURPOSE_INVALID');
});

test('AT argo-mcp-tools: purpose enum is general + audit (internal categories rejected)', () => {
  // GIVEN the agent-facing purpose enum is collapsed to general/audit
  // WHEN a former internal category is submitted as an agent-facing purpose
  const payload = callToolOnce('getSystemArchitecture', { query: { purpose: 'implementation-design', intent: 'x' } });
  // THEN it is rejected as an invalid purpose (internal categories are not agent-facing)
  assert.equal(payload.status, 'failed');
  assert.equal(payload.error && payload.error.category, 'QUERY_PURPOSE_INVALID');
});
