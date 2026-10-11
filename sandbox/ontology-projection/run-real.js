'use strict';

// Docker entrypoint for the REAL-engine run: pySHACL (constraints) + owlready2 /
// HermiT (OWL consistency). It creates the isolated test project, spawns the
// Python engine per sample, asserts REAL-engine conformance, and writes a report.
//
// Canonical JSON is never modified; the host repo is read-only.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TEST_PROJECT = process.env.TEST_PROJECT || '/test-project';
const RESULTS_DIR = process.env.RESULTS_DIR || (fs.existsSync('/results') ? '/results' : '/tmp');
const REPORT_PATH = path.join(RESULTS_DIR, 'ontology-projection-real-report.json');
const PY = process.env.PYTHON || 'python3';
const SCRIPT = path.join(__dirname, 'python', 'validate_ontology.py');

const CASES = [
  { dir: 'team-graph', graph: 'valid.json', expect: { shaclConforms: true, owlConsistent: true } },
  { dir: 'team-graph', graph: 'endpoint-violation.json', expect: { shaclConforms: false } },
  { dir: 'team-graph', graph: 'axiom-contradiction.json', expect: { shaclConforms: true, owlConsistent: false } },
  { dir: 'team-graph', graph: 'multihop-entailment.json', expect: { shaclConforms: true, owlConsistent: true, entails: [['team-a', 'team-c']] } },
  { dir: 'prov-o', graph: 'valid.json', expect: { shaclConforms: true, owlConsistent: true } },
  { dir: 'prov-o', graph: 'endpoint-violation.json', expect: { shaclConforms: false } },
  // issue #11: a `*` target is "any target" -> unconstrained; must conform (was a
  // false violation because the pySHACL projection compiled '*' as class `_`).
  { dir: 'wildcard', graph: 'valid.json', expect: { shaclConforms: true, owlConsistent: true } },
];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function runEngine(bundleDir, graphFile) {
  const out = path.join(TEST_PROJECT, `findings-${path.basename(bundleDir)}-${path.basename(graphFile)}.json`);
  const result = spawnSync(PY, [SCRIPT, '--bundle', bundleDir, '--graph', graphFile, '--out', out], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`engine spawn failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`engine exited ${result.status}: ${String(result.stderr || result.stdout).slice(0, 1500)}`);
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

function evaluate(findings, expect) {
  const failures = [];
  const shacl = findings.shacl || {};
  const owl = findings.owl || {};
  if (shacl.error) failures.push(`SHACL engine error: ${shacl.error}`);
  if (owl.error) failures.push(`OWL engine error: ${owl.error}`);
  if (expect.shaclConforms !== undefined && shacl.conforms !== expect.shaclConforms) {
    failures.push(`expected SHACL conforms=${expect.shaclConforms}, got ${shacl.conforms}`);
  }
  if (expect.owlConsistent !== undefined && owl.consistent !== expect.owlConsistent) {
    failures.push(`expected OWL consistent=${expect.owlConsistent}, got ${owl.consistent}`);
  }
  for (const [s, o] of expect.entails || []) {
    const entailed = (owl.entailed && owl.entailed['Depends On']) || [];
    if (!entailed.some((pair) => pair[0] === s && pair[1] === o)) {
      failures.push(`expected entailed ${s} -> ${o}, got ${JSON.stringify(owl.entailed)}`);
    }
  }
  return failures;
}

function main() {
  const steps = [];

  const opencode = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
  const opencodeVersion = opencode.status === 0 ? String(opencode.stdout).trim() : null;
  steps.push({ name: 'opencode runtime present', status: opencodeVersion ? 'passed' : 'failed', detail: opencodeVersion });

  const java = spawnSync(PY, ['-c', 'import owlready2, pyshacl; print("engines importable")'], { encoding: 'utf8' });
  steps.push({
    name: 'real engines importable (pyshacl + owlready2)',
    status: java.status === 0 ? 'passed' : 'failed',
    detail: String(java.stdout || java.stderr || '').trim().slice(0, 300),
  });

  fs.rmSync(TEST_PROJECT, { recursive: true, force: true });
  copyDir(path.join(__dirname, 'samples'), path.join(TEST_PROJECT, 'samples'));
  steps.push({ name: `isolated test project at ${TEST_PROJECT}`, status: 'passed' });

  for (const c of CASES) {
    const bundleDir = path.join(TEST_PROJECT, 'samples', c.dir, '.argo', 'schema');
    const graphFile = path.join(TEST_PROJECT, 'samples', c.dir, 'graphs', c.graph);
    try {
      const findings = runEngine(bundleDir, graphFile);
      const failures = evaluate(findings, c.expect);
      steps.push({
        name: `${c.dir}/${c.graph}`,
        status: failures.length === 0 ? 'passed' : 'failed',
        detail: {
          shacl: { conforms: findings.shacl && findings.shacl.conforms, violations: (findings.shacl && findings.shacl.violations || []).length },
          owl: findings.owl,
        },
        error: failures.length ? failures.join('; ') : undefined,
      });
    } catch (error) {
      steps.push({ name: `${c.dir}/${c.graph}`, status: 'failed', error: String(error && error.message ? error.message : error) });
    }
  }

  const failed = steps.filter((s) => s.status === 'failed');
  const report = {
    status: failed.length === 0 ? 'passed' : 'failed',
    engine: 'pySHACL + owlready2/HermiT',
    generatedAt: new Date().toISOString(),
    testProject: TEST_PROJECT,
    opencodeVersion,
    passed: steps.length - failed.length,
    total: steps.length,
    steps,
  };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  for (const s of steps) {
    console.log(`${s.status === 'passed' ? 'PASS' : 'FAIL'}  ${s.name}${s.error ? `  -- ${s.error}` : ''}`);
  }
  console.log(`\n${report.passed}/${report.total} checks passed -> ${REPORT_PATH}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
