'use strict';

// MCP-side fallback writer for the single consolidated agent-cost log.
//
// The consolidated log (argo/scripts/graph-rag/agentCostLog.js) has one fixed
// path: <workspace>/.argo/temp/agent-cost-log.ndjson. Under OpenCode the plugin
// argo/plugins/argo-cost-collector.js is the complete collector (it sees every
// tool call on both backends plus token/cost usage). This module is the MCP
// server's contribution, used only when NO host collector is active (marker
// file absent) so the one log never double-counts.
//
// Posture: best-effort, never throws, never logs secret values, never changes
// retrieval (it observes the already-produced result only).

const log = require('./agentCostLog.js');

function resultText(result) {
  if (!result) return '';
  if (result.content && Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === 'string') {
    return result.content[0].text;
  }
  try { return JSON.stringify(result); } catch (_) { return ''; }
}

// Secret-safe, analysis-useful argument digest: top-level key names + an
// optional short semantic-intent preview. Raw argument values are never written.
function argsDigest(tool, args) {
  if (!args || typeof args !== 'object') return { keys: [], bytes: 0 };
  let bytes = 0;
  try { bytes = Buffer.byteLength(JSON.stringify(args)); } catch (_) { bytes = 0; }
  const digest = { keys: Object.keys(args).sort(), bytes };
  const intent = (args.query && args.query.intent) || args.intent || (tool === 'memory_search' ? args.query : undefined);
  if (typeof intent === 'string' && intent) digest.intentPreview = intent.slice(0, 120);
  return digest;
}

// Append one MCP-side tool-call record unless a host collector already owns the
// log for this workspace.
function traceToolCall(workspaceRoot, { tool, args, result, error, durationMs }) {
  if (!log.enabled() || !workspaceRoot) return;
  if (log.hostCollectorActive(workspaceRoot)) return;
  try {
    const cls = log.classifyTool(tool);
    const text = resultText(result);
    log.appendRecord(workspaceRoot, {
      source: 'mcp',
      type: 'tool',
      tool,
      backend: cls.backend,
      kind: cls.kind,
      durationMs: Math.max(0, Math.round(durationMs || 0)),
      ok: !error,
      ...(error ? { errorKind: String((error && error.name) || 'Error').slice(0, 80) } : {}),
      args: argsDigest(tool, args),
      resultBytes: text.length,
      resultTokens: log.estimateTokens(text),
    });
  } catch (_) {
    // best-effort only
  }
}

module.exports = {
  LOG_FILE_NAME: log.LOG_FILE_NAME,
  HOST_MARKER_NAME: log.HOST_MARKER_NAME,
  enabled: log.enabled,
  traceFilePath: log.logFilePath,
  tempDir: log.tempDir,
  classifyTool: log.classifyTool,
  estimateTokens: log.estimateTokens,
  hostCollectorActive: log.hostCollectorActive,
  markHostCollector: log.markHostCollector,
  clearHostCollector: log.clearHostCollector,
  traceToolCall,
  readTrace: log.readLog,
};
