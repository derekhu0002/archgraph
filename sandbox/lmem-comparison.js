#!/usr/bin/env node
'use strict';
/**
 * LongMemEval A/B comparison runner (container-side, runs AFTER argo-deploy).
 *
 * Faithful "双 MCP 同 Agent" comparison (口径 A): the SAME OpenCode Agent +
 * DeepSeek, neutral instructions + identical neutral question per group; the
 * ONLY difference is the mounted memory backend:
 *   A = argo MCP (intent graph; memory injected as Business Objects)
 *   B = lightrag MCP (LightRAG/Neo4j; memory injected via lightrag_insert)
 *
 * Flow:
 *   1. load env + argo init (generate initial graph)
 *   2. neutral AGENTS.md + configure opencode per mode
 *   3. ingest A (addView + addElement per question) and B (python MCP client)
 *   4. for each question: run A session, then B session (opencode run, same Q)
 *   5. judge (normalized containment) + tokens/cost/latency
 *   6. write /results/lmem-comparison-report.json
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOME = process.env.USERPROFILE || process.env.HOME || '/root';
const WORKSPACE = process.env.ARGO_REPO_ROOT || '/workspace';
const PACKAGE = '/tmp/install/node_modules/archgraph-argo';
const SEL = process.env.SEL_PATH || '/opt/lmem-selection.json';
const REPORT = process.env.REPORT_PATH || '/results/lmem-comparison-report.json';
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

const questions = JSON.parse(fs.readFileSync(SEL, 'utf8'));

// ── neutral rules (口径 A) ──────────────────────────────────────────────────
// Neutral = identical for BOTH backends. It explicitly tells the agent a memory
// backend IS mounted and that its retrieval tools may carry generic /
// knowledge-graph-style names, so the argo agent does not dismiss
// getSystemArchitecture / queryNeo4jGraph as "architecture-only" and give up.
const NEUTRAL_AGENTS_MD = `# ArchGraph memory-eval session instructions (neutral)
You are an evaluation agent. A memory backend is mounted in this session and it
holds the user's memory. Answer the question by retrieving that memory using the
session's tools.

1. Inspect the session's tool list: a memory backend IS available. Use its
   retrieval/query tools to look up the user's memory. These tools may have
   generic or knowledge-graph-style names (e.g. system / graph / query /
   retrieval tools) — they still grant access to the user's memory. Do NOT
   assume no memory tool exists, and do NOT conclude there is no memory just
   because a tool is named like an architecture or knowledge-graph tool.
2. Do NOT search local files or the filesystem; retrieve memory through the
   session's tools only.
3. Answer strictly from what you retrieve. If the memory truly does not contain
   the answer, say so explicitly — never invent or guess.
4. If the memory contains the answer, state it DIRECTLY and concisely as a
   standalone statement — do not hedge or qualify a fact that is clearly in
   the memory. Report any identifier verbatim.
5. Use only the tools that actually exist in this session.`;

function writeNeutralInstructions() {
  try { fs.writeFileSync(path.join(HOME, '.config/opencode/AGENTS.md'), NEUTRAL_AGENTS_MD); return true; } catch (_) { return false; }
}

function deleteArgo(cfg) {
  if (!cfg.mcp) return;
  delete cfg.mcp.argo;
  if (cfg.mcp.servers) delete cfg.mcp.servers.argo;
}

function configureMcp(mode) {
  const configPath = path.join(HOME, '.config/opencode/opencode.json');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const baseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  if (!baseURL || !process.env.DEEPSEEK_API_KEY) return false;
  cfg.provider = cfg.provider || {};
  cfg.provider['deepseek-sandbox'] = {
    npm: '@ai-sdk/openai-compatible', name: 'DeepSeek (sandbox)',
    options: { baseURL, apiKey: process.env.DEEPSEEK_API_KEY },
    models: { [model]: { name: model } },
  };
  cfg.mcp = cfg.mcp || {};
  if (mode === 'lightrag') {
    deleteArgo(cfg);
    cfg.mcp['lightrag'] = { type: 'local', command: ['/opt/lightrag/bin/python3', '/opt/sandbox/lightrag-mcp.py'], enabled: true };
  } else {
    delete cfg.mcp['lightrag'];
    // configureMcp('lightrag') deletes mcp.argo, so 'argo' mode MUST re-add it —
    // otherwise every A session after the first B session has no MCP at all
    // (observed: A agent reported "no MCP tools available").
    cfg.mcp['argo'] = {
      type: 'local',
      command: ['node', path.join(HOME, '.argo/scripts/argo-mcp-server.js')],
      enabled: true,
    };
  }
  cfg.model = `deepseek-sandbox/${model}`;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  try {
    const v = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const hasArgo = !!((v.mcp && v.mcp.argo) || (v.mcp && v.mcp.servers && v.mcp.servers.argo));
    const hasLr = !!(v.mcp && v.mcp['lightrag']);
    return mode === 'lightrag' ? (hasLr && !hasArgo) : (hasArgo && !hasLr);
  } catch (_) { return false; }
}

// ── argo MCP (in-process) for init + A-side ingestion ──────────────────────
const { callTool } = require(path.join(PACKAGE, 'argo/scripts/argo-mcp-server.js'));

async function initGraph() {
  const init = await callTool('initializeWorkspace', { workspaceRoot: WORKSPACE }, null, undefined);
  const text = (init && init.content && init.content[0] && init.content[0].text) || JSON.stringify(init);
  return String(text).includes('SystemArchitecture.json');
}

// 宿主 Neo4j 跨容器 run 持久：sandbox 语义投影向量节点 / lightrag 实体节点会不断
// 累积（163 个 element 向量对应 3 个真元素）。每次 run 前 DROP 两个库——框架 sync 与
// Neo4JStorage 都会自动重建（CREATE DATABASE IF NOT EXISTS）。
function dropDbs() {
  try {
    const neo4j = require(NEO4J_DRIVER);
    const uri = process.env.ARGO_NEO4J_DATABASE_URL;
    const user = process.env.ARGO_NEO4J_DATABASE_USERNAME;
    const pw = process.env.ARGO_NEO4J_DATABASE_PASSWORD;
    const drv = neo4j.driver(uri, neo4j.auth.basic(user, pw));
    const sess = drv.session({ database: 'system' });
    const dropped = [];
    for (const db of ['sandbox', 'lightrag']) {
      try { sess.run(`DROP DATABASE \`${db}\` IF EXISTS`); dropped.push(db); } catch (e) { dropped.push(`${db}:${e.message}`); }
    }
    sess.close(); drv.close();
    return { ok: true, dropped };
  } catch (e) { return { ok: false, error: e.message }; }
}

// argo-init：每次跑前执行 ensureArgoHarnessEnvironment.js（ARGO INIT skill），
// 完成 JSON->Neo4j 初始同步 + 语义生命周期 init（embedding backfill + readiness
// 对齐）。生产 mutation 生命周期会校验 touched-record queryability 与 global
// coherence（依赖 Neo4j 语义向量投影 + 生命周期 readiness）——仅做结构同步不够，
// 必须走 argo-init 让语义生命周期就绪。
// Keys the ARGO semantic lifecycle accepts in an env file (READABLE_KEYS in
// argo/scripts/graph-rag/liveEmbeddingProviderConfig.js).
const ARGO_ENV_SUPPORTED_KEYS = [
  'ARGO_EMBEDDING_BASE_URL',
  'ARGO_EMBEDDING_MODEL',
  'ARGO_EMBEDDING_PROVIDER',
  'ARGO_EMBEDDING_MODEL_VERSION',
  'ARGO_EMBEDDING_DIMENSIONS',
  'ARGO_NEO4J_DATABASE_URL',
  'ARGO_NEO4J_DATABASE_USERNAME',
  'ARGO_NEO4J_DATABASE_PASSWORD',
  'QWEN_KEY',
  'ARGO_NEO4J_DATABASE',
  'ARGO_LIVE_PROVIDER_E2E',
  'ARGO_W31_LIVE_MUTATION_VECTOR_E2E',
  'ARGO_SEMANTIC_MEMORY_THRESHOLD',
  'ARGO_SEMANTIC_AUDIT_THRESHOLD',
  'ARGO_SEMANTIC_TOP_K',
];

// The mounted /env/argo.env is a Windows-host bind mount that appears as mode
// 0644 inside the Linux container, which fails the semantic lifecycle's POSIX
// secret-file ACL preflight (no group/other access). Write a container-local
// 0600 copy and point ARGO_ENV_FILE at it so the approved-config preflight
// passes on Linux. The copy uses the CURRENT process.env values (after the
// 127.0.0.1 -> host.docker.internal rewrite and ARGO_NEO4J_DATABASE default) so
// the resolved file and process.env agree and resolveTrusted sees no
// LIVE_PROVIDER_CONFIGURATION_CONFLICT.
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
  // 脚本把完整报告写到 workspace 下，读它拿失败阶段/原因
  let report = {};
  try { report = JSON.parse(fs.readFileSync(path.join(WORKSPACE, '.argo/temp/argo-harness-init-report.json'), 'utf8')); } catch (_) { /* keep */ }
  let failStage = '';
  if (report.status === 'failed') {
    for (const k of ['workspaceBootstrap', 'mcp', 'systemArchitecture', 'neo4j', 'semanticLifecycle', 'subdiagramViews']) {
      if (report[k] && report[k].status === 'failed') failStage += `${k}:${JSON.stringify(report[k]).slice(0, 160)} `;
    }
    if (report.error) failStage += `error:${report.error}`;
  }
  return { ok: s.status === 0 && report.status === 'ok', status: report.status || 'unknown', failStage };
}

// Unwrap the semantic getSystemArchitecture result into the object ids that the
// query actually retrieved. The in-process callTool returns the MCP toolResult
// wrapper ({content:[{type:'text',text}]}); the payload is either the
// business-summary profile (hits under result.businessObjects.elements /
// result.semanticSeeds / result.hitReasons) or the canonical-subset contract
// (hits under document.elements).
function extractSemanticHits(s) {
  let payload = s;
  if (s && s.content && Array.isArray(s.content) && s.content[0] && typeof s.content[0].text === 'string') {
    try { payload = JSON.parse(s.content[0].text); } catch (_) { return []; }
  }
  const result = payload && payload.result;
  const doc = payload && payload.document;
  const elements = (result && result.businessObjects && result.businessObjects.elements)
    || (Array.isArray(doc && doc.elements) ? doc.elements : []);
  const seeds = (result && result.semanticSeeds) || [];
  const reasons = (result && result.hitReasons) || [];
  return elements.map(e => e && e.id)
    .concat(seeds.map(x => x && x.objectId))
    .concat(reasons.map(x => x && x.objectId))
    .filter(Boolean);
}

// Verify the A-side memory is actually reachable via the argo MCP (queryNeo4jGraph
// element list + getSystemArchitecture semantic hits) — isolates backend-retrieval
// from agent behaviour.
async function verifyA(q0) {
  try {
    const q = await callTool('queryNeo4jGraph', {
      cypher: 'MATCH (e:Element {graphKey: $graphKey}) RETURN e.id, e.name ORDER BY e.id',
      workspaceRoot: WORKSPACE,
    }, null, undefined);
    // purpose='audit' is a special proof-closure anchored on the audit policy
    // node, NOT a general memory retrieval — use implementation-design so the
    // query actually runs semantic seed retrieval over the graph.
    const s = await callTool('getSystemArchitecture', {
      query: { purpose: 'implementation-design', intent: q0.question }, workspaceRoot: WORKSPACE,
    }, null, undefined);
    const rawText = s && s.content && Array.isArray(s.content) && s.content[0] && s.content[0].text
      ? s.content[0].text
      : JSON.stringify(s);
    const hits = extractSemanticHits(s);
    // which canonical files contain the injected BO?
    const probe = `lmem-a-${q0.qid}`;
    const foundIn = [];
    const canons = ['/workspace/design/KG/SystemArchitecture.json', '/opt/sandbox/design/KG/SystemArchitecture.json'];
    for (const cand of canons) {
      try { if (fs.readFileSync(cand, 'utf8').includes(probe)) foundIn.push(cand); } catch (_) { /* skip */ }
    }
    const sizes = {};
    for (const cand of canons) { try { sizes[cand] = fs.readFileSync(cand, 'utf8').length; } catch (_) { sizes[cand] = 'missing'; } }
    return { records: JSON.stringify(q && q.records), semanticHits: hits, foundIn, sizes, sRaw: rawText.slice(0, 1500) };
  } catch (e) { return { error: e.message }; }
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
    out.viewResp = JSON.stringify(r).slice(0, 400);
  } catch (e) { out.errors.push(`addArchitectureView: ${e.message}`); }
  for (const q of questions) {
    const id = `lmem-a-${q.qid}`;
    try {
      const r = await callTool('addArchitectureElement', {
        element: { id, name: `用户会话记忆 ${q.qid}`, type: 'Business Object', description: q.haystack },
        view_ids: [viewId], workspaceRoot: WORKSPACE,
      }, null, undefined);
      out.elements += 1;
      out.last = { id, resp: JSON.stringify(r).slice(0, 300) };
    } catch (e) { out.errors.push(`addArchitectureElement ${q.qid}: ${e.message}`); }
  }
  return out;
}

function ingestB() {
  const r = spawnSync('/opt/lightrag/bin/python3', ['/opt/sandbox/lmem-ingest-lightrag.py'], {
    env: process.env, encoding: 'utf8', timeout: 1800000, maxBuffer: 60 * 1024 * 1024,
  });
  return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

// ── agent run + event parsing ──────────────────────────────────────────────
function runAgent(question) {
  writeNeutralInstructions();
  const t0 = Date.now();
  let out = ''; let exit = -1;
  try {
    // 会话自然结束才算评测完：opencode run 会一直跑到 Agent 给出最终答案（不再调工具）
    // 或命中其自身轮次上限；这里用宽松 timeout 只作安全网，绝不截断试错/重试。
    const r = spawnSync('opencode', ['run', '--format', 'json', question], {
      env: process.env, cwd: WORKSPACE, encoding: 'utf8', timeout: 600000, maxBuffer: 40 * 1024 * 1024,
    });
    exit = r.status; out = `${String(r.stdout || '')}\n${String(r.stderr || '')}`;
  } catch (e) { out = `spawn error: ${e.message}`; }
  const parsed = parseEvents(out);
  return { exit, out, latencyMs: Date.now() - t0, ...parsed };
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
  // regex fallback for cost if JSON parse gave none
  if (cost === 0) {
    const m = String(out).match(/"cost"\s*:\s*([0-9.]+)/g);
    if (m) for (const x of m) cost += parseFloat(x.replace(/[^0-9.]/g, ''));
  }
  const fullText = textParts.join('\n').trim();
  // 会话自然结束：最终答案 = 最后一轮文本（Agent 试错/重试后给出的结论），
  // 而非第一条答复。保留 fullText 供报告参考。
  const finalAnswer = (textParts[textParts.length - 1] || '').trim() || fullText;
  return { text: fullText, fullText, finalAnswer, toolNames, tokensIn, tokensOut, cost, steps };
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function judge(text, gt) {
  const a = norm(text); const g = norm(gt);
  if (!g) return false;
  return a.includes(g) || g.includes(a);
}

// 非答案：空/过短/元叙述（"我要去查一下/让我用工具"等没有给出事实的）——直接判错，
// 不能让 lenient judge 把这种当对。
function isNonAnswer(t) {
  const s = String(t || '').trim().toLowerCase();
  if (!s) return true;
  if (s.length < 8) return true;
  if (/^(i (need|will|'ll|would|should|am going|am)|let me|let's|let us|please allow me).{0,80}(look up|check|search|find|use|query|retriev|consult|investigat)/i.test(s)) return true;
  if (/^i (do not|don't|cannot|can't|am not able).{0,40}(find|know|answer|contain)/i.test(s)) return true;
  return false;
}

// LLM judge: handles paraphrase / hedging — DeepSeek decides CORRECT/INCORRECT.
async function judgeLLM(question, gt, answer) {
  try {
    const url = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '') + '/chat/completions';
    const prompt = `You are an evaluation judge. Decide whether the model's answer is CORRECT, i.e. it STATES the fact from the ground truth (equivalently, possibly rephrased). Reply INCORRECT if the answer is a meta-statement (e.g. "let me look up", "I need to search", "I cannot find"), is empty, or does not state any concrete fact. If it contains the correct fact or is equivalent, reply CORRECT. Reply with exactly one word.\n\nQuestion: ${question}\nGround truth: ${gt}\nModel answer: ${String(answer || '').slice(0, 2000)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 8 }),
    });
    const j = await r.json();
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const verdict = /^\s*CORRECT/i.test(txt);
    console.log(`[lmem-judge] gt="${gt}" -> "${String(txt).trim().slice(0, 30)}" => ${verdict}`);
    return verdict;
  } catch (e) { console.log(`[lmem-judge] error: ${e.message}`); return judge(answer, gt); } // fallback to deterministic
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    dataset: 'LongMemEval oracle',
    sample: `${new Set(questions.map(q => q.type)).size} capabilities × ${questions.length / new Set(questions.map(q => q.type)).size} = ${questions.length} questions`,
    questions,
    groups: { A: { backend: 'argo MCP (intent graph)' }, B: { backend: 'lightrag MCP (Neo4j)' } },
    perQuestion: [],
    summary: {},
  };

  console.log('[lmem] drop stale Neo4j dbs (sandbox/lightrag) to avoid vector accumulation...');
  console.log('[lmem] drop:', JSON.stringify(dropDbs()));

  console.log('[lmem] init graph...');
  console.log('[lmem] init ok:', await initGraph());

  console.log('[lmem] argo-init (sync + semantic lifecycle) before A-side mutation...');
  const initRes = argoInit();
  console.log('[lmem] argo-init:', JSON.stringify(initRes));

  console.log('[lmem] ingest A (intent graph)...');
  const aIng = await ingestA();
  console.log('[lmem] ingest A:', JSON.stringify(aIng));

  // A 侧摄入后再跑一次 argo-init：Neo4j 投影 + 语义生命周期才能看到新加的
  // Business Object（否则 A 的 queryNeo4jGraph/getSystemArchitecture 只看到初始元素）。
  console.log('[lmem] argo-init (re-sync) after A-ingest...');
  const initRes2 = argoInit();
  console.log('[lmem] argo-init#2:', JSON.stringify(initRes2));

  console.log('[lmem] verify A-side retrieval...');
  const aVerify = await verifyA(questions[0]);
  console.log('[lmem] verify A:', JSON.stringify(aVerify));

  console.log('[lmem] ingest B (lightrag)...');
  const bIng = ingestB();
  console.log('[lmem] ingest B status:', bIng.status, (bIng.out || '').replace(/\s+/g, ' ').slice(0, 300));

  for (const q of questions) {
    const row = { qid: q.qid, type: q.type, question: q.question, answer: q.answer, A: {}, B: {} };

    configureMcp('argo');
    const a = runAgent(q.question);
    const aNon = isNonAnswer(a.finalAnswer);
    const aDet = judge(a.finalAnswer, q.answer);
    const aLLM = aNon ? false : await judgeLLM(q.question, q.answer, a.finalAnswer);
    row.A = {
      correct: aLLM, correctDet: aDet, nonAnswer: aNon, answer: a.finalAnswer, fullText: a.fullText, exit: a.exit,
      latencyMs: a.latencyMs, tokensIn: a.tokensIn, tokensOut: a.tokensOut, cost: a.cost,
      steps: a.steps, toolCalls: a.toolNames.length,
      toolUsed: /argo|getIntentElementContext|queryNeo4jGraph|getArchitectureViewContext|getSystemArchitecture/.test(a.out),
    };
    console.log(`[lmem] A ${q.qid} (${q.type}) correct=${aLLM} non=${aNon} steps=${a.steps} tools=${a.toolNames.length} ${a.latencyMs}ms tools=[${a.toolNames.join(',')}]`);

    configureMcp('lightrag');
    const b = runAgent(q.question);
    const bNon = isNonAnswer(b.finalAnswer);
    const bDet = judge(b.finalAnswer, q.answer);
    const bLLM = bNon ? false : await judgeLLM(q.question, q.answer, b.finalAnswer);
    row.B = {
      correct: bLLM, correctDet: bDet, nonAnswer: bNon, answer: b.finalAnswer, fullText: b.fullText, exit: b.exit,
      latencyMs: b.latencyMs, tokensIn: b.tokensIn, tokensOut: b.tokensOut, cost: b.cost,
      steps: b.steps, toolCalls: b.toolNames.length,
      toolUsed: /lightrag_query/.test(b.out),
    };
    console.log(`[lmem] B ${q.qid} (${q.type}) correct=${bLLM} non=${bNon} steps=${b.steps} tools=${b.toolNames.length} ${b.latencyMs}ms tools=[${b.toolNames.join(',')}]`);

    report.perQuestion.push(row);
  }

  for (const g of ['A', 'B']) {
    const rows = report.perQuestion.map(r => r[g]);
    const correct = rows.filter(r => r.correct).length;
    report.groups[g] = {
      ...report.groups[g],
      correct, total: rows.length,
      accuracy: +(correct / rows.length).toFixed(3),
      avgLatencyMs: Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length),
      totalTokens: rows.reduce((s, r) => s + (r.tokensIn || 0) + (r.tokensOut || 0), 0),
      totalCost: +rows.reduce((s, r) => s + (r.cost || 0), 0).toFixed(4),
    };
  }
  report.summary = {
    A: `${report.groups.A.correct}/${report.groups.A.total}`,
    B: `${report.groups.B.correct}/${report.groups.B.total}`,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`\n[lmem] REPORT A=${report.summary.A} B=${report.summary.B} -> ${REPORT}`);
}

main().catch((e) => { console.error('[lmem] fatal:', e); process.exit(2); });
