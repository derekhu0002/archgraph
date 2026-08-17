'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const BRAND_FILES = [
  'README.md',
  'index.html',
  'docs/industry-insight-graph-driven-agent.md',
  'docs/industry-insight-graph-driven-agent.html',
  'docs/industry-insight-graph-driven-agent.wechat.md',
];

test('project-name: public-facing files use ArchGraph and drop the old name', () => {
  // GIVEN the project brand name is ArchGraph
  // WHEN a reader opens the README, the home site and the insight report docs
  // THEN public copy uses ArchGraph and no longer mentions open_knowledge_graph_engineering
  for (const rel of BRAND_FILES) {
    const content = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(content, /ArchGraph/, `${rel} should mention the new brand name ArchGraph`);
    assert.doesNotMatch(
      content,
      /open_knowledge_graph_engineering/,
      `${rel} should not contain the old project name`
    );
  }
});

test('project-name: home site links use the archgraph slug', () => {
  // GIVEN the GitHub repository has been renamed to archgraph
  // WHEN a visitor opens the home site
  // THEN GitHub links reference the archgraph slug
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  assert.match(
    html,
    /github\.com\/derekhu0002\/archgraph/,
    'home site GitHub links should point to derekhu0002/archgraph'
  );
});
