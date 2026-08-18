'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

function buildMcpInput() {
  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'argo-global-install-test', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'validateSystemArchitecture', arguments: {} },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'getSystemArchitecture', arguments: {} },
    },
  ];
  return `${requests.map(request => JSON.stringify(request)).join('\n')}\n`;
}

function copyArgoInstallation(targetRoot) {
  const targetArgo = path.join(targetRoot, '.argo');
  fs.mkdirSync(path.join(targetArgo, 'scripts'), { recursive: true });
  fs.cpSync(
    path.join(WORKSPACE_ROOT, 'argo', 'scripts'),
    path.join(targetArgo, 'scripts'),
    { recursive: true },
  );
  fs.cpSync(
    path.join(WORKSPACE_ROOT, 'argo', 'schema'),
    path.join(targetArgo, 'schema'),
    { recursive: true },
  );
  return path.join(targetArgo, 'scripts', 'argo-mcp-server.js');
}

function runGlobalServer(serverPath) {
  const result = spawnSync(process.execPath, [serverPath], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ARGO_REPO_ROOT: WORKSPACE_ROOT },
    input: buildMcpInput(),
    maxBuffer: 20 * 1024 * 1024,
  });
  return result;
}

function parseResponses(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

test('argo MCP works from a repository-external global installation', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-global-install-'));
  try {
    const serverPath = copyArgoInstallation(tempRoot);
    assert.ok(fs.existsSync(serverPath), 'copied global server entrypoint must exist');
    assert.ok(!fs.existsSync(path.join(tempRoot, '.argo', '.env')), 'secrets must not be copied');

    const result = runGlobalServer(serverPath);
    assert.equal(result.status, 0, `server exited with ${result.status}: ${result.stderr}`);

    const responses = parseResponses(result.stdout);
    const initialize = responses.find(response => response.id === 1);
    const toolsList = responses.find(response => response.id === 2);
    const validation = responses.find(response => response.id === 3);
    const snapshot = responses.find(response => response.id === 4);

    assert.ok(initialize && initialize.result, 'initialize must respond');
    assert.equal(initialize.result.serverInfo.name, 'argo');

    const toolNames = (toolsList.result.tools || []).map(tool => tool.name);
    assert.ok(toolNames.includes('getSystemArchitecture'));
    assert.ok(toolNames.includes('validateSystemArchitecture'));

    const validationPayload = JSON.parse(validation.result.content[0].text);
    assert.equal(validationPayload.status, 'passed');

    const snapshotPayload = JSON.parse(snapshot.result.content[0].text);
    assert.equal(snapshotPayload.status, 'passed');
    assert.equal(snapshotPayload.graphPath, 'design/KG/SystemArchitecture.json');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
