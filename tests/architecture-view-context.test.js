'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(WORKSPACE_ROOT, 'argo', 'scripts', 'argo-mcp-server.js');

function runMcpAt(workspaceRoot, requests) {
  const input = `${requests.map(request => JSON.stringify(request)).join('\n')}\n`;
  const result = spawnSync(process.execPath, [SERVER_PATH], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: { ...process.env, ARGO_REPO_ROOT: workspaceRoot },
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `server exited with ${result.status}: ${result.stderr}`);
  return String(result.stdout)
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function runMcp(requests) {
  return runMcpAt(WORKSPACE_ROOT, requests);
}

function callPayload(responses, id) {
  const response = responses.find(entry => entry.id === id);
  assert.ok(response, `missing response for request id ${id}`);
  return JSON.parse(response.result.content[0].text);
}

test('architecture-view-context: resolves complete view membership by view_id', () => {
  // GIVEN the ARGO MCP server exposes getArchitectureViewContext
  // WHEN a caller resolves views 176, 174, and 429 (with child views)
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
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: '429', includeChildViews: true } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: 'does-not-exist' } } },
  ]);

  const toolsList = responses.find(entry => entry.id === 2);
  const toolNames = (toolsList.result.tools || []).map(tool => tool.name);
  assert.ok(toolNames.includes('getArchitectureViewContext'), 'tool must be advertised');

  const agentCapabilities = callPayload(responses, 3);
  assert.equal(agentCapabilities.status, 'passed');
  assert.equal(agentCapabilities.view.view_id, '176');
  assert.deepEqual(agentCapabilities.elements.map(element => element.id).sort(), ['1310', '1319', '1331', '2753', '2757']);
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
  assert.deepEqual(
    childViews.childViews.map(view => view.view_id).sort(),
    ['169', '174', '176', '178', '179', '180', '1800', '298', '432', '434', 'argo-workflow-rules-view', 'diagram-skills-view-001', 'ea-tooling-wps-001', 'memory-eval-view-001', 'openclaw-adaptation', 'self-evolution-sandbox-view-001', 'tb-eval-view-001']
  );

  const missing = callPayload(responses, 6);
  assert.equal(missing.status, 'failed');
  assert.equal(missing.error.category, 'VIEW_NOT_FOUND');
});

test('architecture-view-context (optional EA geometry): opt-in includeEaGeometry returns diagram geometry aligned by schema id; default omits it; no EA model degrades to present:false', () => {
  // GIVEN the workspace EA model (archgraph.qea) lays out views 174 and 176 as diagrams
  // WHEN a caller opts in via includeEaGeometry on views 176/174, calls view 176 without the
  //      flag, and resolves view 176 with the flag in a workspace that has NO EA model
  // THEN the tool returns a `geometry` section aligned by schema id when the view is laid out in
  //      EA, omits `geometry` entirely when the flag is unset (backward compatible default), and
  //      returns present:false (never an error) when no EA model exists in the workspace
  const responses = runMcp([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'architecture-view-context-geometry-test', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: '176', includeEaGeometry: true } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: '174', includeEaGeometry: true } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: '176' } } },
  ]);

  const tool = (responses.find(entry => entry.id === 2).result.tools || []).find(t => t.name === 'getArchitectureViewContext');
  assert.ok(tool, 'tool must be advertised');
  assert.equal(tool.inputSchema.properties.includeEaGeometry.type, 'boolean', 'schema must advertise the opt-in includeEaGeometry boolean');

  const view176 = callPayload(responses, 3);
  assert.equal(view176.status, 'passed');
  assert.ok(view176.geometry, 'includeEaGeometry:true must add a geometry section');
  assert.equal(view176.geometry.present, true, 'view 176 is laid out in the workspace EA model');
  assert.equal(view176.geometry.source, 'archgraph.qea', 'geometry.source names the workspace EA model');
  assert.ok(view176.geometry.elements.length >= view176.elements.length, 'every member element is placed in the EA diagram');
  const elementIds = new Set(view176.elements.map(el => el.id));
  for (const g of view176.geometry.elements) {
    assert.ok(elementIds.has(g.id), `geometry element ${g.id} must align to a returned member element`);
    assert.ok(Number.isFinite(g.left) && Number.isFinite(g.top) && Number.isFinite(g.right) && Number.isFinite(g.bottom), `element ${g.id} rect numbers`);
    assert.ok(g.left < g.right && g.top < g.bottom, `element ${g.id} rect must be sane`);
  }
  assert.deepEqual(view176.geometry.relationships, [], 'view 176 has no relationship lines laid out');

  const view174 = callPayload(responses, 4);
  assert.equal(view174.status, 'passed');
  assert.equal(view174.geometry.present, true, 'view 174 is laid out in the workspace EA model');
  const relIds = new Set(view174.relationships.map(r => r.id));
  assert.ok(view174.geometry.relationships.length >= 1, 'view 174 connector line geometry returned');
  for (const g of view174.geometry.relationships) {
    assert.ok(relIds.has(g.id), `geometry relationship ${g.id} must align to a returned member relationship`);
    assert.equal(typeof g.path, 'string', `relationship ${g.id} path is the EA line geometry string`);
  }

  const defaultCall = callPayload(responses, 5);
  assert.equal(defaultCall.status, 'passed');
  assert.equal(Object.prototype.hasOwnProperty.call(defaultCall, 'geometry'), false, 'default call (flag unset) must not add a geometry section');

  // workspace WITHOUT an EA model → graceful present:false (source null), never an error
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-view-geometry-'));
  try {
    const graphDir = path.join(dir, 'design', 'KG');
    fs.mkdirSync(graphDir, { recursive: true });
    fs.copyFileSync(path.join(WORKSPACE_ROOT, 'design', 'KG', 'SystemArchitecture.json'), path.join(graphDir, 'SystemArchitecture.json'));
    const noModelResponses = runMcpAt(dir, [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'architecture-view-context-geometry-test', version: '1' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: '176', includeEaGeometry: true } } },
    ]);
    const degraded = callPayload(noModelResponses, 2);
    assert.equal(degraded.status, 'passed');
    assert.deepEqual(
      degraded.geometry,
      { source: null, present: false, elements: [], relationships: [] },
      'no EA model in the workspace → geometry present:false with empty arrays, not an error',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
