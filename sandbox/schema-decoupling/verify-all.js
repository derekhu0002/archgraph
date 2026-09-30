'use strict';

// Full-surface verification of the ARGO MCP under BOTH schema modes:
//   A. CUSTOM schema  — the shipped Team Graph bundle (.argo/schema present)
//   B. DEFAULT schema — no .argo/schema (built-in ArgoBument / ArchiMate 3.2)
//
// Each scenario runs against a REAL Neo4j (host.docker.internal, its own
// isolated test database) and the REAL embedding provider, initializes the
// workspace and then exercises ALL 19 ARGO MCP tools: retrieval (incl.
// semantic), writes (element/relationship/view add·update·remove + preview/
// apply), validation, structural Cypher, memory search, init and the test
// runner.
//
// Writes results/schema-decoupling-all-report.json; exits non-zero on failure.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = process.env.HOME || '/root';
const ARGO = path.join(HOME, '.argo');
const WORK = '/work';
const SERVER = path.join(ARGO, 'scripts', 'argo-mcp-server.js');
const WS_CUSTOM = path.join(WORK, 'custom-schema');
const WS_DEFAULT = '/ws-default';
const RESULTS_DIR = fs.existsSync('/results') ? '/results' : '/tmp';
const REPORT_PATH = path.join(RESULTS_DIR, 'schema-decoupling-all-report.json');
const NODE_PATH = path.join(ARGO, 'node_modules');

const ALL_TOOLS = [
  'initializeWorkspace', 'runArchitectureTests', 'getSystemArchitecture', 'getIntentElementContext',
  'previewSystemArchitectureMutation', 'applySystemArchitectureMutation',
  'addArchitectureElement', 'updateArchitectureElement', 'removeArchitectureElement',
  'addArchitectureRelationship', 'updateArchitectureRelationship', 'removeArchitectureRelationship',
  'addArchitectureView', 'updateArchitectureView', 'removeArchitectureView',
  'getArchitectureViewContext', 'queryNeo4jGraph', 'memory_search', 'validateSystemArchitecture',
];

const ENV_SUPPORTED_KEYS = [
  'ARGO_EMBEDDING_PROFILE', 'ARGO_EMBEDDING_BASE_URL', 'ARGO_EMBEDDING_MODEL',
  'ARGO_EMBEDDING_PROVIDER', 'ARGO_EMBEDDING_MODEL_VERSION', 'ARGO_EMBEDDING_DIMENSIONS',
  'ARGO_EMBEDDING_QUERY_INSTRUCTION', 'ARGO_EMBEDDING_API_KEY',
  'ARGO_NEO4J_DATABASE_URL', 'ARGO_NEO4J_DATABASE_USERNAME', 'ARGO_NEO4J_DATABASE_PASSWORD',
  'QWEN_KEY', 'ARGO_SEMANTIC_MEMORY_THRESHOLD', 'ARGO_SEMANTIC_AUDIT_THRESHOLD', 'ARGO_SEMANTIC_TOP_K',
  'ARGO_LIVE_PROVIDER_E2E', 'ARGO_W31_LIVE_MUTATION_VECTOR_E2E',
];

const steps = [];
async function record(name, fn) {
  const started = Date.now();
  console.log(`RUN   ${name}`);
  try {
    const detail = await fn();
    steps.push({ name, status: 'passed', ms: Date.now() - started, detail: detail === undefined ? null : detail });
    console.log(`PASS  ${name}`);
  } catch (error) {
    steps.push({ name, status: 'failed', ms: Date.now() - started, error: String(error && error.message ? error.message : error).slice(0, 2500) });
    console.log(`FAIL  ${name}: ${error && error.message ? error.message : error}`);
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 900000, killSignal: 'SIGKILL', ...opts });
  if (result.error) throw new Error(`${cmd} ${args.join(' ')} failed: ${result.error.message}\n${String(result.stderr || '').slice(0, 1200)}`);
  return result;
}
function mustRun(cmd, args, opts = {}) {
  const result = run(cmd, args, opts);
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}\n${String(result.stderr || result.stdout || '').slice(0, 1500)}`);
  return result;
}

function mcpSession(calls, env, opts = {}) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'schema-all', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: c.name, arguments: c.arguments } })),
  ];
  const input = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  const expected = calls.map((c, i) => 100 + i);
  const timeoutMs = opts.timeoutMs || 300000;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const byId = {};
    let buffer = '';
    let stderr = '';
    let settled = false;
    const missing = () => calls.filter((c, i) => !byId[100 + i]).map((c) => c.key);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      if (error) { reject(error); return; }
      const out = {};
      calls.forEach((c, i) => {
        try { out[c.key] = JSON.parse(byId[100 + i].result.content[0].text); } catch { out[c.key] = { raw: byId[100 + i].result.content[0].text }; }
      });
      resolve(out);
    };
    const timer = setTimeout(() => finish(new Error(`session timeout; missing: ${missing().join(', ')}\n${stderr.slice(0, 800)}`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m && m.id !== undefined && m.id !== null) byId[m.id] = m; } catch { /* ignore */ }
      }
      if (expected.every((id) => byId[id])) finish(null);
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => finish(new Error(`spawn error: ${err.message}`)));
    child.on('exit', () => { if (!expected.every((id) => byId[id])) finish(new Error(`server exited early; missing: ${missing().join(', ')}\n${stderr.slice(0, 800)}`)); });
    child.stdin.on('error', () => { /* ignore EPIPE */ });
    child.stdin.write(input);
    child.stdin.end();
  });
}

function assertNotFailed(payload, key) {
  if (!payload || payload.status === 'failed' || payload.isError === true) {
    throw new Error(`${key} failed: ${JSON.stringify(payload).slice(0, 700)}`);
  }
  return payload;
}

// --- env ---------------------------------------------------------------------

function loadMountedEnv() {
  const file = '/env/argo.env';
  if (!fs.existsSync(file)) return null;
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
  return env;
}

function prepareBaseEnv() {
  const mounted = loadMountedEnv();
  if (!mounted) return { skipped: true };
  const merged = { ...mounted };
  merged.ARGO_NEO4J_DATABASE_URL = (merged.ARGO_NEO4J_DATABASE_URL || 'neo4j://127.0.0.1:7687').replace(/127\.0\.0\.1|localhost/g, 'host.docker.internal');
  for (const [k, v] of Object.entries(merged)) process.env[k] = v;
  return { skipped: false, neo4jUrl: merged.ARGO_NEO4J_DATABASE_URL, embeddingModel: merged.ARGO_EMBEDDING_MODEL || '(default)' };
}

function useDatabase(ws, db) {
  process.env.ARGO_NEO4J_DATABASE = db;
  const dest = path.join(ws, '.argo', 'env.argo.env');
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const lines = ENV_SUPPORTED_KEYS.filter((k) => process.env[k] !== undefined).map((k) => `${k}=${process.env[k]}`);
  fs.writeFileSync(dest, lines.join('\n') + '\n', { mode: 0o600 });
  process.env.ARGO_ENV_FILE = dest;
}

// --- scenarios ---------------------------------------------------------------

function customScenario() {
  const ws = WS_CUSTOM;
  return {
    label: 'custom schema (Team Graph)',
    ws,
    db: 'argob-schema-custom',
    schema: { kind: 'workspace', language: 'Team Graph', actor: 'Agent Node' },
    mentions: /team-a|svc-a|svc-b|Team A|Service A|Service B/,
    minRows: 4,
    reads: [
      { key: 'getSystemArchitecture', name: 'getSystemArchitecture', arguments: { workspaceRoot: ws, query: { purpose: 'general', intent: 'which service does the team depend on' } } },
      { key: 'getIntentElementContext', name: 'getIntentElementContext', arguments: { workspaceRoot: ws, elementId: 'team-a' } },
      { key: 'getArchitectureViewContext', name: 'getArchitectureViewContext', arguments: { workspaceRoot: ws, view_id: 'view-root' } },
      { key: 'queryNeo4jGraphSchema', name: 'queryNeo4jGraph', arguments: { workspaceRoot: ws, schema: true } },
      { key: 'queryNeo4jGraphCypher', name: 'queryNeo4jGraph', arguments: { workspaceRoot: ws, cypher: 'MATCH (e:Element {graphKey: $graphKey}) RETURN e.id AS id ORDER BY id' } },
      { key: 'memory_search', name: 'memory_search', arguments: { workspaceRoot: ws, query: 'team and service dependency', top_k: 5 } },
      { key: 'validate', name: 'validateSystemArchitecture', arguments: { workspaceRoot: ws } },
    ],
    writes: [
      { key: 'addElement', name: 'addArchitectureElement', arguments: { workspaceRoot: ws, onConflict: 'allowDuplicate', justification: 'verification element', element: { id: 'svc-c', name: 'Service C', type: 'Service Node', description: 'A verification service.' }, view_ids: ['view-root'] } },
      { key: 'updateElement', name: 'updateArchitectureElement', arguments: { workspaceRoot: ws, id: 'svc-c', acknowledgeLoss: true, patch: { description: 'A verification service (updated).' } } },
      { key: 'addRelationship', name: 'addArchitectureRelationship', arguments: { workspaceRoot: ws, relationship: { id: 'rel-4', name: 'Service C depends on Service B', type: 'Depends On', source_id: 'svc-c', target_id: 'svc-b', source_name: 'Service C', target_name: 'Service B', statement: 'Service C --(Depends On)--> Service B' }, view_ids: ['view-root'] } },
      { key: 'addRelationship2', name: 'addArchitectureRelationship', arguments: { workspaceRoot: ws, relationship: { id: 'rel-5', name: 'Service B depends on Service A', type: 'Depends On', source_id: 'svc-b', target_id: 'svc-a', source_name: 'Service B', target_name: 'Service A', statement: 'Service B --(Depends On)--> Service A' }, view_ids: ['view-root'] } },
      { key: 'updateRelationship', name: 'updateArchitectureRelationship', arguments: { workspaceRoot: ws, id: 'rel-5', acknowledgeLoss: true, patch: { name: 'Service B depends on Service A (updated)' } } },
      { key: 'preview', name: 'previewSystemArchitectureMutation', arguments: { workspaceRoot: ws, acknowledgeLoss: true, mutations: [{ type: 'updateElement', id: 'svc-c', patch: { description: 'preview only' } }] } },
      { key: 'apply', name: 'applySystemArchitectureMutation', arguments: { workspaceRoot: ws, acknowledgeLoss: true, mutations: [{ type: 'updateElement', id: 'svc-c', patch: { description: 'A verification service (applied).' } }] } },
      { key: 'addView', name: 'addArchitectureView', arguments: { workspaceRoot: ws, view: { view_id: 'view-svc', view_name: 'Service View', parent_element_id: 'svc-a', parent_element_name: 'Service A', description: 'Example sub-view.', included_elements: ['svc-a', 'svc-b'], included_relationships: ['rel-3'] } } },
      { key: 'updateView', name: 'updateArchitectureView', arguments: { workspaceRoot: ws, view_id: 'view-svc', acknowledgeLoss: true, patch: { description: 'Example sub-view (updated).' } } },
      { key: 'removeView', name: 'removeArchitectureView', arguments: { workspaceRoot: ws, view_id: 'view-svc', acknowledgeLoss: true } },
      { key: 'removeRelationship', name: 'removeArchitectureRelationship', arguments: { workspaceRoot: ws, id: 'rel-5', acknowledgeLoss: true } },
      { key: 'removeElement', name: 'removeArchitectureElement', arguments: { workspaceRoot: ws, id: 'svc-c', acknowledgeLoss: true } },
      { key: 'validateAfterWrites', name: 'validateSystemArchitecture', arguments: { workspaceRoot: ws } },
      { key: 'runArchitectureTests', name: 'runArchitectureTests', arguments: { workspaceRoot: ws } },
    ],
  };
}

function defaultScenario() {
  const ws = WS_DEFAULT;
  return {
    label: 'default schema (ArgoBument / ArchiMate 3.2)',
    ws,
    db: 'argob-schema-default',
    schema: { kind: 'default', language: 'ArchiMate 3.2', actor: 'Business Actor' },
    mentions: /1249|1240|project-manager-001|Implementation and Migration|Application Cooperation/,
    minRows: 3,
    reads: [
      { key: 'getSystemArchitecture', name: 'getSystemArchitecture', arguments: { workspaceRoot: ws, query: { purpose: 'general', intent: 'implementation and migration viewpoint and application cooperation' } } },
      { key: 'getIntentElementContext', name: 'getIntentElementContext', arguments: { workspaceRoot: ws, elementId: '1249' } },
      { key: 'getArchitectureViewContext', name: 'getArchitectureViewContext', arguments: { workspaceRoot: ws, view_id: '170' } },
      { key: 'queryNeo4jGraphSchema', name: 'queryNeo4jGraph', arguments: { workspaceRoot: ws, schema: true } },
      { key: 'queryNeo4jGraphCypher', name: 'queryNeo4jGraph', arguments: { workspaceRoot: ws, cypher: 'MATCH (e:Element {graphKey: $graphKey}) RETURN e.id AS id ORDER BY id' } },
      { key: 'memory_search', name: 'memory_search', arguments: { workspaceRoot: ws, query: 'implementation and migration viewpoint', top_k: 5 } },
      { key: 'validate', name: 'validateSystemArchitecture', arguments: { workspaceRoot: ws } },
    ],
    writes: [
      { key: 'addElement', name: 'addArchitectureElement', arguments: { workspaceRoot: ws, onConflict: 'allowDuplicate', justification: 'verification element', element: { id: 'verify-actor-001', name: 'Verification Actor', type: 'Business Actor', description: 'Verification-only actor.' }, view_ids: ['170'] } },
      { key: 'updateElement', name: 'updateArchitectureElement', arguments: { workspaceRoot: ws, id: 'verify-actor-001', acknowledgeLoss: true, patch: { description: 'Verification-only actor (updated).' } } },
      { key: 'addRelationship', name: 'addArchitectureRelationship', arguments: { workspaceRoot: ws, relationship: { id: 'verify-rel-001', name: 'Verification Association', type: 'Association', source_id: 'verify-actor-001', target_id: '1249', source_name: 'Verification Actor', target_name: 'Implementation and Migration Viewpoint', statement: 'Verification Actor --(Association)--> Implementation and Migration Viewpoint' }, view_ids: ['170'] } },
      { key: 'addRelationship2', name: 'addArchitectureRelationship', arguments: { workspaceRoot: ws, relationship: { id: 'verify-rel-002', name: 'Verification Association 2', type: 'Association', source_id: '1249', target_id: '1240', source_name: 'Implementation and Migration Viewpoint', target_name: 'Application Cooperation Viewpoint', statement: 'Implementation and Migration Viewpoint --(Association)--> Application Cooperation Viewpoint' }, view_ids: ['170'] } },
      { key: 'updateRelationship', name: 'updateArchitectureRelationship', arguments: { workspaceRoot: ws, id: 'verify-rel-002', acknowledgeLoss: true, patch: { name: 'Verification Association 2 (updated)' } } },
      { key: 'preview', name: 'previewSystemArchitectureMutation', arguments: { workspaceRoot: ws, acknowledgeLoss: true, mutations: [{ type: 'updateElement', id: 'verify-actor-001', patch: { description: 'preview only' } }] } },
      { key: 'apply', name: 'applySystemArchitectureMutation', arguments: { workspaceRoot: ws, acknowledgeLoss: true, mutations: [{ type: 'updateElement', id: 'verify-actor-001', patch: { description: 'Verification-only actor (applied).' } }] } },
      { key: 'addView', name: 'addArchitectureView', arguments: { workspaceRoot: ws, view: { view_id: 'verify-view-001', view_name: 'Verification View', parent_element_id: '1249', parent_element_name: 'Implementation and Migration Viewpoint', description: 'Verification sub-view.', included_elements: ['1249', '1240'], included_relationships: ['1161'] } } },
      { key: 'updateView', name: 'updateArchitectureView', arguments: { workspaceRoot: ws, view_id: 'verify-view-001', acknowledgeLoss: true, patch: { description: 'Verification sub-view (updated).' } } },
      { key: 'removeView', name: 'removeArchitectureView', arguments: { workspaceRoot: ws, view_id: 'verify-view-001', acknowledgeLoss: true } },
      { key: 'removeRelationship', name: 'removeArchitectureRelationship', arguments: { workspaceRoot: ws, id: 'verify-rel-002', acknowledgeLoss: true } },
      { key: 'removeElement', name: 'removeArchitectureElement', arguments: { workspaceRoot: ws, id: 'verify-actor-001', acknowledgeLoss: true } },
      { key: 'validateAfterWrites', name: 'validateSystemArchitecture', arguments: { workspaceRoot: ws } },
      { key: 'runArchitectureTests', name: 'runArchitectureTests', arguments: { workspaceRoot: ws } },
    ],
  };
}

function assertSweep(results, cfg, toolsSeen) {
  const detail = { schema: {}, writes: {} };

  const gsa = assertNotFailed(results.getSystemArchitecture, 'getSystemArchitecture');
  const gsaText = JSON.stringify(gsa);
  if (!cfg.mentions.test(gsaText)) throw new Error(`semantic retrieval returned no expected element: ${gsaText.slice(0, 600)}`);
  detail.getSystemArchitecture = 'semantic hit';

  assertNotFailed(results.getIntentElementContext, 'getIntentElementContext');
  detail.getIntentElementContext = 'ok';

  const vc = assertNotFailed(results.getArchitectureViewContext, 'getArchitectureViewContext');
  if (!Array.isArray(vc.included_elements || (vc.view && vc.view.included_elements))) throw new Error('getArchitectureViewContext missing membership');
  detail.getArchitectureViewContext = 'ok';

  const qs = assertNotFailed(results.queryNeo4jGraphSchema, 'queryNeo4jGraph{schema}');
  const sch = qs.schema || {};
  if (sch.schemaKind !== cfg.schema.kind) throw new Error(`schemaKind=${sch.schemaKind} expected ${cfg.schema.kind}`);
  if (sch.schemaLanguage !== cfg.schema.language) throw new Error(`language=${sch.schemaLanguage} expected ${cfg.schema.language}`);
  if (sch.actorElementType !== cfg.schema.actor) throw new Error(`actorElementType=${sch.actorElementType} expected ${cfg.schema.actor}`);
  if (!sch.bundleValidation || sch.bundleValidation.status !== 'passed') throw new Error(`bundleValidation=${JSON.stringify(sch.bundleValidation)}`);
  detail.queryNeo4jGraphSchema = { kind: sch.schemaKind, language: sch.schemaLanguage, actor: sch.actorElementType };

  const qc = assertNotFailed(results.queryNeo4jGraphCypher, 'queryNeo4jGraph{cypher}');
  if (!Array.isArray(qc.records) || qc.records.length < cfg.minRows) throw new Error(`cypher rows=${qc.records && qc.records.length} expected>=${cfg.minRows}`);
  detail.queryNeo4jGraphCypher = `${qc.records.length} rows`;

  const ms = assertNotFailed(results.memory_search, 'memory_search');
  const hits = ms.hits || ms.results || [];
  if (!Array.isArray(hits) || hits.length < 1) throw new Error(`memory_search hits=${hits.length}`);
  detail.memory_search = `${hits.length} hits`;

  assertNotFailed(results.validate, 'validateSystemArchitecture');
  detail.validate = 'passed';

  for (const key of ['addElement', 'updateElement', 'addRelationship', 'addRelationship2', 'updateRelationship', 'preview', 'apply', 'addView', 'updateView', 'removeView', 'removeRelationship', 'removeElement']) {
    assertNotFailed(results[key], key);
    detail.writes[key] = 'passed';
  }
  assertNotFailed(results.validateAfterWrites, 'validateSystemArchitecture(after writes)');
  detail.validateAfterWrites = 'passed';

  const rat = results.runArchitectureTests;
  if (rat && rat.status === 'failed') throw new Error(`runArchitectureTests failed: ${JSON.stringify(rat).slice(0, 400)}`);
  detail.runArchitectureTests = rat && rat.status;

  return detail;
}

// --- main --------------------------------------------------------------------

async function main() {
  const container = {
    node: String(run('node', ['--version']).stdout || '').trim(),
    opencode: String(run('opencode', ['--version']).stdout || '').trim(),
    host: `${os.platform()} ${os.release()}`,
  };
  const toolsSeen = new Set();
  let baseEnv = { skipped: true };

  await record('setup: copy repo, install ~/.argo, prepare custom + default workspaces', () => {
    mustRun('sh', ['-c', `rm -rf ${WORK} ${WS_DEFAULT} && mkdir -p ${WORK} && cd /repo && tar --exclude=argo/.env -cf - argo tests scripts design docs custom-schema install-argo.ps1 cordis.patch.yml package.json vendor | tar -xf - -C ${WORK}`]);
    mustRun('sh', ['-c', `rm -rf ${ARGO} && mkdir -p ${ARGO} && cp -r ${WORK}/argo/. ${ARGO}/`]);
    mustRun('npm', ['install', '--no-audit', '--no-fund', '--no-save', path.join(WORK, 'vendor', 'neo4j-driver-6.2.0.tgz')], { cwd: ARGO });
    // default-schema workspace = bundled default template graph, no .argo/schema
    mustRun('sh', ['-c', `mkdir -p ${WS_DEFAULT}/design/KG && cp ${WORK}/argo/defaults/design/KG/SystemArchitecture.json ${WS_DEFAULT}/design/KG/SystemArchitecture.json`]);
    return { argoRoot: ARGO, custom: WS_CUSTOM, default: WS_DEFAULT };
  });

  await record('prepare env (real Neo4j via host.docker.internal + real embedding creds)', () => {
    baseEnv = prepareBaseEnv();
    if (baseEnv.skipped) throw new Error('SKIP: mount argo/.env to /env/argo.env');
    return baseEnv;
  });

  await record('MCP advertises the expected tool set', () => {
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ].map((m) => JSON.stringify(m)).join('\n') + '\n';
    const result = spawnSync(process.execPath, [SERVER], { input, encoding: 'utf8', env: { ...process.env, ARGO_REPO_ROOT: WORK, NODE_PATH }, timeout: 60000, killSignal: 'SIGKILL' });
    const line = String(result.stdout || '').split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m && m.id === 2);
    const names = line.result.tools.map((t) => t.name).sort();
    if (names.length !== ALL_TOOLS.length) throw new Error(`tool count ${names.length} != ${ALL_TOOLS.length}`);
    for (const t of ALL_TOOLS) if (!names.includes(t)) throw new Error(`missing tool ${t}`);
    return { count: names.length };
  });

  for (const cfg of [customScenario(), defaultScenario()]) {
    await record(`initializeWorkspace — ${cfg.label}`, async () => {
      useDatabase(cfg.ws, cfg.db);
      const out = await mcpSession([{ key: 'init', name: 'initializeWorkspace', arguments: { workspaceRoot: cfg.ws } }], { ARGO_REPO_ROOT: cfg.ws, NODE_PATH }, { timeoutMs: 240000 });
      const init = assertNotFailed(out.init, 'initializeWorkspace');
      toolsSeen.add('initializeWorkspace');
      const report = init.report || init;
      if (report && report.status && report.status !== 'ok') throw new Error(`init status=${report.status}: ${JSON.stringify(report).slice(0, 700)}`);
      // The init result must name the active schema (default vs custom + language).
      const schemaInfo = report.schemaBundle || init.schemaBundle || init.schema;
      if (!schemaInfo || schemaInfo.kind !== cfg.schema.kind) throw new Error(`init schema.kind=${schemaInfo && schemaInfo.kind} expected ${cfg.schema.kind}: ${JSON.stringify(schemaInfo)}`);
      if (schemaInfo.language !== cfg.schema.language) throw new Error(`init schema.language=${schemaInfo.language} expected ${cfg.schema.language}`);
      if (schemaInfo.actorElementType !== cfg.schema.actor) throw new Error(`init schema.actorElementType=${schemaInfo.actorElementType} expected ${cfg.schema.actor}`);
      // The .qea projection must run for ANY schema (generic mapping), never skip.
      const qea = init.qeaFullProjection || report.qeaFullProjection;
      if (!qea || qea.status !== 'ok') throw new Error(`.qea projection not ok for ${cfg.schema.kind} schema: ${JSON.stringify(qea)}`);
      return { status: report && report.status, qeaProjection: qea.status, neo4j: report && report.neo4j && report.neo4j.status, semantic: report && report.semanticLifecycle && report.semanticLifecycle.state, schema: { kind: schemaInfo.kind, language: schemaInfo.language, dialect: schemaInfo.dialect, actorElementType: schemaInfo.actorElementType } };
    });

    await record(`all 19 MCP interfaces — ${cfg.label}`, async () => {
      useDatabase(cfg.ws, cfg.db);
      const calls = [...cfg.reads, ...cfg.writes];
      for (const c of calls) toolsSeen.add(c.name);
      const results = await mcpSession(calls, { ARGO_REPO_ROOT: cfg.ws, NODE_PATH });
      toolsSeen.add('runArchitectureTests');
      const detail = assertSweep(results, cfg, toolsSeen);
      const missing = ALL_TOOLS.filter((t) => !toolsSeen.has(t));
      if (missing.length > 0) throw new Error(`tools not exercised: ${missing.join(', ')}`);
      detail.toolsExercised = ALL_TOOLS.length;
      return detail;
    });
  }

  // Replace the INSTALLED default bundle (~/.argo/schema) with a custom bundle and
  // prove a plain workspace (no .argo/schema) now adopts it -> the default schema
  // is replaceable, not hard-wired.
  await record('the installed default bundle is replaceable (swap ~/.argo/schema)', async () => {
    delete process.env.ARGO_SCHEMA_DIR;
    mustRun('sh', ['-c', `rm -rf ${ARGO}/schema && cp -r ${WORK}/custom-schema/.argo/schema ${ARGO}/schema && mkdir -p /ws-replaced/design/KG && cp ${WORK}/custom-schema/design/KG/SystemArchitecture.json /ws-replaced/design/KG/SystemArchitecture.json`]);
    const out = await mcpSession([
      { key: 'schema', name: 'queryNeo4jGraph', arguments: { workspaceRoot: '/ws-replaced', schema: true } },
    ], { ARGO_REPO_ROOT: '/ws-replaced', NODE_PATH }, { timeoutMs: 60000 });
    const sch = out.schema.schema || {};
    if (sch.schemaKind !== 'default') throw new Error(`expected kind=default after swap, got ${sch.schemaKind}`);
    if (sch.schemaLanguage !== 'Team Graph') throw new Error(`expected replaced default language 'Team Graph', got ${sch.schemaLanguage}`);
    if (sch.actorElementType !== 'Agent Node') throw new Error(`expected replaced default actor 'Agent Node', got ${sch.actorElementType}`);
    return { kind: sch.schemaKind, language: sch.schemaLanguage, actorElementType: sch.actorElementType };
  });

  const failed = steps.filter((s) => s.status === 'failed');
  const skipped = failed.some((s) => /^SKIP:/.test(s.error || ''));
  const report = {
    status: failed.length === 0 ? 'passed' : (skipped ? 'skipped' : 'failed'),
    generatedAt: new Date().toISOString(),
    container, env: baseEnv, tools: { total: ALL_TOOLS.length, exercised: toolsSeen.size },
    passed: steps.length - failed.length, total: steps.length, steps,
  };
  try { fs.mkdirSync(RESULTS_DIR, { recursive: true }); fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2)); } catch (e) { console.log(`[warn] report not written: ${e.message}`); }
  console.log(`\n${report.passed}/${report.total} checks passed, status=${report.status} -> ${REPORT_PATH}`);
  process.exit(failed.length === 0 ? 0 : (skipped ? 2 : 1));
}

main().catch((error) => { console.error(error); process.exit(1); });
