'use strict';

// Full-surface verification: under a CUSTOM schema (Team Graph), exercise EVERY
// ARGO MCP interface — retrieval (incl. semantic), writes (element/relationship/
// view add/update/remove + preview/apply), validation, structural Cypher, memory
// search, init and the architecture-test runner — against a REAL Neo4j + REAL
// embedding provider.
//
// Unlike verify.js (schema-resolution only, no infra), this runs the full
// semantic lifecycle: it reaches the host Neo4j through host.docker.internal
// (separate test database) and the embedding provider using the mounted
// /env/argo.env credentials.
//
// Writes results/schema-decoupling-all-report.json; exits non-zero on failure.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = process.env.HOME || '/root';
const ARGO = path.join(HOME, '.argo');
const WORK = '/work';
const WS = path.join(WORK, 'custom-schema'); // the shipped Team Graph example workspace
const RESULTS_DIR = fs.existsSync('/results') ? '/results' : '/tmp';
const REPORT_PATH = path.join(RESULTS_DIR, 'schema-decoupling-all-report.json');
const TEST_DB = 'argob-schema-test';

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

// --- one MCP server session, sequential tool calls --------------------------

function mcpSession(serverPath, calls, env, opts = {}) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'schema-all', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: c.name, arguments: c.arguments } })),
  ];
  const input = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  const expected = calls.map((c, i) => 100 + i);
  const timeoutMs = opts.timeoutMs || 240000;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
      const out = { __timedOut: false };
      calls.forEach((c, i) => {
        try { out[c.key] = JSON.parse(byId[100 + i].result.content[0].text); } catch { out[c.key] = { raw: byId[100 + i].result.content[0].text }; }
      });
      resolve(out);
    };
    const timer = setTimeout(() => finish(new Error(`MCP session timeout; missing: ${missing().join(', ')}\n${stderr.slice(0, 800)}`)), timeoutMs);
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
    child.on('error', (err) => finish(new Error(`MCP spawn error: ${err.message}`)));
    child.on('exit', () => { if (!expected.every((id) => byId[id])) finish(new Error(`MCP server exited early; missing: ${missing().join(', ')}\n${stderr.slice(0, 800)}`)); });
    child.stdin.on('error', () => { /* ignore EPIPE */ });
    child.stdin.write(input);
    child.stdin.end();
  });
}

function assertNotFailed(payload, key) {
  if (!payload || payload.status === 'failed' || payload.isError === true) {
    throw new Error(`${key} failed: ${JSON.stringify(payload).slice(0, 800)}`);
  }
  return payload;
}

// --- env / setup -------------------------------------------------------------

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

function prepareEnvironment() {
  const mounted = loadMountedEnv();
  if (!mounted) return { skipped: true, reason: 'no /env/argo.env mounted' };
  const merged = { ...mounted };
  const url = merged.ARGO_NEO4J_DATABASE_URL || 'neo4j://127.0.0.1:7687';
  merged.ARGO_NEO4J_DATABASE_URL = url.replace(/127\.0\.0\.1|localhost/g, 'host.docker.internal');
  merged.ARGO_NEO4J_DATABASE = TEST_DB;
  for (const [k, v] of Object.entries(merged)) process.env[k] = v;

  // container-local 0600 env file (Windows bind mount shows as 0644 -> POSIX ACL preflight fails)
  const dest = path.join(WS, '.argo', 'env.argo.env');
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const lines = ENV_SUPPORTED_KEYS.filter((k) => process.env[k] !== undefined).map((k) => `${k}=${process.env[k]}`);
  fs.writeFileSync(dest, lines.join('\n') + '\n', { mode: 0o600 });
  process.env.ARGO_ENV_FILE = dest;
  return { skipped: false, neo4jUrl: merged.ARGO_NEO4J_DATABASE_URL, database: TEST_DB, embeddingModel: merged.ARGO_EMBEDDING_MODEL || '(default)' };
}

function validateExampleGraph() {
  const g = JSON.parse(fs.readFileSync(path.join(WS, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
  const ids = new Set((g.elements || []).map((e) => e.id));
  if (!ids.has('team-a') || !ids.has('svc-a')) throw new Error('example graph missing expected elements');
}

// --- main --------------------------------------------------------------------

async function main() {
  const container = {
    node: String(run('node', ['--version']).stdout || '').trim(),
    opencode: String(run('opencode', ['--version']).stdout || '').trim(),
    host: `${os.platform()} ${os.release()}`,
  };
  let env = { skipped: true, reason: 'not prepared' };

  await record('copy repo + install toolchain to ~/.argo', () => {
    mustRun('sh', ['-c', `rm -rf ${WORK} && mkdir -p ${WORK} && cd /repo && tar --exclude=argo/.env -cf - argo tests scripts design docs custom-schema install-argo.ps1 cordis.patch.yml package.json vendor | tar -xf - -C ${WORK}`]);
    mustRun('sh', ['-c', `rm -rf ${ARGO} && mkdir -p ${ARGO} && cp -r ${WORK}/argo/. ${ARGO}/`]);
    mustRun('npm', ['install', '--no-audit', '--no-fund', '--no-save', path.join(WORK, 'vendor', 'neo4j-driver-6.2.0.tgz')], { cwd: ARGO });
    return { argoRoot: ARGO, workspace: WS };
  });

  await record('prepare env (host Neo4j via host.docker.internal + mounted embedding creds)', () => {
    env = prepareEnvironment();
    if (env.skipped) throw new Error(`SKIP: ${env.reason} (mount argo/.env to /env/argo.env to run the full test)`);
    validateExampleGraph();
    return env;
  });

  await record('initializeWorkspace on a custom-schema workspace (Neo4j sync + semantic lifecycle)', async () => {
    const server = path.join(ARGO, 'scripts', 'argo-mcp-server.js');
    const out = await mcpSession(server, [
      { key: 'init', name: 'initializeWorkspace', arguments: { workspaceRoot: WS } },
    ], { ARGO_REPO_ROOT: WS, NODE_PATH: path.join(ARGO, 'node_modules') }, { timeoutMs: 180000 });
    const init = assertNotFailed(out.init, 'initializeWorkspace');
    const report = init.report || init;
    if (report && report.status && report.status !== 'ok') throw new Error(`init report status=${report.status}: ${JSON.stringify(report).slice(0, 700)}`);
    return { initStatus: report && report.status, neo4j: report && report.neo4j && report.neo4j.status, semantic: report && report.semanticLifecycle && report.semanticLifecycle.state };
  });

  await record('all MCP interfaces under the custom schema (retrieval/writes/validation)', async () => {
    const server = path.join(ARGO, 'scripts', 'argo-mcp-server.js');
    const results = await mcpSession(server, [
      // ---- reads / retrieval ----
      { key: 'getSystemArchitecture', name: 'getSystemArchitecture', arguments: { workspaceRoot: WS, query: { purpose: 'general', intent: 'which service does the team depend on' } } },
      { key: 'getIntentElementContext', name: 'getIntentElementContext', arguments: { workspaceRoot: WS, elementId: 'team-a' } },
      { key: 'getArchitectureViewContext', name: 'getArchitectureViewContext', arguments: { workspaceRoot: WS, view_id: 'view-root' } },
      { key: 'queryNeo4jGraphSchema', name: 'queryNeo4jGraph', arguments: { workspaceRoot: WS, schema: true } },
      { key: 'queryNeo4jGraphCypher', name: 'queryNeo4jGraph', arguments: { workspaceRoot: WS, cypher: 'MATCH (e:Element {graphKey: $graphKey}) RETURN e.id AS id ORDER BY id' } },
      { key: 'memory_search', name: 'memory_search', arguments: { workspaceRoot: WS, query: 'team and service dependency', top_k: 5 } },
      // ---- validation ----
      { key: 'validate', name: 'validateSystemArchitecture', arguments: { workspaceRoot: WS } },
      // ---- writes ----
      { key: 'addElement', name: 'addArchitectureElement', arguments: { workspaceRoot: WS, onConflict: 'allowDuplicate', justification: 'new example element', element: { id: 'svc-c', name: 'Service C', type: 'Service Node', description: 'A newly added service.' }, view_ids: ['view-root'] } },
      { key: 'updateElement', name: 'updateArchitectureElement', arguments: { workspaceRoot: WS, id: 'svc-c', acknowledgeLoss: true, patch: { description: 'A newly added service (updated).' } } },
      { key: 'addRelationship', name: 'addArchitectureRelationship', arguments: { workspaceRoot: WS, relationship: { id: 'rel-4', name: 'Service C depends on Service B', type: 'Depends On', source_id: 'svc-c', target_id: 'svc-b', source_name: 'Service C', target_name: 'Service B', statement: 'Service C --(Depends On)--> Service B' }, view_ids: ['view-root'] } },
      { key: 'updateRelationship', name: 'updateArchitectureRelationship', arguments: { workspaceRoot: WS, id: 'rel-4', acknowledgeLoss: true, patch: { name: 'Service C depends on Service B (updated)' } } },
      { key: 'preview', name: 'previewSystemArchitectureMutation', arguments: { workspaceRoot: WS, acknowledgeLoss: true, mutations: [{ type: 'updateElement', id: 'svc-c', patch: { description: 'preview only' } }] } },
      { key: 'apply', name: 'applySystemArchitectureMutation', arguments: { workspaceRoot: WS, acknowledgeLoss: true, mutations: [{ type: 'updateElement', id: 'svc-c', patch: { description: 'A newly added service (applied).' } }] } },
      { key: 'addView', name: 'addArchitectureView', arguments: { workspaceRoot: WS, view: { view_id: 'view-svc', view_name: 'Service View', parent_element_id: 'svc-a', parent_element_name: 'Service A', description: 'Example sub-view.', included_elements: ['svc-a', 'svc-b'], included_relationships: ['rel-3'] } } },
      { key: 'updateView', name: 'updateArchitectureView', arguments: { workspaceRoot: WS, view_id: 'view-svc', acknowledgeLoss: true, patch: { description: 'Example sub-view (updated).' } } },
      { key: 'removeView', name: 'removeArchitectureView', arguments: { workspaceRoot: WS, view_id: 'view-svc', acknowledgeLoss: true } },
      { key: 'removeRelationship', name: 'removeArchitectureRelationship', arguments: { workspaceRoot: WS, id: 'rel-2', acknowledgeLoss: true } },
      { key: 'removeElement', name: 'removeArchitectureElement', arguments: { workspaceRoot: WS, id: 'svc-c', acknowledgeLoss: true } },
      { key: 'validateAfterWrites', name: 'validateSystemArchitecture', arguments: { workspaceRoot: WS } },
      // ---- test runner ----
      { key: 'runArchitectureTests', name: 'runArchitectureTests', arguments: { workspaceRoot: WS } },
    ], { ARGO_REPO_ROOT: WS, NODE_PATH: path.join(ARGO, 'node_modules') });

    const detail = {};

    const gsa = assertNotFailed(results.getSystemArchitecture, 'getSystemArchitecture');
    const gsaText = JSON.stringify(gsa);
    if (!(/team-a|svc-a|svc-b|Team A|Service A|Service B/.test(gsaText))) {
      throw new Error(`semantic retrieval returned no custom-schema element: ${gsaText.slice(0, 700)}`);
    }
    detail.getSystemArchitecture = { semantic: true, mentionsCustomElement: true };

    const ico = assertNotFailed(results.getIntentElementContext, 'getIntentElementContext');
    if (!JSON.stringify(ico).includes('team-a')) throw new Error('getIntentElementContext missing focus element');
    detail.getIntentElementContext = true;

    const vc = assertNotFailed(results.getArchitectureViewContext, 'getArchitectureViewContext');
    if (!Array.isArray(vc.included_elements || (vc.view && vc.view.included_elements))) throw new Error('getArchitectureViewContext missing membership');
    detail.getArchitectureViewContext = true;

    const qs = assertNotFailed(results.queryNeo4jGraphSchema, 'queryNeo4jGraph{schema}');
    if (qs.schema.schemaKind !== 'workspace' || qs.schema.schemaLanguage !== 'Team Graph') throw new Error(`schema projection wrong: ${JSON.stringify(qs.schema).slice(0, 400)}`);
    detail.queryNeo4jGraphSchema = { language: qs.schema.schemaLanguage, actorElementType: qs.schema.actorElementType, bundleValidation: qs.schema.bundleValidation && qs.schema.bundleValidation.status };

    const qc = assertNotFailed(results.queryNeo4jGraphCypher, 'queryNeo4jGraph{cypher}');
    if (!Array.isArray(qc.records) || qc.records.length < 4) throw new Error(`structural cypher returned ${qc.records && qc.records.length} rows`);

    // semantic retrieval via the server's own query path (queryNeo4jGraph returned custom rows)

    const ms = assertNotFailed(results.memory_search, 'memory_search');
    const hits = ms.hits || ms.results || [];
    if (!Array.isArray(hits) || hits.length < 1) throw new Error(`memory_search returned no hits: ${JSON.stringify(ms).slice(0, 500)}`);
    detail.memory_search = { hits: hits.length };

    const v1 = assertNotFailed(results.validate, 'validateSystemArchitecture');
    detail.validate = v1.status;

    for (const key of ['addElement', 'updateElement', 'addRelationship', 'updateRelationship', 'preview', 'apply', 'addView', 'updateView', 'removeView', 'removeRelationship', 'removeElement']) {
      assertNotFailed(results[key], key);
      detail[key] = results[key].status;
    }
    const v2 = assertNotFailed(results.validateAfterWrites, 'validateSystemArchitecture(after writes)');
    detail.validateAfterWrites = v2.status;

    const rat = results.runArchitectureTests;
    if (rat && rat.status === 'failed' && !/no testcase|0 testcase/i.test(JSON.stringify(rat))) {
      throw new Error(`runArchitectureTests failed: ${JSON.stringify(rat).slice(0, 500)}`);
    }
    detail.runArchitectureTests = rat && rat.status;

    return detail;
  });

  const failed = steps.filter((s) => s.status === 'failed');
  const skipped = failed.some((s) => /^SKIP:/.test(s.error || ''));
  const report = {
    status: failed.length === 0 ? 'passed' : (skipped ? 'skipped' : 'failed'),
    generatedAt: new Date().toISOString(),
    container, env, passed: steps.length - failed.length, total: steps.length, steps,
  };
  try { fs.mkdirSync(RESULTS_DIR, { recursive: true }); fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2)); } catch (e) { console.log(`[warn] report not written: ${e.message}`); }
  console.log(`\n${report.passed}/${report.total} checks passed, status=${report.status} -> ${REPORT_PATH}`);
  process.exit(failed.length === 0 ? 0 : (skipped ? 2 : 1));
}

main().catch((error) => { console.error(error); process.exit(1); });
