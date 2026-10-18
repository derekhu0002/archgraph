'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'docs', 'agent-era-human-agent-loop.html');
const GRAPH = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
const ARTICLE_ID = 'agent-era-human-agent-loop-001';
const VIEW_ID = 'comm-2026-10-view-001';

function html() {
  assert.ok(fs.existsSync(HTML_PATH), 'article HTML should exist');
  return fs.readFileSync(HTML_PATH, 'utf8');
}

function element(id) {
  const matches = GRAPH.elements.filter((entry) => entry.id === id);
  assert.equal(matches.length, 1, `exactly one graph element ${id} should exist`);
  return matches[0];
}

test('agent-era article: explains the full human-agent problem-solving loop', () => {
  // GIVEN a reader is new to the article's proposal
  const source = html();
  // WHEN reading its main narrative
  // THEN goal-setting, execution, acceptance, diagnosis, and iteration are all present
  for (const phrase of ['不知道如何实现', '探索路径与执行', '重要问题', 'Agent', '验收', '环境缺失', '上下文治理', '记忆写入']) {
    assert.ok(source.includes(phrase), `article should explain ${phrase}`);
  }
});

test('agent-era article: renders original model-generated engineering illustrations', () => {
  // GIVEN the article is opened locally or as an email body
  const source = html();
  // WHEN its figures are resolved
  const matches = [...source.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/gi)];
  // THEN all three original illustrations are bundled beside the HTML with useful alt text
  assert.ok(matches.length >= 4, 'article should have at least four illustrations');
  for (const [, src] of matches) {
    assert.ok(!/^https?:/i.test(src), 'article images should not depend on remote URLs');
    const resolved = path.resolve(path.dirname(HTML_PATH), src);
    assert.ok(resolved.startsWith(path.join(ROOT, 'docs', 'assets')), 'image should be in docs/assets');
    assert.ok(fs.existsSync(resolved), `image should exist: ${src}`);
  }
  assert.match(source, /人机协作闭环/);
  assert.match(source, /记忆写入治理/);
  assert.match(source, /整体指标/);
  for (const phrase of ['语义检索', '混合召回', '重排序', 'getIntentElementContext', 'getArchitectureViewContext', '整图提取']) {
    assert.ok(source.includes(phrase), 'article should explain retrieval technique ' + phrase);
  }
});

test('agent-era article: distinguishes project-level outcomes from diagnostic measures and sample limits', () => {
  const source = html();
  assert.match(source, /任务完成成功率/);
  assert.match(source, /Recall@k|Recall@1|MRR/);
  assert.match(source, /partial|小样本/);
  assert.match(source, /不是同一口径|不同实验|不同测量轮次/);
});

test('agent-era article: full text and file reference are stored in the intent graph', () => {
  // GIVEN the delivered HTML article
  const article = element(ARTICLE_ID);
  // WHEN the canonical knowledge record is inspected
  const attrs = article.attributes || [];
  const body = attrs.find((entry) => entry.name === 'article');
  const doc = attrs.find((entry) => entry.name === 'doc');
  // THEN the graph contains the authoritative full text and its repository path
  assert.ok(body && body.value.length > 2000, 'graph should store the full article text');
  assert.match(body.value, /目标驱动|目标定义/);
  assert.ok(doc && doc.value === 'docs/agent-era-human-agent-loop.html');
  const view = GRAPH.views.find((entry) => entry.view_id === VIEW_ID);
  assert.ok(view && view.included_elements.includes(ARTICLE_ID), 'article should be mounted in 2026-10 communication view');
});
