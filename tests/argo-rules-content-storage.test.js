'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rulesPath = path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md');

function readRules() {
  return fs.readFileSync(rulesPath, 'utf8');
}

test('archgraph-rules-document-content-storage-policy', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  // THEN it documents the ContentStoragePolicy section
  const section = rules.match(/<ContentStoragePolicy>([\s\S]*?)<\/ContentStoragePolicy>/);
  assert.ok(section, 'ContentStoragePolicy section must exist');
  // AND it mandates KG-first document storage
  assert.match(section[1], /KG-first document storage/);
  assert.match(section[1], /ALL document content MUST/);
  // AND it allows repository-only content (videos/binaries) but requires a KG summary
  assert.match(section[1], /videos/);
  assert.match(section[1], /repository/);
  assert.match(section[1], /summar/);
  // AND it makes the KG the source of truth for document content
  assert.match(section[1], /source of truth/);
});

test('archgraph-rules-document-content-storage-core-rule', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  const coreRules = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(coreRules, 'CoreRules section must exist');
  // THEN the CoreRules section references the content storage policy as a red line
  assert.match(coreRules[1], /ContentStoragePolicy/);
  assert.match(coreRules[1], /KG-first/);
});
