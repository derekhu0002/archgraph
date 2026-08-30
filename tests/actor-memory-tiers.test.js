'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'actor-memory-tiers.md');
const GRAPH = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));

// External-view acceptance tests for the ACTOR three-tier memory model design:
// T1 working memory (loaded into context) / T2 recallable LTM / T3 archive. The
// design solves the real constraint that an actor's full memory cannot all fit
// in context — and that session-end capture must NOT rely on the LLM precisely
// detecting session end (milestone immediate writes are the reliable backbone).

test('AT actor-memory-tiers: design doc exists and defines the three tiers', () => {
  // GIVEN the three-tier memory model design document
  const doc = fs.readFileSync(DOC, 'utf8');
  // THEN it declares the three tiers (working / long-term / archive) with the view convention
  assert.match(doc, /T1 工作记忆/, 'must define working memory tier');
  assert.match(doc, /T2 长期记忆/, 'must define long-term memory tier');
  assert.match(doc, /T3 档案/, 'must define archive tier');
  assert.match(doc, /wm-001/, 'must define <actor>-wm-001 working-memory view convention');
  assert.match(doc, /ltm-001/, 'must define <actor>-ltm-001 LTM view convention');
  assert.match(doc, /archive-001/, 'must define <actor>-archive-001 archive view convention');
  // AND it addresses the context constraint and the memory-search two-step recall
  assert.match(doc, /撑爆上下文/, 'must address the context-overflow constraint');
  assert.match(doc, /memory_search/, 'must reference semantic recall (memory_search)');
});

test('AT actor-memory-tiers: session-end capture does not rely on LLM session-end detection', () => {
  // GIVEN the design document's session-capture strategy
  const doc = fs.readFileSync(DOC, 'utf8');
  // THEN it mandates milestone immediate writes as the reliable backbone
  assert.match(doc, /里程碑即时写入/, 'milestone immediate writes are the reliable backbone');
  assert.match(doc, /MemoryTriggerTiming/, 'must reference MemoryTriggerTiming');
  // AND the session summary is idempotent (overwrite the same T1 element, never append)
  assert.match(doc, /幂等覆盖/, 'session summary must be idempotent overwrite');
  assert.match(doc, /不追加/, 'must not append');
});

test('AT actor-memory-tiers: the Principle is registered in the intent graph under the overseer LTM', () => {
  // GIVEN the three-tier memory model Principle
  const element = (GRAPH.elements || []).find(e => e.id === 'overseer-memory-tiers-001');
  // THEN it exists as a Principle with the three-tier summary in its description
  assert.ok(element, 'overseer-memory-tiers-001 must exist in the graph');
  assert.equal(element.type, 'Principle');
  assert.match(element.description || '', /T1 工作记忆/, 'description must mention T1 working memory');
  assert.match(element.description || '', /T3 档案/, 'description must mention T3 archive');
  // AND it is mounted under the overseer long-term memory view
  const view = (GRAPH.views || []).find(v => v.view_id === 'overseer-ltm-001');
  assert.ok(view && Array.isArray(view.included_elements) && view.included_elements.includes('overseer-memory-tiers-001'),
    'must be a member of overseer-ltm-001');
});

test('AT actor-memory-tiers: T1 working-memory and T3 archive views are realized under the actor', () => {
  // GIVEN the three-tier view conventions are realized for the overseer actor
  const wm = (GRAPH.views || []).find(v => v.view_id === 'overseer-wm-001');
  const archive = (GRAPH.views || []).find(v => v.view_id === 'overseer-archive-001');
  // THEN T1 and T3 views exist mounted under project-overseer-001
  assert.ok(wm, 'overseer-wm-001 (T1) must exist');
  assert.equal(wm.parent_element_id, 'project-overseer-001');
  assert.ok(archive, 'overseer-archive-001 (T3) must exist');
  assert.equal(archive.parent_element_id, 'project-overseer-001');
  // AND the T1 summary element carries the memoryTier=T1 convention
  const summary = (GRAPH.elements || []).find(e => e.id === 'overseer-wm-summary-001');
  assert.ok(summary, 'T1 summary element must exist');
  const tiers = (summary.attributes || []).filter(a => a.name === 'memoryTier').map(a => a.value);
  assert.ok(tiers.includes('T1'), 'summary must carry memoryTier=T1');
  // AND it is a member of the T1 view
  const wmMembers = (wm && wm.included_elements) || [];
  assert.ok(wmMembers.includes('overseer-wm-summary-001'), 'summary must be in overseer-wm-001');
});
