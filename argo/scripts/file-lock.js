'use strict';

// Cross-process file lock (single-flight by convention). One holder at a time
// across OS processes; the lock is a regular file created with `wx`.
//
// A holder that crashes leaves the file behind, so a lock older than `staleMs`
// is stolen. Used by the semantic-alignment lock and the canonical-graph write
// lock; the EA web service uses the same `<graph>.lock` convention so both
// writers serialize on the same file.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_STALE_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 250;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withFileLock(lockPath, action, options = {}) {
  const waitMs = Number.isFinite(options.waitMs) && options.waitMs > 0 ? options.waitMs : DEFAULT_WAIT_MS;
  const staleMs = Number.isFinite(options.staleMs) && options.staleMs > 0 ? options.staleMs : DEFAULT_STALE_MS;
  const pollMs = Number.isFinite(options.pollMs) && options.pollMs > 0 ? options.pollMs : DEFAULT_POLL_MS;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + waitMs;
  let fd = null;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
      let stale = false;
      try {
        stale = (Date.now() - fs.statSync(lockPath).mtimeMs) > staleMs;
      } catch {
        stale = true;
      }
      if (stale) {
        try { fs.unlinkSync(lockPath); } catch { /* raced with another stealer */ }
        continue;
      }
      if (Date.now() >= deadline) {
        throw typeof options.timeoutError === 'function'
          ? options.timeoutError()
          : new Error('FILE_LOCK_TIMEOUT');
      }
      await sleep(pollMs);
    }
  }
  try {
    try { fs.writeSync(fd, String(process.pid)); } catch { /* best-effort owner marker */ }
    return await action();
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

module.exports = {
  withFileLock,
  sleep,
};
