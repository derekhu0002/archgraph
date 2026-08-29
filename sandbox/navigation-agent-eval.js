#!/usr/bin/env node
'use strict';
/**
 * Full-ArchGraph navigation capability eval via an OpenCode Agent (in Docker).
 *
 * NOT an A/B comparison — this runs the COMPLETE ArchGraph toolchain only. The
 * same OpenCode Agent + DeepSeek navigates the intent graph (the ArchiMate-map)
 * using the full set of argo MCP tools (getSystemArchitecture semantic retrieval,
 * queryNeo4jGraph structural Cypher, getIntentElementContext semantic context,
 * getArchitectureViewContext view membership), and we judge whether the agent
 * actually REACHED the target position (id/name) — i.e. "can an agent navigate
 * the map", not "can the backend answer a fact".
 *
 * Flow:
 *   1. load env + argo init (generate initial graph) + full ARGO instructions
 *   2. configure opencode with ONLY the argo MCP (complete toolchain, no lightrag)
 *   3. for each navigation question: opencode run (agent navigates the graph)
 *   4. judge: does the agent's final answer contain the target id/name?
 *   5. package the RAW agent session record (opencode run NDJSON stream) for
 *      each question into /results/navigation-agent-raw/<NV-xx>.ndjson so every
 *      answer is auditable against the actual agent conversation
 *   6. write /results/navigation-agent-report.json (with rawSessions metadata)
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOME = process.env.USERPROFILE || process.env.HOME || '/root';
const WORKSPACE = process.env.ARGO_REPO_ROOT || '/workspace';
const PACKAGE = '/tmp/install/node_modules/archgraph-argo';
const REPORT = process.env.REPORT_PATH || '/results/navigation-agent-report.json';
const RAW_DIR = process.env.RAW_SESSIONS_DIR || path.join(path.dirname(REPORT), 'navigation-agent-raw');
const ENV_FILE = process.env.ENV_FILE || '/env/argo.env';
const NEO4J_DRIVER = path.join(HOME, '.argo/node_modules/neo4j-driver');

// ── env ─────────────────────────────────────────────────────────────────────
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
process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
process.env.OPENCODE_MODEL = process.env.OPENCODE_MODEL || `deepseek-sandbox/${process.env.DEEPSEEK_MODEL || 'deepseek-chat'}`;

// ── navigation questions (NV-01..20) ─────────────────────────────────────────
// Questions come from the canonical evaluation SEED (data/eval-seeds/
// navigation-seed.json) — the single source of truth for the dataset; add/edit
// questions there and bump the seed version. Resolves the seed path for host
// tests (repo), container runs (/opt/sandbox/navigation-seed.json mount), or an
// explicit NAV_SEED_PATH override.
function resolveSeedPath() {
  if (process.env.NAV_SEED_PATH && fs.existsSync(process.env.NAV_SEED_PATH)) return process.env.NAV_SEED_PATH;
  const candidates = [
    '/opt/sandbox/navigation-seed.json',
    path.join(__dirname, '..', 'data', 'eval-seeds', 'navigation-seed.json'),
    path.join(WORKSPACE, 'data', 'eval-seeds', 'navigation-seed.json'),
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[1];
}
function loadSeedQuestions() {
  const file = resolveSeedPath();
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(seed.questions)) throw new Error(`navigation-seed: missing questions in ${file}`);
  return seed.questions.map(q => ({
    id: q.id, dimension: q.dimension, question: q.question,
    answer: q.target && q.target.id, answerAlt: [...((q.target && q.target.names) || [])],
  }));
}
const QUESTIONS = loadSeedQuestions();

// ── full ARGO instructions (NOT neutral — this eval runs the complete ARGO) ─
const ARGO_AGENTS_MD = `# Full-ArchGraph navigation session
You are an agent navigating the ArchGraph intent map. The map is an ArchiMate
knowledge graph (elements, relationships, views) loaded into the argo memory
backend, which IS mounted in this session.

Available argo tools (use them to navigate the map):
- argo_getSystemArchitecture: semantic retrieval; pass query.purpose + query.intent
  (e.g. purpose "general") to locate relevant
  elements/views by meaning.
- argo_queryNeo4jGraph: structural Cypher over the graph; e.g.
  MATCH (e:Element {graphKey:$graphKey}) RETURN e.id, e.name, e.type
- argo_getIntentElementContext: semantic context of one element (parent chain,
  subdiagram_views, neighbours) — use for following relations / multi-hop.
- argo_getArchitectureViewContext: full membership of one view.

Rules:
1. Inspect the tool list first — the argo tools above are your navigation kit.
2. To follow a parent chain: getIntentElementContext gives the element's parent
   (subgraph.elements[].parent) and subdiagram_views.
3. To list a view's members: getArchitectureViewContext with the view_id.
4. To find an element by name/type: queryNeo4jGraph with a MATCH on e.name/e.type.
5. To find by meaning: getSystemArchitecture semantic query.
6. Do NOT guess ids. Only report ids you actually observed from the tools.
7. End with a DIRECT, concise statement: the reached id(s)/name(s).
8. Use only the tools that actually exist in this session.`;

function writeArgoInstructions() {
  try {
    fs.writeFileSync(path.join(HOME, '.config/opencode/AGENTS.md'), ARGO_AGENTS_MD);
    return true;
  } catch (_) { return false; }
}

function configureArgoOnly() {
  const configPath = path.join(HOME, '.config/opencode/opencode.json');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  if (!baseURL || !process.env.DEEPSEEK_API_KEY) return false;
  const cfg = (() => { try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) { return {}; } })();
  cfg.provider = cfg.provider || {};
  cfg.provider['deepseek-sandbox'] = {
    npm: '@ai-sdk/openai-compatible', name: 'DeepSeek (sandbox)',
    options: { baseURL, apiKey: process.env.DEEPSEEK_API_KEY },
    models: { [model]: { name: model } },
  };
  cfg.mcp = { argo: { type: 'local', command: ['node', path.join(HOME, '.argo/scripts/argo-mcp-server.js')], enabled: true } };
  cfg.model = `deepseek-sandbox/${model}`;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  const v = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return !!(v.mcp && v.mcp.argo);
}

// ── argo MCP (in-process) for init + semantic readiness ────────────────────
// Lazy-load: lets tests import this module on the host without the
// in-container argo package being present.
function loadCallTool() {
  return require(path.join(PACKAGE, 'argo/scripts/argo-mcp-server.js')).callTool;
}

async function initGraph() {
  // Full-ArchGraph navigation eval runs against the PRODUCTION intent graph
  // (165 elements / 40 views), NOT the initializeWorkspace 2-element template.
  // The host orchestrator mounts the repo's design/KG/SystemArchitecture.json to
  // /workspace/design/KG/SystemArchitecture.json before running. If present,
  // copy it into place (entrypoint starts from an empty workspace) so the argo
  // tools serve the production map; otherwise fall back to initializeWorkspace.
  const prodGraph = '/workspace/design/KG/SystemArchitecture.json';
  const mounted = '/opt/navigation-system-architecture.json';
  try {
    if (fs.existsSync(mounted)) {
      fs.mkdirSync(path.dirname(prodGraph), { recursive: true });
      fs.copyFileSync(mounted, prodGraph);
      const d = JSON.parse(fs.readFileSync(prodGraph, 'utf8'));
      console.log(`[nav-agent] production graph loaded: ${(d.elements || []).length} elements / ${(d.views || []).length} views`);
      return (d.elements || []).length > 2;
    }
  } catch (_) { /* fall through */ }
  const init = await loadCallTool()('initializeWorkspace', { workspaceRoot: WORKSPACE }, null, undefined);
  const text = (init && init.content && init.content[0] && init.content[0].text) || JSON.stringify(init);
  return String(text).includes('SystemArchitecture.json');
}

function dropDbs() {
  try {
    const neo4j = require(NEO4J_DRIVER);
    const uri = process.env.ARGO_NEO4J_DATABASE_URL;
    const user = process.env.ARGO_NEO4J_DATABASE_USERNAME;
    const pw = process.env.ARGO_NEO4J_DATABASE_PASSWORD;
    const drv = neo4j.driver(uri, neo4j.auth.basic(user, pw));
    const sess = drv.session({ database: 'system' });
    const dropped = [];
    for (const db of ['sandbox']) {
      try { sess.run(`DROP DATABASE \`${db}\` IF EXISTS`); dropped.push(db); } catch (e) { dropped.push(`${db}:${e.message}`); }
    }
    sess.close(); drv.close();
    return { ok: true, dropped };
  } catch (e) { return { ok: false, error: e.message }; }
}

const ARGO_ENV_SUPPORTED_KEYS = [
  'ARGO_EMBEDDING_BASE_URL', 'ARGO_EMBEDDING_MODEL', 'ARGO_EMBEDDING_PROVIDER',
  'ARGO_EMBEDDING_MODEL_VERSION', 'ARGO_EMBEDDING_DIMENSIONS', 'ARGO_NEO4J_DATABASE_URL',
  'ARGO_NEO4J_DATABASE_USERNAME', 'ARGO_NEO4J_DATABASE_PASSWORD', 'QWEN_KEY',
  'ARGO_NEO4J_DATABASE', 'ARGO_LIVE_PROVIDER_E2E', 'ARGO_W31_LIVE_MUTATION_VECTOR_E2E',
  'ARGO_SEMANTIC_MEMORY_THRESHOLD', 'ARGO_SEMANTIC_AUDIT_THRESHOLD', 'ARGO_SEMANTIC_TOP_K',
];

function prepareEnvFileForPosix() {
  const dest = path.join(WORKSPACE, '.argo', 'env.argo.env');
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    const lines = ARGO_ENV_SUPPORTED_KEYS
      .filter(k => process.env[k] !== undefined)
      .map(k => `${k}=${process.env[k]}`);
    fs.writeFileSync(dest, lines.join('\n') + '\n', { mode: 0o600 });
    process.env.ARGO_ENV_FILE = dest;
    return dest;
  } catch (error) {
    return ENV_FILE;
  }
}

function argoInit() {
  const script = path.join(HOME, '.argo/scripts/ensureArgoHarnessEnvironment.js');
  if (!fs.existsSync(script)) return { ok: false, detail: 'ensureArgoHarnessEnvironment.js missing' };
  const envFile = prepareEnvFileForPosix();
  const s = spawnSync(process.execPath, [script], {
    env: { ...process.env, ARGO_REPO_ROOT: WORKSPACE, ARGO_ENV_FILE: envFile },
    cwd: WORKSPACE, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
  });
  let report = {};
  try { report = JSON.parse(fs.readFileSync(path.join(WORKSPACE, '.argo/temp/argo-harness-init-report.json'), 'utf8')); } catch (_) { /* keep */ }
  return { ok: s.status === 0 && report.status === 'ok', status: report.status || 'unknown', code: s.status };
}

// ── agent run + event parsing ──────────────────────────────────────────────
function runAgent(question) {
  writeArgoInstructions();
  const t0 = Date.now();
  let out = ''; let rawSession = ''; let exit = -1;
  try {
    const r = spawnSync('opencode', ['run', '--format', 'json', question], {
      env: process.env, cwd: WORKSPACE, encoding: 'utf8', timeout: 600000, maxBuffer: 40 * 1024 * 1024,
    });
    exit = r.status;
    rawSession = String(r.stdout || ''); // raw NDJSON agent-session record (audit trail)
    out = `${rawSession}\n${String(r.stderr || '')}`;
  } catch (e) { out = `spawn error: ${e.message}`; rawSession = out; }
  const parsed = parseEvents(out);
  return { exit, out, rawSession, latencyMs: Date.now() - t0, ...parsed };
}

function parseEvents(out) {
  const textParts = [];
  const toolNames = [];
  let tokensIn = 0; let tokensOut = 0; let cost = 0;
  let steps = 0;
  for (const line of String(out).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let e; try { e = JSON.parse(t); } catch (_) { continue; }
    const part = e.part || e;
    if (part && part.type === 'text' && part.text) textParts.push(part.text);
    if (part && part.type === 'tool') toolNames.push(part.tool || part.name || 'tool');
    if (e.type === 'tool_use' && e.tool) toolNames.push(e.tool);
    if (e.type === 'step_start') steps += 1;
    if (e.type === 'step_finish') {
      const fin = e.part && e.part.finish ? e.part.finish : (e.part || e);
      if (fin && typeof fin.cost === 'number') cost += fin.cost;
      const tk = fin.tokens || (fin.finish && fin.finish.tokens);
      if (tk) { tokensIn += tk.input || 0; tokensOut += tk.output || 0; }
    }
  }
  if (cost === 0) {
    const m = String(out).match(/"cost"\s*:\s*([0-9.]+)/g);
    if (m) for (const x of m) cost += parseFloat(x.replace(/[^0-9.]/g, ''));
  }
  const fullText = textParts.join('\n').trim();
  const finalAnswer = (textParts[textParts.length - 1] || '').trim() || fullText;
  return { text: fullText, fullText, finalAnswer, toolNames, tokensIn, tokensOut, cost, steps };
}

// judge: does the agent's final answer reach the target (contain the expected id/name)?
function judgeAnswer(answer, question) {
  const s = String(answer || '');
  const targets = [question.answer, ...(question.answerAlt || [])];
  return targets.some(target => s.includes(String(target)));
}

// package the RAW agent session record (opencode run NDJSON stream) for one
// question into the result bundle: <reportDir>/navigation-agent-raw/<qid>.ndjson
function saveRawSession(qid, rawSession, dir) {
  const target = dir || RAW_DIR;
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, `${qid}.ndjson`);
  const body = String(rawSession || '').replace(/\n*$/, '') + '\n';
  fs.writeFileSync(file, body, 'utf8');
  return { file, bytes: Buffer.byteLength(body) };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[nav-agent] drop stale sandbox db...');
  console.log('[nav-agent] drop:', JSON.stringify(dropDbs()));

  console.log('[nav-agent] init graph...');
  console.log('[nav-agent] init ok:', await initGraph());

  console.log('[nav-agent] argo-init (sync + semantic lifecycle)...');
  const initRes = argoInit();
  console.log('[nav-agent] argo-init:', JSON.stringify(initRes));

  console.log('[nav-agent] configure opencode with ONLY the full argo MCP...');
  console.log('[nav-agent] argo-only cfg:', configureArgoOnly());

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: `Full-ArchGraph navigation capability via OpenCode Agent (SEED v1.1.0, ${QUESTIONS.length} questions)`,
    mode: 'complete-argo-no-comparison',
    questions: QUESTIONS,
    groups: { A: { backend: 'argo MCP (full ArchGraph toolchain)' } },
    perQuestion: [],
    summary: {},
  };

  for (const q of QUESTIONS) {
    const row = { qid: q.id, type: q.dimension, question: q.question, answer: q.answer };
    const a = runAgent(q.question);
    const correct = judgeAnswer(a.finalAnswer, q);
    const raw = a.rawSession ? saveRawSession(q.id, a.rawSession) : { file: null, bytes: 0 };
    row.A = {
      correct,
      answer: a.finalAnswer, fullText: a.fullText, exit: a.exit,
      latencyMs: a.latencyMs, tokensIn: a.tokensIn, tokensOut: a.tokensOut, cost: a.cost,
      steps: a.steps, toolCalls: a.toolNames.length, toolNames: a.toolNames,
      rawSessionFile: raw.file, rawSessionBytes: raw.bytes,
    };
    console.log(`[nav-agent] ${q.id} (${q.dimension}) correct=${correct} steps=${a.steps} tools=${a.toolNames.length} ${a.latencyMs}ms tools=[${a.toolNames.join(',')}]`);
    report.perQuestion.push(row);
  }

  const byDimension = {};
  for (const dim of [...new Set(QUESTIONS.map(q => q.dimension))]) {
    const items = report.perQuestion.filter(r => r.type === dim);
    byDimension[dim] = { correct: items.filter(r => r.A.correct).length, total: items.length };
  }
  const A = {
    correct: report.perQuestion.filter(r => r.A.correct).length,
    total: report.perQuestion.length,
    avgLatencyMs: Math.round(report.perQuestion.reduce((a, r) => a + r.A.latencyMs, 0) / report.perQuestion.length),
    totalTokens: report.perQuestion.reduce((a, r) => a + (r.A.tokensIn || 0) + (r.A.tokensOut || 0), 0),
  };
  report.summary = { A, byDimension };
  report.rawSessions = {
    dir: RAW_DIR,
    count: report.perQuestion.filter(r => r.A.rawSessionFile).length,
    files: report.perQuestion.map(r => r.A.rawSessionFile),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  console.log(`\n[nav-agent] OVERALL A=${A.correct}/${A.total}  avg ${A.avgLatencyMs}ms  tok ${A.totalTokens}`);
  console.log(`[nav-agent] ${Object.entries(byDimension).map(([d, v]) => `${d} ${v.correct}/${v.total}`).join('  ')}`);
  return A.correct === A.total ? 0 : 1;
}

if (require.main === module) {
  main().then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { QUESTIONS, judgeAnswer, parseEvents, saveRawSession, main };
