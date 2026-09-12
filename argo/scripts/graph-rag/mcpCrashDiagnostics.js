'use strict';

// Crash diagnostics for the ARGO MCP server. A native abort (libuv assertion) or
// an uncaught error currently kills the server with no trace in the host log.
// This module:
//   - persists a "phase breadcrumb" synchronously on every phase change, so the
//     LAST phase before a crash is always recoverable (even for native aborts
//     that never fire JS handlers);
//   - appends uncaught-exception (incl. unhandled-rejection, which Node raises as
//     an uncaught exception) and process-exit records to a per-workspace crash
//     log.
// It uses `uncaughtExceptionMonitor` (which logs WITHOUT changing Node's default
// crash behaviour) and never logs secret values.

const fs = require('node:fs');
const path = require('node:path');

let installed = false;
let crashLogPath = null;
let phasePath = null;
let currentPhase = 'startup';
const startedAt = Date.now();

function tempPath(workspaceRoot, name) {
  return path.join(workspaceRoot, '.argo', 'temp', name);
}

function crashLogFilePath() {
  return crashLogPath;
}

function appendCrash(entry) {
  if (!crashLogPath) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
    const error = entry && entry.error;
    const line = JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      uptimeMs: Date.now() - startedAt,
      phase: currentPhase,
      kind: entry && entry.kind,
      ...(entry && entry.origin ? { origin: entry.origin } : {}),
      ...(entry && entry.code !== undefined ? { code: entry.code } : {}),
      ...(entry && entry.signal !== undefined ? { signal: entry.signal } : {}),
      ...(error ? {
        category: error.category,
        message: String(error.message || error).slice(0, 1000),
        stack: String(error.stack || '').slice(0, 4000),
      } : {}),
    }) + '\n';
    fs.appendFileSync(crashLogPath, line, 'utf8');
  } catch {
    // best-effort diagnostics only; never throw from the crash path
  }
}

function installCrashDiagnostics(workspaceRoot) {
  if (workspaceRoot) {
    crashLogPath = tempPath(workspaceRoot, 'mcp-crash.log');
    phasePath = tempPath(workspaceRoot, 'mcp-phase.json');
    markPhase(currentPhase);
  }
  if (installed) {
    return;
  }
  installed = true;
  // Logs without altering Node's default crash behaviour (unlike a bare
  // 'uncaughtException' listener, which would swallow the crash).
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    appendCrash({ kind: 'uncaughtException', origin, error });
  });
  process.on('exit', (code, signal) => {
    appendCrash({ kind: 'exit', code: code === undefined ? null : code, signal: signal === undefined ? null : signal });
  });
}

// Synchronous breadcrumb: guarantees the last phase survives a hard abort.
function markPhase(phase) {
  currentPhase = String(phase === undefined || phase === null ? '' : phase);
  if (!phasePath) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(phasePath), { recursive: true });
    fs.writeFileSync(phasePath, JSON.stringify({
      phase: currentPhase,
      at: new Date().toISOString(),
      pid: process.pid,
    }) + '\n', 'utf8');
  } catch {
    // best-effort
  }
}

function readLastPhase(workspaceRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(tempPath(workspaceRoot, 'mcp-phase.json'), 'utf8'));
    return parsed && typeof parsed.phase === 'string' ? parsed.phase : null;
  } catch {
    return null;
  }
}

module.exports = {
  installCrashDiagnostics,
  markPhase,
  readLastPhase,
  crashLogFilePath,
};
