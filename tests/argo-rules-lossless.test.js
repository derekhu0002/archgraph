'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rulesPath = path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md');

function readRules() {
  return fs.readFileSync(rulesPath, 'utf8');
}

test('archgraph-rules-document-lossless-write', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  // THEN it documents the LosslessWrite section
  const section = rules.match(/<LosslessWrite>([\s\S]*?)<\/LosslessWrite>/);
  assert.ok(section, 'LosslessWrite section must exist');
  // AND it requires merge/delta for structured fields (omission preserves)
  assert.match(section[1], /merge/);
  assert.match(section[1], /testcases/);
  assert.match(section[1], /view membership/);
  // AND it guards scalar text via an explicit acknowledgement
  assert.match(section[1], /acknowledgeLoss/);
  assert.match(section[1], /lossJustification/);
  // AND destructive removals are tombstoned for recovery
  assert.match(section[1], /tombstone/);
  // AND the loss report is surfaced on preview and apply
  assert.match(section[1], /lossless/);
});

test('archgraph-rules-document-lossless-write-core-rule', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  const coreRules = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(coreRules, 'CoreRules section must exist');
  // THEN the CoreRules section references the lossless write contract as a red line
  assert.match(coreRules[1], /LosslessWrite/);
  assert.match(coreRules[1], /acknowledgeLoss/);
});
