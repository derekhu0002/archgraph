#!/usr/bin/env node
'use strict';

// One-command, isolated END-TO-END acceptance for the ARGO MCP surface.
//
// Builds the acceptance image (node + opencode) and runs
// sandbox/schema-decoupling/verify-all.js against this repo inside a disposable
// container, using a REAL Neo4j (host.docker.internal, isolated test databases)
// and the REAL embedding provider (credentials mounted from ~/.argo/.env).
//
// It verifies EVERY ARGO MCP tool under BOTH the default ArchiMate 3.2 schema and a
// custom schema, including semantic retrieval (getSystemArchitecture /
// memory_search) and non-semantic retrieval (queryNeo4jGraph / intent / view
// context), plus init, validation, writes and the bundled-example bootstrap.
//
// The host framework is never touched (mounts are read-only; test databases are
// dropped afterwards). This is the standard place for all e2e acceptance.
//
// Usage:
//   node scripts/mcp-acceptance.js            # build + run
//   node scripts/mcp-acceptance.js --check    # only report docker availability
//   node scripts/mcp-acceptance.js --no-build # reuse the existing image

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX_DIR = path.join(ROOT, 'sandbox', 'schema-decoupling');
const RESULTS_DIR = path.join(ROOT, 'results');
const REPORT_PATH = path.join(RESULTS_DIR, 'schema-decoupling-all-report.json');
const IMAGE = 'archgraph-schema-verify';
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
    console.log(JSON.stringify({ docker: String(check.stdout || '').trim(), image: IMAGE, report: REPORT_PATH }, null, 2));
    return;
  }

  const engine = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  if (engine.status !== 0) {
    console.error('docker engine is not running. Start Docker Desktop and retry.');
    process.exit(3);
  }

  if (!process.argv.includes('--no-build')) {
    const build = run('docker', ['build', '-t', IMAGE, SANDBOX_DIR]);
    if (build.status !== 0) process.exit(build.status || 1);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const mounts = [
    '-v', `${ROOT}:/repo:ro`,
    '-v', `${RESULTS_DIR}:/results`,
  ];
  if (fs.existsSync(ENV_FILE)) {
    mounts.push('-v', `${ENV_FILE}:/env/argo.env:ro`);
  } else {
    console.warn(`[mcp-acceptance] no ${ENV_FILE}; the real-semantics checks will SKIP (mount ~/.argo/.env to run them).`);
  }

  const runArgs = ['run', '--rm', '--entrypoint', 'node', ...mounts, IMAGE, '/opt/verify/verify-all.js'];
  const result = run('docker', runArgs);
  const exit = result.status === null ? 1 : result.status;

  let report = null;
  try { report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')); } catch { /* ignore */ }
  if (report) {
    console.log(`\n[mcp-acceptance] status=${report.status} ${report.passed}/${report.total} checks; tools ${report.tools && report.tools.exercised}/${report.tools && report.tools.total}`);
    for (const step of report.steps) console.log(`  ${step.status === 'passed' ? 'PASS' : 'FAIL'}  ${step.name}`);
  } else {
    console.error('\n[mcp-acceptance] no report produced.');
  }
  process.exit(exit);
}

main();
