#!/usr/bin/env node
'use strict';
/**
 * Probe: after the exact same A-side flow as lmem-comparison.js
 * (init -> argo-init -> ingest A -> argo-init#2), call memory_search
 * directly (in-process) and print its raw result, so we can see whether
 * memory_search returns hits or fails in the sandbox.
 *
 * Run inside the container with the same mounts as the comparison:
 *   RUN_PROBE_MEMORY_SEARCH=1 node /opt/sandbox/probe-memory-search.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOME = process.env.USERPROFILE || process.env.HOME || '/root';
const WORKSPACE = process.env.ARGO_REPO_ROOT || '/workspace';
const PACKAGE = '/tmp/install/node_modules/archgraph-argo';
const SEL = process.env.SEL_PATH || '/opt/lmem-selection.json';
const ENV_FILE = process.env.ENV_FILE || '/env/argo.env';
const NEO4J_DRIVER = path.join(HOME, '.argo/node_modules/neo4j-driver');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k) process.env[k] = v;
  }
}
loadEnvFile(ENV_FILE);
if (!process.env.ARGO_NEO4J_DATABASE) process.env.ARGO_NEO4J_DATABASE = 'sandbox';
process.env.ARGO_NEO4J_DATABASE_URL = (process.env.ARGO_NEO4J_DATABASE_URL || 'neo4j://127.0.0.1:7687')
  .replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');

const questions = JSON.parse(fs.readFileSync(SEL, 'utf8'));
const { callTool } = require(path.join(PACKAGE, 'argo/scripts/argo-mcp-server.js'));

function prepareEnvFileForPosix() {
  const dest = path.join(WORKSPACE, '.argo', 'env.argo.env');
  const keys = ['ARGO_EMBEDDING_BASE_URL','ARGO_EMBEDDING_MODEL','ARGO_EMBEDDING_PROVIDER',
    'ARGO_EMBEDDING_MODEL_VERSION','ARGO_EMBEDDING_DIMENSIONS','ARGO_NEO4J_DATABASE_URL',
    'ARGO_NEO4J_DATABASE_USERNAME','ARGO_NEO4J_DATABASE_PASSWORD','QWEN_KEY','ARGO_NEO4J_DATABASE',
    'ARGO_LIVE_PROVIDER_E2E','ARGO_W31_LIVE_MUTATION_VECTOR_E2E','ARGO_SEMANTIC_MEMORY_THRESHOLD',
    'ARGO_SEMANTIC_AUDIT_THRESHOLD','ARGO_SEMANTIC_TOP_K'];
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    const lines = keys.filter(k => process.env[k] !== undefined).map(k => `${k}=${process.env[k]}`);
    fs.writeFileSync(dest, lines.join('\n') + '\n', { mode: 0o600 });
    process.env.ARGO_ENV_FILE = dest;
    return dest;
  } catch (e) { return ENV_FILE; }
}

function argoInit() {
  const script = path.join(HOME, '.argo/scripts/ensureArgoHarnessEnvironment.js');
  const envFile = prepareEnvFileForPosix();
  const s = spawnSync(process.execPath, [script], {
    env: { ...process.env, ARGO_REPO_ROOT: WORKSPACE, ARGO_ENV_FILE: envFile },
    cwd: WORKSPACE, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
  });
  let report = {};
  try { report = JSON.parse(fs.readFileSync(path.join(WORKSPACE, '.argo/temp/argo-harness-init-report.json'), 'utf8')); } catch (_) {}
  return { ok: s.status === 0 && report.status === 'ok', status: report.status || 'unknown', code: s.status };
}

async function ingestA() {
  const viewId = 'lmem-compare-view-001';
  const out = { view: false, elements: 0, errors: [] };
  try {
    const r = await callTool('addArchitectureView', {
      view: { view_id: viewId, view_name: '用户会话记忆', parent_element_id: '1249',
              description: '用户的跨会话对话记忆（A 组记忆后端摄入）',
              included_elements: [], included_relationships: [] },
      workspaceRoot: WORKSPACE,
    }, null, undefined);
    out.view = (r && r.status === 'passed') || (r && r.written === true);
  } catch (e) { out.errors.push(`addArchitectureView: ${e.message}`); }
  for (const q of questions) {
    try {
      const r = await callTool('addArchitectureElement', {
        element: { id: `lmem-a-${q.qid}`, name: `用户会话记忆 ${q.qid}`, type: 'Business Object', description: q.haystack },
        view_ids: [viewId], workspaceRoot: WORKSPACE,
      }, null, undefined);
      out.elements += 1;
    } catch (e) { out.errors.push(`addArchitectureElement ${q.qid}: ${e.message}`); }
  }
  return out;
}

async function main() {
  const log = [];
  log.push(`[probe] questions=${questions.length}`);
  log.push(`[probe] init...`);
  const init = await callTool('initializeWorkspace', { workspaceRoot: WORKSPACE }, null, undefined);
  log.push(`[probe] init done`);
  const i1 = argoInit(); log.push(`[probe] argo-init#1: ${JSON.stringify(i1)}`);
  const aIng = await ingestA(); log.push(`[probe] ingest A: ${JSON.stringify(aIng)}`);
  const i2 = argoInit(); log.push(`[probe] argo-init#2: ${JSON.stringify(i2)}`);

  // Direct in-process memory_search for the first 3 questions
  for (const q of questions.slice(0, 3)) {
    const s = await callTool('memory_search', { query: q.question, top_k: 8, workspaceRoot: WORKSPACE }, null, undefined);
    const text = (s && s.content && s.content[0] && s.content[0].text) || JSON.stringify(s);
    let parsed; try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
    const hits = parsed && parsed.hits ? parsed.hits : [];
    log.push(`[probe] memory_search q=${q.qid} status=${parsed && parsed.status} hits=${hits.length}`);
    for (const h of hits.slice(0, 8)) {
      log.push(`[probe]   - id=${h.id} score=${typeof h.score === 'number' ? h.score.toFixed(4) : h.score} name=${String(h.name || '').slice(0, 40)} descLen=${String(h.description || '').length}`);
    }
    log.push(`[probe]   raw=${text.slice(0, 300)}`);
  }

  // Compare with getSystemArchitecture (same purpose path) for question 0
  const q0 = questions[0];
  const g = await callTool('getSystemArchitecture', {
    query: { purpose: 'general', intent: q0.question }, workspaceRoot: WORKSPACE,
  }, null, undefined);
  const gText = (g && g.content && g.content[0] && g.content[0].text) || JSON.stringify(g);
  log.push(`[probe] getSystemArchitecture q=${q0.qid} raw=${gText.slice(0, 400)}`);

  // ── MCP stdio path (replicates the agent's call route) ──────────────────
  // Spawn the deployed argo MCP server and call memory_search over stdio
  // exactly as opencode does, to see whether the tool result differs from the
  // in-process path (e.g. oversized description being truncated).
  log.push('[probe] --- MCP stdio path ---');
  const serverPath = path.join(HOME, '.argo/scripts/argo-mcp-server.js');
  // Compare deployed copy vs tarball source (memory_search behaviour may differ
  // if the deployed script is stale).
  const pkgServer = path.join(PACKAGE, 'argo/scripts/argo-mcp-server.js');
  const pkgSysArch = path.join(PACKAGE, 'argo/scripts/systemarchitecture-mcp-server.js');
  const depSysArch = path.join(HOME, '.argo/scripts/systemarchitecture-mcp-server.js');
  const sha = s => { try { return require('node:crypto').createHash('sha256').update(fs.readFileSync(s, 'utf8')).digest('hex').slice(0, 12); } catch (_) { return 'MISSING'; } };
  log.push(`[probe] sha tarball argo-mcp-server=${sha(pkgServer)} deployed=${sha(serverPath)}`);
  log.push(`[probe] sha tarball systemarch-mcp=${sha(pkgSysArch)} deployed=${sha(depSysArch)}`);
  const child = spawnSync(process.execPath, [serverPath], {
    env: process.env, cwd: WORKSPACE, encoding: 'utf8',
    input: [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_search', arguments: { query: q0.question, top_k: 8, workspaceRoot: WORKSPACE } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'getSystemArchitecture', arguments: { query: { purpose: 'general', intent: q0.question }, workspaceRoot: WORKSPACE } } }),
    ].join('\n') + '\n',
    maxBuffer: 120 * 1024 * 1024,
  });
  const lines = String(child.stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
  const parsedLines = lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  const resp2 = parsedLines.find(r => r && r.id === 2);
  const resp3 = parsedLines.find(r => r && r.id === 3);
  if (resp2) {
    const result = resp2.result || {};
    const text = (result.content && result.content[0] && result.content[0].text) || JSON.stringify(result);
    log.push(`[probe] MCP stdio memory_search id=2 -> text length=${text.length}`);
    try {
      const p = JSON.parse(text);
      log.push(`[probe] MCP stdio parsed status=${p.status} hits=${(p.hits || []).length}`);
      for (const h of (p.hits || []).slice(0, 3)) {
        log.push(`[probe]   MCP-hit id=${h.id} score=${typeof h.score === 'number' ? h.score.toFixed(4) : h.score} descLen=${String(h.description || '').length}`);
      }
    } catch (_) { log.push(`[probe] MCP stdio payload not JSON: ${text.slice(0, 200)}`); }
  } else {
    log.push(`[probe] MCP stdio NO id=2 response; child exit=${child.status}`);
    log.push(`[probe] MCP stdio stderr=${String(child.stderr || '').slice(-500)}`);
    log.push(`[probe] MCP stdio stdout head=${String(child.stdout || '').slice(0, 500)}`);
  }
  if (resp3) {
    const result = resp3.result || {};
    const text = (result.content && result.content[0] && result.content[0].text) || JSON.stringify(result);
    log.push(`[probe] MCP stdio getSystemArchitecture id=3 -> text length=${text.length} isError=${result.isError}`);
    try {
      const p = JSON.parse(text);
      const els = (p.document && p.document.elements) || (p.result && p.result.businessObjects && p.result.businessObjects.elements) || [];
      log.push(`[probe] MCP stdio GSA status=${p.status} elements=${els.length} mode=${p.query && p.query.mode}`);
    } catch (_) { log.push(`[probe] MCP stdio GSA not JSON: ${text.slice(0, 200)}`); }
  } else {
    log.push(`[probe] MCP stdio NO id=3 response`);
  }

  const out = log.join('\n');
  console.log(out);
  fs.writeFileSync('/results/memory-search-probe.txt', out + '\n', 'utf8');
}

main().catch(e => { console.error('[probe] ERR', e && e.message ? e.message : e); process.exit(1); });
