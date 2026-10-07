'use strict';

// Cross-project workspace WRITE guard.
//
// The per-call `workspaceRoot` override is a wanted capability: it lets a caller
// READ another local project's intent graph. It must NOT let the caller WRITE
// another project's graph. This guard enforces that boundary for the whole MCP
// surface: any tool that mutates the target workspace (canonical graph, .qea,
// test-failure-records, handoff files) may only ever target the server's HOME
// workspace. A foreign `workspaceRoot` on a write tool is rejected fail-closed
// and nothing is written.
//
// READ tools are never gated here: a `workspaceRoot` on a read tool is honored,
// so cross-project reading keeps working.
//
// The HOME workspace is `getWorkspaceRoot()` — the root resolved WITHOUT the
// per-call override (ARGO_REPO_ROOT / WORKSPACE_FOLDER / MCP roots / embedded
// repo / cwd). The guard is ON by default. Set ARGO_WORKSPACE_WRITE_GUARD=0 to
// disable it for a trusted host that legitimately writes several workspaces
// through one server (e.g. a multi-workspace harness bridge). That switch is
// all-or-nothing; it does not reintroduce a per-path allowlist.

const path = require('node:path');

// Tools whose invocation mutates the target workspace. `preview*` and the read
// tools are intentionally absent.
const WRITE_TOOLS = Object.freeze(new Set([
  'initializeWorkspace',
  'runArchitectureTests',
  'applySystemArchitectureMutation',
  'addArchitectureElement',
  'updateArchitectureElement',
  'removeArchitectureElement',
  'addArchitectureRelationship',
  'updateArchitectureRelationship',
  'removeArchitectureRelationship',
  'addArchitectureView',
  'updateArchitectureView',
  'removeArchitectureView',
]));

function guardDisabled(env = process.env) {
  const value = env && env.ARGO_WORKSPACE_WRITE_GUARD;
  return value !== undefined && String(value).trim() === '0';
}

// A focused mutation with dryRun:true validates only and never writes, so it is
// not a write for this guard. initializeWorkspace has no dry-run.
function isWriteTool(name, args = {}) {
  if (!WRITE_TOOLS.has(name)) {
    return false;
  }
  if (name !== 'initializeWorkspace' && args && args.dryRun === true) {
    return false;
  }
  return true;
}

function sameWorkspace(a, b) {
  const na = path.resolve(String(a));
  const nb = path.resolve(String(b));
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/**
 * Authorize one write against the server's home workspace.
 *
 * @param {object} options
 * @param {string} options.tool
 * @param {object} [options.args]
 * @param {string} options.homeRoot - the server's own workspace root.
 * @param {object} [options.env] - injectable environment (tests).
 * @returns {{allowed:boolean, category?:string, message?:string, tool:string, homeWorkspaceRoot:string, requestedWorkspaceRoot:string}}
 */
function authorizeWorkspaceWrite({ tool, args = {}, homeRoot, env = process.env }) {
  const requestedRaw = args && typeof args.workspaceRoot === 'string' ? args.workspaceRoot.trim() : '';
  const requested = requestedRaw !== '' ? path.resolve(requestedRaw) : path.resolve(homeRoot);
  const base = {
    tool,
    homeWorkspaceRoot: path.resolve(homeRoot),
    requestedWorkspaceRoot: requested,
  };
  if (guardDisabled(env) || sameWorkspace(requested, homeRoot)) {
    return { ...base, allowed: true };
  }
  return {
    ...base,
    allowed: false,
    category: 'WORKSPACE_WRITE_DENIED',
    message:
      `Write tool '${tool}' targets workspace '${requested}' but this server is bound to '${base.homeWorkspaceRoot}'. ` +
      'Cross-project access is read-only: pass workspaceRoot only to read tools ' +
      '(getSystemArchitecture, getIntentElementContext, getArchitectureViewContext, queryNeo4jGraph, memory_search).',
  };
}

module.exports = {
  WRITE_TOOLS,
  guardDisabled,
  isWriteTool,
  sameWorkspace,
  authorizeWorkspaceWrite,
};
