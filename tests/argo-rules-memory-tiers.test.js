'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RULES = path.join(ROOT, 'argo', 'rules', 'archgraph.instructions.md');

// External-view acceptance tests for the SessionMemorySummarization /
// MemoryTriggerTiming rules update (ACTOR three-tier memory model, Phase 1):
// milestone immediate writes are the reliable backbone; the session summary is
// opportunistic + idempotent (overwrite, never append) and MUST NOT rely on the
// LLM precisely detecting session end.

test('AT rules: SessionMemorySummarization makes milestone immediate writes the reliable backbone', () => {
  // GIVEN the workflow rules' long-term memory capture section
  const rules = fs.readFileSync(RULES, 'utf8');
  // THEN it declares milestone immediate writes as the reliable backbone
  assert.match(rules, /Milestone immediate writes are the RELIABLE BACKBONE/, 'must declare milestone writes as backbone');
  assert.match(rules, /<MemoryTriggerTiming>/, 'must reference MemoryTriggerTiming');
  assert.match(rules, /Never defer critical content/, 'must not defer critical content to session end');
});

test('AT rules: the session summary is opportunistic + idempotent, not dependent on detecting session end', () => {
  const rules = fs.readFileSync(RULES, 'utf8');
  // THEN it must not rely on precisely detecting session end
  assert.match(rules, /MUST NOT rely on precisely detecting when a session ends/, 'must not depend on session-end detection');
  // AND it is written by overwriting the single T1 element, never appending
  assert.match(rules, /OVERWRITING that single element \(never append\)/, 'session summary must overwrite, never append');
  assert.match(rules, /write amplification stays bounded/, 'must keep write amplification bounded');
  // AND it is triggered by explicit signal or natural turn-end
  assert.match(rules, /explicitly signals wrap-up/, 'explicit signal trigger');
  assert.match(rules, /turn is ending naturally/, 'opportunistic turn-end trigger');
});

test('AT rules: the three-tier memory model is present (T1/T2/T3)', () => {
  const rules = fs.readFileSync(RULES, 'utf8');
  // THEN the rules declare the three-tier model
  assert.match(rules, /T1 working memory/, 'must mention T1 working memory');
  assert.match(rules, /T2 long-term memory/, 'must mention T2 long-term memory');
  assert.match(rules, /T3 archive/, 'must mention T3 archive');
  // AND MemoryTriggerTiming is framed as the immediate, reliable backbone (not "in addition to session end")
  assert.match(rules, /primarily triggered IMMEDIATELY/, 'MemoryTriggerTiming must be the immediate backbone');
});

test('AT rules: WakeupGuideline STEP 0 loads only T1 working memory (T2/T3 on demand)', () => {
  const rules = fs.readFileSync(RULES, 'utf8');
  // THEN STEP 0 loads only the T1 working-memory digest
  assert.match(rules, /load ONLY the T1 working-memory digest/, 'STEP 0 must load only the T1 digest');
  assert.match(rules, /Do NOT bulk-load the T2 long-term memory or T3 archive/, 'must not bulk-load T2/T3');
  // AND recall is on demand via semantic memory_search
  assert.match(rules, /recall them on demand/, 'must recall on demand');
  assert.match(rules, /memory_search/, 'must reference memory_search recall');
  // AND the T2 hierarchy is a recall target, not a bulk context load
  assert.match(rules, /recall target, not as a bulk context load/, 'T2 is a recall target');
});

test('AT rules: MemoryRecallGuideline mandates two-step recall + loose/strict threshold layering', () => {
  const rules = fs.readFileSync(RULES, 'utf8');
  // THEN the framework rules declare the two-step recall (locate then full content)
  assert.match(rules, /MemoryRecallGuideline/, 'must have a MemoryRecallGuideline section');
  assert.match(rules, /TWO steps/, 'must mandate two-step recall');
  assert.match(rules, /memory_search/, 'must reference memory_search (locate)');
  assert.match(rules, /getIntentElementContext/, 'must reference full-content retrieval');
  assert.match(rules, /compact card is a LOCATOR/, 'card is a locator, never the full memory');
  // AND threshold layering: loose recall (0.55) / strict audit (0.8), reject only on zero hits
  assert.match(rules, /LOOSE memory threshold/, 'must declare a loose memory threshold');
  assert.match(rules, /0\.55/, 'must mention the loose memory threshold default');
  assert.match(rules, /0\.8/, 'must mention the strict audit threshold');
  assert.match(rules, /Reject only when there are ZERO/, 'must reject only on zero/irrelevant hits');
});

test('AT rules: MemoryTierConventions operate the tiers directly from the always-loaded rule (no skill)', () => {
  const rules = fs.readFileSync(RULES, 'utf8');
  // THEN the rule declares the three sub-view conventions and memoryTier attribute
  assert.match(rules, /MemoryTierConventions/, 'must have a MemoryTierConventions section');
  assert.match(rules, /<actor>-wm-001/, 'must declare the T1 working-memory view convention');
  assert.match(rules, /<actor>-ltm-001/, 'must declare the T2 LTM view convention');
  assert.match(rules, /<actor>-archive-001/, 'must declare the T3 archive view convention');
  assert.match(rules, /memoryTier/, 'must declare the memoryTier attribute convention');
  // AND the T1 summary is idempotent overwrite, archive is move-only
  assert.match(rules, /OVERWRITE its description \(never append\)/, 'T1 summary must overwrite, never append');
  assert.match(rules, /Never delete archived memories/, 'archive must be move-only');
});
