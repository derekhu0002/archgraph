'use strict';

// WP2792 (AT-2792-01..06): ea-human-diff — human EA-draft -> semantic diff proposals.
// Pure Node, no EA. Builds a baseline .qea via fullProjection of a small fixture graph,
// then simulates human EA edits with direct SQL on a working copy (t_object/t_connector/
// t_diagramobjects). Proves the diff:
//   - reads the EA *visible object model* (schema_id anchor tags), NOT kg_sync_meta
//   - anchored content edit -> updateElement      (AT-2792-01)
//   - new unanchored object on canonical view -> addElement (AT-2792-02)
//   - deletion of anchored element+relationship -> removeElement/removeRelationship (AT-2792-03)
//   - pure geometry move -> zero canonical proposals, layoutOnly counted (AT-2792-04)
//   - --out produces JSON + Markdown              (AT-2792-05)
//   - visible-model change captured even when kg_sync_meta identical; mirror-only
//     difference yields no proposal               (AT-2792-06)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');
const lib = require(path.join(ROOT, 'argo', 'scripts', 'ea-qea-sync-lib.js'));
const diff = require(path.join(ROOT, 'argo', 'scripts', 'ea-human-diff.js'));

const FIXTURE = {
  name: 'ea-human-diff-fixture',
  description: '',
  elements: [
    { id: 'e1', name: 'Element One', type: 'Business Object', description: 'desc one' },
    { id: 'e2', name: 'Element Two', type: 'Application Component', description: 'desc two' },
  ],
  relationships: [
    { id: 'r1', name: 'rel one', type: 'Association', source_id: 'e1', target_id: 'e2', description: 'rel desc' },
  ],
  views: [
    { view_id: 'v1', view_name: 'View One', parent_element_id: 'e1', included_elements: ['e1', 'e2'], included_relationships: ['r1'] },
  ],
};

function tmpQea(dir, name) {
  const target = path.join(dir, name || 'model.qea');
  fs.copyFileSync(TEMPLATE, target);
  return target;
}
function buildBase(dir) {
  const qea = tmpQea(dir, 'base.qea');
  const r = lib.fullProjection(FIXTURE, qea, {});
  assert.ok(r.ok, 'fullProjection of fixture failed');
  return qea;
}
function copyWork(base, dir) {
  const work = path.join(dir, 'work.qea');
  fs.copyFileSync(base, work);
  return work;
}
function dbWrite(q) {
  const db = lib.openQea(q);
  db.exec('BEGIN IMMEDIATE');
  return db;
}
function syncPackageId(db) {
  const root = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=0 ORDER BY Package_ID LIMIT 1').get();
  const pkg = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=? AND Name=? LIMIT 1').get(Number(root.Package_ID), lib.SYNC_PACKAGE_NAME);
  return Number(pkg.Package_ID);
}
function objectRow(db, alias) {
  return db.prepare('SELECT Object_ID FROM t_object WHERE Alias=?').get(alias);
}
function diagramForView(db, viewId) {
  return db.prepare("SELECT Diagram_ID FROM t_diagram WHERE StyleEx LIKE ?").get('%schema_view_id=' + viewId + ';%');
}
function relConnector(db, schemaId) {
  return db.prepare("SELECT ElementID AS cid FROM t_connectortag WHERE Property='schema_id' AND VALUE=?").get(schemaId);
}
function humanNewGuid(tag) {
  return '{' + String(tag).padStart(32, '0').slice(0, 8) + '-' + String(tag).padStart(32, '0').slice(8, 12) + '-'
    + String(tag).padStart(32, '0').slice(12, 16) + '-' + String(tag).padStart(32, '0').slice(16, 20) + '-' + String(tag).padStart(32, '0').slice(20, 32) + '}';
}

function runDiff(base, work) {
  return diff.semanticDiff(diff.readSnapshot(base), diff.readSnapshot(work), {});
}
function ops(result) {
  return result.proposals.map((p) => p.op);
}

// ---------------------------------------------------------------------------
test('ea-human-diff (AT-2792-01): anchored element content edit -> updateElement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehm-'));
  try {
    const base = buildBase(dir);
    const work = copyWork(base, dir);
    const db = dbWrite(work);
    const e1 = objectRow(db, 'e1');
    db.prepare('UPDATE t_object SET Name=?, Note=? WHERE Object_ID=?').run('Element One (human)', 'human changed desc', e1.Object_ID);
    db.exec('COMMIT');
    db.close();

    const r = runDiff(base, work);
    assert.deepEqual(ops(r), ['updateElement']);
    const p = r.proposals[0];
    assert.equal(p.id, 'e1');
    assert.equal(p.fields.name, 'Element One (human)');
    assert.equal(p.fields.description, 'human changed desc');
    assert.ok(p.sourceEa.guid, 'sourceEa carries EA guid');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-human-diff (AT-2792-02): new unanchored object on a canonical view -> addElement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehm-'));
  try {
    const base = buildBase(dir);
    const work = copyWork(base, dir);
    const db = dbWrite(work);
    const syncPkg = syncPackageId(db);
    const diag = diagramForView(db, 'v1');
    assert.ok(diag, 'fixture view v1 diagram exists');
    const guid = humanNewGuid('human-new-box');
    const ins = db.prepare("INSERT INTO t_object (Object_Type, Stereotype, Name, Note, Status, Alias, ea_guid, Package_ID) VALUES (?,?,?,?,?,?,?,?)")
      .run('Class', 'ArchiMate_BusinessObject', 'Human New Box', 'a human drawn box', 'Proposed', null, guid, syncPkg);
    const newOid = Number(ins.lastInsertRowid);
    const maxSeq = db.prepare('SELECT COALESCE(MAX(Sequence),-1) AS s FROM t_diagramobjects WHERE Diagram_ID=?').get(Number(diag.Diagram_ID)).s;
    db.prepare('INSERT INTO t_diagramobjects (Diagram_ID, Object_ID, RectLeft, RectTop, RectRight, RectBottom, Sequence) VALUES (?,?,?,?,?,?,?)')
      .run(Number(diag.Diagram_ID), newOid, 40, 40, 220, 130, Number(maxSeq) + 1);
    db.exec('COMMIT');
    db.close();

    const r = runDiff(base, work);
    assert.deepEqual(ops(r), ['addElement']);
    const p = r.proposals[0];
    assert.equal(p.id, null);
    assert.equal(p.proposed.name, 'Human New Box');
    assert.equal(p.proposed.description, 'a human drawn box');
    assert.deepEqual(p.proposed.eaType, { objectType: 'Class', stereotype: 'ArchiMate_BusinessObject' });
    assert.deepEqual(p.proposed.viewIds, ['v1']);
    assert.ok(p.sourceEa.guid, 'EA guid trace present');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-human-diff (AT-2792-03): deletion of anchored element + relationship -> removeElement + removeRelationship', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehm-'));
  try {
    const base = buildBase(dir);
    const work = copyWork(base, dir);
    const db = dbWrite(work);
    const e2 = objectRow(db, 'e2');
    const oid = Number(e2.Object_ID);
    const rc = relConnector(db, 'r1');
    const cid = Number(rc.cid);
    // simulate EA deleting element e2 (and the connector r1 it participates in)
    db.prepare('DELETE FROM t_objectproperties WHERE Object_ID=?').run(oid);
    db.prepare('DELETE FROM t_attribute WHERE Object_ID=?').run(oid);
    db.prepare('DELETE FROM t_objecttests WHERE Object_ID=?').run(oid);
    db.prepare('DELETE FROM t_diagramobjects WHERE Object_ID=?').run(oid);
    db.prepare('DELETE FROM t_connectortag WHERE ElementID=?').run(cid);
    db.prepare('DELETE FROM t_diagramlinks WHERE ConnectorID=?').run(cid);
    db.prepare('DELETE FROM t_connector WHERE Connector_ID=?').run(cid);
    db.prepare('DELETE FROM t_object WHERE Object_ID=?').run(oid);
    db.exec('COMMIT');
    db.close();

    const r = runDiff(base, work);
    const list = ops(r);
    assert.ok(list.includes('removeElement'), 'expected removeElement, got ' + JSON.stringify(list));
    assert.ok(list.includes('removeRelationship'), 'expected removeRelationship, got ' + JSON.stringify(list));
    const remE = r.proposals.find((p) => p.op === 'removeElement');
    const remR = r.proposals.find((p) => p.op === 'removeRelationship');
    assert.equal(remE.id, 'e2');
    assert.equal(remR.id, 'r1');
    // no phantom updateView removeMembers for the fully-deleted object
    assert.ok(!r.proposals.some((p) => p.op === 'updateView'), 'deleted element must not double as view membership removal');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-human-diff (AT-2792-04): pure geometry move -> no canonical proposals, layoutOnly counted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehm-'));
  try {
    const base = buildBase(dir);
    const work = copyWork(base, dir);
    const db = dbWrite(work);
    const diag = diagramForView(db, 'v1');
    const e1 = objectRow(db, 'e1');
    db.prepare('UPDATE t_diagramobjects SET RectLeft=9999, RectTop=8888 WHERE Diagram_ID=? AND Object_ID=?')
      .run(Number(diag.Diagram_ID), Number(e1.Object_ID));
    db.exec('COMMIT');
    db.close();

    const r = runDiff(base, work);
    assert.deepEqual(r.proposals, [], 'pure geometry move must not emit canonical proposals');
    assert.equal(r.summary.layoutOnly, 1, 'geometry-only change is counted as layoutOnly');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-human-diff (AT-2792-05): --out produces machine JSON + human Markdown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehm-'));
  try {
    const base = buildBase(dir);
    const work = copyWork(base, dir);
    const db = dbWrite(work);
    const e1 = objectRow(db, 'e1');
    db.prepare('UPDATE t_object SET Name=? WHERE Object_ID=?').run('Renamed by human', e1.Object_ID);
    db.exec('COMMIT');
    db.close();

    const outStem = path.join(dir, 'diffout');
    const script = path.join(ROOT, 'argo', 'scripts', 'ea-human-diff.js');
    execFileSync(process.execPath, [script, '--base', base, '--work', work, '--out', outStem], { encoding: 'utf8' });

    assert.ok(fs.existsSync(outStem + '.json'), 'JSON output exists');
    assert.ok(fs.existsSync(outStem + '.md'), 'Markdown output exists');
    const json = JSON.parse(fs.readFileSync(outStem + '.json', 'utf8'));
    assert.equal(json.format, 'archgraph-ea-human-diff');
    assert.equal(json.source.base, base);
    assert.ok(json.proposals.some((p) => p.op === 'updateElement' && p.id === 'e1' && p.fields.name === 'Renamed by human'));
    assert.ok(json.extractedAt, 'extractedAt timestamp present');
    const md = fs.readFileSync(outStem + '.md', 'utf8');
    assert.ok(md.includes('# EA 人类草稿语义 diff'), 'md header');
    assert.ok(md.includes('updateElement') || md.includes('更新元素'), 'md lists the updateElement proposal');
    // JSON and Markdown describe the same proposal count
    const jsonCount = json.summary.updateElement;
    const mdCount = (md.match(/更新元素（updateElement）\s*\|\s*(\d+)/) || [])[1];
    assert.ok(mdCount !== undefined, 'md summary row present');
    assert.equal(Number(mdCount), jsonCount, 'json & md agree on updateElement count');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-human-diff (AT-2792-06): reads visible object model, not kg_sync_meta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehm-'));
  try {
    const base = buildBase(dir);
    const work = copyWork(base, dir);
    const db = dbWrite(work);
    const e1 = objectRow(db, 'e1');
    // human edit: t_object only — kg_sync_meta mirror left untouched
    db.prepare('UPDATE t_object SET Note=? WHERE Object_ID=?').run('desc edited in EA only', e1.Object_ID);
    db.exec('COMMIT');
    db.close();

    const snapBase = diff.readSnapshot(base);
    const snapWork = diff.readSnapshot(work);
    assert.equal(snapBase.meta.sha, snapWork.meta.sha, 'kg_sync_meta is identical (mirror untouched)');
    const r = diff.semanticDiff(snapBase, snapWork, {});
    assert.equal(r.summary.metaUnchanged, true);
    assert.deepEqual(ops(r), ['updateElement'], 'visible-model change is captured even when the mirror is identical');

    // reverse: only the mirror differs (projector-side change, not a human action) -> no proposals
    const work2 = copyWork(base, dir);
    const db2 = dbWrite(work2);
    const sha1 = (t) => require('node:crypto').createHash('sha1').update(String(t)).digest('hex');
    const metaRow = db2.prepare("SELECT key, payload FROM kg_sync_meta WHERE kind='element' AND key='e1'").get();
    const phantom = metaRow.payload.replace('desc one', 'phantom mirror change');
    db2.prepare('UPDATE kg_sync_meta SET payload=?, sha=? WHERE kind=? AND key=?')
      .run(phantom, sha1(phantom), 'element', 'e1');
    db2.exec('COMMIT');
    db2.close();
    const r2 = diff.semanticDiff(diff.readSnapshot(base), diff.readSnapshot(work2), {});
    assert.deepEqual(r2.proposals, [], 'mirror-only difference must produce no proposal');
    assert.equal(r2.summary.metaUnchanged, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-human-diff (AT-2792-08): --work is auto-discovered to the project root single *.qea (no hardcoded filename)', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehm-base-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehm-auto-'));
  try {
    const base = buildBase(baseDir);
    // a single .qea (the human-edited project model) at the workspace root
    const work = path.join(dir, 'sysmodel.qea');
    fs.copyFileSync(base, work);
    const db = dbWrite(work);
    const e1 = objectRow(db, 'e1');
    db.prepare('UPDATE t_object SET Name=? WHERE Object_ID=?').run('Auto discovered', e1.Object_ID);
    db.exec('COMMIT');
    db.close();

    const outStem = path.join(dir, 'autoout');
    const script = path.join(ROOT, 'argo', 'scripts', 'ea-human-diff.js');
    // No --work: the tool must resolve the workspace root's single *.qea on its own.
    // --base is given explicitly so the auto-baseline (git HEAD) is not required.
    execFileSync(process.execPath, [script, '--base', base, '--out', outStem, '--no-md'], { encoding: 'utf8', cwd: dir });
    const json = JSON.parse(fs.readFileSync(outStem + '.json', 'utf8'));
    assert.equal(path.resolve(json.source.work), path.resolve(work), '--work auto-resolved to the project root single *.qea');
    assert.ok(json.proposals.some((p) => p.op === 'updateElement' && p.id === 'e1' && p.fields.name === 'Auto discovered'), 'change captured via the auto-discovered work file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('ea-human-diff (extra): anchored relationship content edit -> updateRelationship', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehm-'));
  try {
    const base = buildBase(dir);
    const work = copyWork(base, dir);
    const db = dbWrite(work);
    const rc = relConnector(db, 'r1');
    db.prepare('UPDATE t_connector SET Name=?, Notes=? WHERE Connector_ID=?').run('rel renamed', 'human rel desc', Number(rc.cid));
    db.exec('COMMIT');
    db.close();

    const r = runDiff(base, work);
    assert.deepEqual(ops(r), ['updateRelationship']);
    const p = r.proposals[0];
    assert.equal(p.id, 'r1');
    assert.equal(p.fields.name, 'rel renamed');
    assert.equal(p.fields.description, 'human rel desc');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
