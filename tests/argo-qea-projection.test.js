'use strict';

// WP2791 (AT-2791-04/06): .qea projection inside the ARGO flow (argo/scripts bundled module,
// decision qea-full-wholefile-argo-scripts-no-config).
//   - apply write path (incremental sync): after apply the workspace .qea reflects the new
//     element — projection module runs from argo/scripts, no workspace-local script needed
//   - initializeWorkspace (full): the whole target .qea is wiped and rebuilt from the
//     canonical graph (only canonical content remains), human/old rows are cleared
//   - no .qea / multiple .qea target -> no-op with explicit resolution

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const QEA_TEMPLATE = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');
const systemArchitectureMcp = require(path.join(ROOT, 'argo', 'scripts', 'systemarchitecture-mcp-server.js'));
const qeaSyncLib = require(path.join(ROOT, 'argo', 'scripts', 'ea-qea-sync-lib.js'));

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

function writeGraphFile(dir, fileName) {
  const p = path.join(dir, 'design', 'KG', fileName);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(BASE_GRAPH, null, 2), 'utf8');
  return 'design/KG/' + fileName;
}

test('argo-qea-projection (AT-2791-04): apply write projects the new element into the workspace .qea', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-qea-'));
  try {
    fs.copyFileSync(QEA_TEMPLATE, path.join(dir, 'archgraph.qea'));
    const architecturePath = writeGraphFile(dir, 'ea-graph.json');

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

test('argo-qea-projection (AT-2791-04): no .qea in workspace -> apply succeeds with no qea side effect', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-qea-none-'));
  try {
    const architecturePath = writeGraphFile(dir, 'ea-graph.json'); // deliberately NO *.qea
    const result = await systemArchitectureMcp.callTool('applySystemArchitectureMutation', {
      workspaceRoot: dir,
      architecturePath,
      mutations: [{ type: 'addElement', element: NEW_ELEMENT, view_ids: ['sys'] }],
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.status, 'passed', 'apply should still succeed');
    assert.equal(payload.written, true, 'canonical should be written');
    assert.equal(fs.existsSync(path.join(dir, 'archgraph.qea')), false, 'no stray qea file created');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('argo-qea-projection (AT-2791-06): initializeWorkspace runs whole-file .qea full projection (only canonical content remains)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-init-qea-'));
  try {
    const wsName = path.basename(dir);
    const qea = path.join(dir, 'archgraph.qea');
    fs.copyFileSync(QEA_TEMPLATE, qea);

    const graphPath = path.join(dir, 'design', 'KG', 'SystemArchitecture.json');
    fs.mkdirSync(path.dirname(graphPath), { recursive: true });
    // phase 1: stale projection of an OLD graph + a human row anywhere
    const oldGraph = { name: 'old', description: 'x', elements: [{ id: 'z1', name: 'ZOld', type: 'Business Actor', description: 'old' }], relationships: [], views: [] };
    qeaSyncLib.syncGraphToQea(oldGraph, qea, { dryRun: false });
    fs.writeFileSync(graphPath, JSON.stringify(oldGraph), 'utf8');
    const db = new DatabaseSync(qea);
    const humanPkg = db.prepare("SELECT Package_ID FROM t_package WHERE Name='Package1'").get().Package_ID;
    db.prepare("INSERT INTO t_object (Object_Type,Name,Alias,ea_guid,Package_ID,ParentID) VALUES ('Class','HumanKeep','human_keep','{human-0000-9999}',?,0)").run(Number(humanPkg));
    db.close();

    // phase 2: canonical graph replaced before init
    const newGraph = { name: 'new', description: 'x', elements: [
      { id: 'b1', name: 'B One', type: 'Business Actor', description: 'b1' },
      { id: 'b2', name: 'B Two', type: 'Business Role', description: 'b2' },
    ], relationships: [], views: [] };
    fs.writeFileSync(graphPath, JSON.stringify(newGraph), 'utf8');

    const argoMcp = require(path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js'));
    const init = await argoMcp.initializeWorkspace(dir);
    assert.equal(init.status, 'ok', 'workspace init should succeed regardless of qea step');
    assert.equal(init.qeaFullProjection && init.qeaFullProjection.status, 'ok', 'init qea full projection should pass: ' + JSON.stringify(init.qeaFullProjection));

    const db2 = new DatabaseSync(qea);
    assert.equal(!!db2.prepare("SELECT 1 FROM t_object WHERE Alias='z1'").get(), false, 'stale graph element cleared');
    assert.equal(!!db2.prepare("SELECT 1 FROM t_object WHERE Alias='b1'").get(), true, 'canonical element b1 present');
    assert.equal(!!db2.prepare("SELECT 1 FROM t_object WHERE Alias='b2'").get(), true, 'canonical element b2 present');
    assert.equal(!!db2.prepare("SELECT 1 FROM t_object WHERE Alias='human_keep'").get(), false, 'whole-file full clears ALL non-canonical content');
    assert.equal(db2.prepare('SELECT COUNT(*) AS c FROM t_object').get().c, newGraph.elements.length, 'whole db equals canonical element count');
    db2.close();

    assert.equal(fs.existsSync(path.join(dir, wsName + '.feap')), true, 'init still bootstraps the EA template feap');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('argo-qea-projection (no qea): initializeWorkspace with no .qea target -> noop qea step', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-init-noqea-'));
  try {
    const graphPath = path.join(dir, 'design', 'KG', 'SystemArchitecture.json');
    fs.mkdirSync(path.dirname(graphPath), { recursive: true });
    const g = { name: 'n', description: 'x', elements: [{ id: 'a1', name: 'Actor One', type: 'Business Actor', description: 'd' }], relationships: [], views: [] };
    fs.writeFileSync(graphPath, JSON.stringify(g), 'utf8');
    const argoMcp = require(path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js'));
    const init = await argoMcp.initializeWorkspace(dir);
    assert.equal(init.status, 'ok');
    assert.equal(init.qeaFullProjection && init.qeaFullProjection.status, 'noop', 'no qea target -> noop');
    assert.equal(fs.existsSync(path.join(dir, 'archgraph.qea')), false, 'no stray qea created');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
