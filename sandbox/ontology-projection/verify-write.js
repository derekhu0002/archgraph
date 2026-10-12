'use strict';

// Real write-path acceptance, aligned to the STANDARD acceptance setup
// (deploy ~/.argo, real Neo4j via host.docker.internal, real embedding creds,
// workspace /work/custom-schema + stock db) so the framework's semantic
// lifecycle reaches the same aligned state the stock acceptance relies on.
//
//   A. a normal (valid) MCP write SUCCEEDS with the ontology extension ON
//      -> the extension never falsely blocks a legitimate write (the must-have).
//   B. a write introducing a logical CONTRADICTION FAILS at the write timing with
//      the real engine's finding. The workspace uses the `functional-open` axioms
//      (`Assigned To` functional, NO `distinctIndividuals`) — issue #12 — so this
//      proves the real engine blocks a closed-world functional conflict the OWL
//      reasoner alone would miss (it used to silently pass).
//   C. the same contradicting write SUCCEEDS with the extension OFF (control).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOME = process.env.HOME || '/root';
const ARGO = path.join(HOME, '.argo');
const SERVER = path.join(ARGO, 'scripts', 'argo-mcp-server.js');
const CLI = path.join(ARGO, 'scripts', 'ontology-projection', 'cli.js');
const NODE_PATH = path.join(ARGO, 'node_modules');
const WS = '/work/custom-schema';
const DB = 'schema-bundle-custom';

const ENV_SUPPORTED_KEYS = [
  'ARGO_EMBEDDING_PROFILE', 'ARGO_EMBEDDING_BASE_URL', 'ARGO_EMBEDDING_MODEL',
  'ARGO_EMBEDDING_PROVIDER', 'ARGO_EMBEDDING_MODEL_VERSION', 'ARGO_EMBEDDING_DIMENSIONS',
  'ARGO_EMBEDDING_QUERY_INSTRUCTION', 'ARGO_EMBEDDING_API_KEY',
  'ARGO_NEO4J_DATABASE_URL', 'ARGO_NEO4J_DATABASE_USERNAME', 'ARGO_NEO4J_DATABASE_PASSWORD',
  'QWEN_KEY', 'ARGO_SEMANTIC_MEMORY_THRESHOLD', 'ARGO_SEMANTIC_AUDIT_THRESHOLD', 'ARGO_SEMANTIC_TOP_K',
  'ARGO_LIVE_PROVIDER_E2E', 'ARGO_W31_LIVE_MUTATION_VECTOR_E2E',
];

function prepareBaseEnv() {
  const file = '/env/argo.env';
  if (!fs.existsSync(file)) throw new Error('SKIP: mount argo/.env to /env/argo.env');
  const env = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!ENV_SUPPORTED_KEYS.includes(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  env.ARGO_NEO4J_DATABASE_URL = (env.ARGO_NEO4J_DATABASE_URL || 'neo4j://127.0.0.1:7687').replace(/127\.0\.0\.1|localhost/g, 'host.docker.internal');
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return env;
}

function useDatabase() {
  process.env.ARGO_NEO4J_DATABASE = DB;
  const dest = path.join(WS, '.argo', 'env.argo.env');
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.writeFileSync(dest, ENV_SUPPORTED_KEYS.filter((k) => process.env[k] !== undefined).map((k) => `${k}=${process.env[k]}`).join('\n') + '\n', { mode: 0o600 });
  process.env.ARGO_ENV_FILE = dest;
}

function mcpSession(calls, env, timeoutMs = 300000) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'write-verify', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: c.name, arguments: c.arguments } })),
  ];
  const input = `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, NODE_PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
    const timer = setTimeout(() => finish(new Error(`timeout; stderr=${stderr.slice(0, 600)}`)), timeoutMs);
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
    child.on('exit', (code) => { if (!calls.every((c, i) => byId[100 + i])) finish(new Error(`early exit code=${code}; stderr=${stderr.slice(0, 600)}`)); });
    child.stdin.on('error', () => { /* ignore */ });
    child.stdin.write(input);
  });
}

const extensionEnv = JSON.stringify([
  { name: 'ontology', timings: ['write'], command: ['node', CLI, '--workspace', '{workspaceRoot}', '--graph', '{graphPath}', '--mode', '{mode}'] },
]);

const validCalls = [
  { key: 'e', name: 'addArchitectureElement', arguments: { workspaceRoot: WS, onConflict: 'allowDuplicate', justification: 'acceptance verification element', element: { id: 'team-b', name: 'Team B', type: 'Team Node' }, view_ids: ['view-root'] } },
  { key: 'w', name: 'addArchitectureRelationship', arguments: { workspaceRoot: WS, relationship: { id: 'rel-v', name: 'Team B depends on Service A', type: 'Depends On', source_id: 'team-b', target_id: 'svc-a', source_name: 'Team B', target_name: 'Service A', statement: 'Team B --(Depends On)--> Service A' }, view_ids: ['view-root'] } },
];
const contradictionCalls = [
  { key: 'e', name: 'addArchitectureElement', arguments: { workspaceRoot: WS, onConflict: 'allowDuplicate', justification: 'acceptance verification element', element: { id: 'team-c', name: 'Team C', type: 'Team Node' }, view_ids: ['view-root'] } },
  { key: 'w', name: 'addArchitectureRelationship', arguments: { workspaceRoot: WS, relationship: { id: 'rel-c', name: 'Agent 001 assigned to Team C', type: 'Assigned To', source_id: 'agent-001', target_id: 'team-c', source_name: 'Agent 001', target_name: 'Team C', statement: 'Agent 001 --(Assigned To)--> Team C' }, view_ids: ['view-root'] } },
];

const warmCalls = [
  { key: 'gsa', name: 'getSystemArchitecture', arguments: { workspaceRoot: WS, query: { purpose: 'general', intent: 'team graph' } } },
  { key: 'ico', name: 'getIntentElementContext', arguments: { workspaceRoot: WS, elementId: 'team-a' } },
  { key: 'vc', name: 'getArchitectureViewContext', arguments: { workspaceRoot: WS, view_id: 'view-root' } },
  { key: 'qs', name: 'queryNeo4jGraph', arguments: { workspaceRoot: WS, schema: true } },
  { key: 'qc', name: 'queryNeo4jGraph', arguments: { workspaceRoot: WS, cypher: 'MATCH (e:Element {graphKey: $graphKey}) RETURN e.id AS id LIMIT 5' } },
  { key: 'ms', name: 'memory_search', arguments: { workspaceRoot: WS, query: 'team service', top_k: 3 } },
  { key: 'val', name: 'validateSystemArchitecture', arguments: { workspaceRoot: WS } },
];

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`);
  if (!ok) failures += 1;
}

async function main() {
  prepareBaseEnv();
  useDatabase();
  const baseEnv = { ARGO_REPO_ROOT: WS };

  const init = await mcpSession([{ key: 'init', name: 'initializeWorkspace', arguments: { workspaceRoot: WS } }], baseEnv, 300000);
  const initReport = (init.init && (init.init.report || init.init)) || {};
  check('init ok (Team Graph)', initReport.status === 'ok', JSON.stringify(init.init).slice(0, 300));

  const a = await mcpSession([...warmCalls, ...validCalls], { ...baseEnv, ARGO_VALIDATION_EXTENSIONS: extensionEnv });
  check('A. valid MCP write succeeds (extension ON)', a.w.status === 'passed', JSON.stringify({ status: a.w.status, errors: a.w.errors, warnings: a.w.validationWarnings }).slice(0, 500));

  const b = await mcpSession([...warmCalls, ...contradictionCalls], { ...baseEnv, ARGO_VALIDATION_EXTENSIONS: extensionEnv });
  const bErrors = JSON.stringify(b.w.errors || []);
  check('B. contradicting MCP write blocked by real engine (extension ON)', b.w.status === 'failed' && /functional 'Assigned To'.*2 distinct values/i.test(bErrors), JSON.stringify(b.w).slice(0, 900));

  const c = await mcpSession([...warmCalls, ...contradictionCalls], baseEnv);
  check('C. control: same write passes with extension OFF', c.w.status === 'passed', JSON.stringify({ status: c.w.status, errors: c.w.errors }).slice(0, 500));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('VERIFY_FAILED:', error.message); process.exit(1); });
