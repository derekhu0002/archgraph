'use strict';

// Agent cost recorder (framework, zero-config, background).
//
// WHY: in a real project the agent's scope is the whole repository (an unbounded
// content source) plus the curated intent graph (KG, only a semantic index /
// routing layer). The agent round-trips between two retrieval backends — graph
// (getSystemArchitecture / getIntentElementContext / getArchitectureViewContext
// / queryNeo4jGraph / memory_search) and repository (read / grep / glob) — and
// the dominant cost is the number of those round-trips, not the size of any one
// backend. To optimise that without hurting recall we must first MEASURE it.
//
// This module is the deployed measurement method, NOT a repo-local script and
// NOT an interface: it records and nothing else. The ARGO MCP server calls
// traceToolCall(...) on every tool call; each call appends one compact NDJSON
// record to the fixed, known path:
//
//     <workspace>/.argo/temp/argo-cost-trace.ndjson
//
// The user simply fetches that file from the known path when they want the
// measurement analysed. There is no MCP tool and no CLI by design.
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
// swallowed so recording can never affect a tool call.
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

module.exports = {
  TRACE_FILE_NAME,
  enabled, traceFilePath, tempDir, classifyTool, estimateTokens,
  traceToolCall, readTrace,
};

if (require.main === module) {
  // No CLI by design: the trace is fetched directly from the known path.
  console.log(traceFilePath(process.cwd()));
}
