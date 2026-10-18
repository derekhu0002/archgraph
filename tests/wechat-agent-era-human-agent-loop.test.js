'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARTICLE_PATH = path.join(ROOT, 'docs', 'agent-era-human-agent-loop.wechat.md');
const ARTICLE_ID = 'agent-era-human-agent-loop-001';
const MEMORY_ID = 'wpp-mem-agent-era-wechat-001';
const GRAPH = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));

function readArticle() {
  assert.ok(fs.existsSync(ARTICLE_PATH), 'WeChat Markdown rendition should exist');
  return fs.readFileSync(ARTICLE_PATH, 'utf8');
}

function parseFrontmatter(source) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  assert.ok(match, 'article should start with YAML frontmatter');
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
    const item = line.match(/^([A-Za-z_][\w-]*):\s*["']?([^"']*?)["']?\s*$/);
    return item ? [[item[1], item[2]]] : [];
  }));
}

test('wechat-agent-era-ready: article rendition has required metadata and the full argument', () => {
  // GIVEN the graph-authoritative HTML article is ready for the public account
  // WHEN wechat-public-cli prepares the draft
  // THEN a WeChat Markdown rendition carries required metadata and the complete interaction/context/retrieval thesis
  const source = readArticle();
  const meta = parseFrontmatter(source);
  for (const field of ['title', 'author', 'digest', 'banner_path']) {
    assert.ok(meta[field], `frontmatter should declare ${field}`);
  }
  for (const phrase of [
    '目标驱动', '探索路径', '人类验收', '环境缺失', '上下文治理', '去重与复用',
    '语义检索', '混合召回', '重排序', 'getIntentElementContext', 'getArchitectureViewContext', '整图提取', '任务完成成功率'
  ]) {
    assert.ok(source.includes(phrase), `WeChat article should preserve ${phrase}`);
  }
  const headings = source.match(/^#{1,3}\s+.+$/gm) || [];
  assert.ok(headings.length >= 8, 'article should retain the main sections rather than a short teaser');
});

test('wechat-agent-era-images: banner and inline model illustrations are local and upload-safe', () => {
  // GIVEN the article contains four model-generated blueprint illustrations
  const source = readArticle();
  const meta = parseFrontmatter(source);
  const imageRefs = [...source.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  // WHEN each image is prepared for the personal subscription account
  const allRefs = [meta.banner_path, ...imageRefs];
  // THEN each local image exists and is below WeChat's 1 MB inline-image limit
  assert.ok(imageRefs.length >= 4, 'article should embed the four labeled illustrations');
  for (const ref of allRefs) {
    assert.ok(!/^(?:https?:|data:)/i.test(ref), 'images should be local files');
    const absolute = path.resolve(ROOT, 'docs', ref);
    assert.ok(absolute.startsWith(path.join(ROOT, 'docs', 'assets')), 'images should stay under docs/assets');
    assert.ok(fs.existsSync(absolute), `image should exist: ${ref}`);
    assert.ok(fs.statSync(absolute).size < 1024 * 1024, `image should be below 1 MB: ${ref}`);
  }
});

test('wechat-agent-era-graph: delivery rendition is tied to the authoritative article element', () => {
  // GIVEN the canonical graph owns the article content
  const element = GRAPH.elements.find((item) => item.id === ARTICLE_ID);
  assert.ok(element, 'authoritative article element should exist');
  // WHEN delivery metadata is inspected
  const attrs = element.attributes || [];
  const wechatPath = attrs.find((item) => item.name === 'wechatMarkdown')?.value || '';
  const testcase = (element.testcases || []).find((item) => item.name === 'AT-agent-era-wechat-draft-01');
  // THEN the WeChat rendition is registered and guarded by this executable acceptance test
  assert.equal(wechatPath, 'docs/agent-era-human-agent-loop.wechat.md', 'graph should register the WeChat rendition path');
  assert.equal(testcase?.acceptanceCriteria, 'tests/wechat-agent-era-human-agent-loop.test.js');
});

test('wechat-agent-era-memory: draft blocker and next step are retained in the publisher long-term memory', () => {
  // GIVEN the WeChat CLI stopped at the platform IP allowlist gate
  const memory = GRAPH.elements.find((item) => item.id === MEMORY_ID);
  assert.ok(memory, 'publisher memory record should exist');
  // WHEN the publishing session record is resolved
  const view = GRAPH.views.find((item) => item.view_id === 'wpp-ltm-001');
  const testcase = (memory.testcases || []).find((item) => item.name === 'AT-agent-era-wechat-memory-01');
  // THEN the Actor's LTM contains the exact failure, public IP, and user recovery step with an executable AT
  assert.equal(memory.parent, '2755');
  assert.ok(view?.included_elements.includes(MEMORY_ID), 'memory record should be mounted in publisher LTM');
  assert.match(memory.description, /40164/);
  assert.match(memory.description, /223\.74\.103\.149/);
  assert.match(memory.description, /加入.*IP 白名单.*重试/);
  assert.equal(testcase?.acceptanceCriteria, 'tests/wechat-agent-era-human-agent-loop.test.js');
});
