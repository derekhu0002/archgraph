'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'agent-programming-language.md');

test('apl-spec: document exists and defines the vocabulary and syntax', () => {
  // GIVEN the repository keeps a graph-based memory system over ArchiMate 3.2
  // WHEN a reader opens docs/agent-programming-language.md
  // THEN the document exists and defines the Agent programming vocabulary and syntax
  assert.ok(existsSync(DOC_PATH), 'docs/agent-programming-language.md should exist');
  const doc = readFileSync(DOC_PATH, 'utf8');
  assert.match(doc, /词汇/, 'document should define the vocabulary');
  assert.match(doc, /语法/, 'document should define the syntax');
  assert.match(doc, /testcases|验收/, 'document should define acceptance assertions');
  assert.match(doc, /持久化/, 'document should describe persistent elements');
  assert.match(doc, /运行时/, 'document should describe runtime instances');
});

test('apl-spec: vocabulary maps core element types to programming concepts', () => {
  // GIVEN the vocabulary table is written in the spec
  // WHEN a reader inspects the element-type mapping
  // THEN core element types are mapped to programming concepts
  const doc = readFileSync(DOC_PATH, 'utf8');
  for (const keyword of [
    'Work Package',
    'Business Actor',
    'Business Process',
    'Course of Action',
    'Constraint',
    'Principle',
    'Business Role',
    'Skill',
    'Capability',
  ]) {
    assert.ok(doc.includes(keyword), `document should map "${keyword}"`);
  }
});

test('apl-spec: syntax maps relationship types to grammar semantics', () => {
  // GIVEN the syntax table is written in the spec
  // WHEN a reader inspects the relationship-type mapping
  // THEN control-flow and structural relationships are mapped to grammar semantics
  const doc = readFileSync(DOC_PATH, 'utf8');
  for (const keyword of [
    'Triggering',
    'Flow',
    'Assignment',
    'Association',
    'Realization',
    'Composition',
    'Access',
  ]) {
    assert.ok(doc.includes(keyword), `document should map "${keyword}"`);
  }
});
