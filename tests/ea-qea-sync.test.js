'use strict';

// WP2791 (AT-2791-01/02/05 + incremental): Node direct .qea projection — pure Node, no EA.
// The projection implementation lives in argo/scripts (same package as the ARGO MCP runtime).
//   - import -> export roundtrip equality (ignore order, _ea-roundtrip-lib)
//   - second import idempotent (added = 0) and unchanged-skip stable
//   - existing t_diagramobjects geometry is never rewritten (sync semantics)
//   - a concurrently open SQLite connection does not block writes (busy_timeout)
//   - full mode wipes the WHOLE target .qea then rebuilds it purely from canonical
//     (decision qea-full-wholefile-argo-scripts-no-config), verified export == canonical
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
