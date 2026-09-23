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
// hurting recall we must measure that. Rather than scatter instrumentation and
// make the user fetch from several places, every source writes ONE stream at a
// fixed, known path:
//
//     <workspace>/.argo/temp/agent-cost-log.ndjson
//
// Sources (each record carries `source`):
//   - "host": the OpenCode plugin argo/plugins/argo-cost-collector.js. It sees
//     EVERY tool call (both backends) plus assistant token/cost usage, so under
//     OpenCode it is the complete single collector.
//   - "mcp":  the ARGO MCP server, a fallback for hosts without the plugin. It
//     is suppressed while a host collector is active (marker file below) so the
//     one log never double-counts.
//
// Posture (mirrors mcpCrashDiagnostics): best-effort, never throws, never logs
// secret values, and NEVER changes retrieval (it observes results only).

const fs = require('node:fs');
const path = require('node:path');

const LOG_FILE_NAME = 'agent-cost-log.ndjson';
const HOST_MARKER_NAME = '.agent-cost-host-collector';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const HOST_MARKER_STALE_MS = 12 * 60 * 60 * 1000;

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

function tempDir(workspaceRoot) {
  return path.join(workspaceRoot, '.argo', 'temp');
}

function logFilePath(workspaceRoot) {
  return path.join(tempDir(workspaceRoot), LOG_FILE_NAME);
}

function hostMarkerPath(workspaceRoot) {
  return path.join(tempDir(workspaceRoot), HOST_MARKER_NAME);
}

// Pure, total classification used by every source. Host tool names may be
// prefixed (e.g. mcp__argo__getSystemArchitecture), so match by substring.
function classifyTool(tool) {
  const name = String(tool || '');
  const hit = (list) => list.some(t => name.includes(t));
  if (hit(GRAPH_WRITE_TOOLS)) return { backend: 'graph', kind: 'write' };
  if (hit(GRAPH_TOOLS)) return { backend: 'graph', kind: 'read' };
  if (hit(VALIDATOR_TOOLS)) return { backend: 'framework', kind: 'framework' };
  if (hit(REPO_TOOLS)) return { backend: 'repo', kind: 'read' };
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
    const line = JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      ...record,
    }) + '\n';
    fs.appendFileSync(file, line, 'utf8');
  } catch (_) {
    // best-effort only
  }
}

// The host collector marks its activity so the MCP fallback does not duplicate.
function markHostCollector(workspaceRoot) {
  if (!workspaceRoot) return;
  try {
    fs.mkdirSync(tempDir(workspaceRoot), { recursive: true });
    fs.writeFileSync(hostMarkerPath(workspaceRoot), JSON.stringify({ at: new Date().toISOString(), pid: process.pid }) + '\n', 'utf8');
  } catch (_) { /* best-effort */ }
}

function clearHostCollector(workspaceRoot) {
  if (!workspaceRoot) return;
  try { fs.rmSync(hostMarkerPath(workspaceRoot), { force: true }); } catch (_) { /* best-effort */ }
}

function hostCollectorActive(workspaceRoot) {
  if (!workspaceRoot) return false;
  try {
    const st = fs.statSync(hostMarkerPath(workspaceRoot));
    return (Date.now() - st.mtimeMs) < HOST_MARKER_STALE_MS;
  } catch (_) {
    return false;
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

// Host-collector hook logic (used by the OpenCode plugin, and unit-tested in
// CJS). It records EVERY host tool call on both backends plus assistant
// token/cost usage into the single consolidated log. Kept here (not in the ESM
// plugin) so it stays plainly testable and shares the exact same schema.
function createHostCollectorHooks(workspaceRoot) {
  const starts = new Map();
  const seenUsage = new Set();
  return {
    before(input) {
      if (!input || !input.callID) return;
      const args = input.args || {};
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
    dispose() {
      clearHostCollector(workspaceRoot);
    },
  };
}

module.exports = {
  LOG_FILE_NAME, HOST_MARKER_NAME,
  enabled, tempDir, logFilePath, hostMarkerPath, classifyTool, estimateTokens,
  appendRecord, markHostCollector, clearHostCollector, hostCollectorActive, readLog,
  createHostCollectorHooks,
};
