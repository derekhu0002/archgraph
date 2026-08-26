#!/usr/bin/env node
'use strict';
/**
 * Build and run the ArchGraph framework Docker sandbox test — WITHOUT npm publish.
 *
 * Flow:
 *   1. `npm pack` the repo into sandbox/dist (a local tarball; never published).
 *   2. `docker build` the sandbox image (node + pwsh, disposable).
 *   3. `docker run` — mounts the tarball, a fixture graph and the results dir;
 *      inside the container it simulates a real user install
 *      (`npm install archgraph-argo.tgz`) then `npx argo-deploy`, then runs an
 *      MCP smoke test against the INSTALLED framework. Everything happens under
 *      the container HOME (/root) — the host configuration is never modified.
 *   4. Reads results/sandbox-report.json; exits non-zero on any check failure.
 *
 * Usage:
 *   node scripts/sandbox-test.js --check   # only report docker availability
 *   node scripts/sandbox-test.js           # full build + run
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX_DIR = path.join(ROOT, 'sandbox');
const RESULTS_DIR = path.join(ROOT, 'results');
const DIST_DIR = path.join(SANDBOX_DIR, 'dist');
const REPORT_PATH = path.join(RESULTS_DIR, 'sandbox-report.json');

// Windows ships `npm` as an npm.cmd shim, so spawnSync needs the .cmd name.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`command failed (${r.status}): ${cmd} ${args.join(' ')}`);
}

function main() {
  if (process.argv.includes('--check')) {
    const d = spawnSync('docker', ['--version'], { encoding: 'utf8' });
    console.log(JSON.stringify({
      docker: d.status === 0 ? String(d.stdout || d.stderr).trim() : null,
      reportPath: REPORT_PATH,
    }));
    return;
  }

  // 1) local tarball (npm pack — NO npm publish)
  // npm.cmd on Windows must run through a shell (batch shim).
  fs.mkdirSync(DIST_DIR, { recursive: true });
  const pack = spawnSync(NPM, ['pack', '--pack-destination', DIST_DIR, '--json'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  if (pack.status !== 0) throw new Error('npm pack failed:\n' + (pack.stderr || pack.stdout || ''));
  const tarball = path.join(DIST_DIR, JSON.parse(pack.stdout)[0].filename);
  console.log(`\n[sandbox] local tarball: ${tarball}\n`);

  // 2) docker build (isolated image; BASE_IMAGE overridable for restricted networks)
  const buildArgs = process.env.SANDBOX_BASE_IMAGE
    ? ['build', '-t', 'archgraph-sandbox', '--build-arg', `BASE_IMAGE=${process.env.SANDBOX_BASE_IMAGE}`, SANDBOX_DIR]
    : ['build', '-t', 'archgraph-sandbox', SANDBOX_DIR];
  run('docker', buildArgs);

  // 3) docker run — mounts tarball + fixture graph + (optional) argo/.env for Level B + results.
  // smoke.js always writes the report (even on failure), so the exit decision is
  // driven by the report, not by docker's exit code.
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  // 初始图谱由容器内 argo init（initializeWorkspace）生成，不再挂生产图。
  const mounts = [
    '-v', `${tarball}:/tarball/archgraph-argo.tgz:ro`,
    '-v', `${RESULTS_DIR}:/results`,
  ];
  // Level B（真实 Embedding + Neo4j）：把 argo/.env 挂进容器；缺失时自动跳过 Level B 检查。
  const envFile = path.join(ROOT, 'argo', '.env');
  if (fs.existsSync(envFile)) {
    mounts.push('-v', `${envFile}:/env/argo.env:ro`);
  }
  spawnSync('docker', ['run', '--rm', ...mounts, 'archgraph-sandbox'], { stdio: 'inherit' });

  // 4) report
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  console.log(`\n[sandbox] ${report.passed}/${report.total} checks passed (archgraph-argo@${report.framework}, home=${report.home})`);
  process.exit(report.allPassed ? 0 : 1);
}

main();
