'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const mod = require('../scripts/memory-archive.js');

// External-view acceptance tests for the memory archive migration (T2 -> T3):
// delivered/COMPLETED + age gate selects candidates; migration is MOVE-ONLY
// (never delete) — remove from T2 membership, add to T3, tag memoryTier=T3.
// Uses a synthetic in-memory document + fake apply, so the production graph is
// never touched.

function syntheticDoc() {
  const old = new Date(Date.now() - 90 * 86400000).toISOString(); // 90 days ago
  return {
    elements: [
      { id: 'm1', name: '旧里程碑', type: 'Business Object', attributes: [{ name: 'deliveryStatus', value: 'delivered' }, { name: 'lastSummaryAt', value: old }] },
      { id: 'm2', name: '无日期', type: 'Business Object', attributes: [{ name: 'deliveryStatus', value: 'delivered' }] },
      { id: 'm3', name: '未交付', type: 'Business Object', attributes: [{ name: 'status', value: 'IN_PROGRESS' }] },
      { id: 'm4', name: '新完成', type: 'Business Object', attributes: [{ name: 'status', value: 'COMPLETED' }, { name: 'lastSummaryAt', value: new Date().toISOString() }] },
    ],
    views: [
      { view_id: 'a-ltm-001', view_name: 'A LTM', parent_element_id: 'actor-a', included_elements: ['m1', 'm2', 'm3', 'm4'], included_relationships: [] },
      { view_id: 'a-archive-001', view_name: 'A Archive', parent_element_id: 'actor-a', included_elements: [], included_relationships: [] },
    ],
  };
}

test('AT memory-archive: candidates are delivered/COMPLETED AND older than the age gate', () => {
  // GIVEN a synthetic T2 LTM with delivered/undated/unfinished/new memories
  const doc = syntheticDoc();
  // WHEN selecting archive candidates with a 30-day age gate
  const { candidates, skipped } = mod.findArchiveCandidates({ doc, actorId: 'actor-a', days: 30 });
  // THEN only the delivered AND old element is a candidate
  assert.deepEqual(candidates, ['m1']);
  const reasons = skipped.map(s => s.id);
  assert.ok(reasons.includes('m2'), 'undated delivered memory is skipped (no age gate)');
  assert.ok(reasons.includes('m3'), 'not-delivered memory is skipped');
  assert.ok(reasons.includes('m4'), 'recent memory is skipped (age < gate)');
});

test('AT memory-archive: migration is MOVE-ONLY and tags memoryTier=T3', () => {
  // GIVEN the same synthetic document
  const doc = syntheticDoc();
  // WHEN building migrations
  const migrations = mod.buildMigrations({ doc, actorId: 'actor-a', days: 30 });
  // THEN each candidate yields exactly 3 migrations (remove from T2 / add to T3 / tag)
  assert.equal(migrations.length, 3);
  const types = migrations.map(m => m.type);
  assert.deepEqual(types, ['updateView', 'updateView', 'updateElement']);
  assert.ok(!migrations.some(m => m.type === 'removeElement'), 'must never delete the element (only-move)');
  // AND T2 membership drops the candidate, T3 gains it, element gets memoryTier=T3 + archivedAt
  assert.ok(migrations[0].patch.included_elements.includes('m2') && !migrations[0].patch.included_elements.includes('m1'));
  assert.ok(migrations[1].patch.included_elements.includes('m1'));
  assert.equal(migrations[2].patch.attributes.find(a => a.name === 'memoryTier').value, 'T3');
  assert.ok(migrations[2].patch.attributes.some(a => a.name === 'archivedAt' && a.value));
});

test('AT memory-archive: archiveMemory is safe by default (undated milestones are never auto-archived)', async () => {
  // GIVEN a fake apply that would record any mutation
  const applied = [];
  const fakeApply = async (mutations) => { applied.push(...mutations); return { status: 'passed' }; };
  // WHEN archiving the real overseer actor with the default 30-day gate
  const path = require('node:path');
  const r = await mod.archiveMemory({ workspaceRoot: path.resolve(__dirname, '..'), actorId: 'project-overseer-001', days: 30, applyMutation: fakeApply });
  // THEN the real undated milestones are skipped -> zero migrations, no write
  assert.equal(r.archived, 0);
  assert.equal(r.migrations, 0);
  assert.equal(applied.length, 0, 'safe default must not write');
});
