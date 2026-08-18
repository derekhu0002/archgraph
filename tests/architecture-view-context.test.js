'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(WORKSPACE_ROOT, 'argo', 'scripts', 'argo-mcp-server.js');

function runMcp(requests) {
  const input = `${requests.map(request => JSON.stringify(request)).join('\n')}\n`;
  const result = spawnSync(process.execPath, [SERVER_PATH], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ARGO_REPO_ROOT: WORKSPACE_ROOT },
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `server exited with ${result.status}: ${result.stderr}`);
  return String(result.stdout)
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function callPayload(responses, id) {
  const response = responses.find(entry => entry.id === id);
  assert.ok(response, `missing response for request id ${id}`);
  return JSON.parse(response.result.content[0].text);
}

test('architecture-view-context: resolves complete view membership by view_id', () => {
  // GIVEN the ARGO MCP server exposes getArchitectureViewContext
  // WHEN a caller resolves views 176, 174, and 170 (with child views)
  // THEN the tool returns the view plus fully resolved elements and relationships
  const responses = runMcp([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'architecture-view-context-test', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: '176' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: '174' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: '170', includeChildViews: true } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: 'does-not-exist' } } },
  ]);

  const toolsList = responses.find(entry => entry.id === 2);
  const toolNames = (toolsList.result.tools || []).map(tool => tool.name);
  assert.ok(toolNames.includes('getArchitectureViewContext'), 'tool must be advertised');

  const agentCapabilities = callPayload(responses, 3);
  assert.equal(agentCapabilities.status, 'passed');
  assert.equal(agentCapabilities.view.view_id, '176');
  assert.deepEqual(agentCapabilities.elements.map(element => element.id).sort(), ['1310', '1319']);
  assert.equal(agentCapabilities.relationships.length, 0);
  assert.equal(agentCapabilities.parentElement.id, '1249');
  assert.equal(agentCapabilities.parentElement.name, 'Implementation and Migration Viewpoint');
  assert.deepEqual(agentCapabilities.missingElementIds, []);
  assert.deepEqual(agentCapabilities.missingRelationshipIds, []);

  const implementationMigration = callPayload(responses, 4);
  assert.equal(implementationMigration.status, 'passed');
  assert.equal(implementationMigration.elements.length, 15);
  assert.equal(implementationMigration.relationships.length, 9);

  const childViews = callPayload(responses, 5);
  assert.equal(childViews.status, 'passed');
  assert.deepEqual(childViews.childViews.map(view => view.view_id).sort(), ['169', '174', '176']);

  const missing = callPayload(responses, 6);
  assert.equal(missing.status, 'failed');
  assert.equal(missing.error.category, 'VIEW_NOT_FOUND');
});
