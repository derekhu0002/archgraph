'use strict';

// Canonical-graph cross-process write lock (L0 lost-update guard).
//
// Every mutating ARGO MCP call is a whole-file read-modify-write of the canonical
// graph. Two MCP server processes (one per agent/session) could each read v1 and
// write v2/v2', so the later write silently dropped the earlier one. This lock
// serializes that window across processes.
//
// The lock file is `<graph>.lock`, the same convention the EA web service uses,
// so an agent write and a human web-service write cannot clobber each other.
//
// Scope: mutating calls only. Reads (including preview) stay lock-free; a
// whole-file `rename` already keeps readers from seeing a torn document.

const { withFileLock } = require('./file-lock.js');

const DEFAULT_WAIT_MS = 120 * 1000;
const DEFAULT_STALE_MS = 10 * 60 * 1000;

function graphWriteLockPath(graphPath) {
  return `${graphPath}.lock`;
}

function envMs(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function graphWriteLockTimeoutError(graphPath) {
  const error = new Error('GRAPH_WRITE_LOCK_TIMEOUT');
  error.category = 'GRAPH_WRITE_LOCK_TIMEOUT';
  error.message = `Another agent/session is writing the canonical graph (${graphPath}) and did not release the lock in time.`;
  error.action = 'Retry the same mutation once the other write finishes; never bypass the lock by editing the graph file directly.';
  return error;
}

async function withGraphWriteLock(graphPath, action, options = {}) {
  if (!graphPath || typeof graphPath !== 'string') {
    throw new Error('withGraphWriteLock requires an absolute canonical graph path');
  }
  const waitMs = Number.isFinite(options.waitMs) && options.waitMs > 0
    ? options.waitMs
    : envMs('ARGO_GRAPH_WRITE_LOCK_WAIT_MS', DEFAULT_WAIT_MS);
  const staleMs = Number.isFinite(options.staleMs) && options.staleMs > 0
    ? options.staleMs
    : envMs('ARGO_GRAPH_WRITE_LOCK_STALE_MS', DEFAULT_STALE_MS);
  return withFileLock(graphWriteLockPath(graphPath), action, {
    waitMs,
    staleMs,
    pollMs: options.pollMs,
    timeoutError: () => graphWriteLockTimeoutError(graphPath),
  });
}

module.exports = {
  withGraphWriteLock,
  graphWriteLockPath,
};
