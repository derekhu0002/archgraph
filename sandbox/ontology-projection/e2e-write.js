'use strict';

// Container run of the REAL write path: drive the framework MCP's
// previewSystemArchitectureMutation over a custom-schema workspace with the
// ontology extension enabled at the WRITE timing, and show the real engine's
// finding surfaced on the mutation result.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = '/repo';
const SERVER = path.join(REPO, 'argo', 'scripts', 'argo-mcp-server.js');
const FIX = path.join(__dirname, 'samples', 'team-graph');

function makeWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-write-'));
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of fs.readdirSync(path.join(FIX, '.argo', 'schema'))) {
    fs.copyFileSync(path.join(FIX, '.argo', 'schema', name), path.join(schemaDir, name));
  }
  fs.mkdirSync(path.join(ws, 'design', 'KG'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'graphs', 'valid.json'), path.join(ws, 'design', 'KG', 'SystemArchitecture.json'));
  return ws;
}

function mcpCall(env, calls) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'write-e2e', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: c.name, arguments: c.arguments } })),
  ];
  const input = `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`;
  const result = spawnSync(process.execPath, [SERVER], { input, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  const byId = {};
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m && typeof m.id === 'number' && m.id >= 100) byId[m.id] = m;
  }
  return calls.map((c, i) => {
    const m = byId[100 + i];
    if (!m) return { __error: `no response; stderr=${String(result.stderr || '').slice(0, 400)}` };
    if (m.error) return { __error: m.error };
    try { return JSON.parse(m.result.content[0].text); } catch { return { __raw: m.result.content[0].text }; }
  });
}

const ws = makeWorkspace();
const extension = JSON.stringify([
  { name: 'ontology', timings: ['write'], command: ['node', path.join(REPO, 'argo', 'scripts', 'ontology-projection', 'cli.js'), '--workspace', '{workspaceRoot}', '--graph', '{graphPath}', '--mode', '{mode}'] },
]);

const mutation = {
  workspaceRoot: ws,
  acknowledgeLoss: true,
  mutations: [
    { type: 'addElement', element: { id: 'team-b', name: 'Team B', type: 'Team Node' }, view_ids: ['view-root'] },
    { type: 'addRelationship', relationship: { id: 'rel-x', name: 'Agent 1 assigned to Team B', type: 'Assigned To', source_id: 'agent-1', target_id: 'team-b', source_name: 'Agent 1', target_name: 'Team B', statement: 'Agent 1 --(Assigned To)--> Team B' }, view_ids: ['view-root'] },
  ],
};

const [off] = mcpCall({ ARGO_REPO_ROOT: ws }, [{ name: 'previewSystemArchitectureMutation', arguments: mutation }]);
const [on] = mcpCall({ ARGO_REPO_ROOT: ws, ARGO_VALIDATION_EXTENSIONS: extension }, [{ name: 'previewSystemArchitectureMutation', arguments: mutation }]);

function summarize(label, r) {
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(r, null, 2).slice(0, 1800));
}

summarize('write path, extension OFF', off);
summarize('write path, extension ON (real engine at write)', on);
