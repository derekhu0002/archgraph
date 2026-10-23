'use strict';

// Cross-process, single-flight lock for the heavy semantic-index alignment
// (workspace bootstrap + semantic backfill + Neo4j sync + EA projection). Any
// invocation that can rebuild the index -- the MCP startup preheat, the
// query-path auto-alignment, and an explicit `argo init` (initializeWorkspace),
// in this process or another -- acquires this lock, so they serialize instead of
// racing (duplicate embeddings, concurrent Neo4j upserts, concurrent .qea
// rebuild, readiness/report races).
//
// The lock primitive (a `wx` file with stale-holder stealing) lives in
// argo/scripts/file-lock.js, shared with the canonical-graph write lock.

const path = require('node:path');
const { withFileLock } = require('../file-lock.js');

const LOCK_RELATIVE_PATH = path.join('.argo', 'temp', 'semantic-alignment.lock');
const DEFAULT_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_STALE_MS = 15 * 60 * 1000;

function alignmentLockPath(repositoryRoot) {
  return path.join(repositoryRoot, ...LOCK_RELATIVE_PATH.split(path.sep));
}

function alignmentLockTimeoutError() {
  const timeout = new Error('SEMANTIC_ALIGNMENT_LOCK_TIMEOUT');
  timeout.category = 'SEMANTIC_ALIGNMENT_LOCK_TIMEOUT';
  timeout.message = 'Another semantic alignment is already running and did not finish in time.';
  timeout.action = 'Wait for the running alignment (argo init) to finish, then retry.';
  return timeout;
}

async function withAlignmentLock(repositoryRoot, action, options = {}) {
  return withFileLock(alignmentLockPath(repositoryRoot), action, {
    waitMs: options.waitMs || DEFAULT_WAIT_MS,
    staleMs: options.staleMs || DEFAULT_STALE_MS,
    timeoutError: alignmentLockTimeoutError,
  });
}

module.exports = {
  withAlignmentLock,
  alignmentLockPath,
};
