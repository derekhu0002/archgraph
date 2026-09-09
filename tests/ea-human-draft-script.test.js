'use strict';

// WP2792 (AT-2792-07): extract-human-draft — an EA-internal JScript (eatool/EA-jsscript/)
// that replaces the removed ea-human-draft argo skill and its node engine (argo/scripts/
// ea-human-diff.js, now deleted). Running INSIDE the open EA model, it reads the canonical
// JSON (design/KG/SystemArchitecture.json) as the BASELINE and the live EA *visible object
// model* (anchored by schema_id / schema_view_id, never kg_sync_meta) as the WORK, then
// classifies the human's changes into the semantic-diff proposal set (addElement/
// updateElement/removeElement / addRelationship/updateRelationship/removeRelationship /
// updateView), excluding pure geometry (layoutOnly).
//   - key fields compared: name / description / status / type for elements; name /
//     description / type / source / target for relationships
//   - element attributes (t_attribute) and element testcases (t_objecttests) are read and
//     diffed into updateElement.fields.attributes / .testcases
//   - relationship attributes (relationship_attributes_json connector tag) are read and
//     diffed into updateRelationship.fields.attributes
// Writes results/human-draft.json + results/human-draft.md for the agent to write back via
// ARGO preview/apply.
//
// External-view acceptance (static review, since EA scripts run in the JScript engine and
// cannot be driven by the node test runner): the script exists at the expected path, carries
// the identity markers, anchors on the visible object model (reads t_object/t_connector/
// t_diagramobjects/t_attribute/t_objecttests + schema_id tags), never reads kg_sync_meta,
// classifies all seven ops, excludes geometry, extracts attributes/testcases/type, and wraps
// a main() that writes the two artifacts. The node tool ea-human-diff.js is gone, the removed
// skill is gone from package.json and install-argo.ps1, and the 22 numbered deploy steps are
// untouched.
//
// A gated headless runtime test (AT-2792-07/R) mirrors ea-headless-roundtrip: it only runs
// when $env:EA_RUN_HEADLESS="1" and EA is available; otherwise it explicitly skips.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'eatool', 'EA-jsscript', 'extract-human-draft.js');
const PKG = path.join(ROOT, 'package.json');
const INSTALL = path.join(ROOT, 'install-argo.ps1');
const BOOTSTRAP = path.join(ROOT, 'eatool', 'EA-jsscript', 'headless', 'bootstrap.js');
const RUNNER = path.join(ROOT, 'eatool', 'EA-jsscript', 'headless', 'run-headless.ps1');
const TEMPLATE_QEA = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');
const OLD_NODE_TOOL = path.join(ROOT, 'argo', 'scripts', 'ea-human-diff.js');
const OLD_NODE_TEST = path.join(ROOT, 'tests', 'ea-human-diff.test.js');
const lib = require(path.join(ROOT, 'argo', 'scripts', 'ea-qea-sync-lib.js'));

function readScript() {
  assert.ok(fs.existsSync(SCRIPT), `script should exist: ${SCRIPT}`);
  return fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

test('ea-human-draft-script (AT-2792-07): EA-internal extractor wraps canonical baseline + visible-object-model semantic diff -> JSON + Markdown', () => {
  // GIVEN the extract-human-draft EA script replaces the removed ea-human-draft skill
  const content = readScript();

  // identity + runtime wiring
  assert.match(content, /INC Local Scripts\.EAConstants-JScript/, 'script must include EA constants');
  assert.match(content, /INC UTILITY\.JSON-Parser/, 'script must include the JSON-Parser include');
  assert.match(content, /Extract Human Draft/, 'script must carry its identity comment header');
  assert.match(content, /function\s+main\s*\(\s*\)/, 'script must wrap a main() entry point');
  assert.match(content, /main\s*\(\s*\);/, 'script must invoke main() on load');

  // baseline = canonical JSON (source of truth), NOT a second .qea (EA cannot open two models)
  assert.match(content, /design\\KG\\SystemArchitecture\.json/, 'script defaults baseline to the canonical graph path');
  assert.match(content, /g\.elements|elements/, 'script must read the canonical elements array');
  assert.match(content, /kg_sync_meta\s+\(/, 'script must state it never uses kg_sync_meta / reads the visible object model');

  // read the EA *visible object model* via SQLQuery on the base table names
  assert.match(content, /FROM t_object\b/, 'script must read t_object (elements)');
  assert.match(content, /FROM t_connector\b/, 'script must read t_connector (relationships)');
  assert.match(content, /FROM t_diagramobjects\b/, 'script must read t_diagramobjects (geometry/membership)');
  assert.match(content, /schema_id/, 'script must anchor on the schema_id tag');

  // attributes + testcases are read from EA-visible tables and diffed
  assert.match(content, /FROM t_attribute\b/, 'script must read t_attribute (element attributes)');
  assert.match(content, /FROM t_objecttests\b/, 'script must read t_objecttests (element testcases)');
  assert.match(content, /relationship_attributes_json/, 'script must read relationship attributes (connector tag)');
  assert.match(content, /function\s+diffAttrs\s*\(/, 'script must define an attribute diff helper');
  assert.match(content, /function\s+diffTestcases\s*\(/, 'script must define a testcase diff helper');
  assert.match(content, /fields\.attributes/, 'script must emit attributes into updateElement/updateRelationship fields');
  assert.match(content, /fields\.testcases/, 'script must emit testcases into updateElement fields');
  assert.match(content, /fields\.type/, 'script must emit type into updateElement/updateRelationship fields');

  // classify all seven canonical ops
  for (const op of ['addElement', 'updateElement', 'removeElement', 'addRelationship', 'updateRelationship', 'removeRelationship', 'updateView']) {
    assert.match(content, new RegExp('op' + '.*' + op), `script must classify ${op}`);
  }

  // geometry-only is counted and excluded, never a proposal
  assert.match(content, /layoutOnly/, 'script must count layoutOnly (geometry-only, non-canonical)');
  assert.match(content, /geometry/i, 'script must reference geometry');

  // new additions carry their semantics: element/relationship descriptions + attrs; a drained
  // anchor-lost relationship is not misreported as a deletion
  assert.match(content, /op: 'addRelationship'[\s\S]*description: recRel\.description/, 'addRelationship.proposed must carry the EA Notes as description');
  assert.match(content, /connectorByEndpoints/, 'script must detect an anchor-lost (still-present) connector to avoid misreporting deletion');
  assert.match(content, /reAnchor/, 'script must emit a reAnchor hint for a drifted connection');
  assert.match(content, /driftedConnectorGuids/, 'script must not double-report a drifted connector as addRelationship');

  // output artifacts
  assert.match(content, /results\\human-draft/, 'script must default output to results/human-draft');
  assert.match(content, /\.json/, 'script must write the machine proposal JSON');
  assert.match(content, /\.md/, 'script must write the human-readable Markdown');

  // the node tool (old engine) is fully removed — this EA script is now the only implementation
  assert.ok(!fs.existsSync(OLD_NODE_TOOL), 'argo/scripts/ea-human-diff.js must be deleted');
  assert.ok(!fs.existsSync(OLD_NODE_TEST), 'tests/ea-human-diff.test.js must be deleted');

  // removed skill no longer ships in the npm package
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  assert.ok(Array.isArray(pkg.files) && !pkg.files.includes('argo/skills/ea-human-draft'),
    'package.json files must no longer include argo/skills/ea-human-draft');
  assert.ok(!fs.existsSync(path.join(ROOT, 'argo', 'skills', 'ea-human-draft')),
    'the ea-human-draft skill directory must be removed');

  // installer no longer deploys the skill, but its 22 numbered argo-init steps are intact
  const install = fs.readFileSync(INSTALL, 'utf8');
  assert.doesNotMatch(install, /ea-human-draft/, 'installer must no longer deploy the ea-human-draft skill');
  for (let i = 1; i <= 22; i++) {
    assert.ok(install.includes('[' + i + '/22]'), 'step marker [' + i + '/22] must exist');
  }
  assert.match(install, /\[16\/22\][^\n]*skills\\argo-init/, 'step 16 still deploys the argo-init skill (dsh)');
  assert.match(install, /\[21\/22\][^\n]*skills\\argo-init/, 'step 21 still deploys the argo-init skill (openclaw)');

  // headless draft mode is wired through bootstrap + runner
  const bootstrap = fs.readFileSync(BOOTSTRAP, 'utf8');
  assert.match(bootstrap, /MODE != 'draft'/, 'headless bootstrap must accept the draft mode');
  const runner = fs.readFileSync(RUNNER, 'utf8');
  assert.match(runner, /'draft'/, 'headless runner must accept the draft mode');
  assert.match(runner, /extract-human-draft\.js/, 'headless runner must map draft mode to extract-human-draft.js');
});

function runHeadlessDraft(workQea, graphPath, outStem) {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RUNNER,
    '-Feap', workQea, '-Mode', 'draft', '-Graph', graphPath, '-Output', outStem, '-KillEA', '-TimeoutSec', '300',
  ], { encoding: 'utf8', timeout: 600000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* ignore */ }
  return { json, r };
}

function projectFixture(graph, dir) {
  const baseQea = path.join(dir, 'base.qea');
  const workQea = path.join(dir, 'work.qea');
  const graphPath = path.join(dir, 'graph.json');
  const outStem = path.join(dir, 'human-draft');
  fs.copyFileSync(TEMPLATE_QEA, baseQea);
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf8');
  const proj = lib.fullProjection(graph, baseQea, {});
  assert.ok(proj.ok, 'fullProjection of fixture failed');
  fs.copyFileSync(baseQea, workQea);
  return { workQea, graphPath, outStem, baseQea };
}

test('ea-human-draft-script (AT-2792-07/R): headless draft run on an edited model yields the visible-object-model semantic diff', (t) => {
  // GIVEN EA headless runner + an isolated .qea projected from a fixture, edited in the
  // visible object model by a human (name/description change + a new unanchored object)
  // WHEN extract-human-draft runs with the canonical JSON as baseline
  // THEN a proposal set is produced matching the edits (updateElement + addElement) and
  //   the baseline is the canonical JSON (not a second model)
  if (process.env.EA_RUN_HEADLESS !== '1') {
    t.skip('EA headless draft run not enabled (needs $env:EA_RUN_HEADLESS=1 and EA available) — explicit skip counts as pass');
    return;
  }
  if (!fs.existsSync(TEMPLATE_QEA)) { t.skip(`template missing: ${TEMPLATE_QEA}`); return; }
  if (!fs.existsSync(RUNNER)) { t.skip(`headless runner missing: ${RUNNER}`); return; }

  const FIXTURE = {
    name: 'extract-human-draft-fixture',
    description: '',
    elements: [
      { id: 'e1', name: 'Element One', type: 'Business Object', description: 'desc one', attributes: [{ name: 'note', value: 'v1' }, { name: 'category', value: 'c' }] },
      { id: 'e2', name: 'Element Two', type: 'Application Component', description: 'desc two' },
    ],
    relationships: [
      { id: 'r1', name: 'rel one', type: 'Association', source_id: 'e1', target_id: 'e2', description: 'rel desc', attributes: [{ name: 'weight', value: 'low' }] },
    ],
    views: [
      { view_id: 'v1', view_name: 'View One', parent_element_id: 'e1', included_elements: ['e1', 'e2'], included_relationships: ['r1'] },
    ],
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-draft-'));
  let db = null;
  try {
    const { workQea, graphPath, outStem } = projectFixture(FIXTURE, tmp);
    db = lib.openQea(workQea);
    db.exec('BEGIN IMMEDIATE');
    const root = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=0 ORDER BY Package_ID LIMIT 1').get();
    const pkg = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=? AND Name=? LIMIT 1').get(Number(root.Package_ID), lib.SYNC_PACKAGE_NAME);
    const syncPkg = Number(pkg.Package_ID);
    // human edits: change e1 name (anchored) + add a brand-new unanchored element placed on v1
    const e1Guid = lib.deterministicGuid('el:e1');
    db.prepare("UPDATE t_object SET Name=? WHERE ea_guid=?").run('Element One Human Edited', e1Guid);
    // human changes an element attribute value (note: v1 -> v2) in t_attribute
    db.prepare("UPDATE t_attribute SET \"Default\"=? WHERE Object_ID=(SELECT Object_ID FROM t_object WHERE ea_guid=?) AND Name=?")
      .run('v2', e1Guid, 'note');
    const newGuid = '{11111111-2222-3333-4444-555555555555}';
    const ins = db.prepare("INSERT INTO t_object (Object_Type, Name, Stereotype, Note, Status, Alias, ea_guid, Package_ID, ParentID) VALUES (?,?,?,?,?,?,?,?,0)")
      .run('Class', 'Human Doodled Box', 'BusinessObject', 'human notes', 'Proposed', '', newGuid, syncPkg);
    const newObjId = Number(ins.lastInsertRowid);
    const v1diag = db.prepare("SELECT Diagram_ID FROM t_diagram WHERE StyleEx LIKE ?").get('%schema_view_id=v1;%');
    const dSeq = db.prepare('SELECT COALESCE(MAX(Sequence),-1) AS s FROM t_diagramobjects WHERE Diagram_ID=?').get(Number(v1diag.Diagram_ID)).s;
    db.prepare('INSERT INTO t_diagramobjects (Diagram_ID, Object_ID, Sequence, RectLeft, RectTop, RectRight, RectBottom) VALUES (?,?,?,?,?,?,?)')
      .run(Number(v1diag.Diagram_ID), newObjId, Number(dSeq) + 1, 100, 100, 280, 190);
    db.exec('COMMIT');
    db.close(); db = null;

    const { json } = runHeadlessDraft(workQea, graphPath, outStem);
    assert.ok(json && json.ok && json.exitCode === 0,
      `headless draft run failed: ${JSON.stringify(json || '').slice(0, 500)}`);
    assert.ok(fs.existsSync(outStem + '.json'), 'draft .json must be produced');
    assert.ok(fs.existsSync(outStem + '.md'), 'draft .md must be produced');

    const result = JSON.parse(fs.readFileSync(outStem + '.json', 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(result.format, 'archgraph-ea-human-diff', 'result format must match the node tool');
    const ops = result.proposals.map((p) => p.op);
    assert.ok(ops.includes('updateElement'), `expected updateElement for the human name edit, got ${ops.join(',')}`);
    assert.ok(ops.includes('addElement'), `expected addElement for the human-doodled box, got ${ops.join(',')}`);
    assert.ok(!ops.includes('removeElement') && !ops.includes('updateView'),
      `human additions/edits must not produce spurious removeElement/updateView, got ${ops.join(',')}`);
    const upd = result.proposals.find((p) => p.op === 'updateElement' && p.id === 'e1');
    assert.ok(upd && upd.fields.name === 'Element One Human Edited', 'updateElement carries the human name');
    assert.ok(Array.isArray(upd.fields.attributes), 'updateElement must carry the diffed attributes array');
    const noteAttr = upd.fields.attributes && upd.fields.attributes.find((a) => a.name === 'note');
    assert.ok(noteAttr && noteAttr.value === 'v2', 'updateElement attributes must reflect the human value change');
    const add = result.proposals.find((p) => p.op === 'addElement');
    assert.ok(add && add.proposed.name === 'Human Doodled Box', 'addElement carries the human-doodled object');
  } finally {
    if (db) { try { db.close(); } catch { /* ignore */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('ea-human-draft-script (AT-2792-09/R): an relationship whose connector lost its schema_id anchor is NOT misreported as removeRelationship; it becomes updateRelationship with a reAnchor hint', (t) => {
  if (process.env.EA_RUN_HEADLESS !== '1') { t.skip('EA headless not enabled'); return; }
  if (!fs.existsSync(TEMPLATE_QEA)) { t.skip(`template missing: ${TEMPLATE_QEA}`); return; }
  if (!fs.existsSync(RUNNER)) { t.skip(`headless runner missing: ${RUNNER}`); return; }

  const graph = {
    name: 'anchor-drift', description: '', elements: [
      { id: 'e1', name: 'One', type: 'Business Object', description: 'd1' },
      { id: 'e2', name: 'Two', type: 'Business Object', description: 'd2' },
    ],
    relationships: [
      { id: '1161', name: 'Association', type: 'Association', source_id: 'e1', target_id: 'e2', description: 'rel-desc' },
    ],
    views: [],
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-drift-'));
  let db = null;
  try {
    const { workQea, graphPath, outStem } = projectFixture(graph, tmp);
    // simulate EA dropping the connector's schema_id anchor (connector still present)
    db = lib.openQea(workQea);
    db.exec('BEGIN IMMEDIATE');
    const cid = db.prepare("SELECT ElementID AS cid FROM t_connectortag WHERE Property='schema_id' AND VALUE='1161'").get().cid;
    db.prepare("DELETE FROM t_connectortag WHERE ElementID=? AND Property='schema_id'").run(Number(cid));
    db.exec('COMMIT');
    db.close(); db = null;

    const { json } = runHeadlessDraft(workQea, graphPath, outStem);
    assert.ok(json && json.ok && json.exitCode === 0, `draft run failed: ${JSON.stringify(json || '').slice(0, 500)}`);
    const result = JSON.parse(fs.readFileSync(outStem + '.json', 'utf8').replace(/^\uFEFF/, ''));
    const ops = result.proposals.map((p) => p.op);
    assert.ok(!ops.includes('removeRelationship'),
      `anchor-lost connector must NOT be reported as removeRelationship, got ${ops.join(',')}`);
    const upd = result.proposals.find((p) => p.op === 'updateRelationship' && p.id === '1161');
    assert.ok(upd && upd.fields.reAnchor, `expected updateRelationship with reAnchor hint for 1161, got ${ops.join(',')}`);
    assert.ok(!result.proposals.some((p) => p.op === 'addRelationship'),
      `anchor-lost connector must not be double-reported as addRelationship, got ${ops.join(',')}`);
  } finally {
    if (db) { try { db.close(); } catch { /* ignore */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('ea-human-draft-script (AT-2792-10/R): a brand-new relationship carries its EA description (Notes) in addRelationship.proposed.description', (t) => {
  if (process.env.EA_RUN_HEADLESS !== '1') { t.skip('EA headless not enabled'); return; }
  if (!fs.existsSync(TEMPLATE_QEA)) { t.skip(`template missing: ${TEMPLATE_QEA}`); return; }
  if (!fs.existsSync(RUNNER)) { t.skip(`headless runner missing: ${RUNNER}`); return; }

  const graph = {
    name: 'new-rel-desc', description: '', elements: [
      { id: 'e1', name: 'One', type: 'Business Object', description: 'd1' },
      { id: 'e2', name: 'Two', type: 'Business Object', description: 'd2' },
    ],
    relationships: [],
    views: [],
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-newrel-'));
  let db = null;
  try {
    const { workQea, graphPath, outStem, baseQea } = projectFixture(graph, tmp);
    db = lib.openQea(workQea);
    db.exec('BEGIN IMMEDIATE');
    const root = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=0 ORDER BY Package_ID LIMIT 1').get();
    const pkg = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=? AND Name=? LIMIT 1').get(Number(root.Package_ID), lib.SYNC_PACKAGE_NAME);
    const syncPkg = Number(pkg.Package_ID);
    // human draws a brand-new connector between e1->e2 with a Notes description, no schema_id anchor
    const sObj = db.prepare('SELECT Object_ID FROM t_object WHERE Alias=?').get('e1').Object_ID;
    const tObj = db.prepare('SELECT Object_ID FROM t_object WHERE Alias=?').get('e2').Object_ID;
    const newConnGuid = '{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}';
    db.prepare("INSERT INTO t_connector (Name, Connector_Type, Stereotype, Notes, Direction, Start_Object_ID, End_Object_ID, ea_guid) VALUES (?,?,?,?,?,?,?,?)")
      .run('Brand New Rel', 'Association', 'Association', 'human-typed description', 'Source -> Destination', sObj, tObj, newConnGuid);
    db.exec('COMMIT');
    db.close(); db = null;

    const { json } = runHeadlessDraft(workQea, graphPath, outStem);
    assert.ok(json && json.ok && json.exitCode === 0, `draft run failed: ${JSON.stringify(json || '').slice(0, 500)}`);
    const result = JSON.parse(fs.readFileSync(outStem + '.json', 'utf8').replace(/^\uFEFF/, ''));
    const add = result.proposals.find((p) => p.op === 'addRelationship');
    assert.ok(add, `expected an addRelationship for the human-drawn connector, got ${result.proposals.map((p) => p.op).join(',')}`);
    assert.equal(add.proposed.description, 'human-typed description',
      'addRelationship.proposed.description must carry the EA Notes of the new relationship');
  } finally {
    if (db) { try { db.close(); } catch { /* ignore */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
