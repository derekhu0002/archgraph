'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rulesPath = path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md');

function readRules() {
  return fs.readFileSync(rulesPath, 'utf8');
}

test('archgraph-rules-document-change-tier-gate', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  // THEN it documents the ChangeTierGate section with three tiers
  assert.match(rules, /ChangeTierGate/);
  assert.match(rules, /Tier 1/);
  assert.match(rules, /行为无关/);
  assert.match(rules, /Tier 2/);
  assert.match(rules, /Tier 3/);
  assert.match(rules, /跳过验收回归/);
  // AND the CoreRules section references the tier gate
  const coreRules = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(coreRules, 'CoreRules section must exist');
  assert.match(coreRules[1], /ChangeTierGate/);
});

test('archgraph-rules-document-change-tier-safety-net', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  const gate = rules.match(/<ChangeTierGate>([\s\S]*?)<\/ChangeTierGate>/);
  assert.ok(gate, 'ChangeTierGate section must exist');
  // THEN it requires git diff verification with escalation on scope breach
  assert.match(gate[1], /git diff/);
  assert.match(gate[1], /升为 Tier 2/);
  // AND it keeps full validation when the canonical graph is touched
  assert.match(gate[1], /KG 触线/);
  // AND it defaults uncertain classifications up (fail-safe)
  assert.match(gate[1], /零歧义/);
  assert.match(gate[1], /fail-safe/);
});
