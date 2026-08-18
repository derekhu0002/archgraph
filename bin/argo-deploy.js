#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, '..', 'install-argo.ps1');
const shell = process.platform === 'win32' ? 'powershell' : 'pwsh';
const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...process.argv.slice(2)];

const result = spawnSync(shell, args, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
