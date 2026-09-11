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
  // AND it tells the Agent to reuse rather than duplicate (behaviour, not tool internals)
  assert.match(section[1], /[Nn]ever add what the graph already has/);
  assert.match(section[1], /reuse/i);
  assert.match(section[1], /onConflict: "reuse"/);
  // AND it tells the Agent what to do when an add is rejected as a duplicate
  assert.match(section[1], /rejected as a duplicate/);
  // AND it requires a justification for an intentional duplicate
  assert.match(section[1], /allowDuplicate/);
  assert.match(section[1], /justification/);
  // AND it treats semantic near-duplicates as advisory only
  assert.match(section[1], /advisory/i);
  assert.match(section[1], /never block/);
  // AND it exempts updates
  assert.match(section[1], /never gated/);
});

test('archgraph-rules-graph-deduplication-core-rule', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  const coreRules = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(coreRules, 'CoreRules section must exist');
  // THEN the CoreRules section references the dedup rule as a red line
  assert.match(coreRules[1], /GraphDeduplication/);
  assert.match(coreRules[1], /Never duplicate/i);
});
