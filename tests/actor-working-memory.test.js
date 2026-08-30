'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const mod = require('../scripts/actor-working-memory.js');

// External-view acceptance tests for the ACTOR working-memory (T1) mechanism:
// the T1 summary element is read as the session-start digest, and writes are an
// IDEMPOTENT OVERWRITE (never append). Reads are against the real graph
// (read-only); the write path is exercised with an injected fake applyMutation so
// the production graph is never mutated by a test.

test('AT working-memory: the T1 summary element resolves for the overseer actor', () => {
  // GIVEN the three-tier view conventions realized in the graph
  const doc = mod.readGraph(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'));
  // WHEN resolving the T1 working-memory element of the overseer actor
  const t1 = mod.resolveT1Element(doc, 'project-overseer-001');
  // THEN it is the idempotent summary element in overseer-wm-001
  assert.ok(t1, 'must resolve a T1 element');
  assert.equal(t1.id, 'overseer-wm-summary-001');
  assert.equal(t1.type, 'Business Object');
  const tiers = (t1.attributes || []).filter(a => a.name === 'memoryTier').map(a => a.value);
  assert.ok(tiers.includes('T1'), 'T1 element must carry memoryTier=T1');
});

test('AT working-memory: the digest content is structured and compact', () => {
  // GIVEN structured summary inputs
  // WHEN building the digest content
  const digest = mod.buildDigestContent({
    actorName: '项目总管',
    goal: '三层记忆落地',
    progress: ['Phase 1 规则完成', 'Phase 2 视图落地'],
    decisions: ['会话摘要幂等覆盖'],
    todos: ['Phase 3'],
    lessons: ['里程碑即写兜底'],
    hooks: ['继续 Phase 3'],
  });
  // THEN it includes each section and stays compact (truncation caps at max)
  assert.match(digest, /工作记忆/);
  assert.match(digest, /当前目标/);
  assert.match(digest, /本次进展/);
  assert.match(digest, /未完成\/TODO/);
  assert.match(digest, /经验教训/);
  assert.match(digest, /会话钩子/);
  const long = 'x'.repeat(1000);
  assert.equal(mod.truncateDescription(long, 800).length, 801); // 800 + ellipsis
  assert.ok(mod.truncateDescription(long, 800).endsWith('…'));
});

test('AT working-memory: load returns the T1 digest + recent compact cards from T2 (read-only)', () => {
  // GIVEN the overseer actor with T1 + T2 views
  // WHEN loading the working-memory digest
  const result = mod.loadWorkingMemoryDigest({ workspaceRoot: ROOT, actorId: 'project-overseer-001', recentN: 3 });
  // THEN it returns the T1 summary element digest and recent cards from the T2 LTM view
  assert.equal(result.actorId, 'project-overseer-001');
  assert.ok(result.t1Element && result.t1Element.id === 'overseer-wm-summary-001', 'must include the T1 summary element');
  assert.ok(result.t2View && /-ltm-/.test(result.t2View.view_id), 'must include the T2 LTM view');
  assert.ok(Array.isArray(result.recentCards) && result.recentCards.length >= 1, 'must include recent T2 cards');
  for (const card of result.recentCards) {
    assert.ok(card.id && card.name, 'each card carries id + name');
    assert.ok(typeof card.description === 'string', 'each card carries a compact description');
  }
});

test('AT working-memory: write is an idempotent overwrite (never append)', async () => {
  // GIVEN a fake applyMutation that records the updateElement mutation (no graph write)
  const applied = [];
  const fakeApply = async (mutation) => { applied.push(mutation); return { status: 'passed' }; };
  // WHEN writing the working-memory summary twice with the same content
  await mod.writeWorkingMemory({
    workspaceRoot: ROOT,
    actorId: 'project-overseer-001',
    summary: '当前摘要内容',
    timestamp: '2026-08-30T00:00:00.000Z',
    applyMutation: fakeApply,
  });
  await mod.writeWorkingMemory({
    workspaceRoot: ROOT,
    actorId: 'project-overseer-001',
    summary: '当前摘要内容',
    timestamp: '2026-08-30T00:00:00.000Z',
    applyMutation: fakeApply,
  });
  // THEN each write produces a single updateElement overwriting the T1 description (no append, no duplicate ledger)
  assert.equal(applied.length, 2);
  for (const m of applied) {
    assert.equal(m.type, 'updateElement');
    assert.equal(m.id, 'overseer-wm-summary-001');
    assert.equal(m.patch.description, '当前摘要内容');
    const statuses = (m.patch.attributes || []).filter(a => a.name === 'status');
    assert.ok(statuses.some(a => a.value === 'ACTIVE'), 'keeps status ACTIVE');
  }
});
