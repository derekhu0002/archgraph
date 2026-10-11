'use strict';

// Docker entrypoint for the ontology-projection sidecar.
//
// Flow (per the agreed plan):
//   1. the container already carries the OpenCode runtime (opencode-sandbox base)
//      — prove it with `opencode --version`;
//   2. create an ISOLATED test project directory and copy the samples into it;
//   3. validate every sample UNDER that project (canonical JSON is never written);
//   4. write a machine-readable report and exit non-zero on any failed expectation.
//
// It touches ONLY the test project dir + the report dir; the host repo is mounted
// read-only and archgraph is never modified.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { loadModel, validateGraph } = require('./lib/validate.js');

const TEST_PROJECT = process.env.TEST_PROJECT || '/test-project';
const RESULTS_DIR = process.env.RESULTS_DIR || (fs.existsSync('/results') ? '/results' : '/tmp');
const REPORT_PATH = path.join(RESULTS_DIR, 'ontology-projection-report.json');

const CASES = [
  { dir: 'team-graph', graph: 'valid.json', expect: { passed: true } },
  {
    dir: 'team-graph',
    graph: 'endpoint-violation.json',
    expect: { shacl: [{ relationshipId: 'rel-3', code: 'SHACL_ENDPOINT' }] },
  },
  {
    dir: 'team-graph',
    graph: 'axiom-contradiction.json',
    expect: { shaclCount: 0, owlCodes: ['OWL_FUNCTIONAL', 'OWL_DISJOINT'] },
  },
  {
    dir: 'team-graph',
    graph: 'multihop-contradiction.json',
    expect: { shaclCount: 0, owlCodes: ['OWL_IRREFLEXIVE'], derived: true },
  },
  { dir: 'prov-o', graph: 'valid.json', expect: { passed: true } },
  {
    dir: 'prov-o',
    graph: 'endpoint-violation.json',
    expect: { shacl: [{ relationshipId: 'rel-4', code: 'SHACL_ENDPOINT' }] },
  },
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

function evaluate(result, expect) {
  const failures = [];
  if (expect.passed) {
    if (result.status !== 'passed') {
      failures.push(`expected passed, got ${result.status}`);
    }
  }
  if (expect.shaclCount !== undefined && result.shacl.violations.length !== expect.shaclCount) {
    failures.push(`expected ${expect.shaclCount} SHACL violations, got ${result.shacl.violations.length}`);
  }
  for (const want of expect.shacl || []) {
    if (!result.shacl.violations.some((v) => v.relationshipId === want.relationshipId && v.code === want.code)) {
      failures.push(`missing SHACL violation ${JSON.stringify(want)}`);
    }
  }
  if (expect.owlCodes) {
    const codes = new Set(result.owl.inconsistencies.map((i) => i.code));
    for (const code of expect.owlCodes) {
      if (!codes.has(code)) failures.push(`missing OWL inconsistency ${code}`);
    }
  }
  if (expect.derived !== undefined) {
    const hasDerived = result.owl.inconsistencies.some((i) => i.derived === true);
    if (hasDerived !== expect.derived) failures.push(`expected derived=${expect.derived}`);
  }
  return failures;
}

function main() {
  const steps = [];

  const opencode = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
  const opencodeVersion = opencode.status === 0 ? String(opencode.stdout).trim() : null;
  steps.push({
    name: 'opencode runtime present',
    status: opencodeVersion ? 'passed' : 'failed',
    detail: opencodeVersion || String(opencode.stderr || '').slice(0, 400),
  });

  // fresh isolated test project
  fs.rmSync(TEST_PROJECT, { recursive: true, force: true });
  copyDir(path.join(__dirname, 'samples'), path.join(TEST_PROJECT, 'samples'));
  steps.push({ name: `isolated test project at ${TEST_PROJECT}`, status: 'passed' });

  for (const c of CASES) {
    const bundleDir = path.join(TEST_PROJECT, 'samples', c.dir, '.argo', 'schema');
    const graphFile = path.join(TEST_PROJECT, 'samples', c.dir, 'graphs', c.graph);
    try {
      const model = loadModel(bundleDir);
      const graph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
      const result = validateGraph(model, graph);
      const failures = evaluate(result, c.expect);
      steps.push({
        name: `${c.dir}/${c.graph}`,
        status: failures.length === 0 ? 'passed' : 'failed',
        detail: {
          status: result.status,
          projectionHash: result.projectionHash,
          shaclViolations: result.shacl.violations.map((v) => ({ relationshipId: v.relationshipId, code: v.code })),
          owlInconsistencies: result.owl.inconsistencies.map((i) => ({ code: i.code, subject: i.subject, derived: !!i.derived })),
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
