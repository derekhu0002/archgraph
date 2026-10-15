'use strict';

// Run the argo-init CLI (workspace init moved out of the MCP tool surface).
// Returns the parsed report (identical to the former initializeWorkspace tool).
// Passes --json: the CLI's DEFAULT output is a concise human summary; programmatic
// callers need the FULL report, which --json still emits verbatim.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function resolveArgoInit() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const repo = process.env.ARGO_REPO_ROOT || process.env.SANDBOX_REPO || '/work';
  const candidates = [
    path.join(repo, 'bin', 'argo-init.js'),
    path.join(home, '.argo', 'bin', 'argo-init.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { cmd: process.execPath, args: [candidate] };
  }
  return { cmd: 'argo-init', args: [] }; // global on PATH
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
