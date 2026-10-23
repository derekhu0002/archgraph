'use strict';

// AT-run-tests-lock: the architecture test runner computes delivery status from
// a document read at the START of a run that can take minutes. Persisting that
// stale document would silently drop any agent write that landed meanwhile, so
// the persist step must take the canonical write lock and re-read inside it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'argo', 'scripts', 'runArchitectureTests.js');
const { withGraphWriteLock } = require(path.join(ROOT, 'argo', 'scripts', 'graph-write-lock.js'));

test('AT-run-tests-lock: delivery status is persisted under the lock, re-reading the fresh graph', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-run-tests-lock-'));
  const graphRel = 'design/KG/Graph.json';
  const graphPath = path.join(ws, ...graphRel.split('/'));
  const marker = path.join(ws, 'probe-ran.txt');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, 'tests', 'probe.test.js'),
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`,
    'utf8',
  );
  fs.writeFileSync(graphPath, JSON.stringify({
    name: 'run-tests-lock',
    description: 'run-tests-lock',
    elements: [{
      id: 'e1',
      name: 'Probe',
      type: 'Application Component',
      description: 'probe',
      testcases: [{
        name: 'AT-probe',
        type: 'Acceptance Test',
        description: 'probe',
        acceptanceCriteria: 'tests/probe.test.js',
        Input: 'tests/probe.test.js',
      }],
    }],
    relationships: [],
    views: [{ view_id: 'top', view_name: 'SystemArchitecture', included_elements: ['e1'], included_relationships: [] }],
  }, null, 2), 'utf8');

  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  const holding = withGraphWriteLock(graphPath, async () => {
    release();
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });
  await held;

  const child = spawn(process.execPath, [RUNNER, graphRel], {
    cwd: ws,
    env: { ...process.env, ARGO_REPO_ROOT: ws, ARGO_TEST_TIMEOUT_MS: '20000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });

  try {
    // GIVEN the runner has executed the testcase and another process holds the lock
    const deadline = Date.now() + 20000;
    while (!fs.existsSync(marker)) {
      if (Date.now() > deadline) throw new Error(`probe test never ran: ${output.slice(-600)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));

    // THEN the persist step is blocked (no deliveryStatus written yet)
    const during = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    assert.equal(
      (during.elements[0].attributes || []).some((attribute) => attribute.name === 'deliveryStatus'),
      false,
      'delivery status must not be written while another process holds the lock',
    );

    // AND a write that landed during the run is present on disk before release
    during.elements.push({ id: 'e2', name: 'Concurrent', type: 'Application Component' });
    fs.writeFileSync(graphPath, JSON.stringify(during, null, 2), 'utf8');

    release();
    const code = await exited;

    // THEN the runner re-read under the lock: the concurrent element survives and
    // the delivery status is still persisted
    assert.equal(code, 0, `runner must exit 0: ${output.slice(-800)}`);
    const after = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    assert.ok(after.elements.some((element) => element.id === 'e2'),
      'a write that landed during the run must not be lost');
    assert.ok(
      (after.elements.find((element) => element.id === 'e1').attributes || [])
        .some((attribute) => attribute.name === 'deliveryStatus'),
      'delivery status must be persisted',
    );
  } finally {
    try { release(); } catch { /* ignore */ }
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    await holding.catch(() => {});
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
