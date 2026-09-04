'use strict';

// WP2791 (AT-2791-01/02/05/08 + incremental): Node direct .qea projection — pure Node, no EA.
// The projection implementation lives in argo/scripts (same package as the ARGO MCP runtime).
//   - import -> export roundtrip equality (ignore order, _ea-roundtrip-lib)
//   - second import idempotent (added = 0) and unchanged-skip stable
//   - existing t_diagramobjects geometry is never rewritten (sync semantics)
//   - a concurrently open SQLite connection does not block writes (busy_timeout)
//   - full mode wipes the WHOLE target .qea then rebuilds it purely from canonical
//     (decision qea-full-wholefile-argo-scripts-no-config), verified export == canonical
//   - element attributes -> EA t_attribute, element testcases -> EA t_objecttests
//     (visible under the element Attributes / Testing tabs), idempotent update-in-place
//   - migration guard: projection code lives in argo/scripts, no top-level scripts/ residue

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');
const GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const lib = require(path.join(ROOT, 'argo', 'scripts', 'ea-qea-sync-lib.js'));
const { compareRoundtrip } = require(path.join(__dirname, '_ea-roundtrip-lib.js'));

function copyGraphTo(jsonPath) {
  const raw = fs.readFileSync(GRAPH, 'utf8').replace(/^\uFEFF/, '');
  fs.writeFileSync(jsonPath, raw, 'utf8');
  return JSON.parse(raw);
}
function tmpQea(dir) {
  const target = path.join(dir, 'isolated.qea');
  fs.copyFileSync(TEMPLATE, target);
  return target;
}

// Windows: sqlite handles can take a beat to release after close; retry before
// treating directory removal as a failure (see AT-2791-08 cleanup).
function removeTree(dir) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) { throw error; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
}

const CHILD_GRAPH = {
  name: 'child-mirror-fixture',
  description: '',
  elements: [
    {
      id: 'e1',
      name: 'Element One',
      type: 'Business Object',
      description: 'desc one',
      attributes: [
        { name: 'commit', value: 'aaa111', description: 'first commit' },
        { name: 'commit', value: 'bbb222' },
        { name: 'decision', value: 'x'.repeat(300), description: 'long note' },
        { name: 'status', value: 'ACTIVE' },
      ],
      testcases: [
        { name: 'AT-E1-01', type: 'Acceptance Test', description: 'acceptance one', Input: 'tests/foo.test.js', acceptanceCriteria: 'tests/foo.test.js' },
        { name: 'AT-E1-02', type: 'Acceptance Test', description: 'acceptance two', Input: 'tests/bar.test.js', acceptanceCriteria: 'tests/bar.test.js' },
      ],
    },
  ],
  relationships: [],
  views: [],
};

test('ea-qea-sync (AT-2791-01): isolated import -> export roundtrip equal + idempotent + geometry preserved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-qea-'));
  try {
    const qea = tmpQea(dir);
    const graph = copyGraphTo(path.join(dir, 'graph.json'));

    const r1 = lib.syncGraphToQea(graph, qea, { dryRun: false, allowDelete: false });
    assert.equal(r1.stats.added.elements, graph.elements.length);
    assert.equal(r1.stats.added.relationships, graph.relationships.length);
    assert.equal(r1.stats.added.diagrams, graph.views.length);

    const db = openRead(qea);
    const first = db.prepare('SELECT Diagram_ID, Object_ID FROM t_diagramobjects ORDER BY Diagram_ID, Sequence LIMIT 1').get();
    assert.ok(first, 'expected diagramobjects after import');
    db.prepare('UPDATE t_diagramobjects SET RectLeft=7777 WHERE Diagram_ID=? AND Object_ID=?').run(first.Diagram_ID, first.Object_ID);
    const before = db.prepare('SELECT COUNT(*) AS c FROM t_diagramobjects').get().c;
    db.close();

    const r2 = lib.syncGraphToQea(graph, qea, { dryRun: false, allowDelete: false });
    assert.equal(r2.stats.added.elements, 0);
    assert.equal(r2.stats.added.relationships, 0);
    assert.equal(r2.stats.added.diagrams, 0);
    assert.equal(r2.stats.updated.elements, 0, 'unchanged-skip: elements stable');
    assert.equal(r2.stats.updated.diagrams, 0, 'unchanged-skip: views stable');

    const db2 = openRead(qea);
    const afterRow = db2.prepare('SELECT RectLeft FROM t_diagramobjects WHERE Diagram_ID=? AND Object_ID=?').get(first.Diagram_ID, first.Object_ID);
    assert.equal(afterRow.RectLeft, 7777, 'existing t_diagramobjects geometry must not be rewritten');
    const after = db2.prepare('SELECT COUNT(*) AS c FROM t_diagramobjects').get().c;
    assert.equal(after, before, 'no diagramobject rows churned by re-import');
    db2.close();

    const exp = lib.exportQeaToGraph(qea);
    const rep = compareRoundtrip(graph, exp, {});
    assert.ok(rep.equal, `roundtrip mismatch: missing=${rep.missingInExport.length} extra=${rep.extraInExport.length} value=${rep.valueDiffs.length}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function openRead(q) {
  return new DatabaseSync(q);
}

test('ea-qea-sync (AT-2791-02): concurrent open SQLite connection does not block writes (busy_timeout)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-qea-'));
  try {
    const qea = tmpQea(dir);
    const graph = copyGraphTo(path.join(dir, 'graph.json'));
    lib.syncGraphToQea(graph, qea, { dryRun: false, allowDelete: false });
    const holder = new DatabaseSync(qea);
    const ok = lib.syncGraphToQea(graph, qea, { dryRun: false, allowDelete: false });
    assert.equal(ok.stats.added.elements, 0);
    holder.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-qea-sync (AT-2791-05): full wipes the WHOLE .qea then rebuilds canonical-only, export==canonical, idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-qea-full-'));
  try {
    const qea = tmpQea(dir);
    const graph = copyGraphTo(path.join(dir, 'graph.json'));
    lib.syncGraphToQea(graph, qea, { dryRun: false });

    // plant rows anywhere (sync pkg "stale" + a human row outside it + template baseline remains)
    const db = new DatabaseSync(qea);
    const syncId = db.prepare("SELECT Package_ID FROM t_package WHERE Name='ArchGraph Sync'").get().Package_ID;
    const humanPkg = db.prepare("SELECT Package_ID FROM t_package WHERE Name='Package1'").get().Package_ID;
    db.prepare("INSERT INTO t_object (Object_Type,Name,Alias,ea_guid,Package_ID,ParentID) VALUES ('Class','Stale','stale_x','{stale-xxxx-0000}',?,0)").run(Number(syncId));
    db.prepare("INSERT INTO t_object (Object_Type,Name,Alias,ea_guid,Package_ID,ParentID) VALUES ('Class','HumanKeep','human_keep','{human-0000-9999}',?,0)").run(Number(humanPkg));
    db.prepare("INSERT INTO t_objectproperties (Object_ID, Property, Value) VALUES ((SELECT Object_ID FROM t_object WHERE Alias='human_keep'),'note','keepme')").run();
    db.close();

    const full = lib.fullProjection(graph, qea, { dryRun: false });
    assert.ok(full.wiped && full.wiped.t_object > 0, 'full wipes existing rows');
    assert.ok(full.verification && full.verification.consistent === true, 'full projection export must equal canonical: ' + JSON.stringify(full.verification));

    const db2 = new DatabaseSync(qea);
    assert.equal(db2.prepare('SELECT COUNT(*) AS c FROM t_object').get().c, graph.elements.length, 'target .qea holds ONLY canonical elements after full');
    assert.equal(!!db2.prepare("SELECT 1 FROM t_object WHERE Alias='stale_x'").get(), false, 'stale row gone');
    assert.equal(!!db2.prepare("SELECT 1 FROM t_object WHERE Alias='human_keep'").get(), false, 'human row cleared by whole-file full (EA is a projection)');
    assert.equal(db2.prepare('SELECT COUNT(*) AS c FROM t_objectproperties').get().c, graph.elements.length * 2, 'only canonical anchor tags remain');
    db2.close();

    const exp = lib.exportQeaToGraph(qea);
    const rep = compareRoundtrip(graph, exp, {});
    assert.ok(rep.equal, `post-full export mismatch: missing=${rep.missingInExport.length} extra=${rep.extraInExport.length}`);

    // idempotent second full
    const full2 = lib.fullProjection(graph, qea, { dryRun: false });
    assert.equal(full2.sync.added.elements, graph.elements.length);
    const db3 = new DatabaseSync(qea);
    assert.equal(db3.prepare('SELECT COUNT(*) AS c FROM t_object').get().c, graph.elements.length, 'no duplicates after 2nd full');
    assert.equal(!!db3.prepare("SELECT 1 FROM t_object WHERE Alias='human_keep'").get(), false, 'human row still absent after 2nd full');
    db3.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-qea-sync (AT-2791-08): element attributes and testcases are mirrored into EA (t_attribute / t_objecttests), idempotent update-in-place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-qea-child-'));
  try {
    const qea = tmpQea(dir);
    lib.syncGraphToQea(CHILD_GRAPH, qea, { dryRun: false, allowDelete: false });

    const db = new DatabaseSync(qea);
    const eid = db.prepare("SELECT Object_ID FROM t_object WHERE Alias='e1'").get().Object_ID;
    const attrs = db.prepare('SELECT Name, "Default", Notes, ea_guid FROM t_attribute WHERE Object_ID=? ORDER BY Pos, ID').all(Number(eid));
    assert.equal(attrs.length, 4, 'one EA attribute row per canonical attribute entry (incl. ledger duplicates)');
    assert.deepEqual(attrs.map((a) => a.Name), ['commit', 'commit', 'decision', 'status']);
    assert.equal(attrs[0].Default, 'aaa111');
    assert.equal(attrs[1].Default, 'bbb222');
    assert.equal(attrs[2].Default, '', 'long attribute value must not overflow the Default column');
    assert.ok(attrs[2].Notes.includes('x'.repeat(300)) && attrs[2].Notes.includes('long note'), 'long value + description go to Notes');
    assert.equal(attrs[3].Default, 'ACTIVE');
    assert.equal(new Set(attrs.map((a) => a.ea_guid)).size, 4, 'attribute ea_guid must be unique');

    const tests = db.prepare('SELECT Test, TestClass, TestType, Notes, InputData, AcceptanceCriteria, Results FROM t_objecttests WHERE Object_ID=? ORDER BY Test').all(Number(eid));
    assert.equal(tests.length, 2, 'one t_objecttests row per canonical testcase');
    const t1 = tests.find((t) => t.Test === 'AT-E1-01');
    assert.ok(t1, 'AT-E1-01 mirrored');
    assert.equal(t1.TestClass, 4, 'Acceptance Test class (mirrors import-from-kg)');
    assert.equal(t1.Notes, 'acceptance one');
    assert.equal(t1.InputData, 'tests/foo.test.js');
    assert.equal(t1.AcceptanceCriteria, 'tests/foo.test.js');
    db.close();

    // idempotent second sync: no new rows
    lib.syncGraphToQea(CHILD_GRAPH, qea, { dryRun: false, allowDelete: false });
    const db2 = new DatabaseSync(qea);
    const eid2 = db2.prepare("SELECT Object_ID FROM t_object WHERE Alias='e1'").get().Object_ID;
    assert.equal(db2.prepare('SELECT COUNT(*) AS c FROM t_attribute WHERE Object_ID=?').get(Number(eid2)).c, 4, 'no attribute rows churned by re-sync');
    assert.equal(db2.prepare('SELECT COUNT(*) AS c FROM t_objecttests WHERE Object_ID=?').get(Number(eid2)).c, 2, 'no test rows churned by re-sync');
    db2.close();

    // value change updates in place (row count stable, no duplicate)
    const changed = JSON.parse(JSON.stringify(CHILD_GRAPH));
    changed.elements[0].attributes[1].value = 'ccc333';
    lib.syncGraphToQea(changed, qea, { dryRun: false, allowDelete: false });
    const db3 = new DatabaseSync(qea);
    const eid3 = db3.prepare("SELECT Object_ID FROM t_object WHERE Alias='e1'").get().Object_ID;
    assert.equal(db3.prepare('SELECT COUNT(*) AS c FROM t_attribute WHERE Object_ID=?').get(Number(eid3)).c, 4, 'attribute update must not grow rows');
    assert.equal(!!db3.prepare('SELECT 1 FROM t_attribute WHERE Object_ID=? AND "Default"=?').get(Number(eid3), 'ccc333'), true, 'updated value applied in place');
    assert.equal(!!db3.prepare('SELECT 1 FROM t_attribute WHERE Object_ID=? AND "Default"=?').get(Number(eid3), 'bbb222'), false, 'old value replaced');
    db3.close();

    // full projection also mirrors child rows after the whole-file rebuild
    const full = lib.fullProjection(CHILD_GRAPH, qea, { dryRun: false });
    assert.ok(full.verification && full.verification.consistent === true, 'child graph full projection export equals canonical');
    const db4 = new DatabaseSync(qea);
    const eid4 = db4.prepare("SELECT Object_ID FROM t_object WHERE Alias='e1'").get().Object_ID;
    assert.equal(db4.prepare('SELECT COUNT(*) AS c FROM t_attribute WHERE Object_ID=?').get(Number(eid4)).c, 4, 'full rebuild carries attributes');
    assert.equal(db4.prepare('SELECT COUNT(*) AS c FROM t_objecttests WHERE Object_ID=?').get(Number(eid4)).c, 2, 'full rebuild carries testcases');
    db4.close();
  } finally {
    removeTree(dir);
  }
});

test('ea-qea-sync (AT-2791-10): incremental sync survives EA-rewritten diagram StyleEx (matched by deterministic ea_guid, no t_diagram UNIQUE crash) and is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-qea-styleex-'));
  try {
    const qea = tmpQea(dir);
    const g = {
      name: 'styleex', description: 'x', elements: [], relationships: [],
      views: [
        { view_id: 'v1', view_name: 'View One', description: '', parent_element_name: '', included_elements: [], included_relationships: [] },
        { view_id: 'v2', view_name: 'View Two', description: '', parent_element_name: '', included_elements: [], included_relationships: [] },
      ],
    };
    const r1 = lib.syncGraphToQea(g, qea, { dryRun: false });
    assert.equal(r1.stats.added.diagrams, 2, 'two diagrams created');

    // Simulate EA having opened the project and rewritten StyleEx with its own
    // formatting tokens, dropping our schema_view_id anchor (kept ea_guid), plus a
    // stale orphan diagram EA kept around.
    const db = new DatabaseSync(qea);
    const syncId = db.prepare("SELECT Package_ID FROM t_package WHERE Name='ArchGraph Sync'").get().Package_ID;
    const v1 = db.prepare("SELECT Diagram_ID, ea_guid FROM t_diagram WHERE StyleEx LIKE '%schema_view_id=v1;%'").get();
    assert.ok(v1, 'v1 diagram present after sync');
    db.prepare("UPDATE t_diagram SET StyleEx='ExcludeRTF=0;SaveTag=034DF09E;Theme=:119;' WHERE Diagram_ID=?").run(Number(v1.Diagram_ID));
    db.prepare("INSERT INTO t_diagram (Name, Diagram_Type, Package_ID, ParentID, StyleEx, ea_guid) VALUES ('StaleOrphan','Logical',?,0,'',?)").run(Number(syncId), '{00000000-0000-0000-0000-00000000dead}');
    db.close();

    // Old code crashed here with UNIQUE constraint failed: t_diagram.ea_guid.
    const r2 = lib.syncGraphToQea(g, qea, { dryRun: false, allowDelete: false });
    assert.equal(r2.stats.added.diagrams, 0, 'v1 must be matched by ea_guid, not re-inserted (no UNIQUE crash)');
    assert.equal(r2.stats.updated.diagrams, 1, 'v1 diagram re-anchored with schema_view_id');

    const db2 = new DatabaseSync(qea);
    const rows = db2.prepare('SELECT COUNT(*) AS c FROM t_diagram').get().c;
    assert.equal(rows, 3, '2 canonical diagrams + 1 stale orphan; no duplicate created');
    const v1b = db2.prepare("SELECT StyleEx FROM t_diagram WHERE Diagram_ID=?").get(Number(v1.Diagram_ID));
    assert.match(v1b.StyleEx, /schema_view_id=v1;/, 'schema_view_id anchor re-injected while preserving EA tokens');
    assert.ok(v1b.StyleEx.includes('SaveTag=034DF09E'), 'EA formatting tokens preserved');
    db2.close();

    // idempotent third sync
    const r3 = lib.syncGraphToQea(g, qea, { dryRun: false, allowDelete: false });
    assert.equal(r3.stats.added.diagrams, 0, 'no churn on third sync');
    assert.equal(r3.stats.updated.diagrams, 0, 'stable after re-anchor');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-qea-sync (incremental): single element change updates only that element; steady-state timing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-qea-'));
  try {
    const qea = tmpQea(dir);
    const graphCopy = path.join(dir, 'graph.json');
    const graph = copyGraphTo(graphCopy);
    lib.syncGraphToQea(graph, qea, { dryRun: false, allowDelete: false });

    const changed = JSON.parse(fs.readFileSync(graphCopy, 'utf8').replace(/^\uFEFF/, ''));
    const target = changed.elements[0];
    const newDesc = (String(target.description || '') + ' <<changed>>').trim();
    target.description = newDesc;
    fs.writeFileSync(graphCopy, JSON.stringify(changed), 'utf8');

    const t0 = Date.now();
    const r = lib.syncGraphToQea(changed, qea, { dryRun: false, allowDelete: false });
    const incMs = Date.now() - t0;

    assert.equal(r.stats.updated.elements, 1, 'exactly the changed element updated');
    assert.equal(r.stats.added.elements, 0);
    assert.equal(r.stats.skipped.elements, graph.elements.length - 1, 'all other elements skipped');
    assert.equal(r.stats.updated.relationships, 0);

    const t1 = Date.now();
    const r2 = lib.syncGraphToQea(changed, qea, { dryRun: false, allowDelete: false });
    const steadyMs = Date.now() - t1;
    assert.equal(r2.stats.updated.elements, 0);

    process.stdout.write(`[ea-qea-sync] incremental=${incMs}ms steadyState=${steadyMs}ms\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ea-qea-sync (migration): projection lives in argo/scripts; no top-level scripts/ea-qea-sync residue', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts', 'ea-qea-sync.js')), false, 'top-level scripts/ea-qea-sync.js removed');
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts', 'ea-qea-sync-lib.js')), false, 'top-level scripts/ea-qea-sync-lib.js removed');
  assert.equal(fs.existsSync(path.join(ROOT, 'argo', 'scripts', 'ea-qea-sync.js')), true, 'moved to argo/scripts/ea-qea-sync.js');
  assert.equal(fs.existsSync(path.join(ROOT, 'argo', 'scripts', 'ea-qea-sync-lib.js')), true, 'moved to argo/scripts/ea-qea-sync-lib.js');

  const filesToScan = [];
  for (const dirName of ['argo']) {
    const base = path.join(ROOT, dirName);
    if (!fs.existsSync(base)) { continue; }
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) { walk(full); }
        else if (/\.(js|md)$/.test(entry.name)) { filesToScan.push(full); }
      }
    };
    walk(base);
  }
  for (const file of filesToScan) {
    const content = fs.readFileSync(file, 'utf8');
    const cleaned = content.split('argo/scripts/ea-qea-sync').join('');
    assert.ok(!cleaned.includes('scripts/ea-qea-sync'), `no stale top-level scripts/ea-qea-sync reference in ${file}`);
    assert.ok(!cleaned.includes('"ea-qea.json"') && !cleaned.includes("'ea-qea.json'"), `no ea-qea.json config reference in ${file}`);
  }
});
