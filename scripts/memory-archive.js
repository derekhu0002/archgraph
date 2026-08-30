#!/usr/bin/env node
'use strict';
/**
 * ACTOR memory archive migration (T2 -> T3), per docs/actor-memory-tiers.md.
 *
 * Rule: a T2 long-term-memory element is a candidate for archiving when it is
 * DELIVERED (deliveryStatus=delivered) or COMPLETED (status=COMPLETED) AND it is
 * OLDER than `days` (age gate). The age gate uses a date attribute
 * (lastSummaryAt / archivedAt / createdAt); elements without a date attribute are
 * SKIPPED (never auto-archived on age alone) — a safe default that keeps active
 * milestones in T2.
 *
 * Migration is MOVE-ONLY (only move, never delete): the element stays in the
 * graph; it is removed from the T2 <actor>-ltm-001 view membership, added to the
 * T3 <actor>-archive-001 view membership, and tagged memoryTier=T3 + archivedAt.
 *
 * Usage:
 *   node scripts/memory-archive.js <actorId> --check [--days 30]   # dry-run report
 *   node scripts/memory-archive.js <actorId> --apply [--days 30]   # write via ARGO MCP
 *   ARGO_REPO_ROOT overrides the workspace root (default: repo root).
 */
const fs = require('node:fs');
const path = require('node:path');

function readGraph(graphPath) {
  return JSON.parse(fs.readFileSync(graphPath, 'utf8'));
}

function attrValue(element, name) {
  const attrs = (element && element.attributes) || [];
  const hit = attrs.find(a => a.name === name);
  return hit ? hit.value : undefined;
}

// Deterministic candidate selection: delivered/COMPLETED + age gate.
function findArchiveCandidates({ doc, actorId, days = 30 }) {
  const t2 = (doc.views || []).find(v => v.parent_element_id === actorId && /-ltm-/.test(v.view_id));
  const t3 = (doc.views || []).find(v => v.parent_element_id === actorId && /-archive-/.test(v.view_id));
  if (!t2 || !t3) return { t2, t3, candidates: [], skipped: [] };
  const candidates = [];
  const skipped = [];
  for (const id of t2.included_elements || []) {
    const el = (doc.elements || []).find(e => e.id === id);
    if (!el) { skipped.push({ id, reason: 'missing element' }); continue; }
    const delivered = attrValue(el, 'deliveryStatus') === 'delivered';
    const completed = attrValue(el, 'status') === 'COMPLETED';
    if (!(delivered || completed)) { skipped.push({ id, reason: 'not delivered/COMPLETED' }); continue; }
    if (days > 0) {
      const dateAttr = (el.attributes || []).find(a => ['lastSummaryAt', 'archivedAt', 'createdAt'].includes(a.name));
      if (!dateAttr) { skipped.push({ id, reason: 'no date attribute for age gate' }); continue; }
      const ts = Date.parse(dateAttr.value);
      if (Number.isNaN(ts)) { skipped.push({ id, reason: 'unparseable date' }); continue; }
      const ageDays = (Date.now() - ts) / 86400000;
      if (ageDays < days) { skipped.push({ id, reason: `age ${Math.round(ageDays)}d < ${days}d` }); continue; }
    }
    candidates.push(id);
  }
  return { t2, t3, candidates, skipped };
}

// MOVE-ONLY migrations: remove from T2 membership, add to T3 membership, tag T3.
function buildMigrations({ doc, actorId, days }) {
  const { t2, t3, candidates } = findArchiveCandidates({ doc, actorId, days });
  if (!t2 || !t3 || candidates.length === 0) return [];
  const migrations = [];
  const archivedAt = new Date().toISOString();
  for (const id of candidates) {
    migrations.push({
      type: 'updateView',
      view_id: t2.view_id,
      patch: { included_elements: (t2.included_elements || []).filter(x => x !== id) },
    });
    migrations.push({
      type: 'updateView',
      view_id: t3.view_id,
      patch: { included_elements: [...(t3.included_elements || []), id] },
    });
    migrations.push({
      type: 'updateElement',
      id,
      patch: {
        attributes: [
          { name: 'memoryTier', value: 'T3' },
          { name: 'archivedAt', value: archivedAt },
        ],
      },
    });
  }
  return migrations;
}

// Apply the migrations (default via in-process ARGO MCP; injectable for tests).
async function archiveMemory({ workspaceRoot, actorId, days = 30, applyMutation }) {
  const root = workspaceRoot || path.resolve(__dirname, '..');
  const doc = readGraph(path.join(root, 'design', 'KG', 'SystemArchitecture.json'));
  const migrations = buildMigrations({ doc, actorId, days });
  const apply = applyMutation || (async (mutations) => {
    const { callTool } = require('./argo-mcp-server.js');
    return callTool('applySystemArchitectureMutation', { mutations }, null, undefined);
  });
  if (migrations.length > 0) {
    await apply(migrations);
  }
  return { actorId, archived: (migrations.length / 3), migrations: migrations.length };
}

async function main() {
  const actorId = process.argv[2];
  if (!actorId) {
    console.error('usage: node scripts/memory-archive.js <actorId> --check|--apply [--days 30]');
    process.exit(1);
  }
  const workspaceRoot = process.env.ARGO_REPO_ROOT || path.resolve(__dirname, '..');
  const daysIdx = process.argv.indexOf('--days');
  const days = daysIdx >= 0 ? Number(process.argv[daysIdx + 1]) || 30 : 30;
  const doc = readGraph(path.join(workspaceRoot, 'design', 'KG', 'SystemArchitecture.json'));
  const { t2, t3, candidates, skipped } = findArchiveCandidates({ doc, actorId, days });
  console.log(JSON.stringify({
    actorId,
    t2: t2 ? t2.view_id : null,
    t3: t3 ? t3.view_id : null,
    days,
    candidates,
    skipped,
  }, null, 2));
  if (process.argv.includes('--apply')) {
    const r = await archiveMemory({ workspaceRoot, actorId, days });
    console.log(JSON.stringify(r, null, 2));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  readGraph,
  findArchiveCandidates,
  buildMigrations,
  archiveMemory,
};
