'use strict';

// Run the argo-init CLI (workspace init moved out of the MCP tool surface).
// Returns the parsed report (identical to the former initializeWorkspace tool).
// Passes --json: the CLI's DEFAULT output is a concise human summary; programmatic
// callers need the FULL report, which --json still emits verbatim.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { resolveArgoCli } = require('../../argo/scripts/resolveArgoCli.js');

function resolveArgoInit() {
  // A checkout (or the Docker sandbox at /work) carries the CLI at <repo>/bin.
  // Keep that probe first so existing sandbox runs resolve exactly as before.
  const repo = process.env.ARGO_REPO_ROOT || process.env.SANDBOX_REPO || '/work';
  const repoCli = path.join(repo, 'bin', 'argo-init.js');
  if (fs.existsSync(repoCli)) return { cmd: process.execPath, args: [repoCli] };

  // Otherwise use the shared resolver: deployed ~/.argo/bin, npm global prefix,
  // this package's own root, and PATH last. Never assume PATH on a
  // non-interactive control plane (Paperclip/SSH/WSL/CI).
  const resolved = resolveArgoCli('argo-init');
  return { cmd: resolved.cmd, args: resolved.args };
}

function runArgoInitCli(workspaceRoot, extraEnv = {}) {
  const { cmd, args } = resolveArgoInit();
  const result = spawnSync(cmd, [...args, '--workspace', workspaceRoot, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ARGO_REPO_ROOT: workspaceRoot, ...extraEnv },
    maxBuffer: 128 * 1024 * 1024,
    timeout: 600000,
  });
  if (result.error) throw new Error(`argo-init CLI error: ${result.error.message}`);
  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch { parsed = null; }
  if (!parsed) {
    throw new Error(`argo-init CLI output not JSON (exit ${result.status}): ${String(result.stderr || result.stdout).slice(0, 1200)}`);
  }
  return parsed;
}

module.exports = { runArgoInitCli };
