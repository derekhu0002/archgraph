#!/usr/bin/env node
'use strict';
/**
 * ACTOR working-memory (T1) read/write helpers + CLI.
 *
 * Three-tier memory model (see docs/actor-memory-tiers.md):
 *   T1 working memory  -> <actor>-wm-001 view, holds the idempotent summary element
 *   T2 long-term       -> <actor>-ltm-001 view, recall on demand (compact cards)
 *   T3 archive         -> <actor>-archive-001 view, explicit retrieval
 *
 * This module provides:
 *   - READ  loadWorkingMemoryDigest(): T1 digest + recent N compact cards from T2
 *   - WRITE writeWorkingMemory(): idempotent OVERWRITE of the T1 summary element
 *     description (never append) — write amplification stays bounded.
 *
 * Usage:
 *   node scripts/actor-working-memory.js <actorId>                     # read digest
 *   node scripts/actor-working-memory.js <actorId> --write "<summary>" # idempotent write
 *   ARGO_REPO_ROOT overrides the workspace root (default: repo root).
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_DESC_LEN = 800;

function readGraph(graphPath) {
  return JSON.parse(fs.readFileSync(graphPath, 'utf8'));
}

// Compact-card truncation (same style as memory_search's max_desc_len).
function truncateDescription(text, maxLen = DEFAULT_MAX_DESC_LEN) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

// The actor's T1 working-memory view is <actor>-wm-001; its summary element is
// the (single) member, conventionally named <actor>-wm-summary-<nnn>.
function resolveT1Element(document, actorId) {
  const view = (document.views || []).find(v => v.parent_element_id === actorId && /-wm-/.test(v.view_id));
  if (!view) return null;
  const memberIds = view.included_elements || [];
  return (document.elements || []).find(e => memberIds.includes(e.id)) || null;
}

// The actor's T2 long-term memory view is <actor>-ltm-001.
function resolveT2View(document, actorId) {
  return (document.views || []).find(v => v.parent_element_id === actorId && /-ltm-/.test(v.view_id)) || null;
}

// Structured digest content (idempotently overwrites the T1 element description).
function buildDigestContent({ actorName, goal, progress = [], decisions = [], todos = [], lessons = [], hooks = [] }) {
  const lines = [];
  if (actorName) lines.push(`# ${actorName} 工作记忆`);
  if (goal) lines.push(`- 当前目标：${goal}`);
  if (progress.length) lines.push(`- 本次进展：${progress.join('；')}`);
  if (decisions.length) lines.push(`- 关键决策：${decisions.join('；')}`);
  if (todos.length) lines.push(`- 未完成/TODO：${todos.join('；')}`);
  if (lessons.length) lines.push(`- 经验教训：${lessons.join('；')}`);
  if (hooks.length) lines.push(`- 会话钩子：${hooks.join('；')}`);
  return lines.join('\n');
}

// READ-ONLY: T1 digest + recent N compact cards from the T2 LTM view.
function loadWorkingMemoryDigest({ workspaceRoot, actorId, recentN = 5, graphPath }) {
  const root = workspaceRoot || path.resolve(__dirname, '..');
  const doc = readGraph(graphPath || path.join(root, 'design', 'KG', 'SystemArchitecture.json'));
  const t1 = resolveT1Element(doc, actorId);
  const t2 = resolveT2View(doc, actorId);
  const cards = [];
  if (t2) {
    for (const id of t2.included_elements || []) {
      const el = (doc.elements || []).find(e => e.id === id);
      if (el) cards.push({ id: el.id, name: el.name, type: el.type, description: truncateDescription(el.description) });
    }
  }
  return {
    actorId,
    t1Element: t1 ? { id: t1.id, name: t1.name, digest: t1.description } : null,
    t2View: t2 ? { view_id: t2.view_id, view_name: t2.view_name, memberCount: (t2.included_elements || []).length } : null,
    recentCards: cards.slice(0, recentN),
  };
}

// WRITE: idempotent OVERWRITE of the T1 summary element's description (never
// append). The default applyMutation routes through in-process ARGO MCP
// (applySystemArchitectureMutation). Inject a fake apply in tests to avoid
// touching the production graph.
async function writeWorkingMemory({ workspaceRoot, actorId, summary, timestamp, applyMutation }) {
  const root = workspaceRoot || path.resolve(__dirname, '..');
  const doc = readGraph(path.join(root, 'design', 'KG', 'SystemArchitecture.json'));
  const t1 = resolveT1Element(doc, actorId);
  if (!t1) throw new Error(`No T1 working-memory element found for actor ${actorId}`);
  const mutation = {
    type: 'updateElement',
    id: t1.id,
    patch: {
      description: summary,
      attributes: [
        { name: 'status', value: 'ACTIVE' },
        { name: 'lastSummaryAt', value: timestamp || new Date().toISOString() },
      ],
    },
  };
  const apply = applyMutation || (async (m) => {
    const { callTool } = require('./argo-mcp-server.js');
    return callTool('applySystemArchitectureMutation', { mutations: [m] }, null, undefined);
  });
  await apply(mutation);
  return { actorId, elementId: t1.id, applied: true };
}

async function main() {
  const actorId = process.argv[2];
  if (!actorId) {
    console.error('usage: node scripts/actor-working-memory.js <actorId> [--write "<summary>"]');
    process.exit(1);
  }
  const workspaceRoot = process.env.ARGO_REPO_ROOT || path.resolve(__dirname, '..');
  const writeIdx = process.argv.indexOf('--write');
  if (writeIdx >= 0) {
    const summary = process.argv[writeIdx + 1];
    const r = await writeWorkingMemory({ workspaceRoot, actorId, summary });
    console.log(JSON.stringify(r, null, 2));
  } else {
    const r = loadWorkingMemoryDigest({ workspaceRoot, actorId });
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
  truncateDescription,
  resolveT1Element,
  resolveT2View,
  buildDigestContent,
  loadWorkingMemoryDigest,
  writeWorkingMemory,
};
