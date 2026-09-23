'use strict';
/**
 * Agent 成本—召回度量 harness (R7)。
 *
 * 场景：把「仓（无界内容源，多数内容由 Agent 注入）+ 策展意图图（KG，仅语义
 * 目录/路由层，不覆盖全仓）」作为 Agent 的活动范围。真实 Agent 会在两个后端
 * 之间往返：语义搜图 → 不够 → 搜仓(grep/glob/read) → 可能再回图。成本主要发生
 * 在这些往返轮次上：轮次一多，累积上下文使 token 近平方级膨胀、时延变长。
 *
 * 本 harness 以任务语料 SEED（data/eval-seeds/agent-cost-seed.json）的【oracle
 * 证据集】为召回上界，对真实 Agent 会话（opencode run --format json 的 NDJSON
 * 事件流）做确定性评分，输出四元组：
 *   轮次 / 工具调用（按图/仓后端分类）/ 后端往返次数 / token / 时延
 *   以及 证据召回率(evidenceRecall) 与 精度(evidencePrecision)。
 *
 * 红线（与 retrieval-recall-first 一致）：不得以缩池/截断换速度；任何优化若
 * 造成召回缺口，必须被本 harness 显式暴露（failedTasks.missing），不得掩盖。
 *
 * 用法：
 *   node scripts/agent-cost-eval.js --logs <dir> [--seed <file>] [--json]
 *   node scripts/agent-cost-eval.js --seed-only
 *   <dir> 下每个任务一个会话文件：<taskId>.ndjson（opencode run 原始事件流）
 *
 * 零 LLM / 零 Neo4j 运行时依赖：只读 canonical JSON 取图内 id 字典 + 遍历仓取
 * 路径字典，评分全部为确定性字符串/结构检查。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SEED_PATH = path.join(ROOT, 'data', 'eval-seeds', 'agent-cost-seed.json');
const GRAPH_PATH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const REPORT_PATH = path.join(ROOT, 'results', 'agent-cost-report.json');

const GRAPH_TOOLS = ['getSystemArchitecture', 'getIntentElementContext', 'getArchitectureViewContext', 'queryNeo4jGraph', 'memory_search'];
const REPO_TOOLS = ['read', 'grep', 'glob', 'list', 'bash', 'webfetch', 'edit', 'write'];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coverage', 'dist', '.argo', 'tmp', 'out', 'build', 'results']);

const DIMENSION_KEYS = ['graph', 'repo', 'joint'];

// ── seed ─────────────────────────────────────────────────────────────────────
function loadSeed(file) {
  const filePath = file || SEED_PATH;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// A task's ORACLE is the evidence set that MUST be recalled. The canonical form
// is `oracle: { elements, repoPaths }`. For compatibility with the existing
// navigation SEED (whose ground truth is a single target id/name) the oracle is
// derived from `target.id` when `oracle` is absent — so the same harness can
// score any real agent-session logs.
function taskOracle(q) {
  if (q && q.oracle && typeof q.oracle === 'object') {
    return { elements: q.oracle.elements || [], repoPaths: (q.oracle.repoPaths || []).map(normPath) };
  }
  if (q && q.target && typeof q.target.id === 'string' && q.target.id) {
    return { elements: [q.target.id], repoPaths: [] };
  }
  return null;
}

function validateSeed(seed) {
  const errors = [];
  if (!seed || typeof seed !== 'object') return { ok: false, errors: ['seed must be an object'] };
  if (seed.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof seed.seedId !== 'string' || !seed.seedId) errors.push('seedId required');
  if (typeof seed.version !== 'string' || !seed.version) errors.push('version required');
  if (!Array.isArray(seed.questions) || seed.questions.length === 0) errors.push('questions array required');
  const seen = new Set();
  for (const q of seed.questions || []) {
    if (!q || typeof q.id !== 'string' || !/^[A-Z]{2}-\d{2}$/.test(q.id)) { errors.push('question id must be XX-nn'); continue; }
    if (seen.has(q.id)) errors.push(`duplicate id ${q.id}`);
    seen.add(q.id);
    for (const field of ['question']) {
      if (typeof q[field] !== 'string' || !q[field]) errors.push(`${q.id} missing ${field}`);
    }
    const oracle = taskOracle(q);
    if (!oracle) { errors.push(`${q.id} missing oracle (or target.id fallback)`); continue; }
    if (oracle.elements.length === 0 && oracle.repoPaths.length === 0) errors.push(`${q.id} oracle must declare at least one element or repoPath`);
  }
  return { ok: errors.length === 0, errors };
}

// ── evidence dictionary (universe) ────────────────────────────────────────────
function graphIds(graphPath) {
  const graph = JSON.parse(fs.readFileSync(graphPath || GRAPH_PATH, 'utf8'));
  return [...(graph.elements || []).map(e => e.id), ...(graph.views || []).map(v => v.view_id)].filter(Boolean);
}

function walkRepo(root, opts = {}) {
  const maxFiles = opts.maxFiles || 50000;
  const out = [];
  const queue = [''];
  let head = 0;
  while (head < queue.length && out.length < maxFiles) {
    const rel = queue[head++];
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (_) { continue; }
    for (const ent of entries) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) queue.push(r); }
      else out.push(r);
    }
  }
  return out;
}

function buildUniverse(options = {}) {
  const ids = new Set(options.ids || []);
  const paths_ = new Set((options.paths || []).map(normPath));
  if (options.graphPath !== null) for (const id of graphIds(options.graphPath)) ids.add(id);
  if (options.repoRoot) for (const p of walkRepo(options.repoRoot, options)) paths_.add(normPath(p));
  return { ids, paths: paths_ };
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/');
}

// ── trajectory parsing ────────────────────────────────────────────────────────
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function backendOf(tool) {
  const name = String(tool || '').toLowerCase();
  if (GRAPH_TOOLS.some(t => name.includes(t.toLowerCase()))) return 'graph';
  if (REPO_TOOLS.some(t => name.includes(t.toLowerCase()))) return 'repo';
  return 'other';
}

function toolRecord(tool, line, part) {
  const st = (part && part.state) || {};
  const tm = st.time || {};
  const durationMs = (typeof tm.start === 'number' && typeof tm.end === 'number') ? Math.max(0, tm.end - tm.start) : null;
  const ok = st.status ? st.status !== 'error' : true;
  return { tool, backend: backendOf(tool), raw: line, durationMs, ok, error: st.error ? String(st.error).slice(0, 160) : null };
}

function eventTime(e) {
  const candidates = [e.time, e.part && e.part.time, e.part && e.part.state && e.part.state.time];
  for (const t of candidates) {
    if (!t) continue;
    if (typeof t === 'number') return t;
    if (typeof t.start === 'number' && typeof t.end === 'number') return t.end;
    if (typeof t.start === 'number') return t.start;
    if (typeof t.end === 'number') return t.end;
  }
  if (typeof e.timestamp === 'number') return e.timestamp;
  return null;
}

function parseTrajectory(text) {
  const raw = String(text || '');
  const texts = [];
  const toolCalls = [];
  let tokensIn = 0; let tokensOut = 0; let tokensReasoning = 0;
  let cost = 0; let steps = 0; let tMin = null; let tMax = null;

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let e; try { e = JSON.parse(t); } catch (_) { continue; }
    const part = e.part || e;
    if (part && part.type === 'text' && part.text) texts.push(part.text);
    if (part && part.type === 'tool') {
      const tool = part.tool || part.name || (part.state && part.state.tool) || 'tool';
      toolCalls.push(toolRecord(tool, t, part));
    }
    if (e.type === 'tool_use' && e.tool) toolCalls.push(toolRecord(e.tool, t, part));
    if (e.type === 'step_start') steps += 1;
    if (e.type === 'step_finish') {
      const fin = (e.part && e.part.finish) ? e.part.finish : (e.part || e);
      if (fin && typeof fin.cost === 'number') cost += fin.cost;
      const tk = fin && (fin.tokens || (fin.finish && fin.finish.tokens));
      if (tk) {
        tokensIn += tk.input || 0;
        tokensOut += tk.output || 0;
        tokensReasoning += tk.reasoning || tk.reasoningTokens || 0;
      }
    }
    const time = eventTime(e);
    if (time !== null) { tMin = tMin === null ? time : Math.min(tMin, time); tMax = tMax === null ? time : Math.max(tMax, time); }
  }

  const tokens = tokensIn + tokensOut + tokensReasoning;
  const latencyMs = (tMin !== null && tMax !== null && tMax >= tMin) ? (tMax - tMin) : null;
  const byBackendTime = { graph: 0, repo: 0, other: 0 };
  let toolTimeMs = 0;
  let toolErrors = 0;
  for (const c of toolCalls) {
    const d = c.durationMs || 0;
    toolTimeMs += d;
    if (byBackendTime[c.backend] != null) byBackendTime[c.backend] += d;
    if (c.ok === false) toolErrors += 1;
  }
  return { rawText: raw, texts, fullText: texts.join('\n').trim(), toolCalls, steps, tokensIn, tokensOut, tokensReasoning, tokens, cost, latencyMs, toolTimeMs, toolErrors, byBackendTime };
}

// ── evidence extraction + scoring ─────────────────────────────────────────────
function extractEvidence(rawText, universe) {
  const text = String(rawText || '').replace(/\\\//g, '/');
  const ids = [];
  for (const id of universe.ids) {
    const re = new RegExp('(?<![\\w-])' + escapeRe(id) + '(?![\\w-])');
    if (re.test(text)) ids.push(id);
  }
  const paths_ = [];
  for (const p of universe.paths) {
    if (text.includes(p)) paths_.push(p);
  }
  return { ids, paths: paths_ };
}

function countRoundTrips(toolCalls) {
  const seq = toolCalls.map(c => c.backend).filter(b => b === 'graph' || b === 'repo');
  let trips = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) trips += 1;
  return trips;
}

function countBackends(toolCalls) {
  const out = { graph: 0, repo: 0, other: 0 };
  for (const c of toolCalls) out[c.backend] = (out[c.backend] || 0) + 1;
  return out;
}

function firstHitIndex(toolCalls, oracleTokens) {
  for (let i = 0; i < toolCalls.length; i++) {
    const raw = toolCalls[i].raw.replace(/\\\//g, '/');
    if (oracleTokens.some(tok => raw.includes(tok))) return i;
  }
  return -1;
}

function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (String(text).match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return cjk + Math.ceil((String(text).length - cjk) / 4);
}

function scoreTask(trajectory, task, universe, opts = {}) {
  const oracleIds = task.oracle.elements || [];
  const oraclePaths = (task.oracle.repoPaths || []).map(normPath);
  const oracleTokens = [...oracleIds, ...oraclePaths];

  const found = extractEvidence(trajectory.rawText, universe);
  const foundSet = new Set([...found.ids, ...found.paths]);
  const oracleSet = new Set(oracleTokens);
  const hits = oracleTokens.filter(tok => foundSet.has(tok));
  const missing = oracleTokens.filter(tok => !foundSet.has(tok));

  const evidenceRecall = oracleSet.size ? hits.length / oracleSet.size : 1;
  const evidencePrecision = foundSet.size ? hits.length / foundSet.size : 0;

  const backends = countBackends(trajectory.toolCalls);
  const tokens = trajectory.tokens || (opts.estimate ? estimateTokens(trajectory.rawText) : 0);
  const turns = trajectory.steps || 0;

  return {
    taskId: task.id,
    dimension: task.dimension,
    dimensionKey: task.dimensionKey,
    success: missing.length === 0,
    evidenceRecall: round3(evidenceRecall),
    evidencePrecision: round3(evidencePrecision),
    hits,
    missing,
    tokens,
    tokensIn: trajectory.tokensIn,
    tokensOut: trajectory.tokensOut,
    tokensReasoning: trajectory.tokensReasoning,
    latencyMs: opts.latencyMs != null ? opts.latencyMs : trajectory.latencyMs,
    turns,
    toolCalls: trajectory.toolCalls.length,
    roundTrips: countRoundTrips(trajectory.toolCalls),
    byBackend: backends,
    firstHitIndex: firstHitIndex(trajectory.toolCalls, oracleTokens),
  };
}

function round3(n) { return Math.round(Number(n) * 1000) / 1000; }

// ── aggregation + cost/recall curve ───────────────────────────────────────────
function buildCurve(rows) {
  const sorted = [...rows].sort((a, b) => (a.tokens - b.tokens) || a.taskId.localeCompare(b.taskId));
  let cumTokens = 0; let cumSuccess = 0;
  return sorted.map((r, i) => {
    cumTokens += r.tokens;
    if (r.success) cumSuccess += 1;
    return { taskId: r.taskId, tokens: r.tokens, cumulativeTokens: cumTokens, evidenceRecall: r.evidenceRecall, success: r.success, cumulativeSuccessRate: round3(cumSuccess / (i + 1)) };
  });
}

function aggregate(rows) {
  const n = rows.length || 0;
  const sum = (f) => rows.reduce((a, r) => a + (f(r) || 0), 0);
  const avg = (f) => (n ? round3(sum(f) / n) : 0);
  const byBackend = { graph: 0, repo: 0, other: 0 };
  for (const r of rows) for (const k of Object.keys(byBackend)) byBackend[k] += (r.byBackend[k] || 0);
  return {
    generatedAt: new Date().toISOString(),
    totalTasks: n,
    successCount: rows.filter(r => r.success).length,
    successRate: n ? round3(rows.filter(r => r.success).length / n) : 0,
    totalTokens: sum(r => r.tokens),
    avgTokens: avg(r => r.tokens),
    avgInputTokens: avg(r => r.tokensIn),
    avgOutputTokens: avg(r => r.tokensOut),
    avgLatencyMs: avg(r => r.latencyMs),
    avgTurns: avg(r => r.turns),
    avgToolCalls: avg(r => r.toolCalls),
    avgRoundTrips: avg(r => r.roundTrips),
    avgEvidenceRecall: avg(r => r.evidenceRecall),
    avgEvidencePrecision: avg(r => r.evidencePrecision),
    byBackend,
    failedTasks: rows.filter(r => !r.success).map(r => ({ taskId: r.taskId, missing: r.missing, evidenceRecall: r.evidenceRecall, tokens: r.tokens })),
    mostExpensive: [...rows].sort((a, b) => b.tokens - a.tokens).slice(0, 3).map(r => ({ taskId: r.taskId, tokens: r.tokens, roundTrips: r.roundTrips, toolCalls: r.toolCalls })),
    curve: buildCurve(rows),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { logs: null, seed: null, json: false, seedOnly: false, report: REPORT_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--logs') args.logs = argv[++i];
    else if (a === '--seed') args.seed = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--seed-only') args.seedOnly = true;
  }
  return args;
}

function evaluateLogs(logsDir, seed, universe) {
  const rows = [];
  for (const q of seed.questions) {
    const file = path.join(logsDir, `${q.id}.ndjson`);
    if (!fs.existsSync(file)) continue;
    const task = { id: q.id, dimension: q.dimension || q.dimensionKey || 'n/a', dimensionKey: q.dimensionKey || 'n/a', oracle: taskOracle(q) };
    const parsed = parseTrajectory(fs.readFileSync(file, 'utf8'));
    rows.push(scoreTask(parsed, task, universe, { estimate: true }));
  }
  return rows;
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const seed = loadSeed(args.seed);
  const validation = validateSeed(seed);
  if (!validation.ok) { console.error('invalid SEED:\n  - ' + validation.errors.join('\n  - ')); return 2; }

  if (args.seedOnly || !args.logs) {
    console.log(`Agent 成本—召回 SEED ${seed.seedId} v${seed.version}`);
    console.log(`任务数 ${seed.questions.length}：` + DIMENSION_KEYS.map(k => `${k}=${seed.questions.filter(q => q.dimensionKey === k).length}`).join('  '));
    if (!args.logs) console.log('（未指定 --logs，仅校验 SEED）');
    return 0;
  }

  const universe = buildUniverse({ repoRoot: ROOT, graphPath: GRAPH_PATH });
  const rows = evaluateLogs(args.logs, seed, universe);
  const summary = aggregate(rows);
  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.report, JSON.stringify({ seed: { seedId: seed.seedId, version: seed.version }, ...summary, results: rows }, null, 2));

  if (args.json) { console.log(JSON.stringify(summary)); return 0; }

  console.log('\nAgent 成本—召回度量（R7）');
  console.log('================================');
  for (const r of rows) {
    const mark = r.success ? '✓' : '✗';
    console.log(`${mark} ${r.taskId} [${r.dimension}] recall=${r.evidenceRecall} tokens=${r.tokens} turns=${r.turns} tools=${r.toolCalls}(g${r.byBackend.graph}/r${r.byBackend.repo}) roundTrips=${r.roundTrips}${r.success ? '' : '  ← 缺: ' + r.missing.join(',')}`);
  }
  console.log('--------------------------------');
  console.log(`成功率 ${summary.successCount}/${summary.totalTasks} (${(summary.successRate * 100).toFixed(1)}%)  平均召回 ${(summary.avgEvidenceRecall * 100).toFixed(1)}%  平均精度 ${(summary.avgEvidencePrecision * 100).toFixed(1)}%`);
  console.log(`平均 token ${summary.avgTokens}  平均时延 ${summary.avgLatencyMs}ms  平均轮次 ${summary.avgTurns}  平均工具调用 ${summary.avgToolCalls}  平均后端往返 ${summary.avgRoundTrips}`);
  console.log(`报告: ${args.report}`);
  return 0;
}

module.exports = {
  ROOT, SEED_PATH, GRAPH_PATH, REPORT_PATH,
  GRAPH_TOOLS, REPO_TOOLS,
  loadSeed, validateSeed, graphIds, walkRepo, buildUniverse, normPath,
  backendOf, parseTrajectory, extractEvidence, countRoundTrips, countBackends, estimateTokens,
  scoreTask, buildCurve, aggregate, evaluateLogs, main,
};

if (require.main === module) process.exit(main());
