'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSemanticRecordText,
} = require('../argo/scripts/graph-rag/semanticRecordText.js');

const ROOT = path.resolve(__dirname, '..');

// AT-semantic-text-01..04: the vector index MUST encode only human-meaningful
// fields (no ids, endpoint ids, view member-id arrays, or JSON syntax).
test('AT-semantic-text-01: element text keeps type/name/alias/description/attributes/testcase intents', () => {
  const element = {
    id: 'e-123',
    name: 'Widget Handler',
    type: 'Application Component',
    alias: 'WH',
    parent: 'p-9',
    description: 'Handles widgets end to end.',
    attributes: [
      { name: 'owner', value: 'team-a', description: 'team owning it' },
      { name: 'note', description: 'secondary note' },
    ],
    subdiagram_views: [{ view_id: 'v-1', view_name: 'V' }],
    testcases: [{ name: 'AT-1', description: 'GIVEN a widget WHEN handled THEN ok', Input: 'tests/x.test.js', acceptanceCriteria: 'tests/x.test.js' }],
  };
  const text = buildSemanticRecordText('Element', element);
  for (const kept of ['Application Component', 'Widget Handler', 'WH', 'Handles widgets end to end.', 'owner: team-a', 'note: secondary note', 'GIVEN a widget WHEN handled THEN ok']) {
    assert.ok(text.includes(kept), `must include: ${kept}`);
  }
  for (const dropped of ['e-123', 'p-9', 'v-1', 'tests/x.test.js', 'AT-1']) {
    assert.ok(!text.includes(dropped), `must NOT encode id/path: ${dropped}`);
  }
  assert.ok(!/[{}[\]]/.test(text), 'must not contain JSON structural punctuation');
  assert.ok(!text.includes('"'), 'must not contain JSON quotes');
});

test('AT-semantic-text-02: relationship text keeps statement/name/description/document/attributes, drops endpoints', () => {
  const relationship = {
    id: 'r-7',
    statement: 'A --(Flow)--> B',
    name: 'Flow',
    type: 'Flow',
    description: 'flows from A to B',
    document: 'flow doc',
    attributes: [{ name: 'weight', description: 'w' }],
    source_id: 'a-1',
    target_id: 'b-2',
    source_name: 'A',
    target_name: 'B',
  };
  const text = buildSemanticRecordText('ArchitectureRelationship', relationship);
  for (const kept of ['A --(Flow)--> B', 'Flow', 'flows from A to B', 'flow doc', 'weight: w']) {
    assert.ok(text.includes(kept), `must include: ${kept}`);
  }
  for (const dropped of ['r-7', 'a-1', 'b-2']) {
    assert.ok(!text.includes(dropped), `must NOT encode id: ${dropped}`);
  }
});

test('AT-semantic-text-03: view text keeps view_name/description, drops view id and member-id arrays', () => {
  const view = {
    view_id: 'v-55',
    view_name: 'Harness',
    parent_element_id: '1961',
    description: 'the harness view',
    included_elements: ['e-1', 'e-2'],
    included_relationships: ['r-1'],
  };
  const text = buildSemanticRecordText('View', view);
  assert.ok(text.includes('Harness'));
  assert.ok(text.includes('the harness view'));
  for (const dropped of ['v-55', '1961', 'e-1', 'e-2', 'r-1']) {
    assert.ok(!text.includes(dropped), `must NOT encode id: ${dropped}`);
  }
});

test('AT-semantic-text-04: missing/blank fields degrade without throwing', () => {
  assert.equal(buildSemanticRecordText('Element', undefined), '');
  assert.equal(buildSemanticRecordText('View', {}), '');
  assert.equal(buildSemanticRecordText('ArchitectureRelationship', { id: 'r-1' }), '');
});

// AT-semantic-text-05: both embedding paths (full backfill + incremental
// lifecycle) MUST embed through the single curated composer, never the raw
// canonical object.
test('AT-semantic-text-05: backfill and incremental lifecycle embed curated text (no raw JSON object)', () => {
  const server = fs.readFileSync(path.join(ROOT, 'argo/scripts/systemarchitecture-mcp-server.js'), 'utf8');
  assert.match(server, /buildSemanticRecordText\(record\.channel, record\.canonicalObject\)/);
  assert.doesNotMatch(server, /JSON\.stringify\(record\.canonicalObject\)/);

  const lifecycle = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/mutationEmbeddingVectorLifecycle.js'), 'utf8');
  assert.match(lifecycle, /buildSemanticRecordText\(definition\.channel, object\)/);

  const backfill = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/semantic-persistence/productionSemanticBackfill.js'), 'utf8');
  assert.match(backfill, /\.update\(buildSemanticRecordText\(record\.channel, record\.canonicalObject\)\)/);
  assert.doesNotMatch(backfill, /JSON\.stringify\(record\.canonicalObject\)/);
});
