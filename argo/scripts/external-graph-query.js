'use strict';

// Cross-project graph query (federation client side).
//
// A read tool call may carry an optional `projectId`. Absent => the local
// workspace (unchanged). Present => the call is routed to the federation center
// (`POST <centerUrl>/graph/read`), which authorizes and forwards to the mirror
// engine; the native ARGO result is passed through with a `namespaceKey`. There
// is NO silent fallback to the local graph.
//
// The requester identity is the project's own `projectId`, read from
// `<workspace>/.argo/federation.json`. If it is missing, external queries fail
// with an explicit "register first" error — the id is never guessed.

const fs = require('node:fs');
const path = require('node:path');

const EXTERNAL_READ_TOOLS = new Set([
  'getSystemArchitecture',
  'getIntentElementContext',
  'getArchitectureViewContext',
  'queryNeo4jGraph',
  'memory_search',
]);

const FEDERATION_FILE = path.join('.argo', 'federation.json');
const DEFAULT_CENTER_URL = 'https://argo.derekworkspacev5.com';

function loadFederationIdentity(workspaceRoot) {
  const file = path.join(workspaceRoot || process.cwd(), FEDERATION_FILE);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const identity = JSON.parse(fs.readFileSync(file, 'utf8'));
    return identity && typeof identity === 'object' ? identity : null;
  } catch {
    return null;
  }
}

function isExternalQuery(args) {
  return Boolean(args) && typeof args.projectId === 'string' && args.projectId.trim() !== '';
}

// A tool call is external iff it is one of the readable tools AND carries projectId.
function externalQueryRequested(toolName, args) {
  return EXTERNAL_READ_TOOLS.has(toolName) && isExternalQuery(args);
}

function forwardedArgs(args) {
  const out = { ...(args || {}) };
  // projectId is the router parameter; workspaceRoot/architecturePath are local-only.
  delete out.projectId;
  delete out.workspaceRoot;
  delete out.architecturePath;
  return out;
}

/**
 * Route an external read. Returns the native ARGO result (with an added
 * `namespaceKey`) on success, or `{ status:'failed', error:{...} }` — never the
 * local result.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.tool
 * @param {object} options.args
 * @param {Function} [options.fetchImpl] - injectable fetch (tests)
 */
async function queryExternalRead({ workspaceRoot, tool, args, fetchImpl }) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { status: 'failed', error: { category: 'EXTERNAL_QUERY_UNREACHABLE', message: 'global fetch is unavailable in this runtime' } };
  }

  const identity = loadFederationIdentity(workspaceRoot);
  if (!identity || typeof identity.projectId !== 'string' || identity.projectId.trim() === '') {
    return {
      status: 'failed',
      error: {
        category: 'EXTERNAL_QUERY_NOT_REGISTERED',
        message: `No federation identity at ${FEDERATION_FILE}. Register this project with the federation center first (registry_register) and write its projectId to ${FEDERATION_FILE}.`,
      },
    };
  }

  if (!EXTERNAL_READ_TOOLS.has(tool)) {
    return {
      status: 'failed',
      error: { category: 'EXTERNAL_QUERY_TOOL_NOT_ALLOWED', message: `tool '${tool}' is not externally readable`, allowed: [...EXTERNAL_READ_TOOLS] },
    };
  }

  const centerUrl = String(identity.centerUrl || DEFAULT_CENTER_URL).replace(/\/+$/, '');
  const url = `${centerUrl}/graph/read`;
  const body = {
    requester: identity.projectId,
    projectId: args.projectId,
    tool,
    args: forwardedArgs(args),
  };

  let response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      status: 'failed',
      error: {
        category: 'EXTERNAL_QUERY_UNREACHABLE',
        message: `federation center unreachable: ${error && error.message ? error.message : error}`,
        centerUrl,
      },
    };
  }

  let payload = null;
  try { payload = await response.json(); } catch { /* leave null */ }

  if (response.status === 200 && payload && payload.status === 'ok') {
    // The engine returns the ARGO tool result; unwrap a {content:[{text}]}
    // envelope so callers get the native payload, then stamp the namespaceKey.
    let result = payload.result;
    if (result && Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === 'string') {
      try { result = JSON.parse(result.content[0].text); } catch { /* keep the envelope */ }
    }
    if (result && typeof result === 'object') {
      result = { ...result, namespaceKey: payload.namespaceKey || `proj:${args.projectId}` };
    }
    return result;
  }

  const denied = Boolean(payload && payload.status === 'denied');
  const reason = (payload && payload.reason)
    || (response.status === 403 ? 'not_authorized' : `http_${response.status}`);
  return {
    status: 'failed',
    error: {
      category: denied ? 'EXTERNAL_QUERY_DENIED' : 'EXTERNAL_QUERY_FAILED',
      reason,
      httpStatus: response.status,
      requester: identity.projectId,
      projectId: args.projectId,
      namespaceKey: `proj:${args.projectId}`,
    },
  };
}

module.exports = {
  EXTERNAL_READ_TOOLS,
  FEDERATION_FILE,
  DEFAULT_CENTER_URL,
  loadFederationIdentity,
  isExternalQuery,
  externalQueryRequested,
  queryExternalRead,
};
