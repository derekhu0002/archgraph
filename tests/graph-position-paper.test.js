'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML_DOC = path.join(ROOT, 'docs', 'graph-position-paper.html');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const ELEMENT_ID = 'wp-graph-position-paper-001';
const ELEMENT_NAME = '撰写『以项目为基本 block，让 Agent 有图可依』方案与测评材料（意见）';
const ARTICLE_ID = 'graph-position-paper-001';
const VIEW_ID = 'comm-2026-09-view-001';

function readHtml() {
  assert.ok(existsSync(HTML_DOC), 'position paper HTML should exist');
  return readFileSync(HTML_DOC, 'utf8');
}

function elementById(id) {
  const matches = GRAPH.elements.filter((entry) => entry.id === id);
  assert.equal(matches.length, 1, `exactly one element with id ${id} should exist`);
  return matches[0];
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('position-paper: is a self-contained, email-safe HTML document', () => {
  const html = readHtml();
  assert.match(html, /<!DOCTYPE html>/i, 'should be a complete HTML document');
  assert.match(html, /<html\b/i, 'should declare an html root');
  assert.doesNotMatch(html, /<svg\b/i, 'should avoid inline SVG');
  assert.doesNotMatch(html, /<img\b/i, 'should not depend on external images');
});

test('position-paper: follows the four-part structure (problem / solution / details / evaluation)', () => {
  const html = readHtml();
  assert.match(html, /一、提出问题/, 'should open with the industry problem');
  assert.match(html, /二、解决方案/, 'should present the solution');
  assert.match(html, /三、框架细节/, 'should detail the framework');
  assert.match(html, /四、测评与交付/, 'should close with evaluation and delivery');
});

test('position-paper: solution names the authentic graph and the no-policy-family framing', () => {
  const html = readHtml();
  assert.match(html, /本真图谱/, 'should name the authentic (source-of-truth) graph');
  assert.match(html, /记忆系统/, 'should frame the knowledge base as a memory system');
  assert.match(html, /设计图纸/, 'should frame it as the design blueprint');
  assert.match(html, /有图可依/, 'should state "the Agent has a graph to rely on"');
  assert.match(html, /以项目为基本\s*block|基本\s*block/, 'should keep the project-as-block direction');
  assert.doesNotMatch(html, /家人|政策加人|口服液|口服药/, 'should drop the earlier unrelated terms');
});

test('position-paper: framework details cover write gates, read optimization and metrics', () => {
  const html = readHtml();
  assert.match(html, /写入时的门禁机制/, 'should cover the write-time gate');
  assert.match(html, /去重/, 'should cover dedup');
  assert.match(html, /无损/, 'should cover lossless writes');
  assert.match(html, /墓碑/, 'should cover the tombstone ledger');
  assert.match(html, /读取时优化/, 'should cover read-time optimization');
  assert.match(html, /Token|token/, 'should cover token optimization');
  assert.match(html, /三层记忆/, 'should cover layered memory');
  assert.match(html, /阈值/, 'should cover the calibrated threshold');
  assert.match(html, /检出率/, 'should state the detection-rate metric');
  assert.match(html, /召回率/, 'should state the recall metric');
  assert.match(html, /recall@1/i, 'should cite recall@1');
  assert.match(html, /MRR/, 'should cite MRR');
});

test('position-paper: evaluation section states methods and results', () => {
  const html = readHtml();
  assert.match(html, /测评方法|测评/, 'should describe the evaluation method');
  assert.match(html, /LongMemEval/, 'should align with the industry benchmark');
  assert.match(html, /拒答/, 'should cover abstention');
  assert.match(html, /94\.6%/, 'should cite the recall@1 baseline');
  assert.match(html, /99\.4%/, 'should cite the recall@5 baseline');
  assert.match(html, /回归/, 'should state the regression/delivery discipline');
});

test('position-paper: pairs the narrative with email-safe diagrams', () => {
  const html = readHtml();
  const diagramCount = (html.match(/class="diagram/g) || []).length;
  const figureCount = (html.match(/<figure\b/g) || []).length;
  assert.ok(diagramCount >= 2, `should embed at least 2 diagram tables (found ${diagramCount})`);
  assert.ok(figureCount >= 2, `should wrap them in at least 2 figures (found ${figureCount})`);
  assert.match(html, /图 1/, 'should label figure 1');
  assert.match(html, /图 2/, 'should label figure 2');
});

test('position-paper: graph contains the work package with a doc attribute and a GIVEN-WHEN-THEN testcase', () => {
  const el = elementById(ELEMENT_ID);
  assert.equal(el.name, ELEMENT_NAME, 'element name should match');
  assert.equal(el.type, 'Work Package', 'element should be a Work Package');
  assert.ok(el.description && el.description.trim().length > 0, 'element should carry a description');
  const attributeNames = (el.attributes || []).map((a) => a.name);
  assert.ok(attributeNames.includes('doc'), 'element should record the HTML doc path');
  assert.ok(Array.isArray(el.testcases) && el.testcases.length > 0, 'element should carry testcases');
  assert.ok(
    el.testcases.some((tc) => isGivenWhenThen(tc.description || '')),
    'at least one testcase should be written GIVEN-WHEN-THEN'
  );
});

test('position-paper: the full text is stored in the graph', () => {
  const bo = elementById(ARTICLE_ID);
  const text = (bo.attributes || []).find((a) => a.name === 'article');
  assert.ok(text, 'article element should carry the full text');
  assert.ok(text.value.length > 800, 'stored text should be substantial');
  assert.match(text.value, /本真图谱/, 'stored text should contain the core term');
  assert.match(text.value, /召回/, 'stored text should contain the recall discussion');
});

test('position-paper: deliverable is a member of the content publication view', () => {
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.ok(view.included_elements.includes(ELEMENT_ID), `${VIEW_ID} should include the work package`);
});
