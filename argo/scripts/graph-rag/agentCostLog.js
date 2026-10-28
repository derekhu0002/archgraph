'use strict';

// Agent cost LOG (framework, zero-config, background) — the single consolidated
// store for everything needed to reason about an agent's retrieval cost.
//
// WHY ONE FILE: in a real project the agent's scope is the whole repository (an
// unbounded content source) plus the curated intent graph (KG, only a semantic
// index / routing layer). Cost is dominated by the agent's round-trips BETWEEN
// the two backends (graph: getSystemArchitecture / getIntentElementContext /
// getArchitectureViewContext / queryNeo4jGraph / memory_search; repository:
// read / grep / glob), not by the size of either backend. To optimise without
// hurting recall we must measure that — in ONE place the user fetches once:
//
//     <workspace>/.argo/temp/agent-cost-log.ndjson
//
// WHO WRITES: the OpenCode plugin argo/plugins/argo-cost-collector.js. Every
// tool call the agent makes — MCP interface calls, graph writes, and repository
// calls alike — is a host tool, so the plugin records ALL of them, plus the
// assistant's token/cost usage. There is deliberately NO MCP-side instrumentation
// (a record without the host side would be incomplete and thus misleading).
//
// Posture (mirrors mcpCrashDiagnostics): best-effort, never throws, never logs
// secret values, and NEVER changes retrieval (it observes results only).

const fs = require('node:fs');
const path = require('node:path');

const LOG_FILE_NAME = 'agent-cost-log.ndjson';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const GRAPH_TOOLS = ['getSystemArchitecture', 'getIntentElementContext', 'getArchitectureViewContext', 'queryNeo4jGraph', 'memory_search'];
const GRAPH_WRITE_TOOLS = [
  'previewSystemArchitectureMutation', 'applySystemArchitectureMutation',
  'addArchitectureElement', 'updateArchitectureElement', 'removeArchitectureElement',
  'addArchitectureRelationship', 'updateArchitectureRelationship', 'removeArchitectureRelationship',
  'addArchitectureView', 'updateArchitectureView', 'removeArchitectureView',
];
const VALIDATOR_TOOLS = ['validateSystemArchitecture', 'runArchitectureTests'];
// `kind` must answer ONE question: did this call READ content? A cost metric that
// wants "the first retrieval of a run" cannot use a kind that lumps file writes,
// shell runs and task-list edits in with reads. So the repo backend keeps three
// distinct kinds (read / write / exec), and host utilities that touch neither the
// graph nor the repository stay `other`.
const REPO_READ_TOOLS = ['read', 'grep', 'glob', 'list', 'webfetch', 'fetch', 'search_files'];
const REPO_WRITE_TOOLS = ['write', 'edit', 'multiedit', 'apply_patch', 'patch'];
const SHELL_TOOLS = ['bash', 'shell', 'powershell', 'terminal', 'exec', 'exec_command', 'run_command'];

function enabled() {
  return process.env.ARGO_COST_PROFILER !== '0';
}

function maxBytes() {
  const n = Number(process.env.ARGO_COST_TRACE_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

function tempDir(workspaceRoot) {
  return path.join(workspaceRoot, '.argo', 'temp');
}

function logFilePath(workspaceRoot) {
  return path.join(tempDir(workspaceRoot), LOG_FILE_NAME);
}

// Pure, total classification. Host tool names vary (e.g. `read`,
// `mcp__argo__getSystemArchitecture`, `functions.read`), so strip a transport
// prefix (`mcp__<server>__`), a namespace (`functions.`), and the `argo_` alias
// before matching an exact tool key. Unknown names stay `other` rather than
// being force-fitted into a backend by substring.
function toolKey(tool) {
  const lower = String(tool || '').trim().toLowerCase();
  const tail = lower.split('__').pop();
  const segments = tail.split(/[.:]/);
  return segments[segments.length - 1].replace(/^argo_/, '');
}

function classifyTool(tool) {
  const key = toolKey(tool);
  if (GRAPH_WRITE_TOOLS.some(t => t.toLowerCase() === key)) return { backend: 'graph', kind: 'write' };
  if (GRAPH_TOOLS.some(t => t.toLowerCase() === key)) return { backend: 'graph', kind: 'read' };
  if (VALIDATOR_TOOLS.some(t => t.toLowerCase() === key)) return { backend: 'framework', kind: 'framework' };
  if (REPO_READ_TOOLS.includes(key)) return { backend: 'repo', kind: 'read' };
  if (REPO_WRITE_TOOLS.includes(key)) return { backend: 'repo', kind: 'write' };
  if (SHELL_TOOLS.includes(key)) return { backend: 'repo', kind: 'exec' };
  return { backend: 'other', kind: 'other' };
}

// Deterministic coarse token estimate: CJK ≈ 1 token/char, else ≈ 1/4 chars.
function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return cjk + Math.ceil((s.length - cjk) / 4);
}

function rotateIfNeeded(file, limit) {
  try {
    if (fs.statSync(file).size >= limit) fs.renameSync(file, `${file}.1`);
  } catch (_) { /* no existing log */ }
}

// Append one record to the single consolidated log. Best-effort: any failure is
// swallowed so logging can never affect a tool call.
function appendRecord(workspaceRoot, record) {
  if (!enabled() || !workspaceRoot || !record || typeof record !== 'object') return;
  try {
    const file = logFilePath(workspaceRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotateIfNeeded(file, maxBytes());
    const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...record }) + '\n';
    fs.appendFileSync(file, line, 'utf8');
  } catch (_) {
    // best-effort only
  }
}

function readLog(workspaceRoot) {
  const file = logFilePath(workspaceRoot);
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

function byteLen(value) {
  try {
    const s = JSON.stringify(value);
    return (typeof Buffer !== 'undefined') ? Buffer.byteLength(s) : s.length;
  } catch (_) { return 0; }
}

function keysOf(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? Object.keys(value).sort() : [];
}

// Host-collector hook logic (used by the OpenCode plugin; unit-tested in CJS).
// It records EVERY host tool call — MCP interface calls, graph writes, and
// repository calls alike — plus assistant token/cost usage into the single log.
function createHostCollectorHooks(workspaceRoot) {
  const starts = new Map();
  const seenUsage = new Set();
  return {
    // Hosts differ in WHERE the arguments live: OpenCode passes them as the
    // second argument of tool.execute.before ({ args }), while some harnesses
    // put them on the input object. Accept both, never record raw values.
    before(input, toolOutput) {
      if (!input || !input.callID) return;
      const args = (toolOutput && toolOutput.args) || input.args || {};
      starts.set(input.callID, { t: Date.now(), keys: keysOf(args), bytes: byteLen(args) });
    },
    after(input, output) {
      if (!input) return;
      const s = starts.get(input.callID) || {};
      const cls = classifyTool(input.tool);
      const out = (output && output.output) || '';
      appendRecord(workspaceRoot, {
        source: 'host',
        type: 'tool',
        sessionID: input.sessionID,
        callID: input.callID,
        tool: input.tool,
        backend: cls.backend,
        kind: cls.kind,
        durationMs: s.t ? (Date.now() - s.t) : 0,
        ok: true,
        args: { keys: s.keys || keysOf(input.args), bytes: s.bytes != null ? s.bytes : byteLen(input.args) },
        resultBytes: String(out).length,
        resultTokens: estimateTokens(out),
      });
      starts.delete(input.callID);
    },
    event(payload) {
      const event = payload && payload.event;
      const props = (event && event.properties) || {};
      const info = props.info || (event && event.info) || null;
      if (info && info.role === 'assistant' && info.tokens && info.id && !seenUsage.has(info.id)) {
        seenUsage.add(info.id);
        appendRecord(workspaceRoot, {
          source: 'host',
          type: 'usage',
          sessionID: info.sessionID,
          messageID: info.id,
          tokens: info.tokens,
          cost: info.cost,
        });
      }
    },
  };
}

module.exports = {
  LOG_FILE_NAME,
  enabled, tempDir, logFilePath, classifyTool, estimateTokens,
  appendRecord, readLog, createHostCollectorHooks,
};
