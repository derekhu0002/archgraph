'use strict';

// Cross-process, single-flight lock for the heavy semantic-index alignment
// (workspace bootstrap + semantic backfill + Neo4j sync + EA projection). Any
// invocation that can rebuild the index -- the MCP startup preheat, the
// query-path auto-alignment, and an explicit `argo init` (initializeWorkspace),
// in this process or another -- acquires this lock, so they serialize instead of
// racing (duplicate embeddings, concurrent Neo4j upserts, concurrent .qea
// rebuild, readiness/report races).
//
// The lock is a regular file created with `wx` under <workspace>/.argo/temp. A
// holder that crashes leaves a stale file; a lock older than `staleMs` is stolen.

const fs = require('node:fs');
const path = require('node:path');

const LOCK_RELATIVE_PATH = path.join('.argo', 'temp', 'semantic-alignment.lock');
const DEFAULT_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_STALE_MS = 15 * 60 * 1000;

function alignmentLockPath(repositoryRoot) {
  return path.join(repositoryRoot, ...LOCK_RELATIVE_PATH.split(path.sep));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withAlignmentLock(repositoryRoot, action, options = {}) {
  const waitMs = Number.isFinite(options.waitMs) && options.waitMs > 0 ? options.waitMs : DEFAULT_WAIT_MS;
  const staleMs = Number.isFinite(options.staleMs) && options.staleMs > 0 ? options.staleMs : DEFAULT_STALE_MS;
  const file = alignmentLockPath(repositoryRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + waitMs;
  let fd = null;
  for (;;) {
    try {
      fd = fs.openSync(file, 'wx');
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
      let stale = false;
      try {
        stale = (Date.now() - fs.statSync(file).mtimeMs) > staleMs;
      } catch {
        stale = true;
      }
      if (stale) {
        try { fs.unlinkSync(file); } catch { /* raced with another stealer */ }
        continue;
      }
      if (Date.now() >= deadline) {
        const timeout = new Error('SEMANTIC_ALIGNMENT_LOCK_TIMEOUT');
        timeout.category = 'SEMANTIC_ALIGNMENT_LOCK_TIMEOUT';
        timeout.message = 'Another semantic alignment is already running and did not finish in time.';
        timeout.action = 'Wait for the running alignment (argo init) to finish, then retry.';
        throw timeout;
      }
      await sleep(250);
    }
  }
  try {
    try { fs.writeSync(fd, String(process.pid)); } catch { /* best-effort owner marker */ }
    return await action();
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
}

module.exports = {
  withAlignmentLock,
  alignmentLockPath,
};
