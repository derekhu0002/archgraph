'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARTICLE = path.join(ROOT, 'docs', 'industry-insight-graph-driven-agent.wechat.md');
const ANNOUNCEMENT = path.join(ROOT, 'docs', 'archgraph-introduction.wechat.md');
const COMMUNITY = path.join(ROOT, 'docs', 'developer-community.wechat.md');

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

test('wechat-community-ready: developer community article with required frontmatter', () => {
  // GIVEN the developer community (GitHub Discussions) has been designed
  // WHEN the wechat-public-cli skill prepares to publish
  // THEN a WeChat-ready markdown exists with title/author/digest frontmatter and community intro body
  const md = readFileSync(COMMUNITY, 'utf8');
  const meta = parseFrontmatter(md);

  assert.ok(meta.title, 'frontmatter should declare a title');
  assert.ok(meta.author, 'frontmatter should declare an author');
  assert.ok(meta.digest, 'frontmatter should declare a digest');
  assert.match(md, /GitHub Discussions/, 'article body should introduce GitHub Discussions');
  assert.match(md, /工作包/, 'article body should mention work packages');
});

test('wechat-community-banner: developer community article has a dedicated themed banner', () => {
  // GIVEN the developer community article is about to be published
  // WHEN the publisher prepares the title image
  // THEN the article declares a dedicated themed banner (distinct from the generic core-model image) and the file exists
  const md = readFileSync(COMMUNITY, 'utf8');
  const meta = parseFrontmatter(md);

  assert.ok(meta.banner_path, 'frontmatter should declare a banner_path');
  assert.notEqual(
    meta.banner_path,
    'diagrams/image.png',
    'should use a dedicated themed banner, not the generic core-model image'
  );
  const bannerAbs = path.join(ROOT, 'docs', meta.banner_path);
  assert.ok(existsSync(bannerAbs), `banner image should exist: ${bannerAbs}`);
});
