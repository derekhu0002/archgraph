'use strict';

// Agent cost profiler (framework, zero-config, background).
//
// WHY: in a real project the agent's scope is the whole repository (an unbounded
// content source) plus the curated intent graph (KG, only a semantic index /
// routing layer). The agent round-trips between two retrieval backends — graph
// (getSystemArchitecture / getIntentElementContext / getArchitectureViewContext
// / queryNeo4jGraph / memory_search) and repository (read / grep / glob) — and
// the dominant cost is the number of those round-trips, not the size of any one
// backend. To optimise that without hurting recall we must first MEASURE it.
//
// This module is the deployed measurement method, not a repo-local script:
//   - traceToolCall(...) is called by the ARGO MCP server on EVERY tool call,
//     appending one compact NDJSON record per call to the per-workspace trace
//     <workspace>/.argo/temp/argo-cost-trace.ndjson (append-only, rotated).
//   - summarize(...) aggregates the trace into a compact digest (calls / backend
//     / read-vs-write / latency p50·p95 / returned tokens) the user can paste.
//   - parseHostSession(...) + mergeHostSession(...) fold an exported host session
//     (opencode run --format json NDJSON) into the picture for the cross-backend
//     metrics the MCP alone cannot see: turns, graph-vs-repo tool mix, backend
//     round-trips, tokens, latency.
//   - scoreEvidence(...) scores a host session against a project-provided oracle
//     ({elements, repoPaths}) -> evidenceRecall / evidencePrecision. The red line:
//     any optimisation that shrinks recall MUST be surfaced, never hidden.
//
// Posture (mirrors mcpCrashDiagnostics): best-effort, never throws from the tool
// path, never blocks a tool call, and never logs secret values. Enabled by
// default; set ARGO_COST_PROFILER=0 to disable. It NEVER changes retrieval: it
// only observes the result already produced (no candidate/content reduction).

const fs = require('node:fs');
const path = require('node:path');

const TRACE_FILE_NAME = 'argo-cost-trace.ndjson';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const GRAPH_TOOLS = ['getSystemArchitecture', 'getIntentElementContext', 'getArchitectureViewContext', 'queryNeo4jGraph', 'memory_search'];
const GRAPH_WRITE_TOOLS = [
  'previewSystemArchitectureMutation', 'applySystemArchitectureMutation',
  'addArchitectureElement', 'updateArchitectureElement', 'removeArchitectureElement',
  'addArchitectureRelationship', 'updateArchitectureRelationship', 'removeArchitectureRelationship',
  'addArchitectureView', 'updateArchitectureView', 'removeArchitectureView',
];
const VALIDATOR_TOOLS = ['validateSystemArchitecture', 'runArchitectureTests', 'initializeWorkspace'];
const REPO_TOOLS = ['read', 'grep', 'glob', 'list', 'bash', 'webfetch', 'edit', 'write'];

function enabled() {
  return process.env.ARGO_COST_PROFILER !== '0';
}

function maxBytes() {
  const n = Number(process.env.ARGO_COST_TRACE_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

function traceFilePath(workspaceRoot) {
  return path.join(workspaceRoot, '.argo', 'temp', TRACE_FILE_NAME);
}

function tempDir(workspaceRoot) {
  return path.join(workspaceRoot, '.argo', 'temp');
}

// Classify a tool name into its retrieval backend and read/write kind. Pure and
// total so host-session tool names (which may be prefixed, e.g. mcp__argo__X)
// classify correctly.
function classifyTool(tool) {
  const name = String(tool || '');
  const hit = (list) => list.some(t => name.includes(t));
  if (hit(GRAPH_WRITE_TOOLS)) return { backend: 'graph', kind: 'write' };
  if (hit(GRAPH_TOOLS)) return { backend: 'graph', kind: 'read' };
  if (hit(VALIDATOR_TOOLS)) return { backend: 'framework', kind: 'framework' };
  if (hit(REPO_TOOLS)) return { backend: 'repo', kind: 'read' };
  return { backend: 'other', kind: 'other' };
}

// Deterministic coarse token estimate (no tokenizer dependency), same heuristic
// used across the framework: CJK ≈ 1 token/char, everything else ≈ 1/4 chars.
function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return cjk + Math.ceil((s.length - cjk) / 4);
}

function resultText(result) {
  if (!result) return '';
  if (result.content && Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === 'string') {
    return result.content[0].text;
  }
  try { return JSON.stringify(result); } catch (_) { return ''; }
}

// A secret-safe, analysis-useful argument digest: top-level key names plus an
// optional short intent preview for semantic retrieval tools. Raw argument
// values (which could carry secrets) are never written.
function argsDigest(tool, args) {
  if (!args || typeof args !== 'object') return { keys: [], bytes: 0 };
  let bytes = 0;
  try { bytes = Buffer.byteLength(JSON.stringify(args)); } catch (_) { bytes = 0; }
  const digest = { keys: Object.keys(args).sort(), bytes };
  const intent = (args.query && args.query.intent) || args.intent || (tool === 'memory_search' ? args.query : undefined);
  if (typeof intent === 'string' && intent) digest.intentPreview = intent.slice(0, 120);
  return digest;
}

function rotateIfNeeded(file, limit) {
  try {
    const st = fs.statSync(file);
    if (st.size >= limit) fs.renameSync(file, `${file}.1`);
  } catch (_) { /* no existing trace */ }
}

// Append one trace record for a completed tool call. Best-effort: any failure is
// swallowed so profiling can never affect a tool call.
function traceToolCall(workspaceRoot, { tool, args, result, error, durationMs }) {
  if (!enabled() || !workspaceRoot) return;
  try {
    const file = traceFilePath(workspaceRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotateIfNeeded(file, maxBytes());
    const cls = classifyTool(tool);
    const text = resultText(result);
    const record = {
      at: new Date().toISOString(),
      pid: process.pid,
      tool,
      backend: cls.backend,
      kind: cls.kind,
      durationMs: Math.max(0, Math.round(durationMs || 0)),
      ok: !error,
      ...(error ? { errorKind: String((error && error.name) || 'Error').slice(0, 80) } : {}),
      args: argsDigest(tool, args),
      resultBytes: text.length,
      resultTokens: estimateTokens(text),
    };
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
  } catch (_) {
    // best-effort only
  }
}

function readTrace(workspaceRoot) {
  const file = traceFilePath(workspaceRoot);
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return { file, records: [] }; }
  const records = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { records.push(JSON.parse(t)); } catch (_) { /* skip malformed */ }
  }
  return { file, records };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function emptyBucket() {
  return { calls: 0, errors: 0, resultTokens: 0, durations: [] };
}

function finalizeBucket(b) {
  const sorted = [...b.durations].sort((a, z) => a - z);
  return {
    calls: b.calls,
    errors: b.errors,
    resultTokens: b.resultTokens,
    avgMs: b.calls ? Math.round(b.durations.reduce((a, z) => a + z, 0) / b.calls) : 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

// Aggregate the trace into a compact digest the user can copy and send.
function summarize(workspaceRoot) {
  const { file, records } = readTrace(workspaceRoot);
  const byTool = {};
  const byBackend = {};
  const byKind = {};
  let errors = 0;
  let totalTokens = 0;
  let firstAt = null;
  let lastAt = null;
  const bump = (map, key, r) => {
    const b = map[key] || (map[key] = emptyBucket());
    b.calls += 1;
    if (!r.ok) b.errors += 1;
    b.resultTokens += r.resultTokens || 0;
    b.durations.push(r.durationMs || 0);
  };
  for (const r of records) {
    bump(byTool, r.tool || 'unknown', r);
    bump(byBackend, r.backend || 'other', r);
    bump(byKind, r.kind || 'other', r);
    if (!r.ok) errors += 1;
    totalTokens += r.resultTokens || 0;
    if (r.at) { firstAt = firstAt || r.at; lastAt = r.at; }
  }
  const finalize = (map) => {
    const out = {};
    for (const [k, b] of Object.entries(map)) out[k] = finalizeBucket(b);
    return out;
  };
  const topToolsByTokens = Object.entries(byTool)
    .map(([tool, b]) => ({ tool, calls: b.calls, resultTokens: b.resultTokens }))
    .sort((a, z) => z.resultTokens - a.resultTokens)
    .slice(0, 5);
  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    traceFile: file,
    span: { firstAt, lastAt, records: records.length },
    calls: { total: records.length, errors },
    tokens: { total: totalTokens, avg: records.length ? Math.round(totalTokens / records.length) : 0 },
    byTool: finalize(byTool),
    byBackend: finalize(byBackend),
    byKind: finalize(byKind),
    topToolsByTokens,
  };
}

// ── host session (opencode run --format json NDJSON) ─────────────────────────
function parseHostSession(text) {
  const raw = String(text || '');
  const toolCalls = [];
  let tokensIn = 0; let tokensOut = 0; let tokensReasoning = 0; let steps = 0; let cost = 0;
  let tMin = null; let tMax = null;
  const timeOf = (e) => {
    const parts = [e.time, e.part && e.part.time];
    for (const t of parts) {
      if (!t) continue;
      if (typeof t === 'number') return t;
      if (typeof t.start === 'number' && typeof t.end === 'number') return t.end;
      if (typeof t.start === 'number') return t.start;
      if (typeof t.end === 'number') return t.end;
    }
    return null;
  };
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let e; try { e = JSON.parse(s); } catch (_) { continue; }
    const part = e.part || e;
    if (part && part.type === 'tool') {
      const tool = part.tool || part.name || (part.state && part.state.tool) || 'tool';
      toolCalls.push({ tool, ...classifyTool(tool) });
    }
    if (e.type === 'tool_use' && e.tool) toolCalls.push({ tool: e.tool, ...classifyTool(e.tool) });
    if (e.type === 'step_start') steps += 1;
    if (e.type === 'step_finish') {
      const fin = (e.part && e.part.finish) ? e.part.finish : (e.part || e);
      if (fin && typeof fin.cost === 'number') cost += fin.cost;
      const tk = fin && (fin.tokens || (fin.finish && fin.finish.tokens));
      if (tk) { tokensIn += tk.input || 0; tokensOut += tk.output || 0; tokensReasoning += tk.reasoning || tk.reasoningTokens || 0; }
    }
    const t = timeOf(e);
    if (t !== null) { tMin = tMin === null ? t : Math.min(tMin, t); tMax = tMax === null ? t : Math.max(tMax, t); }
  }
  const byBackend = { graph: 0, repo: 0, other: 0 };
  const seq = [];
  for (const c of toolCalls) {
    byBackend[c.backend] = (byBackend[c.backend] || 0) + 1;
    if (c.backend === 'graph' || c.backend === 'repo') seq.push(c.backend);
  }
  let roundTrips = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) roundTrips += 1;
  return {
    turns: steps,
    toolCalls: toolCalls.length,
    byBackend,
    roundTrips,
    tokensIn, tokensOut, tokensReasoning,
    tokens: tokensIn + tokensOut + tokensReasoning,
    cost,
    latencyMs: (tMin !== null && tMax !== null && tMax >= tMin) ? (tMax - tMin) : null,
  };
}

// ── evidence scoring against a project-provided oracle ───────────────────────
function boundaryRe(token) {
  return new RegExp('(?<![\\w-])' + String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
}

function scoreEvidence(oracle, sessionText, universe) {
  const norm = (p) => String(p || '').replace(/\\/g, '/');
  const oracleIds = (oracle && oracle.elements) || [];
  const oraclePaths = ((oracle && oracle.repoPaths) || []).map(norm);
  const text = String(sessionText || '').replace(/\\\//g, '/');
  const ids = (universe && universe.ids ? [...universe.ids] : oracleIds);
  const paths = (universe && universe.paths ? [...universe.paths] : oraclePaths).map(norm);
  const found = new Set();
  for (const id of ids) if (boundaryRe(id).test(text)) found.add(id);
  for (const p of paths) if (text.includes(p)) found.add(p);
  const oracleSet = new Set([...oracleIds, ...oraclePaths]);
  const hits = [...oracleSet].filter(t => found.has(t));
  const missing = [...oracleSet].filter(t => !found.has(t));
  return {
    evidenceRecall: oracleSet.size ? Math.round((hits.length / oracleSet.size) * 1000) / 1000 : 1,
    evidencePrecision: found.size ? Math.round((hits.length / found.size) * 1000) / 1000 : 0,
    missing,
  };
}

function mergeHostSession(host, summary) {
  return {
    graph: {
      backend: 'graph',
      callsFromHost: host.byBackend.graph,
      callsFromTrace: summary.byBackend && summary.byBackend.graph ? summary.byBackend.graph.calls : 0,
    },
    repo: { backend: 'repo', callsFromHost: host.byBackend.repo },
    tokens: { session: host.tokens, sessionIn: host.tokensIn, sessionOut: host.tokensOut, sessionReasoning: host.tokensReasoning, graphResultTokens: summary.tokens.total },
    cost: { sessionCost: host.cost },
    roundTrips: host.roundTrips,
    turns: host.turns,
    hostToolCalls: host.toolCalls,
    latencyMs: host.latencyMs,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { command: 'report', workspace: process.cwd(), hostLog: null, seed: null, json: false, universe: null };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('--')) out.command = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--workspace') out.workspace = rest[++i];
    else if (a === '--host-log') out.hostLog = rest[++i];
    else if (a === '--seed') out.seed = rest[++i];
    else if (a === '--universe') out.universe = rest[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}

function humanDigest(summary) {
  const lines = [];
  lines.push(`Agent cost digest  (${summary.calls.total} tool calls, ${summary.calls.errors} errors)`);
  lines.push(`trace: ${summary.traceFile}`);
  if (summary.span.firstAt) lines.push(`span: ${summary.span.firstAt} → ${summary.span.lastAt}`);
  lines.push(`returned tokens: total ${summary.tokens.total} / avg ${summary.tokens.avg}`);
  for (const [backend, b] of Object.entries(summary.byBackend)) {
    lines.push(`  backend ${backend}: calls=${b.calls} p50=${b.p50Ms}ms p95=${b.p95Ms}ms tokens=${b.resultTokens}`);
  }
  for (const [kind, b] of Object.entries(summary.byKind)) {
    lines.push(`  kind ${kind}: calls=${b.calls} avg=${b.avgMs}ms`);
  }
  const tools = Object.entries(summary.byTool).sort((a, z) => z[1].calls - a[1].calls).slice(0, 10);
  for (const [tool, b] of tools) lines.push(`  tool ${tool}: calls=${b.calls} p95=${b.p95Ms}ms tokens=${b.resultTokens}`);
  return lines.join('\n');
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const summary = summarize(args.workspace);
  let out = { ...summary };
  if (args.hostLog) {
    const host = parseHostSession(fs.readFileSync(args.hostLog, 'utf8'));
    out = { ...out, host, crossBackend: mergeHostSession(host, summary) };
    if (args.seed) {
      const seed = JSON.parse(fs.readFileSync(args.seed, 'utf8'));
      const universes = args.universe ? JSON.parse(fs.readFileSync(args.universe, 'utf8')) : null;
      out.evidence = seed.questions.map(q => ({
        id: q.id,
        oracle: q.oracle || (q.target ? { elements: [q.target.id], repoPaths: [] } : { elements: [], repoPaths: [] }),
        ...scoreEvidence(q.oracle || (q.target ? { elements: [q.target.id], repoPaths: [] } : {}), fs.readFileSync(args.hostLog, 'utf8'), universes),
      }));
    }
  }
  if (args.json) { console.log(JSON.stringify(out, null, 2)); return 0; }
  console.log(humanDigest(summary));
  if (out.crossBackend) {
    console.log('--- cross-backend (host session) ---');
    console.log(`turns=${out.host.turns} toolCalls=${out.host.toolCalls} (graph=${out.crossBackend.graph.callsFromHost} repo=${out.crossBackend.repo.callsFromHost}) roundTrips=${out.host.roundTrips} tokens=${out.host.tokens} latency=${out.host.latencyMs}ms`);
  }
  if (out.evidence) {
    console.log('--- evidence recall vs oracle ---');
    for (const e of out.evidence) console.log(`${e.evidenceRecall === 1 ? '✓' : '✗'} ${e.id} recall=${e.evidenceRecall} precision=${e.evidencePrecision}${e.missing.length ? ' missing=' + e.missing.join(',') : ''}`);
  }
  return 0;
}

module.exports = {
  TRACE_FILE_NAME,
  enabled, traceFilePath, tempDir, classifyTool, estimateTokens,
  traceToolCall, readTrace, summarize, parseHostSession, scoreEvidence, mergeHostSession, main,
};

if (require.main === module) process.exit(main());
