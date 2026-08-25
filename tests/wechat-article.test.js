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

const OPENCLAW = path.join(ROOT, 'docs', 'openclaw-support.wechat.md');

test('wechat-openclaw-ready: OpenClaw support article with required frontmatter', () => {
  // GIVEN ArchGraph has been adapted for OpenClaw (WP 2780 completed)
  // WHEN the wechat-public-cli skill prepares to publish
  // THEN a WeChat-ready markdown exists with title/author/digest frontmatter and OpenClaw support body
  const md = readFileSync(OPENCLAW, 'utf8');
  const meta = parseFrontmatter(md);

  assert.ok(meta.title, 'frontmatter should declare a title');
  assert.ok(meta.author, 'frontmatter should declare an author');
  assert.ok(meta.digest, 'frontmatter should declare a digest');
  assert.match(md, /OpenClaw/, 'article body should introduce OpenClaw');
  assert.match(md, /argo MCP server/, 'article body should mention the argo MCP server');
  assert.match(md, /AGENTS\.md/, 'article body should mention the OpenClaw workspace AGENTS.md rule injection');
});

test('wechat-openclaw-banner: OpenClaw support article has a dedicated themed banner', () => {
  // GIVEN the OpenClaw support article is about to be published
  // WHEN the publisher prepares the title image
  // THEN the article declares a dedicated themed banner (distinct from the generic core-model image) and the file exists
  const md = readFileSync(OPENCLAW, 'utf8');
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

const MULTI_ROLE = path.join(ROOT, 'docs', 'multi-role-capability.wechat.md');

test('wechat-multi-role-ready: multi-role capability article with required frontmatter and content', () => {
  // GIVEN ArchGraph's multi-role capability has been demonstrated by its own development process
  // WHEN the wechat-public-cli skill prepares to publish
  // THEN a WeChat-ready markdown exists with title/author/digest frontmatter and multi-role body
  const md = readFileSync(MULTI_ROLE, 'utf8');
  const meta = parseFrontmatter(md);

  assert.ok(meta.title, 'frontmatter should declare a title');
  assert.ok(meta.author, 'frontmatter should declare an author');
  assert.ok(meta.digest, 'frontmatter should declare a digest');
  assert.match(md, /多角色/, 'article body should discuss multi-role');
  assert.match(md, /Business Actor/, 'article body should mention Business Actor');
  assert.match(md, /Assignment/, 'article body should mention Assignment relationships');
  assert.match(md, /Triggering/, 'article body should mention Triggering collaboration');
});

test('wechat-multi-role-images: multi-role article embeds the photorealistic illustrations inline', () => {
  // GIVEN the media-artist has generated photorealistic illustrations for the multi-role article
  // WHEN the article is rendered for the public account
  // THEN the article body embeds at least one markdown image referencing a real diagrams/*.png file (not just the banner)
  const md = readFileSync(MULTI_ROLE, 'utf8');
  const meta = parseFrontmatter(md);
  const images = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);

  assert.ok(images.length >= 1, 'article body should embed at least one inline image');
  for (const rel of images) {
    const abs = path.join(ROOT, 'docs', rel);
    assert.ok(existsSync(abs), `embedded image should exist: ${abs}`);
  }
  assert.notEqual(meta.banner_path, 'diagrams/image.png', 'should use a dedicated themed banner');
});

test('wechat-multi-role-banner: multi-role article has a dedicated photorealistic banner', () => {
  // GIVEN the multi-role article is about to be published
  // WHEN the media-artist prepares the title image
  // THEN the article declares a dedicated themed banner (distinct from the generic core-model image) and the file exists
  const md = readFileSync(MULTI_ROLE, 'utf8');
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

const SKILL_COEV = path.join(ROOT, 'docs', 'skill-coevolution.wechat.md');

test('wechat-skill-coevolution-ready: SKILL co-evolution article with required frontmatter and content', () => {
  // GIVEN the industry insight material about SKILL internalization and co-evolution is complete
  // WHEN the wechat-public-cli skill prepares to publish
  // THEN a WeChat-ready markdown exists with title/author/digest frontmatter and SKILL co-evolution body
  const md = readFileSync(SKILL_COEV, 'utf8');
  const meta = parseFrontmatter(md);

  assert.ok(meta.title, 'frontmatter should declare a title');
  assert.ok(meta.author, 'frontmatter should declare an author');
  assert.ok(meta.digest, 'frontmatter should declare a digest');
  assert.match(md, /SKILL/, 'article body should discuss SKILL');
  assert.match(md, /内化/, 'article body should discuss internalization');
  assert.match(md, /共同进化/, 'article body should discuss co-evolution');
});

test('wechat-skill-coevolution-banner: SKILL co-evolution article has a dedicated themed banner', () => {
  // GIVEN the SKILL co-evolution article is about to be published
  // WHEN the media-artist prepares the title image
  // THEN the article declares a dedicated themed banner (distinct from the generic core-model image) and the file exists
  const md = readFileSync(SKILL_COEV, 'utf8');
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

test('wechat-skill-coevolution-images: SKILL co-evolution article embeds the illustrations inline', () => {
  // GIVEN the media-artist has generated illustrations for the SKILL co-evolution article
  // WHEN the article is rendered for the public account
  // THEN the article body embeds at least one markdown image referencing a real diagrams/*.png file (not just the banner)
  const md = readFileSync(SKILL_COEV, 'utf8');
  const meta = parseFrontmatter(md);
  const images = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);

  assert.ok(images.length >= 1, 'article body should embed at least one inline image');
  for (const rel of images) {
    const abs = path.join(ROOT, 'docs', rel);
    assert.ok(existsSync(abs), `embedded image should exist: ${abs}`);
  }
  assert.notEqual(meta.banner_path, 'diagrams/image.png', 'should use a dedicated themed banner');
});

const INNOVATIONS = path.join(ROOT, 'docs', '8-innovations.wechat.md');

test('wechat-innovations-ready: 8 innovations article with required frontmatter and content', () => {
  // GIVEN the ArchGraph project has 8 key innovations to announce
  // WHEN the wechat-public-cli skill prepares to publish
  // THEN a WeChat-ready markdown exists with title/author/digest frontmatter and 8 innovations body
  const md = readFileSync(INNOVATIONS, 'utf8');
  const meta = parseFrontmatter(md);

  assert.ok(meta.title, 'frontmatter should declare a title');
  assert.ok(meta.author, 'frontmatter should declare an author');
  assert.ok(meta.digest, 'frontmatter should declare a digest');
  assert.match(md, /ArchGraph/, 'article body should introduce ArchGraph');
  assert.match(md, /ArchiMate/, 'article body should mention ArchiMate');
  assert.match(md, /创新/, 'article body should discuss innovations');
});


