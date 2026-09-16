'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OVERVIEW = path.join(ROOT, 'docs', 'archgraph-framework-overview.md');

function parseFrontmatter(md) {
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!m) {
    throw new Error('overview is missing a YAML frontmatter block');
  }
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) {
      let value = kv[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      meta[kv[1]] = value;
    }
  }
  return meta;
}

test('framework-overview-ready: master overview draft with required frontmatter and body', () => {
  // GIVEN the framework introduction series needs a master overview
  // WHEN the repository draft is read
  // THEN a markdown overview exists with title/digest/status/series frontmatter and the core thesis
  const md = readFileSync(OVERVIEW, 'utf8');
  const meta = parseFrontmatter(md);

  assert.ok(meta.title, 'frontmatter should declare a title');
  assert.ok(meta.digest, 'frontmatter should declare a digest');
  assert.equal(meta.status, 'draft', 'overview should start as a draft');
  assert.ok(meta.series, 'frontmatter should declare the series it belongs to');

  assert.match(md, /ArchGraph/, 'body should introduce ArchGraph');
  assert.match(md, /ArchiMate 3\.2/, 'body should name the ArchiMate 3.2 meta-model');
  assert.match(md, /意图架构图/, 'body should present the intent architecture graph');
  assert.match(md, /单一事实源/, 'body should state the single-source-of-truth property');
});

test('framework-overview-covers-two-lines: overview covers the architecture line and the AI line', () => {
  // GIVEN the overview claims ArchGraph unifies architecture and AI
  // WHEN the body is inspected
  // THEN both main lines are substantively present
  const md = readFileSync(OVERVIEW, 'utf8');

  assert.match(md, /AML/, 'architecture line should introduce AML');
  assert.match(md, /统一模型/, 'architecture line should cover the unified model');
  assert.match(md, /GraphRAG/, 'AI line should cover GraphRAG retrieval');
  assert.match(md, /三层/, 'AI line should cover the three-tier memory');
});

test('framework-overview-governance: overview states the four engineering constraints', () => {
  // GIVEN the overview presents governance as the framework's discipline
  // WHEN the body is inspected
  // THEN the four constraints are named
  const md = readFileSync(OVERVIEW, 'utf8');

  assert.match(md, /定位先行/, 'governance should include locate-first');
  assert.match(md, /验收先行/, 'governance should include acceptance-test-first');
  assert.match(md, /commit id/, 'governance should include change traceability via commit ids');
  assert.match(md, /去重/, 'governance should include deduplication');
});

test('framework-overview-series-map: overview carries the series map that organizes the follow-ups', () => {
  // GIVEN the overview is the anchor of a series
  // WHEN the body is inspected
  // THEN it contains a series map linking the follow-up pieces to the two lines
  const md = readFileSync(OVERVIEW, 'utf8');

  assert.match(md, /系列地图/, 'overview should contain a series map section');
  assert.match(md, /多 Harness/, 'series map should include the harness/interop piece');
});
