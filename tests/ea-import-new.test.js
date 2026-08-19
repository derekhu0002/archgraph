'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'eatool', 'EA-jsscript', 'import_system_architecture_json_to_ea_new.js');

test('ea-import-new: new import script exists and imports as new elements', () => {
  // GIVEN the original import script preserves source-graph ids in aliases/tags
  // WHEN a new import variant is provided at eatool/EA-jsscript/import_system_architecture_json_to_ea_new.js
  // THEN the script exists and keeps the import entrypoints (main/importElements/importRelationships/importViews)
  assert.ok(existsSync(SCRIPT), 'new import script should exist');

  const content = readFileSync(SCRIPT, 'utf8');
  assert.match(content, /function\s+main\s*\(/, 'script should define main()');
  assert.match(content, /function\s+importElements\s*\(/, 'script should define importElements()');
  assert.match(content, /function\s+importRelationships\s*\(/, 'script should define importRelationships()');
  assert.match(content, /function\s+importViews\s*\(/, 'script should define importViews()');
});

test('ea-import-new: script does not persist source-graph ids', () => {
  // GIVEN the requirement that all imported elements are treated as new elements
  // WHEN the script is inspected
  // THEN no source-graph id markers are written into the EA model
  const content = readFileSync(SCRIPT, 'utf8');

  const forbidden = [
    'schema_id',
    'schema_parent',
    'schema_element_json',
    'schema_relationship_json',
    'schema_view_id',
    'schema_sub_view_map',
    'schema_included_elements_json',
    'schema_included_relationships_json',
    'source_schema_id',
    'target_schema_id',
  ];

  for (const token of forbidden) {
    assert.doesNotMatch(
      content,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `script should not contain source-graph id marker "${token}"`
    );
  }

  // Elements must never fall back to the source id as their EA alias.
  assert.doesNotMatch(
    content,
    /\.Alias\s*=\s*data\.id/,
    'script should not set an element Alias from the source id'
  );
  assert.doesNotMatch(
    content,
    /connector\.Alias\s*=\s*data\.id/,
    'script should not set a connector Alias from the source id'
  );
});
