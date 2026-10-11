'use strict';

// Full write-path end-to-end in the container: initializeWorkspace (Neo4j
// projection + semantic lifecycle) then a real MCP write
// (previewSystemArchitectureMutation), first with the extension OFF, then ON
// (real ontology engine at the WRITE timing, delta scope). Proves the write hook
// runs the real engine on a real framework write.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = '/repo';
const SERVER = path.join(REPO, 'argo', 'scripts', 'argo-mcp-server.js');
const FIX = path.join(__dirname, 'samples', 'team-graph');
const CLI = path.join(REPO, 'argo', 'scripts', 'ontology-projection', 'cli.js');

const SUPPORTED = [
  'ARGO_EMBEDDING_PROFILE', 'ARGO_EMBEDDING_BASE_URL', 'ARGO_EMBEDDING_MODEL', 'ARGO_EMBEDDING_PROVIDER',
  'ARGO_EMBEDDING_MODEL_VERSION', 'ARGO_EMBEDDING_DIMENSIONS', 'ARGO_EMBEDDING_QUERY_INSTRUCTION', 'ARGO_EMBEDDING_API_KEY',
  'ARGO_NEO4J_DATABASE_URL', 'ARGO_NEO4J_DATABASE_USERNAME', 'ARGO_NEO4J_DATABASE_PASSWORD', 'QWEN_KEY',
  'ARGO_SEMANTIC_MEMORY_THRESHOLD', 'ARGO_SEMANTIC_AUDIT_THRESHOLD', 'ARGO_SEMANTIC_TOP_K', 'ARGO_SEMANTIC_HYBRID',
  'ARGO_SEMANTIC_RERANK', 'ARGO_RERANK_PROVIDER', 'ARGO_RERANK_MODEL', 'ARGO_RERANK_BASE_URL', 'ARGO_RERANK_API_KEY',
];

function loadEnv() {
  const file = '/env/argo.env';
  if (!fs.existsSync(file)) throw new Error('SKIP: mount argo/.env to /env/argo.env');
  const env = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!SUPPORTED.includes(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

function prepare() {
  const merged = loadEnv();
  merged.ARGO_NEO4J_DATABASE_URL = (merged.ARGO_NEO4J_DATABASE_URL || 'neo4j://127.0.0.1:7687').replace(/127\.0\.0\.1|localhost/g, 'host.docker.internal');
  for (const [k, v] of Object.entries(merged)) process.env[k] = v;
  return merged;
}

function makeWs() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-writefull-'));
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of fs.readdirSync(path.join(FIX, '.argo', 'schema'))) {
    fs.copyFileSync(path.join(FIX, '.argo', 'schema', name), path.join(schemaDir, name));
  }
  fs.mkdirSync(path.join(ws, 'design', 'KG'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'graphs', 'valid.json'), path.join(ws, 'design', 'KG', 'SystemArchitecture.json'));
  return ws;
}

function useDatabase(ws, db) {
  process.env.ARGO_NEO4J_DATABASE = db;
  const dest = path.join(ws, '.argo', 'env.argo.env');
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.writeFileSync(dest, SUPPORTED.filter((k) => process.env[k] !== undefined).map((k) => `${k}=${process.env[k]}`).join('\n') + '\n', { mode: 0o600 });
  process.env.ARGO_ENV_FILE = dest;
}

function mcpSession(calls, env, timeoutMs = 300000) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'write-full', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: c.name, arguments: c.arguments } })),
  ];
  const input = `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const byId = {};
    let buffer = '';
    let stderr = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      if (error) return reject(error);
      const out = {};
      calls.forEach((c, i) => {
        const m = byId[100 + i];
        if (!m) return (out[c.key] = { __error: 'no response' });
        if (m.error) return (out[c.key] = { __error: m.error });
        try { out[c.key] = JSON.parse(m.result.content[0].text); } catch { out[c.key] = { __raw: m.result.content[0].text }; }
      });
      resolve(out);
    };
    const timer = setTimeout(() => finish(new Error(`timeout; stderr=${stderr.slice(0, 800)}`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m && typeof m.id === 'number' && m.id >= 100) byId[m.id] = m; } catch { /* ignore */ }
      }
      if (calls.every((c, i) => byId[100 + i])) finish(null);
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => finish(err));
    child.on('exit', () => { if (!calls.every((c, i) => byId[100 + i])) finish(new Error(`early exit; missing=${calls.filter((c, i) => !byId[100 + i]).map((c) => c.key).join(',')}; stderr=${stderr.slice(0, 800)}`)); });
    child.stdin.on('error', () => { /* ignore */ });
    child.stdin.write(input);
    child.stdin.end();
  });
}

async function main() {
  prepare();
  const ws = makeWs();
  useDatabase(ws, 'ontology-projection-e2e');
  const baseEnv = { ARGO_REPO_ROOT: ws };

  const mutation = {
    workspaceRoot: ws,
    acknowledgeLoss: true,
    mutations: [
      { type: 'addElement', element: { id: 'team-b', name: 'Team B', type: 'Team Node' }, view_ids: ['view-root'] },
      { type: 'addRelationship', relationship: { id: 'rel-x', name: 'Agent 1 assigned to Team B', type: 'Assigned To', source_id: 'agent-1', target_id: 'team-b', source_name: 'Agent 1', target_name: 'Team B', statement: 'Agent 1 --(Assigned To)--> Team B' }, view_ids: ['view-root'] },
    ],
  };
  const extension = JSON.stringify([
    { name: 'ontology', timings: ['write'], command: ['node', CLI, '--workspace', '{workspaceRoot}', '--graph', '{graphPath}', '--mode', '{mode}'] },
  ]);

  // init + write in ONE process (avoids the fresh-process startup-alignment race)
  const on = await mcpSession([
    { key: 'init', name: 'initializeWorkspace', arguments: { workspaceRoot: ws } },
    { key: 'w', name: 'previewSystemArchitectureMutation', arguments: mutation },
  ], { ...baseEnv, ARGO_VALIDATION_EXTENSIONS: extension }, 300000);
  const onReport = (on.init && (on.init.report || on.init)) || {};
  console.log('INIT_ON:', JSON.stringify({ status: onReport.status, schema: onReport.schemaBundle && onReport.schemaBundle.language, semantic: onReport.semanticLifecycle && onReport.semanticLifecycle.state }).slice(0, 300));
  console.log('WRITE_ON:', JSON.stringify({ status: on.w.status, errors: on.w.errors, validationWarnings: on.w.validationWarnings }).slice(0, 900));

  const off = await mcpSession([
    { key: 'init', name: 'initializeWorkspace', arguments: { workspaceRoot: ws } },
    { key: 'w', name: 'previewSystemArchitectureMutation', arguments: mutation },
  ], baseEnv, 300000);
  console.log('WRITE_OFF:', JSON.stringify({ status: off.w.status, errors: off.w.errors }).slice(0, 400));
}

main().catch((error) => { console.error('E2E_FAILED:', error.message); process.exit(1); });
