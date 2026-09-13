'use strict';

// Owns the (expensive) semantic-index alignment child process. When readiness is
// NOT aligned, the index must be rebuilt to serve correct (full-recall) results;
// that rebuild can take seconds to ~90s. This module:
//   - runs it ASYNCHRONOUSLY (child_process.spawn, not spawnSync) so the MCP
//     event loop is never frozen while it runs;
//   - de-duplicates concurrent requests (one rebuild shared by all waiters);
//   - logs start/finish/failure for observability;
//   - exposes preheatSemanticAlignment() for a background warm-up at startup.
// It never changes WHAT is retrieved (recall/precision), only how the rebuild is
// scheduled/observed.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getWorkspaceRoot, resolveArgoPath } = require('../argo-paths.js');

const READINESS_RELATIVE_PATH = path.join('.argo', 'temp', 'system-architecture-semantic-readiness.json');

let inFlight = null;
let preheated = false;

function readinessRecordPath(repositoryRoot) {
  return path.join(repositoryRoot, ...READINESS_RELATIVE_PATH.split(path.sep));
}

function isSemanticReady(repositoryRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(readinessRecordPath(repositoryRoot), 'utf8'));
    return !!parsed && parsed.state === 'Aligned' && parsed.verified === true;
  } catch {
    return false;
  }
}

// A project is "initialized" once its canonical graph exists. The startup
// preheat must NEVER bootstrap a brand-new project: creating files / running a
// full backfill for an unknown workspace in the background is surprising and
// would race an explicit `argo init`. New projects initialize explicitly.
function isProjectInitialized(repositoryRoot) {
  try {
    return fs.existsSync(path.join(repositoryRoot, 'design', 'KG', 'SystemArchitecture.json'));
  } catch {
    return false;
  }
}

// A readiness record proves the workspace was initialized (argo init) before.
// The preheat only RECONCILES a previously-initialized-but-now-stale workspace;
// a never-aligned workspace (brand-new project, or a synthetic test copy) must
// be initialized explicitly, never rebuilt in the background.
function hasReadinessRecord(repositoryRoot) {
  try {
    return fs.existsSync(readinessRecordPath(repositoryRoot));
  } catch {
    return false;
  }
}

function alignmentError() {
  const error = new Error('SEMANTIC_AUTO_ALIGNMENT_FAILED');
  error.category = 'SEMANTIC_AUTO_ALIGNMENT_FAILED';
  error.message = 'Semantic automatic alignment failed before retry.';
  error.action = 'Repair semantic lifecycle alignment, then retry the original query.';
  error.fullSnapshotFallback = false;
  return error;
}

// Run the alignment (once). Returns a promise resolving to { status: 'aligned' }
// or rejecting with the SEMANTIC_AUTO_ALIGNMENT_FAILED envelope.
function runSemanticAlignment(repositoryRoot = getWorkspaceRoot(), options = {}) {
  if (inFlight) {
    return inFlight;
  }
  const scriptPath = resolveArgoPath('scripts', 'ensureArgoHarnessEnvironment.js');
  const startedAt = Date.now();
  console.error('[argo] semantic auto-alignment: index not aligned, rebuilding (recall-safe)…');
  inFlight = new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (options.unref && typeof child.unref === 'function') {
      // Background preheat must NOT keep the MCP process alive (a spawnSync-driven
      // caller waits for the server to exit; an attached child would hang it).
      child.unref();
    }
    const finish = (failed, cause) => {
      inFlight = null;
      const ms = Date.now() - startedAt;
      if (failed) {
        console.error(`[argo] semantic auto-alignment FAILED in ${ms}ms${cause ? ': ' + cause : ''}`);
        reject(alignmentError());
      } else {
        console.error(`[argo] semantic auto-alignment done in ${ms}ms`);
        resolve(Object.freeze({ status: 'aligned' }));
      }
    };
    child.on('error', (error) => finish(true, error && error.message));
    child.on('exit', (code, signal) => finish(code !== 0, `code=${code} signal=${signal || '-'}`));
  });
  return inFlight;
}

// Fire-and-forget warm-up: if readiness is already Aligned it does nothing;
// otherwise it starts the rebuild in the background so the first query rarely
// pays for it. Safe to call repeatedly (guarded + de-duplicated).
function preheatSemanticAlignment(repositoryRoot = getWorkspaceRoot()) {
  if (preheated || !repositoryRoot || !isProjectInitialized(repositoryRoot) || isSemanticReady(repositoryRoot)) {
    return;
  }
  // Only reconcile a workspace that was initialized before (a readiness record
  // exists); never rebuild a never-aligned project in the background.
  if (!hasReadinessRecord(repositoryRoot)) {
    return;
  }
  preheated = true;
  console.error('[argo] readiness not aligned at startup; preheating semantic alignment in background…');
  runSemanticAlignment(repositoryRoot, { unref: true }).catch(() => {});
}

module.exports = {
  runSemanticAlignment,
  preheatSemanticAlignment,
  isSemanticReady,
  isProjectInitialized,
  hasReadinessRecord,
  readinessRecordPath,
};
