'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const { repairSubdiagramViews } = require(path.join(ROOT, 'argo', 'scripts', 'repair-subdiagram-views.js'));

function writeTempGraph(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-subdiagram-repair-'));
  const graphPath = path.join(dir, 'SystemArchitecture.json');
  fs.writeFileSync(graphPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  return { dir, graphPath };
}

function baseGraph() {
  return {
    name: 'repair-test',
    description: 'repair-test',
    elements: [
      { id: 'e1', name: 'Parent', type: 'Grouping', subdiagram_views: [] },
    ],
    relationships: [],
    views: [
      { view_id: 'vTop', view_name: 'SystemArchitecture', included_elements: ['e1'], included_relationships: [] },
      { view_id: 'vSub', view_name: 'Sub', parent_element_id: 'e1', parent_element_name: 'Parent', included_elements: [], included_relationships: [] },
    ],
  };
}

test('repairSubdiagramViews check mode reports drift without writing', async () => {
  // GIVEN a graph whose parent element is missing its subdiagram_views entry
  const { dir, graphPath } = writeTempGraph(baseGraph());
  try {
    // WHEN running repairSubdiagramViews in check mode
    const result = await repairSubdiagramViews({ workspaceRoot: dir, architecturePath: 'SystemArchitecture.json', mode: 'check' });

    // THEN drift is reported and nothing is written
    assert.equal(result.status, 'failed');
    assert.equal(result.driftCount, 1);
    assert.equal(result.written, false);
    assert.deepEqual(result.reports[0].elementId, 'e1');
    const onDisk = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    assert.deepEqual(onDisk.elements[0].subdiagram_views, [], 'check mode must not modify the file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repairSubdiagramViews fix-direct mode backfills and leaves a backup', async () => {
  // GIVEN a drifted graph
  const { dir, graphPath } = writeTempGraph(baseGraph());
  try {
    // WHEN running repairSubdiagramViews in fix-direct mode
    const result = await repairSubdiagramViews({ workspaceRoot: dir, architecturePath: 'SystemArchitecture.json', mode: 'fix-direct' });

    // THEN the parent element gains the entry, written=true, and a .bak is left
    assert.equal(result.status, 'ok');
    assert.equal(result.fixedCount, 1);
    assert.equal(result.written, true);
    const onDisk = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    assert.deepEqual(onDisk.elements[0].subdiagram_views, [{ view_id: 'vSub', view_name: 'Sub' }]);
    assert.ok(fs.existsSync(`${graphPath}.bak`), 'backup file must be created');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repairSubdiagramViews fix-direct mode is a no-op on a consistent graph', async () => {
  // GIVEN an already-consistent graph
  const graph = baseGraph();
  graph.elements[0].subdiagram_views = [{ view_id: 'vSub', view_name: 'Sub' }];
  const { dir, graphPath } = writeTempGraph(graph);
  try {
    // WHEN running fix-direct
    const result = await repairSubdiagramViews({ workspaceRoot: dir, architecturePath: 'SystemArchitecture.json', mode: 'fix-direct' });

    // THEN nothing is written and no backup is created
    assert.equal(result.status, 'ok');
    assert.equal(result.driftCount, 0);
    assert.equal(result.written, false);
    assert.equal(fs.existsSync(`${graphPath}.bak`), false, 'no backup for a no-op');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repairSubdiagramViews fix-direct re-reads under the graph write lock (concurrent write survives)', async () => {
  // GIVEN a drifted graph and another writer that holds the canonical lock
  const { dir, graphPath } = writeTempGraph(baseGraph());
  try {
    const { withGraphWriteLock } = require(path.join(ROOT, 'argo', 'scripts', 'graph-write-lock.js'));
    let releaseHolder = () => {};
    const holderGate = new Promise((resolve) => { releaseHolder = resolve; });
    let held = false;
    const holding = withGraphWriteLock(graphPath, async () => {
      held = true;
      const doc = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
      doc.elements.push({ id: 'e2', name: 'AddedByAgent', type: 'Application Component' });
      fs.writeFileSync(graphPath, JSON.stringify(doc, null, 2));
      await holderGate;
    });
    while (!held) { await new Promise((resolve) => setTimeout(resolve, 10)); }

    // WHEN fix-direct runs while the lock is held
    const pending = repairSubdiagramViews({
      workspaceRoot: dir,
      architecturePath: 'SystemArchitecture.json',
      mode: 'fix-direct',
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    // THEN it waits (nothing written) ...
    const during = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    assert.deepEqual(during.elements.find((e) => e.id === 'e1').subdiagram_views, [],
      'fix-direct must not write while another process holds the lock');

    releaseHolder();
    const result = await pending;
    await holding;

    // ... and re-reads INSIDE the lock, so the concurrent element survives
    assert.equal(result.written, true);
    const after = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    assert.ok(after.elements.some((e) => e.id === 'e2'), 'a concurrent write must not be lost');
    assert.equal(after.elements.find((e) => e.id === 'e1').subdiagram_views.length, 1,
      'the repair must still backfill the parent element');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
