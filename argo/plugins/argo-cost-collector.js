// Argo agent-cost collector plugin for opencode.
//
// The framework records ONE consolidated agent-cost log per workspace at
// <workspace>/.argo/temp/agent-cost-log.ndjson, so the user fetches a single
// file instead of stitching logs from several places. This plugin is the
// complete host-side collector: it sees EVERY tool call (both retrieval
// backends — graph and repository) plus assistant token/cost usage, which the
// MCP server alone cannot observe.
//
// It marks a per-workspace host-collector marker so the MCP server's fallback
// writer stays silent and the one log never double-counts. Recording only
// observes; it never changes retrieval. Disable with ARGO_COST_PROFILER=0.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let log = null;
try {
  log = require('../scripts/graph-rag/agentCostLog.js');
} catch {
  // The shared log module ships next to the plugins under ~/.argo; if it is
  // missing this plugin is a no-op so it can never break a session.
  log = null;
}

export default async function argoCostCollector(input) {
  if (!log) return {};
  const workspaceRoot = (input && (input.directory || input.worktree)) || process.cwd();
  log.markHostCollector(workspaceRoot);
  const hooks = log.createHostCollectorHooks(workspaceRoot);
  return {
    "tool.execute.before": async (i) => { try { hooks.before(i); } catch { /* best-effort */ } },
    "tool.execute.after": async (i, o) => { try { hooks.after(i, o); } catch { /* best-effort */ } },
    event: async (payload) => { try { hooks.event(payload); } catch { /* best-effort */ } },
    dispose: async () => { try { hooks.dispose(); } catch { /* best-effort */ } },
  };
}
