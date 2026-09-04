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
// Element child mirror (attributes -> t_attribute, testcases -> t_objecttests)
// Mirrors the legacy object-model import (import-from-kg.js applyElementAttributes /
// applyTestcases) so canonical attributes and acceptance tests are visible in EA
// under the element's Attributes / Testing tabs. Canonical-owned fields only:
// run status/results on tests are left untouched on update (EA-side state).
// ---------------------------------------------------------------------------
const MAX_ATTRIBUTE_DEFAULT_LENGTH = 250;
const TEST_CLASS_ACCEPTANCE = 4; // mirrors import-from-kg mapTestTypeToEaClass('Acceptance Test')

function attrRowGuid(elementAlias, name, occurrence) {
  return deterministicGuid('attr:' + elementAlias + ':' + name + '#' + occurrence);
}
function attributeDefaultValue(attr) {
  const value = attr.value === undefined || attr.value === null ? '' : String(attr.value);
  return value.length > MAX_ATTRIBUTE_DEFAULT_LENGTH ? '' : value;
}
function attributeNoteText(attr) {
  const parts = [];
  const value = attr.value === undefined || attr.value === null ? '' : String(attr.value);
  if (value.length > MAX_ATTRIBUTE_DEFAULT_LENGTH) { parts.push(value); }
  if (attr.description !== undefined && attr.description !== null && String(attr.description) !== '') { parts.push(String(attr.description)); }
  if (attr.content !== undefined && attr.content !== null && String(attr.content) !== '') { parts.push(String(attr.content)); }
  return parts.join('\r\n\r\n');
}
function isPersistedAttribute(attr) {
  return !!(attr && typeof attr === 'object' && typeof attr.name === 'string' && attr.name.trim() !== '' && attr.op !== 'remove');
}
function mirrorElementChildren(db, objectId, element, stats) {
  const alias = String(element.id);
  const attrs = (Array.isArray(element.attributes) ? element.attributes : []).filter(isPersistedAttribute);
  if (attrs.length > 0) {
    const existing = db.prepare('SELECT ID, Name, "Default", Notes, ea_guid, Pos FROM t_attribute WHERE Object_ID=?').all(objectId);
    const available = existing.map((r) => ({ ...r }));
    let maxPos = 0;
    for (const r of existing) { const p = Number(r.Pos); if (!Number.isNaN(p) && p > maxPos) { maxPos = p; } }
    const occurrence = {};
    for (const a of attrs) {
      occurrence[a.name] = (occurrence[a.name] || 0) + 1;
      const guid = attrRowGuid(alias, a.name, occurrence[a.name]);
      const notes = attributeNoteText(a);
      const def = attributeDefaultValue(a);
      const idx = available.findIndex((r) => String(r.ea_guid || '') === guid);
      if (idx >= 0) {
        db.prepare('UPDATE t_attribute SET Name=?, Type=?, "Default"=?, Notes=? WHERE ID=?')
          .run(a.name, 'String', def, notes, Number(available[idx].ID));
        available.splice(idx, 1);
        stats.attributesUpdated++;
      } else {
        maxPos += 16;
        db.prepare('INSERT INTO t_attribute (Object_ID, Name, Scope, Type, "Default", Notes, Pos, ea_guid) VALUES (?,?,?,?,?,?,?,?)')
          .run(objectId, a.name, 'Public', 'String', def, notes, maxPos, guid);
        stats.attributesAdded++;
      }
    }
  }
  const tests = Array.isArray(element.testcases) ? element.testcases : [];
  for (const tc of tests) {
    if (!tc || typeof tc.name !== 'string' || tc.name.trim() === '') { continue; }
    const name = tc.name.trim();
    const type = (tc.type !== undefined && tc.type !== null && String(tc.type) !== '') ? String(tc.type) : 'Acceptance Test';
    const notes = tc.description === undefined || tc.description === null ? '' : String(tc.description);
    const input = tc.Input === undefined || tc.Input === null ? '' : String(tc.Input);
    const criteria = tc.acceptanceCriteria === undefined || tc.acceptanceCriteria === null ? '' : String(tc.acceptanceCriteria);
    const existing = db.prepare('SELECT Test FROM t_objecttests WHERE Object_ID=? AND Test=? AND TestClass=?')
      .get(objectId, name, TEST_CLASS_ACCEPTANCE);
    if (existing) {
      db.prepare('UPDATE t_objecttests SET TestType=?, Notes=?, InputData=?, AcceptanceCriteria=? WHERE Object_ID=? AND Test=? AND TestClass=?')
        .run(type, notes, input, criteria, objectId, name, TEST_CLASS_ACCEPTANCE);
      stats.testsUpdated++;
    } else {
      db.prepare('INSERT INTO t_objecttests (Object_ID, Test, TestClass, TestType, Notes, InputData, AcceptanceCriteria, Status, Results) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(objectId, name, TEST_CLASS_ACCEPTANCE, type, notes, input, criteria, 'Proposed', '');
      stats.testsAdded++;
    }
  }
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
function ensureStyleToken(styleEx, keyValue) {
  // EA rewrites StyleEx with its own tokens and drops unknown ones (e.g. schema_view_id).
  // Re-inject our anchor while preserving EA's formatting tokens so diagram identity
  // stays discoverable on the next sync.
  const text = String(styleEx === null || styleEx === undefined ? '' : styleEx);
  const key = String(keyValue).split('=')[0];
  const existing = parseStyleToken(text, key);
  if (existing !== '') { return text; }
  const token = String(keyValue).indexOf('=') >= 0 ? String(keyValue) + ';' : String(keyValue) + '=;';
  return text ? token + text : token;
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
      // canonical attributes -> t_attribute, canonical testcases -> t_objecttests
      for (const t of toTag) {
        mirrorElementChildren(db, t.id, t.e, tagStats);
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
    // Diagram identity is matched by BOTH the schema_view_id StyleEx token AND the
    // deterministic ea_guid. EA rewrites StyleEx (its own formatting tokens) whenever
    // it touches an open project and DROPS unknown tokens like schema_view_id — if we
    // only matched by the token we would re-INSERT the same deterministic ea_guid and
    // crash on t_diagram's UNIQUE(ea_guid) (projection failure: Neo4j ok, EA stale).
    const existingDiags = db.prepare('SELECT Diagram_ID, Package_ID, Name, StyleEx, ea_guid FROM t_diagram WHERE Package_ID=?').all(syncId);
    const diagByView = new Map();
    const diagByGuid = new Map();
    for (const d of existingDiags) {
      if (d.ea_guid) { diagByGuid.set(String(d.ea_guid), d); }
      const v = parseStyleToken(d.StyleEx, 'schema_view_id');
      if (v) { diagByView.set(v, d); }
    }
    const diagViewRows = new Map(); // view_id -> matched existing row (token OR guid)
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
      const existing = diagByView.get(viewId) || diagByGuid.get(deterministicGuid('diag:' + viewId)) || null;
      const intended = {
        Name: safeName(view.view_name, viewId),
        Diagram_Type: DIAGRAM_TYPE,
        Package_ID: syncId,
        ParentID: parentObjectId,
        Notes: '', // EA .qea 不保留多段 Notes；视图内容经 kg_sync_meta 保真
        StyleEx: styleEx,
      };
      if (existing) {
        diagViewRows.set(viewId, existing);
        // EA may have rewritten StyleEx and dropped the anchor — re-inject it while
        // preserving EA's own formatting tokens so identity stays discoverable.
        const anchoredStyleEx = ensureStyleToken(existing.StyleEx, 'schema_view_id=' + viewId);
        const changed = intended.Name !== (existing.Name || '') || (existing.StyleEx || '') !== anchoredStyleEx;
        if (DEBUG && changed) { console.error('DEBUG diagram chg', viewId, JSON.stringify({n:[intended.Name,(existing.Name||'')], style: !!parseStyleToken(existing.StyleEx,'schema_view_id')})); }
        if (changed && !o.dryRun) {
          db.prepare('UPDATE t_diagram SET Name=?, StyleEx=? WHERE Diagram_ID=?')
            .run(intended.Name, anchoredStyleEx, Number(existing.Diagram_ID));
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
    const diagIdForView = (viewId) => {
      const row = diagViewRows.get(viewId) || diagByView.get(viewId);
      if (row) { return Number(row.Diagram_ID !== undefined ? row.Diagram_ID : row); }
      const planned = diagAliasToId.get(viewId);
      return planned === undefined ? null : planned;
    };
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
      const diagramId = diagIdForView(viewId);
      if (diagramId === null) { continue; }
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
// ---------------------------------------------------------------------------
// Full projection (whole-file rebuild, decision qea-full-wholefile-argo-scripts-no-config):
// wipe ALL existing content in the target .qea (every user table row, incl. kg_sync_meta),
// re-seed the minimal root package, then rebuild the whole .qea purely from the canonical
// graph. EA is treated as a projection: after full there is nothing but canonical content.
// ---------------------------------------------------------------------------
function wipeAllContent(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const cleared = {};
  for (const r of rows) {
    try {
      const before = db.prepare('SELECT COUNT(*) AS c FROM "' + r.name + '"').get().c;
      db.exec('DELETE FROM "' + r.name + '"');
      cleared[r.name] = before;
    } catch { /* skip locked/system tables */ }
  }
  try { db.exec('DELETE FROM sqlite_sequence'); } catch { /* ignore */ }
  return cleared;
}
function ensureRootPackage(db) {
  const roots = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=0 ORDER BY Package_ID').all();
  if (roots.length > 0) { return Number(roots[0].Package_ID); }
  const r = db.prepare('INSERT INTO t_package (Name, Parent_ID, ea_guid) VALUES (?,?,?)').run('Model', 0, deterministicGuid('pkg:Model'));
  return Number(r.lastInsertRowid);
}
function verifyQeaCanonical(graph, qeaPath) {
  let roundtrip = null;
  try { roundtrip = require('../../tests/_ea-roundtrip-lib.js'); } catch { roundtrip = null; }
  const exp = exportQeaToGraph(qeaPath);
  const counts = {
    elements: exp.elements.length, relationships: exp.relationships.length, views: exp.views.length,
    sourceElements: (graph.elements || []).length,
    sourceRelationships: (graph.relationships || []).length,
    sourceViews: (graph.views || []).length,
  };
  let equal = counts.elements === counts.sourceElements && counts.relationships === counts.sourceRelationships && counts.views === counts.sourceViews;
  let diffs = null;
  if (roundtrip && typeof roundtrip.compareRoundtrip === 'function') {
    const rep = roundtrip.compareRoundtrip(graph, exp, {});
    equal = rep.equal;
    diffs = { missing: rep.missingInExport.length, extra: rep.extraInExport.length, valueDiffs: rep.valueDiffs.length };
  }
  return { consistent: equal, diffs, counts };
}
function fullProjection(graph, qeaPath, opts) {
  const o = opts || {};
  const t0 = nowMs();
  let wiped = null;
  let db = null;
  try {
    db = openQea(qeaPath);
    ensureMetaTable(db);
    db.exec('BEGIN IMMEDIATE');
    wiped = wipeAllContent(db);
    ensureRootPackage(db);
    db.exec('COMMIT');
  } finally {
    if (db) { try { db.close(); } catch { /* ignore */ } }
  }
  const sync = syncGraphToQea(graph, qeaPath, { dryRun: o.dryRun, allowDelete: false });
  const verification = o.verify === false ? null : verifyQeaCanonical(graph, qeaPath);
  return { ok: true, wiped, sync: sync.stats, verification, ms: { total: nowMs() - t0 } };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
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
  wipeAllContent,
  ensureRootPackage,
  verifyQeaCanonical,
};
