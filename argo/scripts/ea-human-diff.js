'use strict';

// WP2792 (AT-2792-01..06): EA human-draft -> semantic diff -> agent write-back.
// Compares the EA *visible object model* of two .qea snapshots (baseline committed
// .qea vs human-edited working .qea) and classifies the human's changes into
// canonical-graph proposals (addElement/updateElement/removeElement,
// addRelationship/updateRelationship/removeRelationship, updateView membership).
//
// Why the visible object model and NOT kg_sync_meta:
//   kg_sync_meta is a lossless canonical mirror written only by the projector; a human
//   editing in EA touches t_object/t_connector/t_diagram/t_diagramobjects (plus the
//   schema_id / archimate_type anchor tags). Comparing mirrors would show zero diff for
//   human edits. So we anchor via the schema_id tag (elements: t_objectproperties,
//   relationships: t_connectortag; views: t_diagram schema_view_id StyleEx token OR the
//   deterministic diag:<viewId> ea_guid written by the projection).
//
// Semantic-first (v1): pure geometry (t_diagramobjects coordinates) never becomes a
// canonical proposal — it is only counted (layoutOnly) and excluded.
//
// Zero third-party deps, no EA required: node:sqlite via the shared lib helper.
//   node argo/scripts/ea-human-diff.js [--work <work.qea>] [--base <base.qea>] [--graph <json>]
//        [--out <stem>] [--no-md] [--baseline-commit <sha>]
//   --work defaults to the CURRENT PROJECT's root single *.qea (ARGO_EA_QEA > 仓库根唯一 *.qea),
//   never a hardcoded filename — the flow works in any ArchGraph workspace.
//   --base is optional: when omitted and --work is a tracked file inside the git repo,
//   the committed (HEAD) version of --work is extracted automatically as the baseline —
//   the day-to-day "human edited <project>.qea" flow is then a single command.

const path = require('node:path');
const fs = require('node:fs');
const lib = require('./ea-qea-sync-lib.js');
const { deterministicGuid } = lib;

// ---------------------------------------------------------------------------
// readSnapshot — read one .qea's semantic EA-visible projection surface
// ---------------------------------------------------------------------------
function parseStyleToken(styleEx, key) {
  const text = String(styleEx === null || styleEx === undefined ? '' : styleEx);
  const re = new RegExp('(^|;|\\s)' + key + '=([^;]*)', 'i');
  const m = re.exec(text);
  return m ? m[2] : '';
}

function readSnapshot(qeaPath, opts) {
  const o = opts || {};
  const db = lib.openQea(qeaPath);
  try {
    const snapshot = {
      path: qeaPath,
      syncPackageId: 0,
      // viewId -> { diagramId, name }
      diagramsByView: new Map(),
      // diagramId -> viewId
      viewByDiagram: new Map(),
      // canonical id -> element (anchored via schema_id tag)
      elementBySchema: new Map(),
      // eaGuid -> element (all t_object)
      elementByGuid: new Map(),
      // canonical id -> relationship (anchored via t_connectortag schema_id)
      relBySchema: new Map(),
      // eaGuid -> relationship (all t_connector)
      relByGuid: new Map(),
      // diagramId -> Map(objectId -> coords)
      placements: new Map(),
      // informational: kg_sync_meta counts/shas (never used for proposal detection)
      meta: { elements: 0, relationships: 0, views: 0, sha: '' },
      knownViewIds: null, // set by resolveViews when a canonical view catalog is provided
    };

    // kg_sync_meta informational snapshot (human edits never touch it -> identical).
    try {
      const rows = db.prepare('SELECT kind, key, sha FROM kg_sync_meta ORDER BY kind, key').all();
      snapshot.meta.elements = rows.filter((r) => r.kind === 'element').length;
      snapshot.meta.relationships = rows.filter((r) => r.kind === 'relationship').length;
      snapshot.meta.views = rows.filter((r) => r.kind === 'view').length;
      const hasher = require('node:crypto').createHash('sha256');
      for (const r of rows) { hasher.update(r.kind + '|' + r.key + '|' + r.sha); }
      snapshot.meta.sha = hasher.digest('hex');
    } catch { /* table may be absent on a hand-drawn model */ }

    // sync package id
    const roots = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=0 ORDER BY Package_ID LIMIT 1').all();
    if (roots.length > 0) {
      const pkg = db.prepare('SELECT Package_ID FROM t_package WHERE Parent_ID=? AND Name=? LIMIT 1').get(Number(roots[0].Package_ID), lib.SYNC_PACKAGE_NAME);
      if (pkg) { snapshot.syncPackageId = Number(pkg.Package_ID); }
    }

    // diagrams -> view mapping (schema_view_id StyleEx token)
    const diags = db.prepare('SELECT Diagram_ID, Package_ID, Name, StyleEx, ea_guid FROM t_diagram').all();
    for (const d of diags) {
      const v = parseStyleToken(d.StyleEx, 'schema_view_id');
      if (v) {
        const diagramId = Number(d.Diagram_ID);
        snapshot.diagramsByView.set(v, { diagramId, name: String(d.Name || ''), eaGuid: String(d.ea_guid || '') });
        snapshot.viewByDiagram.set(diagramId, v);
      }
    }
    // Optionally also bind known view ids via deterministic diagram guid (robust when EA
    // dropped the StyleEx token). Canonical view catalog supplied via --graph.
    if (o.knownViewIds && Array.isArray(o.knownViewIds)) {
      snapshot.knownViewIds = o.knownViewIds;
      for (const v of o.knownViewIds) {
        if (snapshot.diagramsByView.has(v)) { continue; }
        const guid = deterministicGuid('diag:' + v);
        const d = db.prepare('SELECT Diagram_ID, Name FROM t_diagram WHERE ea_guid = ? LIMIT 1').get(guid);
        if (d) {
          const diagramId = Number(d.Diagram_ID);
          snapshot.diagramsByView.set(v, { diagramId, name: String(d.Name || ''), eaGuid: guid });
          snapshot.viewByDiagram.set(diagramId, v);
        }
      }
    }

    // element anchor tags
    const elemTags = new Map(); // Object_ID -> {schemaId?, archimateType?}
    try {
      const props = db.prepare("SELECT Object_ID, Property, Value FROM t_objectproperties WHERE Property IN ('schema_id','archimate_type')").all();
      for (const p of props) {
        const oid = Number(p.Object_ID);
        if (!elemTags.has(oid)) { elemTags.set(oid, {}); }
        const t = elemTags.get(oid);
        if (p.Property === 'schema_id') { t.schemaId = String(p.Value); }
        if (p.Property === 'archimate_type') { t.archimateType = String(p.Value); }
      }
    } catch { /* ignore */ }

    const elems = db.prepare(
      'SELECT Object_ID, Alias, ea_guid, Object_Type, Stereotype, Name, Note, Status, Package_ID FROM t_object'
    ).all();
    for (const e of elems) {
      const rec = {
        objectId: Number(e.Object_ID),
        alias: e.Alias === null || e.Alias === undefined ? '' : String(e.Alias),
        eaGuid: String(e.ea_guid || ''),
        objectType: String(e.Object_Type || ''),
        stereotype: String(e.Stereotype || ''),
        name: String(e.Name || ''),
        description: String(e.Note === null || e.Note === undefined ? '' : e.Note),
        status: String(e.Status || ''),
        packageId: Number(e.Package_ID || 0),
      };
      const tag = elemTags.get(rec.objectId);
      if (tag && tag.schemaId) {
        rec.schemaId = tag.schemaId;
        rec.archimateType = tag.archimateType || '';
        snapshot.elementBySchema.set(rec.schemaId, rec);
      }
      if (rec.eaGuid) { snapshot.elementByGuid.set(rec.eaGuid, rec); }
    }

    // relationship anchor tags — t_connectortag's value column is literally named VALUE,
    // so alias it to Value for a case-stable row key (unlike t_objectproperties.Value).
    const relTags = new Map(); // Connector_ID -> schemaId
    try {
      const props = db.prepare("SELECT ElementID, Property, VALUE AS Value FROM t_connectortag WHERE Property IN ('schema_id','archimate_relationship_type')").all();
      for (const p of props) {
        const cid = Number(p.ElementID);
        if (!relTags.has(cid)) { relTags.set(cid, {}); }
        const t = relTags.get(cid);
        if (p.Property === 'schema_id') { t.schemaId = String(p.Value); }
        if (p.Property === 'archimate_relationship_type') { t.archimateType = String(p.Value); }
      }
    } catch { /* ignore */ }

    const conns = db.prepare(
      'SELECT Connector_ID, ea_guid, Name, Connector_Type, Stereotype, Notes, Direction, Start_Object_ID, End_Object_ID FROM t_connector'
    ).all();
    for (const c of conns) {
      const rec = {
        connectorId: Number(c.Connector_ID),
        eaGuid: String(c.ea_guid || ''),
        name: String(c.Name || ''),
        connectorType: String(c.Connector_Type || ''),
        stereotype: String(c.Stereotype || ''),
        description: String(c.Notes === null || c.Notes === undefined ? '' : c.Notes),
        direction: String(c.Direction || ''),
        sourceObjectId: Number(c.Start_Object_ID || 0),
        targetObjectId: Number(c.End_Object_ID || 0),
      };
      const tag = relTags.get(rec.connectorId);
      if (tag && tag.schemaId) {
        rec.schemaId = tag.schemaId;
        rec.archimateType = tag.archimateType || '';
        snapshot.relBySchema.set(rec.schemaId, rec);
      }
      if (rec.eaGuid) { snapshot.relByGuid.set(rec.eaGuid, rec); }
    }

    // placements (diagram membership + geometry)
    const objs = db.prepare(
      'SELECT Diagram_ID, Object_ID, Sequence, RectLeft, RectTop, RectRight, RectBottom FROM t_diagramobjects'
    ).all();
    for (const r of objs) {
      const diagramId = Number(r.Diagram_ID);
      if (!snapshot.placements.has(diagramId)) { snapshot.placements.set(diagramId, new Map()); }
      snapshot.placements.get(diagramId).set(Number(r.Object_ID), {
        left: Number(r.RectLeft || 0), top: Number(r.RectTop || 0),
        right: Number(r.RectRight || 0), bottom: Number(r.RectBottom || 0),
      });
    }
    return snapshot;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// semanticDiff — classify human changes between base and work snapshots
// ---------------------------------------------------------------------------
function normText(s) {
  return String(s === null || s === undefined ? '' : s).trim();
}

function elementCanonicalContext(work, rec) {
  // Is this EA object part of the projection-owned / canonical surface?
  if (rec.schemaId) { return true; }
  if (rec.packageId === work.syncPackageId) { return true; }
  // placed on any canonical view diagram?
  for (const [diagramId, members] of work.placements) {
    if (work.viewByDiagram.has(diagramId) && members.has(rec.objectId)) { return true; }
  }
  return false;
}

function placedViewIds(work, objectId) {
  const out = [];
  for (const [diagramId, members] of work.placements) {
    const viewId = work.viewByDiagram.get(diagramId);
    if (viewId && members.has(objectId)) { out.push(viewId); }
  }
  return out;
}

function semanticDiff(base, work, opts) {
  const o = opts || {};
  const proposals = [];
  const summary = {
    addElement: 0, updateElement: 0, removeElement: 0,
    addRelationship: 0, updateRelationship: 0, removeRelationship: 0,
    updateView: 0,
    layoutOnly: 0, geometryOnlyObjects: 0, outOfScopeNew: 0, removedUnanchored: 0, orphanAnchored: 0,
  };
  const push = (p) => { proposals.push(p); summary[p.op] = (summary[p.op] || 0) + 1; };

  const metaUnchanged = base.meta.sha === work.meta.sha;

  // --- geometry-only counting (never proposed) -----------------------------
  for (const [diagramId, baseMembers] of base.placements) {
    const viewId = base.viewByDiagram.get(diagramId);
    if (!viewId) { continue; }
    const workMembers = work.placements.get(diagramId);
    if (!workMembers) { continue; }
    for (const [objectId, baseCoords] of baseMembers) {
      const workCoords = workMembers.get(objectId);
      if (!workCoords) { continue; }
      const moved = baseCoords.left !== workCoords.left || baseCoords.top !== workCoords.top ||
        baseCoords.right !== workCoords.right || baseCoords.bottom !== workCoords.bottom;
      if (moved) { summary.layoutOnly++; }
    }
  }

  // --- elements: anchored content / removal / addition ---------------------
  const baseSchemaIds = new Set(base.elementBySchema.keys());
  const workSchemaIds = new Set(work.elementBySchema.keys());
  for (const schemaId of baseSchemaIds) {
    const b = base.elementBySchema.get(schemaId);
    const w = work.elementBySchema.get(schemaId);
    if (!w) {
      // anchored element removed from the model -> removeElement
      push({ op: 'removeElement', kind: 'element', id: schemaId, sourceEa: { guid: b.eaGuid } });
      continue;
    }
    const fields = {};
    if (normText(b.name) !== normText(w.name)) { fields.name = w.name; }
    if (normText(b.description) !== normText(w.description)) { fields.description = w.description; }
    if (normText(b.status) !== normText(w.status)) { fields.status = w.status; }
    if (Object.keys(fields).length > 0) {
      push({ op: 'updateElement', kind: 'element', id: schemaId, fields, sourceEa: { guid: w.eaGuid } });
    }
  }
  for (const schemaId of workSchemaIds) {
    if (baseSchemaIds.has(schemaId)) { continue; }
    // anchored id present only in work (e.g. human duplicated a tagged object) — cannot map
    // to a canonical id safely; count and skip (agent reconciles).
    summary.orphanAnchored++;
  }
  // unanchored NEW objects in work (human drew fresh boxes)
  for (const [eaGuid, rec] of work.elementByGuid) {
    if (rec.schemaId) { continue; }
    if (base.elementByGuid.has(eaGuid)) { continue; }
    if (!elementCanonicalContext(work, rec)) { summary.outOfScopeNew++; continue; }
    const viewIds = placedViewIds(work, rec.objectId);
    push({
      op: 'addElement', kind: 'element', id: null,
      proposed: {
        name: rec.name,
        description: rec.description === '' ? undefined : rec.description,
        eaType: { objectType: rec.objectType, stereotype: rec.stereotype },
        viewIds: viewIds.length > 0 ? viewIds : undefined,
      },
      sourceEa: { guid: eaGuid, objectId: rec.objectId },
    });
  }
  // unanchored objects removed in work (never canonical -> no proposal, count only)
  for (const [eaGuid, rec] of base.elementByGuid) {
    if (rec.schemaId) { continue; }
    if (work.elementByGuid.has(eaGuid)) { continue; }
    if (elementCanonicalContext(base, rec)) { summary.removedUnanchored++; }
  }

  // --- relationships --------------------------------------------------------
  const baseRelIds = new Set(base.relBySchema.keys());
  const workRelIds = new Set(work.relBySchema.keys());
  const schemaOfObject = (snap, objectId) => {
    for (const [, e] of snap.elementBySchema) { if (e.objectId === objectId) { return e.schemaId; } }
    const w = snap.elementByGuid;
    for (const [, e] of w) { if (e.objectId === objectId && !e.schemaId) { return { newGuid: e.eaGuid }; } }
    return null;
  };
  for (const schemaId of baseRelIds) {
    const b = base.relBySchema.get(schemaId);
    const w = work.relBySchema.get(schemaId);
    if (!w) {
      push({ op: 'removeRelationship', kind: 'relationship', id: schemaId, sourceEa: { guid: b.eaGuid } });
      continue;
    }
    const fields = {};
    if (normText(b.name) !== normText(w.name)) { fields.name = w.name; }
    if (normText(b.description) !== normText(w.description)) { fields.description = w.description; }
    const s = schemaOfObject(work, w.sourceObjectId);
    const t = schemaOfObject(work, w.targetObjectId);
    const bS = schemaOfObject(base, b.sourceObjectId);
    const bT = schemaOfObject(base, b.targetObjectId);
    const src = s && typeof s === 'object' ? null : s;
    const tgt = t && typeof t === 'object' ? null : t;
    const bSrc = bS && typeof bS === 'object' ? null : bS;
    const bTgt = bT && typeof bT === 'object' ? null : bT;
    if (src !== bSrc) { fields.sourceId = src; }
    if (tgt !== bTgt) { fields.targetId = tgt; }
    if (Object.keys(fields).length > 0) {
      push({ op: 'updateRelationship', kind: 'relationship', id: schemaId, fields, sourceEa: { guid: w.eaGuid } });
    }
  }
  for (const schemaId of workRelIds) {
    if (baseRelIds.has(schemaId)) { continue; }
    summary.orphanAnchored++;
  }
  // unanchored NEW connectors in work (human drew fresh links)
  for (const [eaGuid, rec] of work.relByGuid) {
    if (rec.schemaId) { continue; }
    if (base.relByGuid.has(eaGuid)) { continue; }
    // canonical context: at least one endpoint anchored/placed on a canonical view
    const src = work.elementByGuid.get(guidOfObject(work, rec.sourceObjectId));
    const tgt = work.elementByGuid.get(guidOfObject(work, rec.targetObjectId));
    const srcContext = src ? elementCanonicalContext(work, src) : false;
    const tgtContext = tgt ? elementCanonicalContext(work, tgt) : false;
    if (!srcContext && !tgtContext) { summary.outOfScopeNew++; continue; }
    const viewIds = [];
    for (const [diagramId, members] of work.placements) {
      const viewId = work.viewByDiagram.get(diagramId);
      if (viewId && members.has(rec.sourceObjectId) && members.has(rec.targetObjectId)) { viewIds.push(viewId); }
    }
    const srcRef = src ? (src.schemaId || { newGuid: src.eaGuid }) : null;
    const tgtRef = tgt ? (tgt.schemaId || { newGuid: tgt.eaGuid }) : null;
    push({
      op: 'addRelationship', kind: 'relationship', id: null,
      proposed: {
        name: rec.name === '' ? undefined : rec.name,
        sourceRef: srcRef, targetRef: tgtRef,
        eaType: { connectorType: rec.connectorType, stereotype: rec.stereotype },
        viewIds: viewIds.length > 0 ? viewIds : undefined,
      },
      sourceEa: { guid: eaGuid, connectorId: rec.connectorId },
    });
  }

  // --- view membership (anchored objects only, still present in the model) ---
  const allViewIds = new Set([...base.viewByDiagram.values(), ...work.viewByDiagram.values()]);
  for (const viewId of allViewIds) {
    const bDiag = base.diagramsByView.get(viewId);
    const wDiag = work.diagramsByView.get(viewId);
    if (!bDiag || !wDiag) { continue; } // view's diagram added/removed wholesale: out of v1 scope
    const bMembers = base.placements.get(bDiag.diagramId) || new Map();
    const wMembers = work.placements.get(wDiag.diagramId) || new Map();
    const addMembers = [];
    const removeMembers = [];
    for (const objectId of wMembers.keys()) {
      if (bMembers.has(objectId)) { continue; }
      const rec = elemByObjectId(work, objectId);
      if (!rec || !rec.schemaId) { continue; } // unanchored new placement -> rides addElement
      addMembers.push(rec.schemaId);
    }
    for (const objectId of bMembers.keys()) {
      if (wMembers.has(objectId)) { continue; }
      const rec = elemByObjectId(base, objectId);
      if (!rec || !rec.schemaId) { continue; }
      // removed from diagram but object must still exist in the model (else removeElement)
      if (!work.elementBySchema.has(rec.schemaId)) { continue; }
      removeMembers.push(rec.schemaId);
    }
    if (addMembers.length > 0 || removeMembers.length > 0) {
      push({
        op: 'updateView', kind: 'view', viewId,
        addMembers: addMembers.length > 0 ? addMembers : undefined,
        removeMembers: removeMembers.length > 0 ? removeMembers : undefined,
        sourceEa: {},
      });
    }
  }

  // orphan/other counts merge
  summary.metaUnchanged = metaUnchanged;
  return { proposals, summary };
}

function guidOfObject(snap, objectId) {
  for (const [, e] of snap.elementByGuid) { if (e.objectId === objectId) { return e.eaGuid; } }
  return '';
}
function elemByObjectId(snap, objectId) {
  for (const [, e] of snap.elementByGuid) { if (e.objectId === objectId) { return e; } }
  return null;
}

// ---------------------------------------------------------------------------
// Output rendering (JSON + Markdown)
// ---------------------------------------------------------------------------
function buildJsonResult(args) {
  return {
    format: 'archgraph-ea-human-diff',
    version: 1,
    source: { base: args.base, work: args.work },
    baselineCommit: args.baselineCommit || null,
    extractedAt: new Date().toISOString(),
    summary: args.summary,
    proposals: args.proposals,
  };
}

function renderMarkdown(result) {
  const s = result.summary;
  const lines = [];
  lines.push('# EA 人类草稿语义 diff（ea-human-diff）');
  lines.push('');
  lines.push(`- 基线（committed .qea）：\`${result.source.base}\``);
  lines.push(`- 工作区（human-edited .qea）：\`${result.source.work}\``);
  if (result.baselineCommit) { lines.push(`- 基线 commit：\`${result.baselineCommit}\``); }
  lines.push(`- 提取时间：${result.extractedAt}`);
  lines.push('');
  lines.push('## 摘要');
  lines.push('');
  lines.push('| 操作 | 数量 |');
  lines.push('| --- | --- |');
  const opOrder = ['addElement', 'updateElement', 'removeElement', 'addRelationship', 'updateRelationship', 'removeRelationship', 'updateView'];
  for (const op of opOrder) {
    const label = { addElement: '新增元素', updateElement: '更新元素', removeElement: '删除元素', addRelationship: '新增关系', updateRelationship: '更新关系', removeRelationship: '删除关系', updateView: '视图成员' }[op];
    lines.push(`| ${label}（${op}） | ${s[op] || 0} |`);
  }
  lines.push(`| 纯几何移动（不产出，语义优先排除） | ${s.layoutOnly || 0} |`);
  lines.push(`| 超出 canonical 作用域的新对象（跳过） | ${s.outOfScopeNew || 0} |`);
  lines.push(`| 删除的无锚对象（从未入 canonical，跳过） | ${s.removedUnanchored || 0} |`);
  lines.push(`| 镜像（kg_sync_meta）未变 | ${s.metaUnchanged ? '是' : '否'} |`);
  lines.push('');
  if (result.proposals.length === 0) {
    lines.push('> 未检测到 canonical 语义提议（纯几何/超出作用域改动不计）。');
    lines.push('');
  }
  const groups = {
    addElement: '新增元素提议', updateElement: '更新元素提议', removeElement: '删除元素提议',
    addRelationship: '新增关系提议', updateRelationship: '更新关系提议', removeRelationship: '删除关系提议',
    updateView: '视图成员提议',
  };
  for (const op of opOrder) {
    const items = result.proposals.filter((p) => p.op === op);
    if (items.length === 0) { continue; }
    lines.push(`## ${groups[op]}（${items.length}）`);
    lines.push('');
    for (const p of items) {
      if (op === 'addElement') {
        lines.push(`- **${p.proposed.name}** — id 待 agent 分配；EA 类型 \`${p.proposed.eaType.objectType}\`/\`${p.proposed.eaType.stereotype}\`${p.proposed.viewIds ? `；视图候选 ${p.proposed.viewIds.join(', ')}` : ''}${p.proposed.description ? `；描述：${p.proposed.description.slice(0, 120)}` : ''}；EA \`${p.sourceEa.guid}\``);
      } else if (op === 'updateElement') {
        lines.push(`- \`${p.id}\` — ${Object.entries(p.fields).map(([k, v]) => `${k} → ${String(v).slice(0, 80)}`).join('；')}；EA \`${p.sourceEa.guid}\``);
      } else if (op === 'removeElement' || op === 'removeRelationship') {
        lines.push(`- \`${p.id}\` — 待 agent 确认后删除；EA \`${p.sourceEa.guid}\``);
      } else if (op === 'addRelationship') {
        const src = typeof p.proposed.sourceRef === 'object' ? `新元素 ${p.proposed.sourceRef.newGuid}` : p.proposed.sourceRef;
        const tgt = typeof p.proposed.targetRef === 'object' ? `新元素 ${p.proposed.targetRef.newGuid}` : p.proposed.targetRef;
        lines.push(`- ${p.proposed.name ? `**${p.proposed.name}** ` : ''}${src} → ${tgt}；EA 类型 \`${p.proposed.eaType.connectorType}\`/\`${p.proposed.eaType.stereotype}\`；EA \`${p.sourceEa.guid}\``);
      } else if (op === 'updateRelationship') {
        lines.push(`- \`${p.id}\` — ${Object.entries(p.fields).map(([k, v]) => `${k} → ${String(v).slice(0, 80)}`).join('；')}；EA \`${p.sourceEa.guid}\``);
      } else if (op === 'updateView') {
        const a = p.addMembers ? `加入：${p.addMembers.join(', ')}` : '';
        const r = p.removeMembers ? `移除：${p.removeMembers.join(', ')}` : '';
        lines.push(`- 视图 \`${p.viewId}\` — ${[a, r].filter(Boolean).join('；')}`);
      }
    }
    lines.push('');
  }
  lines.push('> 本 diff 基于 EA 可见对象模型（schema_id 锚 tag 对齐），不读 kg_sync_meta；几何不进 canonical。交由 agent 经 ARGO preview/apply 写入图谱。');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { base: '', work: '', graph: '', out: '', baselineCommit: '', md: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : '');
    if (a === '--base') { args.base = next(); }
    else if (a === '--work') { args.work = next(); }
    else if (a === '--graph') { args.graph = next(); }
    else if (a === '--out') { args.out = next(); }
    else if (a === '--baseline-commit') { args.baselineCommit = next(); }
    else if (a === '--no-md') { args.md = false; }
  }
  return args;
}

// Auto-baseline: extract the committed (HEAD) version of the working .qea as the baseline.
// Lets the day-to-day flow be a single command when --work is a tracked repo file.
function gitShowHeadBlob(relPath) {
  const { execFileSync } = require('node:child_process');
  return execFileSync('git', ['cat-file', 'blob', 'HEAD:' + relPath], { maxBuffer: 512 * 1024 * 1024 });
}
function gitToplevel() {
  const { execFileSync } = require('node:child_process');
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}
// Resolve the CURRENT PROJECT's .qea (same convention as the projection):
//   ARGO_EA_QEA env > exactly one *.qea at the git top-level (else cwd).
// Called when --work is omitted so the day-to-day command never hardcodes a filename.
function resolveProjectQea() {
  if (process.env.ARGO_EA_QEA) { return process.env.ARGO_EA_QEA; }
  const root = gitToplevel() || process.cwd();
  let qeas = [];
  try { qeas = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith('.qea')); } catch { qeas = []; }
  if (qeas.length === 1) { return path.join(root, qeas[0]); }
  return '';
}

function resolveAutoBase(workPath) {
  const { execFileSync } = require('node:child_process');
  const workAbs = path.resolve(process.cwd(), workPath);
  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('--base omitted but git toplevel unavailable; pass --base <baseline.qea> explicitly');
  }
  const rel = path.relative(root, workAbs).split(path.sep).join('/');
  if (rel.startsWith('..')) {
    throw new Error('--work (' + workAbs + ') is outside the git repo; pass --base <baseline.qea> explicitly');
  }
  let blob;
  try {
    blob = gitShowHeadBlob(rel);
  } catch {
    throw new Error('git HEAD has no tracked file "' + rel + '"; pass --base <baseline.qea> explicitly');
  }
  const tmp = path.join(require('node:os').tmpdir(), 'ea-human-diff-base-' + process.pid + '.qea');
  fs.writeFileSync(tmp, blob);
  let short = '';
  try { short = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* ignore */ }
  return { base: tmp, baselineCommit: short };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.work) {
    const auto = resolveProjectQea();
    if (auto) { args.work = auto; }
  }
  if (!args.base && !args.work) {
    console.error('usage: node argo/scripts/ea-human-diff.js [--base <base.qea>] [--work <work.qea>] [--graph <json>] [--out <stem>] [--baseline-commit <sha>] [--no-md]');
    console.error('       (--work optional: defaults to the current project root single *.qea; --base optional: the committed HEAD version of --work is the baseline)');
    process.exit(2);
  }
  if (args.base === '' && args.work) {
    try {
      const auto = resolveAutoBase(args.work);
      args.base = auto.base;
      if (!args.baselineCommit) { args.baselineCommit = auto.baselineCommit; }
    } catch (err) {
      console.error('ea-human-diff: ' + err.message);
      process.exit(2);
    }
  }
  for (const f of [args.base, args.work]) {
    if (!fs.existsSync(f)) { console.error('file not found: ' + f); process.exit(2); }
  }
  const knownViewIds = null;
  if (args.graph && fs.existsSync(args.graph)) {
    try {
      const g = JSON.parse(fs.readFileSync(args.graph, 'utf8').replace(/^\uFEFF/, ''));
      args._knownViewIds = (g.views || []).map((v) => String(v.view_id));
    } catch { /* optional catalog */ }
  }
  const base = readSnapshot(args.base, { knownViewIds: args._knownViewIds });
  const work = readSnapshot(args.work, { knownViewIds: args._knownViewIds });
  const { proposals, summary } = semanticDiff(base, work, {});
  const result = buildJsonResult({ base: args.base, work: args.work, baselineCommit: args.baselineCommit, summary, proposals });
  if (args.out) {
    const stem = path.resolve(process.cwd(), args.out);
    fs.writeFileSync(stem + '.json', JSON.stringify(result, null, 2), 'utf8');
    if (args.md) {
      fs.writeFileSync(stem + '.md', renderMarkdown(result), 'utf8');
    }
    console.log('ea-human-diff written: ' + stem + '.json' + (args.md ? ' + ' + stem + '.md' : ''));
    console.log(JSON.stringify({ summary }, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (require.main === module) { main(); }

module.exports = {
  parseStyleToken,
  readSnapshot,
  semanticDiff,
  buildJsonResult,
  renderMarkdown,
};
