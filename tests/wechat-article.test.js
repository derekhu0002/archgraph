'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARTICLE = path.join(ROOT, 'docs', 'industry-insight-graph-driven-agent.wechat.md');
const ANNOUNCEMENT = path.join(ROOT, 'docs', 'archgraph-introduction.wechat.md');

function parseFrontmatter(md) {
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!m) {
    throw new Error('article is missing a YAML frontmatter block');
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

test('wechat-article-ready: WeChat article markdown with required frontmatter', () => {
  // GIVEN the industry insight report has been archived
  // WHEN the wechat-public-cli skill prepares to publish
  // THEN a WeChat-ready markdown exists with title/author/digest frontmatter and report body
  const md = readFileSync(ARTICLE, 'utf8');
  const meta = parseFrontmatter(md);

  assert.ok(meta.title, 'frontmatter should declare a title');
  assert.ok(meta.author, 'frontmatter should declare an author');
  assert.ok(meta.digest, 'frontmatter should declare a digest');
  assert.match(md, /GraphRAG/, 'article body should discuss GraphRAG');
  assert.match(md, /知识图谱/, 'article body should discuss knowledge graphs');
});

test('wechat-intro-ready: project announcement article with required frontmatter', () => {
  // GIVEN the project is ready for public announcement
  // WHEN the wechat-public-cli skill prepares to publish
  // THEN a WeChat-ready announcement markdown exists with title/author/digest frontmatter and project intro body
  const md = readFileSync(ANNOUNCEMENT, 'utf8');
  const meta = parseFrontmatter(md);

  assert.ok(meta.title, 'frontmatter should declare a title');
  assert.ok(meta.author, 'frontmatter should declare an author');
  assert.ok(meta.digest, 'frontmatter should declare a digest');
  assert.match(md, /ArchGraph/, 'article body should introduce ArchGraph');
  assert.match(md, /Agentic Engineering/, 'article body should mention Agentic Engineering');
});
