'use strict';

// Cross-project workspace WRITE guard.
//
// The per-call `workspaceRoot` override is a wanted capability: it lets a caller
// READ another local project's intent graph. It must NOT let the caller WRITE an
// arbitrary other project's graph. This guard bounds writes to the server's HOME
// workspace PLUS a host-designated session workspace that only a trusted broker
// may name.
//
// Two channels, deliberately distinct:
//   - `workspaceRoot`      : the generic per-call override. A model may set it.
//                            Reads honor it; a WRITE to a foreign path is denied.
//   - `sessionWorkspaceRoot`: the host broker's (e.g. the DSH workspace bridge)
//                            designation of the current session's workspace. It
//                            is trusted for writes ONLY when the process was
//                            launched with ARGO_WORKSPACE_ROOT_TRUSTED=1 (set by
//                            the broker at spawn, which the model cannot forge).
//                            A model-supplied sessionWorkspaceRoot on a plain
//                            (unflagged) server is ignored.
//
// So: cross-project reading keeps working everywhere; cross-project WRITING is
// blocked unless the trusted host broker explicitly designates that workspace.
// The whole guard is OFF (all-or-nothing) with ARGO_WORKSPACE_WRITE_GUARD=0.

const path = require('node:path');

// Host-designated trusted session workspace (broker channel, not advertised to
// the model).
const TRUSTED_SESSION_FIELD = 'sessionWorkspaceRoot';
// Spawn-time flag the broker sets to assert it controls TRUSTED_SESSION_FIELD.
const TRUSTED_ENV = 'ARGO_WORKSPACE_ROOT_TRUSTED';

// Tools whose invocation mutates the target workspace. `preview*` and the read
// tools are intentionally absent.
const WRITE_TOOLS = Object.freeze(new Set([
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
// not a write for this guard. (Workspace init is now the `argo-init` CLI, not an
// MCP tool, so it is no longer in WRITE_TOOLS.)
function isWriteTool(name, args = {}) {
  if (!WRITE_TOOLS.has(name)) {
    return false;
  }
  if (args && args.dryRun === true) {
    return false;
  }
  return true;
}

function sameWorkspace(a, b) {
  const na = path.resolve(String(a));
  const nb = path.resolve(String(b));
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

// The host-broker-designated session workspace, honored only behind the
// spawn-time trust flag. Returns an absolute path or null.
function trustedSessionWorkspace(args, env = process.env) {
  if (!env || String(env[TRUSTED_ENV]).trim() !== '1') {
    return null;
  }
  const raw = args && typeof args[TRUSTED_SESSION_FIELD] === 'string'
    ? args[TRUSTED_SESSION_FIELD].trim()
    : '';
  return raw !== '' ? path.resolve(raw) : null;
}

/**
 * Authorize one write against the home workspace and the trusted session workspace.
 *
 * @param {object} options
 * @param {string} options.tool
 * @param {object} [options.args]
 * @param {string} options.homeRoot - the server's own workspace root.
 * @param {object} [options.env] - injectable environment (tests).
 * @returns {{allowed:boolean, category?:string, message?:string, tool:string, homeWorkspaceRoot:string, requestedWorkspaceRoot:string, trustedSessionWorkspaceRoot:(string|null)}}
 */
function authorizeWorkspaceWrite({ tool, args = {}, homeRoot, env = process.env }) {
  const requestedRaw = args && typeof args.workspaceRoot === 'string' ? args.workspaceRoot.trim() : '';
  const requested = requestedRaw !== '' ? path.resolve(requestedRaw) : path.resolve(homeRoot);
  const trusted = trustedSessionWorkspace(args, env);
  const base = {
    tool,
    homeWorkspaceRoot: path.resolve(homeRoot),
    requestedWorkspaceRoot: requested,
    trustedSessionWorkspaceRoot: trusted,
  };
  if (guardDisabled(env) || sameWorkspace(requested, homeRoot)) {
    return { ...base, allowed: true };
  }
  if (trusted && sameWorkspace(requested, trusted)) {
    return { ...base, allowed: true };
  }
  return {
    ...base,
    allowed: false,
    category: 'WORKSPACE_WRITE_DENIED',
    message:
      `Write tool '${tool}' targets workspace '${requested}' but this server is only allowed to write its home workspace ` +
      `'${base.homeWorkspaceRoot}' (plus a trusted host-designated session workspace). Cross-project access is read-only: ` +
      'pass workspaceRoot only to read tools (getSystemArchitecture, getIntentElementContext, getArchitectureViewContext, ' +
      'queryNeo4jGraph, memory_search).',
  };
}

// Remove the broker-only field so it never reaches tool schema validation.
function stripTrustedSessionField(args) {
  if (!args || !Object.prototype.hasOwnProperty.call(args, TRUSTED_SESSION_FIELD)) {
    return args;
  }
  const next = { ...args };
  delete next[TRUSTED_SESSION_FIELD];
  return next;
}

module.exports = {
  WRITE_TOOLS,
  TRUSTED_SESSION_FIELD,
  TRUSTED_ENV,
  guardDisabled,
  isWriteTool,
  sameWorkspace,
  trustedSessionWorkspace,
  authorizeWorkspaceWrite,
  stripTrustedSessionField,
};
