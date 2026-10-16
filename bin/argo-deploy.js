#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const passthrough = process.argv.slice(2);
const isWindows = process.platform === 'win32';

// Linux / WSL / macOS: drive the shared installer through its POSIX wrapper.
// The wrapper resolves the XDG/home directories and passes a complete set of
// forward-slash path parameters, so nothing depends on the Windows-only
// defaults (%USERPROFILE%/%APPDATA%/%LOCALAPPDATA%) or on backslash path joins.
const shScript = path.join(__dirname, '..', 'install-argo.sh');
if (!isWindows && fs.existsSync(shScript)) {
  const result = spawnSync('bash', [shScript, ...passthrough], { stdio: 'inherit' });
  // Fall through to the PowerShell path only when bash itself is unavailable.
  if (!(result.error && result.error.code === 'ENOENT')) {
    process.exit(result.status === null ? 1 : result.status);
  }
}

const script = path.join(__dirname, '..', 'install-argo.ps1');
const shell = isWindows ? 'powershell' : 'pwsh';
const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...passthrough];

const result = spawnSync(shell, args, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
