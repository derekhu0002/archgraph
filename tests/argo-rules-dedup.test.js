'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rulesPath = path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md');

function readRules() {
  return fs.readFileSync(rulesPath, 'utf8');
}

// AT-rules-03
test('archgraph-rules-document-graph-deduplication', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  // THEN it documents the GraphDeduplication section
  const section = rules.match(/<GraphDeduplication>([\s\S]*?)<\/GraphDeduplication>/);
  assert.ok(section, 'GraphDeduplication section must exist');
  // AND it defines the deterministic natural keys
  assert.match(section[1], /natural key/i);
  assert.match(section[1], /element:\s*\(type, normalizedName\)/);
  assert.match(section[1], /relationship:\s*\(source_id, type, target_id, normalizedName\)/);
  assert.match(section[1], /view:\s*\(parent_element_id, normalizedViewName\)/);
  // AND it declares the three onConflict policies
  assert.match(section[1], /`fail`/);
  assert.match(section[1], /`reuse`/);
  assert.match(section[1], /`allowDuplicate`/);
  // AND it keeps semantic similarity advisory only (never a rejection)
  assert.match(section[1], /ADVISORY ONLY/);
  assert.match(section[1], /MUST NOT reject/);
  // AND it exempts update* operations
  assert.match(section[1], /never gated/);
});

test('archgraph-rules-graph-deduplication-core-rule', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  const coreRules = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(coreRules, 'CoreRules section must exist');
  // THEN the CoreRules section references the dedup gate as a red line
  assert.match(coreRules[1], /GraphDeduplication/);
  assert.match(coreRules[1], /deduplicated at the tool boundary/);
});
