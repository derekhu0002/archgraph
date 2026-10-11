#!/usr/bin/env node
'use strict';

// One-command acceptance for the ontology-validation extension's REAL write path.
//
// Builds the real-engine image (node + opencode + python3 + pyshacl + owlready2/HermiT)
// and runs sandbox/ontology-projection/verify-write.sh inside a disposable container
// against the SAME runtime the standard acceptance uses: a REAL Neo4j
// (host.docker.internal, isolated test database) and the REAL embedding provider
// (credentials mounted from ~/.argo/.env). The host framework is never touched
// (repo mounted read-only; the deployed ~/.argo lives in the container).
//
// It proves, through the MCP write path:
//   A. a valid write SUCCEEDS with the extension ON (the must-have: no false block)
//   B. a contradicting write is BLOCKED by the real engine at the write timing
//   C. the same write passes with the extension OFF (control)
//
// Usage:
//   node scripts/ontology-acceptance.js            # build + run
//   node scripts/ontology-acceptance.js --check    # only report docker availability
//   node scripts/ontology-acceptance.js --no-build # reuse the existing image

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX_DIR = path.join(ROOT, 'sandbox', 'ontology-projection');
const IMAGE = 'archgraph-ontology-projection-real';
const ENV_FILE = path.join(os.homedir(), '.argo', '.env');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', ...opts });
}

function main() {
  const check = spawnSync('docker', ['--version'], { encoding: 'utf8' });
  if (check.status !== 0) {
    console.error('docker is not available:', String(check.stderr || check.error || '').trim());
    process.exit(3);
  }
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ docker: String(check.stdout || '').trim(), image: IMAGE, envFile: ENV_FILE }, null, 2));
    return;
  }

  const engine = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  if (engine.status !== 0) {
    console.error('docker engine is not running. Start Docker Desktop and retry.');
    process.exit(3);
  }

  if (!process.argv.includes('--no-build')) {
    const build = run('docker', ['build', '-f', path.join(SANDBOX_DIR, 'Dockerfile.real'), '-t', IMAGE, SANDBOX_DIR]);
    if (build.status !== 0) process.exit(build.status || 1);
  }

  const mounts = ['-v', `${ROOT}:/repo:ro`];
  if (fs.existsSync(ENV_FILE)) {
    mounts.push('-v', `${ENV_FILE}:/env/argo.env:ro`);
  } else {
    console.error(`[ontology-acceptance] no ${ENV_FILE}; mount ~/.argo/.env to run the real-engine write acceptance.`);
    process.exit(3);
  }

  const result = run('docker', ['run', '--rm', '--entrypoint', 'sh', ...mounts, IMAGE, '/repo/sandbox/ontology-projection/verify-write.sh']);
  process.exit(result.status === null ? 1 : result.status);
}

main();
