'use strict';

// WP2791 (AT-2791-04): post-canonical-write .qea projection inside the ARGO apply path.
// In-process callTool('applySystemArchitectureMutation') against an isolated temp workspace
// (non-canonical architecturePath so the Neo4j recover/sync path stays untouched):
//   - with a .qea + scripts/ea-qea-sync.js present  -> apply writes canonical AND the .qea
//     reflects the newly added element (real module spawn, end-to-end)
//   - without any .qea / without the script        -> apply succeeds with no qea side effect

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const QEA_TEMPLATE = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');
const systemArchitectureMcp = require(path.join(ROOT, 'argo', 'scripts', 'systemarchitecture-mcp-server.js'));

const BASE_GRAPH = {
  name: 'argo-qea-projection-fixture',
  description: 'fixture workspace graph',
  elements: [
    { id: 'a1', name: 'Actor One', type: 'Business Actor', description: 'actor one description', attributes: [], subdiagram_views: [], testcases: [] },
    { id: 'b1', name: 'Actor Base', type: 'Business Actor', description: 'actor base description', attributes: [], subdiagram_views: [], testcases: [] },
  ],
  relationships: [
    {
      id: 'r1', name: 'A to B', type: 'Association', source_id: 'a1', target_id: 'b1',
      description: 'x', statement: 'Actor One --(Association)--> Actor Base',
      attributes: [], source_name: 'Actor One', target_name: 'Actor Base',
    },
  ],
  views: [
    {
      view_id: 'sys', view_name: 'SystemArchitecture', description: 'top view',
      parent_element_name: '',
      included_elements: ['a1', 'b1'], included_relationships: ['r1'],
    },
  ],
};

const NEW_ELEMENT = {
  id: 'a2', name: 'Actor Two (argo)', type: 'Business Actor',
  description: 'added through the ARGO mutation write path',
  attributes: [], subdiagram_views: [], testcases: [],
};

function writeGraphFile(dir) {
  const p = path.join(dir, 'design', 'KG', 'ea-graph.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(BASE_GRAPH, null, 2), 'utf8');
  return 'design/KG/ea-graph.json';
}

test('argo-qea-projection (AT-2791-04): apply write also projects the new element into the workspace .qea', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-qea-'));
  try {
    fs.copyFileSync(QEA_TEMPLATE, path.join(dir, 'archgraph.qea'));
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts', 'ea-qea-sync.js'), path.join(dir, 'scripts', 'ea-qea-sync.js'));
    fs.copyFileSync(path.join(ROOT, 'scripts', 'ea-qea-sync-lib.js'), path.join(dir, 'scripts', 'ea-qea-sync-lib.js'));
    const architecturePath = writeGraphFile(dir);

    const result = await systemArchitectureMcp.callTool('applySystemArchitectureMutation', {
      workspaceRoot: dir,
      architecturePath,
      mutations: [{ type: 'addElement', element: NEW_ELEMENT, view_ids: ['sys'] }],
    });
    const payload = JSON.parse(result.content[0].text);

    assert.equal(payload.status, 'passed', 'apply should succeed');
    assert.equal(payload.written, true, 'canonical should be written');

    const db = new DatabaseSync(path.join(dir, 'archgraph.qea'));
    const row = db.prepare('SELECT Object_ID, Name FROM t_object WHERE Alias=?').get('a2');
    assert.ok(row, 'new element must be visible in the .qea projection');
    assert.equal(row.Name, 'Actor Two (argo)');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('argo-qea-projection (AT-2791-04): no .qea / no script in workspace -> apply succeeds with no qea side effect', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-qea-none-'));
  try {
    const architecturePath = writeGraphFile(dir); // deliberately NO archgraph.qea, NO scripts/
    const result = await systemArchitectureMcp.callTool('applySystemArchitectureMutation', {
      workspaceRoot: dir,
      architecturePath,
      mutations: [{ type: 'addElement', element: NEW_ELEMENT, view_ids: ['sys'] }],
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.status, 'passed', 'apply should still succeed');
    assert.equal(payload.written, true, 'canonical should be written');
    assert.ok(!payload.qeaProjection, 'no qea projection should be attempted without a target');
    assert.equal(fs.existsSync(path.join(dir, 'archgraph.qea')), false, 'no stray qea file created');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
