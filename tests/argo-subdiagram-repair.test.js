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
