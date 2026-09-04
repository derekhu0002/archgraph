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

    assert.equal(fs.existsSync(path.join(dir, wsName + '.qea')), false, 'init must not bootstrap a second .qea when one already exists');
    assert.equal(fs.existsSync(path.join(dir, wsName + '.feap')), false, 'init must not bootstrap a legacy .feap when a .qea already exists');
    assert.equal(fs.readdirSync(dir).some(n => n.toLowerCase().endsWith('.feap')), false, 'no .feap may be created at all');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('argo-qea-projection (no qea): initializeWorkspace with only a legacy .feap -> no .qea target -> noop qea step', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-init-noqea-'));
  try {
    const graphPath = path.join(dir, 'design', 'KG', 'SystemArchitecture.json');
    fs.mkdirSync(path.dirname(graphPath), { recursive: true });
    const g = { name: 'n', description: 'x', elements: [{ id: 'a1', name: 'Actor One', type: 'Business Actor', description: 'd' }], relationships: [], views: [] };
    fs.writeFileSync(graphPath, JSON.stringify(g), 'utf8');
    fs.writeFileSync(path.join(dir, 'archgraph.feap'), 'legacy sentinel', 'utf8'); // legacy EA model only
    const argoMcp = require(path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js'));
    const init = await argoMcp.initializeWorkspace(dir);
    assert.equal(init.status, 'ok');
    assert.equal(init.qeaFullProjection && init.qeaFullProjection.status, 'noop', 'legacy .feap only -> no .qea target -> noop');
    assert.equal(fs.existsSync(path.join(dir, 'archgraph.qea')), false, 'no stray qea created next to a legacy .feap');
    assert.equal(fs.existsSync(path.join(dir, 'archgraph.feap')), true, 'legacy .feap untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('argo-qea-projection (AT-2791-09): apply always reports the EA .qea projection status (passed / noop+reason / warning) — never silent', async () => {
  async function applyIn(dir) {
    const architecturePath = writeGraphFile(dir, 'ea-graph.json');
    const result = await systemArchitectureMcp.callTool('applySystemArchitectureMutation', {
      workspaceRoot: dir,
      architecturePath,
      mutations: [{ type: 'addElement', element: NEW_ELEMENT, view_ids: ['sys'] }],
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.status, 'passed', 'apply must succeed regardless of EA projection state');
    assert.equal(payload.written, true);
    return payload;
  }

  // 1) exactly one root .qea -> projection actually runs and reports passed
  const dirPass = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-qea-pass-'));
  try {
    fs.copyFileSync(QEA_TEMPLATE, path.join(dirPass, 'archgraph.qea'));
    const payload = await applyIn(dirPass);
    assert.ok(payload.qeaProjection, 'qeaProjection must be present on a successful apply (not stripped by compact response)');
    assert.equal(payload.qeaProjection.status, 'passed', 'single root .qea must project: ' + JSON.stringify(payload.qeaProjection));
    const db = new DatabaseSync(path.join(dirPass, 'archgraph.qea'));
    const row = db.prepare("SELECT Object_ID FROM t_object WHERE Alias='a2'").get();
    db.close();
    assert.ok(row, 'new element must be present in the EA .qea after a passed projection');
  } finally {
    fs.rmSync(dirPass, { recursive: true, force: true });
  }

  // 2) legacy .feap only -> explicit noop reason + warning (direct projection cannot write Firebird)
  const dirFeap = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-qea-feap-'));
  try {
    fs.writeFileSync(path.join(dirFeap, 'archgraph.feap'), 'legacy sentinel', 'utf8');
    const payload = await applyIn(dirFeap);
    assert.ok(payload.qeaProjection, 'qeaProjection must be present even when no .qea target exists');
    assert.equal(payload.qeaProjection.status, 'noop', 'legacy .feap only -> noop');
    assert.match(String(payload.qeaProjection.reason), /legacy|\.feap/i, 'noop reason must explain the legacy EA model');
    assert.ok(Array.isArray(payload.warnings) && payload.warnings.some((w) => /ea-qea projection not run/i.test(w)), 'noop with EA signals must surface a warning');
    assert.equal(fs.existsSync(path.join(dirFeap, 'archgraph.qea')), false, 'no stray qea created');
  } finally {
    fs.rmSync(dirFeap, { recursive: true, force: true });
  }

  // 3) no EA file at all -> explicit noop reason still present (no EA-signal warning needed)
  const dirNone = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-qea-none2-'));
  try {
    const payload = await applyIn(dirNone);
    assert.ok(payload.qeaProjection, 'qeaProjection must be present when the workspace has no EA model');
    assert.equal(payload.qeaProjection.status, 'noop');
    assert.match(String(payload.qeaProjection.reason), /\.qea target/i, 'noop reason must guide to ARGO_EA_QEA / root *.qea');
  } finally {
    fs.rmSync(dirNone, { recursive: true, force: true });
  }
});
