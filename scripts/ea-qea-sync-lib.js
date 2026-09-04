'use strict';

// EA .qea (SQLite) direct projection library — WP2791.
// Zero third-party deps: node:sqlite (DatabaseSync, Node >=22/24), node:crypto, node:fs.
// Mirrors the ArchiMate->EA mapping conventions of eatool/EA-jsscript/import-from-kg.js
// (Object_Type base + Stereotype archimate name + Alias/ea_guid anchors + schema_view_id
// StyleEx token) while writing through SQLite directly (no EA COM required).
//
// Concurrency model:
//   - PRAGMA busy_timeout = 15000 set on every connection; write phases wrapped in short
//     transactions with a bounded busy retry. Keep EA's own SQLite handle open is fine —
//     SQLite only locks during active transactions, an idle open connection does not block.
//   - Rows are matched by Alias (schema id) / deterministic ea_guid, update-in-place only;
//     existing t_diagramobjects/t_diagramlinks geometry is NEVER updated or deleted, only
//     missing members are INSERTed.

const { DatabaseSync } = require('node:sqlite');
const DEBUG = !!process.env.EA_QEA_DEBUG;
const crypto = require('node:crypto');

const SYNC_PACKAGE_NAME = 'ArchGraph Sync';
const DIAGRAM_TYPE = 'Logical';
const META_TABLE = 'kg_sync_meta'; // {kind,key,sha,payload} — Node export/reconcile store
const BUSY_TIMEOUT_MS = 15000;
const CHUNK = 200;

// ---------------------------------------------------------------------------
// ArchiMate -> EA mapping (mirrors import-from-kg.js)
// ---------------------------------------------------------------------------
function normalizeName(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return text.replace(/^ArchiMate[_\s-]*/i, '');
}
function alnum(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '')
    .replace(/[^A-Za-z0-9]/g, '');
}
function elementStereotype(type) {
  const norm = alnum(normalizeName(type));
  if (norm === '') { return ''; }
  if (norm === 'SystemSoftware') { return 'ArchiMate_SystemSoftware'; }
  if (norm === 'Constraint') { return 'ArchiMate_Constraint'; }
  return norm;
}
const ACTIVITY_ALNUM = new Set([
  'BusinessEvent', 'BusinessProcess', 'BusinessFunction', 'BusinessInteraction',
  'BusinessService', 'ApplicationEvent', 'ApplicationProcess', 'ApplicationFunction',
  'ApplicationInteraction', 'ApplicationService', 'TechnologyEvent',
  'TechnologyProcess', 'TechnologyFunction', 'TechnologyInteraction',
  'TechnologyService', 'ValueStream',
]);
function elementObjectType(type) {
  const norm = alnum(normalizeName(type));
  if (norm === 'ApplicationComponent') { return 'Component'; }
  if (ACTIVITY_ALNUM.has(norm)) { return 'Activity'; }
  if (norm === 'Junction' || norm === 'AndJunction' || norm === 'OrJunction') { return 'StateNode'; }
  return 'Class';
}
function canonicalArchimateType(type) {
  const norm = alnum(normalizeName(type));
  return norm; // full ArchiMate name e.g. BusinessActor is carried by Stereotype column
}
function relStereotype(type) {
  return alnum(normalizeName(type));
}
function relationshipMap(type) {
  const norm = alnum(normalizeName(type));
  const meta = { connectorType: 'Association', directed: false };
  switch (norm) {
    case 'Composition':
    case 'Aggregation':
      meta.connectorType = 'Association';
      break;
    case 'Specialization':
      meta.connectorType = 'Generalization';
      meta.directed = true;
      break;
    case 'Realization':
    case 'Access':
      meta.connectorType = 'Dependency';
      meta.directed = true;
      break;
    case 'Serving':
    case 'Assignment':
      meta.connectorType = 'Association';
      meta.directed = true;
      break;
    case 'Association':
      meta.connectorType = 'Association';
      break;
    case 'Triggering':
    case 'Flow':
    case 'Influence':
      meta.connectorType = 'ControlFlow';
      meta.directed = true;
      break;
    default:
      meta.connectorType = 'Association';
      break;
  }
  return meta;
}
function safeName(name, fallbackId) {
  const n = String(name === null || name === undefined ? '' : name).trim();
  return n !== '' ? n : String(fallbackId === null || fallbackId === undefined ? '' : fallbackId);
}
function deterministicGuid(seed) {
  const h = crypto.createHash('sha1').update(String(seed)).digest('hex');
  return '{' + h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32) + '}';
}
function sha1(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}

// ---------------------------------------------------------------------------
// sqlite helpers
// ---------------------------------------------------------------------------
function openQea(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=' + BUSY_TIMEOUT_MS);
  db.exec('PRAGMA foreign_keys=OFF');
  return db;
}
function columnNames(db, table) {
  const rows = db.prepare('PRAGMA table_info(' + table + ')').all();
  return rows.map((r) => r.name);
}
function ensureMetaTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS ' + META_TABLE + ' (kind TEXT NOT NULL, key TEXT NOT NULL, sha TEXT, payload TEXT, PRIMARY KEY(kind,key))');
}
// multi-row INSERT with positional placeholders, chunked
function insertMany(db, table, columns, rows) {
  let inserted = 0;
  if (!rows || rows.length === 0) { return 0; }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const colSql = columns.join(', ');
    const valueSql = chunk.map(() => '(' + columns.map(() => '?').join(', ') + ')').join(', ');
    const sql = 'INSERT INTO ' + table + ' (' + colSql + ') VALUES ' + valueSql;
    const params = [];
    for (const r of chunk) { for (const c of columns) { params.push(r[c]); } }
    db.prepare(sql).run(...params);
    inserted += chunk.length;
  }
  return inserted;
}
function updateRow(db, table, setColumns, whereColumn, id, values) {
  const setSql = setColumns.map((c) => c + '=?').join(', ');
  db.prepare('UPDATE ' + table + ' SET ' + setSql + ' WHERE ' + whereColumn + '=?')
    .run(...setColumns.map((c) => values[c]), id);
}
function upsertMeta(db, kind, key, node) {
  const payload = JSON.stringify(node);
  const sh = sha1(payload);
  db.prepare('INSERT INTO ' + META_TABLE + ' (kind,key,sha,payload) VALUES (?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET sha=excluded.sha, payload=excluded.payload')
    .run(kind, String(key), sh, payload);
  return sh;
}
function readMetaKind(db, kind) {
  const rows = db.prepare('SELECT key, payload FROM ' + META_TABLE + ' WHERE kind=? ORDER BY key').all(kind);
  const out = [];
  for (const r of rows) { try { out.push(JSON.parse(r.payload)); } catch { /* skip corrupt */ } }
  return out;
}
// mark checkpoints
function nowMs() { return Date.now(); }

// ---------------------------------------------------------------------------
// Package anchoring
// ---------------------------------------------------------------------------
function resolveSyncPackage(db, dryRun) {
  let roots = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=0 ORDER BY Package_ID').all();
  if (roots.length === 0) { roots = db.prepare('SELECT Package_ID FROM t_package ORDER BY Package_ID LIMIT 1').all(); }
  const rootId = Number(roots[0].Package_ID);
  let existing = db.prepare('SELECT Package_ID, Name FROM t_package WHERE Parent_ID=? AND Name=?').get(rootId, SYNC_PACKAGE_NAME);
  if (existing) { return { rootId, packageId: Number(existing.Package_ID), created: false }; }
  if (dryRun) { return { rootId, packageId: 0, created: true }; }
  const guid = deterministicGuid('pkg:' + SYNC_PACKAGE_NAME);
  const r = db.prepare('INSERT INTO t_package (Name, Parent_ID, ea_guid, Notes) VALUES (?,?,?,?)').run(SYNC_PACKAGE_NAME, rootId, guid, '');
  return { rootId, packageId: Number(r.lastInsertRowid), created: true };
}
function parseStyleToken(styleEx, key) {
  const text = String(styleEx === null || styleEx === undefined ? '' : styleEx);
  const re = new RegExp('(^|;|\\s)' + key + '=([^;]*)', 'i');
  const m = re.exec(text);
  return m ? m[2] : '';
}

// ---------------------------------------------------------------------------
// Core sync
// ---------------------------------------------------------------------------
// opts: { dryRun, allowDelete, snapshotDir }
function syncGraphToQea(graph, qeaPath, opts) {
  const o = opts || {};
  const stages = {};
  const stats = {
    added: { elements: 0, relationships: 0, diagrams: 0, diagramObjects: 0, diagramLinks: 0 },
    updated: { elements: 0, relationships: 0, diagrams: 0 },
    skipped: { elements: 0, relationships: 0, diagrams: 0 },
    deleteCandidates: 0, deleted: 0,
  };
  const t0 = nowMs();
  const db = openQea(qeaPath);
  try {
    ensureMetaTable(db);
    if (!o.dryRun) { db.exec('BEGIN IMMEDIATE'); }
    stages.package = nowMs();

    const syncPkg = resolveSyncPackage(db, o.dryRun);
    const syncId = syncPkg.packageId;
    stats.syncPackageId = syncId;

    // --- elements ---------------------------------------------------------
    const elemById = new Map();
    for (const e of graph.elements || []) { if (e && e.id !== undefined && e.id !== null) { elemById.set(String(e.id), e); } }
    const existingElems = db.prepare(
      'SELECT Object_ID, Alias, ea_guid, Object_Type, Name, Stereotype, Note, Status, Package_ID, ParentID FROM t_object WHERE Package_ID=?').all(syncId);
    const elemByAlias = new Map();
    const elemByGuid = new Map();
    for (const row of existingElems) {
      if (row.Alias) { elemByAlias.set(String(row.Alias), row); }
      if (row.ea_guid) { elemByGuid.set(String(row.ea_guid), row); }
    }
    const newElems = [];
    const parentOf = {};
    for (const e of graph.elements || []) {
      if (!e || e.id === undefined || e.id === null) { continue; }
      const alias = String(e.id);
      const guid = deterministicGuid('el:' + alias);
      const existing = elemByAlias.get(alias) || elemByGuid.get(guid) || null;
      const parentId = e.parent !== undefined && e.parent !== null && String(e.parent) !== '0' && elemById.has(String(e.parent)) ? parentOf[String(e.parent)] || 0 : 0;
      const intended = {
        Object_Type: elementObjectType(e.type),
        Name: safeName(e.name, alias),
        Stereotype: elementStereotype(e.type),
        Note: String(e.description === null || e.description === undefined ? '' : e.description),
        Status: String(e.status === null || e.status === undefined ? 'Proposed' : e.status),
        ParentID: parentId || 0,
      };
      if (existing) {
        const changed = intended.Object_Type !== existing.Object_Type || intended.Name !== existing.Name ||
          (intended.Stereotype || '') !== (existing.Stereotype || '') || intended.Note !== (existing.Note || '') ||
          (intended.Status || '') !== (existing.Status || '') || Number(intended.ParentID) !== Number(existing.ParentID || 0);
        if (changed && !o.dryRun) {
          updateRow(db, 't_object', ['Name', 'Stereotype', 'Note', 'Status', 'ParentID'], 'Object_ID', Number(existing.Object_ID), intended);
        }
        stats[changed ? 'updated' : 'skipped'].elements++;
        parentOf[alias] = Number(existing.Object_ID);
      } else {
        newElems.push({ ...intended, Alias: alias, ea_guid: guid, Package_ID: syncId });
        stats.added.elements++;
      }
    }
    // batch insert new elements (ParentID refined below) then read ids
    if (newElems.length > 0) {
      if (!o.dryRun) {
        insertMany(db, 't_object', ['Object_Type', 'Name', 'Stereotype', 'Note', 'Status', 'Alias', 'ea_guid', 'Package_ID', 'ParentID'], newElems);
      }
      for (const row of newElems) { parentOf[row.Alias] = row.Alias; } // placeholder; resolved by readback
    }
    // resolve real Object_ID for new elements + parents
    const aliasToId = new Map();
    if (!o.dryRun) {
      const aliases = newElems.map((r) => r.Alias);
      const readback = [];
      for (let i = 0; i < aliases.length; i += 200) {
        const part = aliases.slice(i, i + 200);
        const marks = part.map(() => '?').join(',');
        const rows = db.prepare('SELECT Object_ID, Alias FROM t_object WHERE Alias IN (' + marks + ')').all(...part);
        readback.push(...rows);
      }
      for (const r of readback) { aliasToId.set(String(r.Alias), Number(r.Object_ID)); }
    } else {
      for (const r of newElems) { aliasToId.set(r.Alias, -1); }
    }
    // second pass: set ParentID where the parent is a new element
    if (newElems.length > 0 && !o.dryRun) {
      for (const e of graph.elements || []) {
        if (!e || e.id === undefined || e.id === null) { continue; }
        const alias = String(e.id);
        const pid = aliasToId.get(alias);
        if (pid === undefined) { continue; }
        const parentNode = e.parent !== undefined && e.parent !== null && elemById.get(String(e.parent)) ? elemById.get(String(e.parent)) : null;
        if (!parentNode) { continue; }
        const parentRowId = (function () {
          const a = String(e.parent);
          const ex = elemByAlias.get(a) || elemByGuid.get(deterministicGuid('el:' + a));
          if (ex) { return Number(ex.Object_ID); }
          return aliasToId.get(a);
        })();
        if (parentRowId && Number(parentRowId) !== pid) {
          db.prepare('UPDATE t_object SET ParentID=? WHERE Object_ID=?').run(Number(parentRowId), pid);
        }
      }
    }
    stages.elements = nowMs();

    // element anchors + meta (idempotent, fingerprint-skipped)
    let tagStats = { propsNew: 0, propsSkip: 0 };
    if (!o.dryRun) {
      // minimal EA-facing anchors for compatibility with the legacy object-model exporter
      const anchorRows = [];
      const elemIdByAliasFinal = new Map();
      for (const ex of existingElems) { elemIdByAliasFinal.set(String(ex.Alias), Number(ex.Object_ID)); }
      for (const [a, id] of aliasToId) { elemIdByAliasFinal.set(a, id); }
      const toTag = [];
      for (const e of graph.elements || []) {
        if (!e || e.id === undefined || e.id === null) { continue; }
        const id = elemIdByAliasFinal.get(String(e.id));
        if (id === undefined) { continue; }
        toTag.push({ id: Number(id), e });
      }
      const metaNew = [];
      const propsToWrite = [];
      for (const t of toTag) {
        const sh = upsertMeta(db, 'element', t.e.id, t.e);
        metaNew.push(1);
        propsToWrite.push([t.id, 'schema_id', t.e.id]);
        propsToWrite.push([t.id, 'archimate_type', canonicalArchimateType(t.e.type)]);
      }
      if (propsToWrite.length > 0) {
        const existingProps = new Set();
        for (let i = 0; i < propsToWrite.length; i += 200) {
          const part = propsToWrite.slice(i, i + 200);
          const ids = new Set(part.map((p) => p[0]));
          const marks = Array.from(ids).map(() => '?').join(',');
          const rows = db.prepare('SELECT Object_ID, Property FROM t_objectproperties WHERE Object_ID IN (' + marks + ')').all(...Array.from(ids));
          for (const r of rows) { existingProps.add(Number(r.Object_ID) + '|' + r.Property); }
        }
        const newProps = propsToWrite.filter((p) => !existingProps.has(p[0] + '|' + p[1]));
        if (newProps.length > 0) {
          insertMany(db, 't_objectproperties', ['Object_ID', 'Property', 'Value', 'Notes'], newProps.map((p) => ({ Object_ID: p[0], Property: p[1], Value: p[2], Notes: '' })));
          tagStats.propsNew += newProps.length;
        }
        tagStats.propsSkip = propsToWrite.length - newProps.length;
      }
    }
    stages.elemTags = nowMs();

    // --- relationships -----------------------------------------------------
    const elemIdByAliasAll = new Map();
    for (const ex of existingElems) { if (ex.Alias) { elemIdByAliasAll.set(String(ex.Alias), Number(ex.Object_ID)); } }
    if (!o.dryRun) { for (const [a, id] of aliasToId) { elemIdByAliasAll.set(a, id); } }
    const relByGuid = new Map();
    const existingRels = db.prepare('SELECT Connector_ID, ea_guid, Name, Connector_Type, Stereotype, Notes, Direction, Start_Object_ID, End_Object_ID FROM t_connector').all();
    for (const r of existingRels) { if (r.ea_guid) { relByGuid.set(String(r.ea_guid), r); } }
    const newRels = [];
    for (const rel of graph.relationships || []) {
      if (!rel || rel.id === undefined || rel.id === null) { continue; }
      const alias = String(rel.id);
      const guid = deterministicGuid('rel:' + alias);
      const start = elemIdByAliasAll.get(String(rel.source_id));
      const end = elemIdByAliasAll.get(String(rel.target_id));
      if (start === undefined || end === undefined) { continue; }
      const map = relationshipMap(rel.type);
      const direction = map.directed ? 'Source -> Destination' : '';
      const existing = relByGuid.get(guid);
      const intended = {
        Name: safeName(rel.name, alias),
        Connector_Type: map.connectorType,
        Stereotype: relStereotype(rel.type),
        Notes: String(rel.description === null || rel.description === undefined ? '' : rel.description),
        Direction: direction,
        Start_Object_ID: Number(start),
        End_Object_ID: Number(end),
      };
      if (existing) {
        const changed = intended.Name !== (existing.Name || '') || (intended.Connector_Type || '') !== (existing.Connector_Type || '') ||
          (intended.Stereotype || '') !== (existing.Stereotype || '') || intended.Notes !== (existing.Notes || '') ||
          intended.Direction !== (existing.Direction || '') || Number(intended.Start_Object_ID) !== Number(existing.Start_Object_ID || 0) ||
          Number(intended.End_Object_ID) !== Number(existing.End_Object_ID || 0);
        if (changed && !o.dryRun) {
          updateRow(db, 't_connector', ['Name', 'Connector_Type', 'Stereotype', 'Notes', 'Direction', 'Start_Object_ID', 'End_Object_ID'], 'Connector_ID', Number(existing.Connector_ID), intended);
        }
        stats[changed ? 'updated' : 'skipped'].relationships++;
      } else {
        newRels.push({ ...intended, ea_guid: guid, _alias: alias });
        stats.added.relationships++;
      }
    }
    const relAliasToId = new Map();
    if (!o.dryRun) {
      if (newRels.length > 0) {
        insertMany(db, 't_connector', ['Name', 'Connector_Type', 'Stereotype', 'Notes', 'Direction', 'Start_Object_ID', 'End_Object_ID', 'ea_guid'], newRels);
      }
      for (let i = 0; i < newRels.length; i += 200) {
        const part = newRels.slice(i, i + 200);
        const marks = part.map(() => '?').join(',');
        const rows = db.prepare('SELECT Connector_ID, ea_guid FROM t_connector WHERE ea_guid IN (' + marks + ')').all(...part.map((r) => r.ea_guid));
        for (const r of rows) { const pr = part.find((x) => x.ea_guid === r.ea_guid); if (pr) { relAliasToId.set(pr._alias, Number(r.Connector_ID)); } }
      }
    } else {
      for (const r of newRels) { relAliasToId.set(r._alias, -1); }
    }
    stages.relationships = nowMs();

    // connector anchors + meta
    if (!o.dryRun) {
      for (const rel of graph.relationships || []) {
        if (!rel || rel.id === undefined || rel.id === null) { continue; }
        const id = relAliasToId.get(String(rel.id));
        if (id === undefined || id < 0) { continue; }
        upsertMeta(db, 'relationship', rel.id, rel);
        const existingCt = db.prepare('SELECT PropertyID FROM t_connectortag WHERE ElementID=? AND Property=?').get(Number(id), 'schema_id');
        if (!existingCt) {
          db.prepare('INSERT INTO t_connectortag (ElementID, Property, VALUE, NOTES) VALUES (?,?,?,?)')
            .run(Number(id), 'schema_id', rel.id, '');
          db.prepare('INSERT INTO t_connectortag (ElementID, Property, VALUE, NOTES) VALUES (?,?,?,?)')
            .run(Number(id), 'archimate_relationship_type', canonicalArchimateType(rel.type), '');
        }
      }
    }
    stages.relTags = nowMs();

    // --- views/diagrams ----------------------------------------------------
    const existingDiags = db.prepare('SELECT Diagram_ID, Package_ID, Name, StyleEx, ea_guid FROM t_diagram WHERE Package_ID=?').all(syncId);
    const diagByView = new Map();
    for (const d of existingDiags) {
      const v = parseStyleToken(d.StyleEx, 'schema_view_id');
      if (v) { diagByView.set(v, d); }
    }
    const newDiags = [];
    for (const view of graph.views || []) {
      if (!view || view.view_id === undefined || view.view_id === null) { continue; }
      const viewId = String(view.view_id);
      const styleEx = 'schema_view_id=' + viewId + ';';
      const parentObjectId = (function () {
        if (view.parent_element_id !== undefined && view.parent_element_id !== null && view.parent_element_id !== '') {
          const pid = elemIdByAliasAll.get(String(view.parent_element_id));
          if (pid !== undefined) { return pid; }
        }
        return 0;
      })();
      const existing = diagByView.get(viewId);
      const intended = {
        Name: safeName(view.view_name, viewId),
        Diagram_Type: DIAGRAM_TYPE,
        Package_ID: syncId,
        ParentID: parentObjectId,
        Notes: '', // EA .qea 不保留多段 Notes；视图内容经 kg_sync_meta 保真
        StyleEx: styleEx,
      };
      if (existing) {
        const changed = intended.Name !== (existing.Name || '');
        if (DEBUG && changed) { console.error('DEBUG diagram chg', viewId, JSON.stringify({n:[intended.Name,(existing.Name||'')], notes:[intended.Notes,(existing.Notes||'')]})); }
        if (changed && !o.dryRun) {
          updateRow(db, 't_diagram', ['Name'], 'Diagram_ID', Number(existing.Diagram_ID), intended);
        }
        stats[changed ? 'updated' : 'skipped'].diagrams++;
      } else {
        newDiags.push({ ...intended, ea_guid: deterministicGuid('diag:' + viewId) });
        stats.added.diagrams++;
      }
    }
    const diagAliasToId = new Map();
    if (!o.dryRun) {
      if (newDiags.length > 0) {
        insertMany(db, 't_diagram', ['Name', 'Diagram_Type', 'Package_ID', 'ParentID', 'StyleEx', 'ea_guid'], newDiags);
      }
      for (let i = 0; i < newDiags.length; i += 200) {
        const part = newDiags.slice(i, i + 200);
        const marks = part.map(() => '?').join(',');
        const rows = db.prepare('SELECT Diagram_ID, StyleEx FROM t_diagram WHERE StyleEx IN (' + marks + ')').all(...part.map((d) => d.StyleEx));
        for (const r of rows) {
          const v = parseStyleToken(r.StyleEx, 'schema_view_id');
          if (v) { diagAliasToId.set(v, Number(r.Diagram_ID)); }
        }
      }
    } else {
      for (const d of newDiags) { diagAliasToId.set(parseStyleToken(d.StyleEx, 'schema_view_id'), -1); }
    }
    // view meta
    if (!o.dryRun) {
      for (const view of graph.views || []) {
        if (view && view.view_id !== undefined && view.view_id !== null) { upsertMeta(db, 'view', view.view_id, view); }
      }
    }
    // memberships: only INSERT missing; never touch existing geometry
    for (const view of graph.views || []) {
      if (!view || view.view_id === undefined || view.view_id === null) { continue; }
      const viewId = String(view.view_id);
      let dId = diagByView.get(viewId);
      if (!dId) { dId = diagAliasToId.get(viewId); }
      if (!dId) { continue; }
      const diagramId = Number(dId.Diagram_ID !== undefined ? dId.Diagram_ID : dId);
      const placedObjs = new Set();
      const objs = db.prepare('SELECT Object_ID FROM t_diagramobjects WHERE Diagram_ID=?').all(diagramId);
      for (const r of objs) { placedObjs.add(Number(r.Object_ID)); }
      const nextSeq = objs.length;
      const newObjs = [];
      const incl = view.included_elements || [];
      let seq = nextSeq;
      for (const elId of incl) {
        const oid = elemIdByAliasAll.get(String(elId));
        if (oid === undefined) { continue; }
        if (placedObjs.has(Number(oid))) { continue; }
        const col = seq % 6;
        const row = Math.floor(seq / 6);
        newObjs.push({
          Diagram_ID: diagramId, Object_ID: Number(oid),
          RectLeft: 40 + col * 260, RectTop: 40 + row * 160,
          RectRight: 40 + col * 260 + 180, RectBottom: 40 + row * 160 + 90,
          Sequence: seq,
        });
        seq++;
      }
      if (newObjs.length > 0 && !o.dryRun) {
        insertMany(db, 't_diagramobjects', ['Diagram_ID', 'Object_ID', 'RectLeft', 'RectTop', 'RectRight', 'RectBottom', 'Sequence'], newObjs);
      }
      stats.added.diagramObjects += newObjs.length;

      const placedLinks = new Set();
      const links = db.prepare('SELECT ConnectorID FROM t_diagramlinks WHERE DiagramID=?').all(diagramId);
      for (const r of links) { placedLinks.add(Number(r.ConnectorID)); }
      const newLinks = [];
      for (const relId of view.included_relationships || []) {
        const cid = relAliasToId.get(String(relId));
        if (cid === undefined || cid < 0) { continue; }
        if (placedLinks.has(Number(cid))) { continue; }
        newLinks.push({ DiagramID: diagramId, ConnectorID: Number(cid), Style: '', Geometry: '' });
      }
      if (newLinks.length > 0 && !o.dryRun) {
        insertMany(db, 't_diagramlinks', ['DiagramID', 'ConnectorID', 'Style', 'Geometry'], newLinks);
      }
      stats.added.diagramLinks += newLinks.length;
    }
    stages.members = nowMs();

    // --- deletion reconcile (opt-in) ---------------------------------------
    const keepAliases = new Set();
    for (const e of graph.elements || []) { if (e && e.id !== undefined) { keepAliases.add(String(e.id)); } }
    for (const rel of graph.relationships || []) { if (rel && rel.id !== undefined) { keepAliases.add(String(rel.id)); } }
    const candidates = [];
    for (const row of existingElems) {
      if (row.Alias && !keepAliases.has(String(row.Alias))) { candidates.push({ type: 'element', id: Number(row.Object_ID), alias: row.Alias }); }
    }
    for (const row of existingRels) {
      if (row.Alias && !keepAliases.has(String(row.Alias))) { candidates.push({ type: 'relationship', id: Number(row.Connector_ID), alias: row.Alias }); }
    }
    stats.deleteCandidates = candidates.length;
    if (candidates.length > 0 && o.allowDelete && !o.dryRun) {
      for (const c of candidates) {
        if (c.type === 'relationship') {
          db.prepare('DELETE FROM t_connector WHERE Connector_ID=?').run(c.id);
        } else {
          db.prepare('DELETE FROM t_diagramobjects WHERE Object_ID=?').run(c.id);
          db.prepare('DELETE FROM t_objectproperties WHERE Object_ID=?').run(c.id);
          db.prepare('DELETE FROM t_object WHERE Object_ID=?').run(c.id);
        }
        stats.deleted++;
      }
    }
    stages.deletes = nowMs();
    if (!o.dryRun) { db.exec('COMMIT'); }
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
  stats.ms = {
    total: nowMs() - t0,
    package: stages.package - t0,
    elements: stages.elements - stages.package,
    elemTags: stages.elemTags - stages.elements,
    relationships: stages.relationships - stages.elemTags,
    relTags: stages.relTags - stages.relationships,
    views: stages.members - stages.relTags,
    members: stages.members - stages.relTags,
  };
  return { ok: true, syncPackageId: stats.syncPackageId, stats };
}

// ---------------------------------------------------------------------------
// Full projection (argo init): clear projection-owned content then re-write everything
// ---------------------------------------------------------------------------
function findSyncPackageId(db) {
  const rows = db.prepare("SELECT Package_ID FROM t_package WHERE Name=?").all(SYNC_PACKAGE_NAME);
  return rows.length > 0 ? Number(rows[0].Package_ID) : null;
}
// clearProjectionOwned deletes ONLY content owned by the projection:
//   - kg_sync_meta is entirely ours (truncated)
//   - the 'ArchGraph Sync' package subtree (elements, their objectproperties,
//     diagrams + diagramobjects/diagramlinks, connectors whose endpoints are our
//     elements + their connectortag rows) — dependency order links->objects->tags->
//     connectors->props->diagrams->elements. Human / non-projection content in other
//     packages is never touched.
function clearProjectionOwned(db) {
  const cleared = { elements: 0, relationships: 0, diagrams: 0, diagramObjects: 0, diagramLinks: 0, tags: 0, meta: 0 };
  ensureMetaTable(db);
  const syncId = findSyncPackageId(db);
  if (syncId == null) {
    const metaCount = db.prepare('SELECT COUNT(*) AS c FROM ' + META_TABLE).get().c;
    db.exec('DELETE FROM ' + META_TABLE);
    cleared.meta = metaCount;
    return cleared;
  }
  const elementIds = db.prepare('SELECT Object_ID FROM t_object WHERE Package_ID=?').all(syncId).map((r) => Number(r.Object_ID));
  const diagramIds = db.prepare('SELECT Diagram_ID FROM t_diagram WHERE Package_ID=?').all(syncId).map((r) => Number(r.Diagram_ID));
  const connectorIds = [];
  if (elementIds.length > 0) {
    for (let i = 0; i < elementIds.length; i += 500) {
      const marks = elementIds.slice(i, i + 500).map(() => '?').join(',');
      const rows = db.prepare('SELECT Connector_ID FROM t_connector WHERE Start_Object_ID IN (' + marks + ')').all(...elementIds.slice(i, i + 500));
      connectorIds.push(...rows.map((r) => Number(r.Connector_ID)));
    }
  }
  const del = (sql, id) => { db.prepare(sql).run(id); };
  for (const id of diagramIds) {
    const c1 = db.prepare('SELECT COUNT(*) AS c FROM t_diagramlinks WHERE DiagramID=?').get(id).c;
    const c2 = db.prepare('SELECT COUNT(*) AS c FROM t_diagramobjects WHERE Diagram_ID=?').get(id).c;
    del('DELETE FROM t_diagramlinks WHERE DiagramID=?', id); cleared.diagramLinks += c1;
    del('DELETE FROM t_diagramobjects WHERE Diagram_ID=?', id); cleared.diagramObjects += c2;
  }
  for (const id of connectorIds) {
    const c = db.prepare('SELECT COUNT(*) AS c FROM t_connectortag WHERE ElementID=?').get(id).c;
    del('DELETE FROM t_connectortag WHERE ElementID=?', id); cleared.tags += c;
    del('DELETE FROM t_connector WHERE Connector_ID=?', id); cleared.relationships++;
  }
  for (const id of elementIds) {
    const c = db.prepare('SELECT COUNT(*) AS c FROM t_objectproperties WHERE Object_ID=?').get(id).c;
    del('DELETE FROM t_objectproperties WHERE Object_ID=?', id); cleared.tags += c;
    del('DELETE FROM t_object WHERE Object_ID=?', id); cleared.elements++;
  }
  for (const id of diagramIds) { del('DELETE FROM t_diagram WHERE Diagram_ID=?', id); cleared.diagrams++; }
  const metaCount = db.prepare('SELECT COUNT(*) AS c FROM ' + META_TABLE).get().c;
  db.exec('DELETE FROM ' + META_TABLE);
  cleared.meta = metaCount;
  return cleared;
}
function fullProjection(graph, qeaPath, opts) {
  const o = opts || {};
  const t0 = nowMs();
  let cleared = null;
  let db;
  try {
    db = openQea(qeaPath);
    ensureMetaTable(db);
    db.exec('BEGIN IMMEDIATE');
    cleared = clearProjectionOwned(db);
    db.exec('COMMIT');
  } finally {
    if (db) { try { db.close(); } catch { /* ignore */ } }
  }
  const sync = syncGraphToQea(graph, qeaPath, { dryRun: o.dryRun, allowDelete: false });
  return { ok: true, cleared, sync: sync.stats, ms: { clear: nowMs() - t0 - (sync.stats.ms ? sync.stats.ms.total : 0), sync: sync.stats.ms ? sync.stats.ms.total : 0, total: nowMs() - t0 } };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function exportQeaToGraph(qeaPath) {
  const db = openQea(qeaPath);
  try {
    ensureMetaTable(db);
    const elements = readMetaKind(db, 'element').filter((e) => e && e.id !== undefined);
    const relationships = readMetaKind(db, 'relationship').filter((r) => r && r.id !== undefined);
    const views = readMetaKind(db, 'view').filter((v) => v && v.view_id !== undefined);
    return { name: 'ArchGraph (from archgraph.qea)', description: '', elements, relationships, views };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------
function snapshotQea(qeaPath, snapshotDir) {
  const fs = require('node:fs');
  const path = require('node:path');
  if (!fs.existsSync(qeaPath)) { return null; }
  const dir = snapshotDir || path.dirname(qeaPath);
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, path.basename(qeaPath).replace(/(\.qea)$/i, '_before_sync_' + ts + '$1'));
  fs.copyFileSync(qeaPath, target);
  return target;
}

module.exports = {
  SYNC_PACKAGE_NAME,
  META_TABLE,
  openQea,
  deterministicGuid,
  elementObjectType,
  elementStereotype,
  relationshipMap,
  canonicalArchimateType,
  syncGraphToQea,
  exportQeaToGraph,
  snapshotQea,
  readMetaKind,
  fullProjection,
  clearProjectionOwned,
  findSyncPackageId,
};
