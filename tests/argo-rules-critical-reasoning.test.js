'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rulesPath = path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md');

function readRules() {
  return fs.readFileSync(rulesPath, 'utf8');
}

test('archgraph-rules-document-critical-reasoning', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  // THEN it documents the CriticalReasoningGuideline section
  const section = rules.match(/<CriticalReasoningGuideline>([\s\S]*?)<\/CriticalReasoningGuideline>/);
  assert.ok(section, 'CriticalReasoningGuideline section must exist');
  // AND it names all three evidence sources the agent must use to challenge the human
  assert.match(section[1], /native model knowledge/);
  assert.match(section[1], /repository/);
  assert.match(section[1], /intent graph/);
  // AND it requires evidence-based challenge rather than agreement by default
  assert.match(section[1], /evidence/);
  assert.match(section[1], /[Cc]hallenge/);
  assert.match(section[1], /falsifiable/);
  // AND it explicitly names sycophancy as a defect
  assert.match(section[1], /sycophantic|Sycophancy|sycophancy/);
  // AND it separates facts (evidence-decided) from human preferences
  assert.match(section[1], /preferences/);
  // AND it forbids silently complying with an unsound request
  assert.match(section[1], /silently comply/);
});

test('archgraph-rules-document-critical-reasoning-core-rule', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  const coreRules = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(coreRules, 'CoreRules section must exist');
  // THEN the CoreRules section references the critical-reasoning guideline as a red line
  assert.match(coreRules[1], /CriticalReasoningGuideline/);
  // AND it forbids agreeing by default and silent compliance
  assert.match(coreRules[1], /agreeing by default/);
  assert.match(coreRules[1], /silently comply/);
});
