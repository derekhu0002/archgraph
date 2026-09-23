'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML_DOC = path.join(ROOT, 'docs', 'graph-agent-paper.html');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const ELEMENT_ID = 'wp-graph-agent-paper-001';
const ELEMENT_NAME = '撰写『面向 Agent 工程的本真图谱』科研论文（问题/方案/框架/实验）';
const ARTICLE_ID = 'graph-agent-paper-001';
const VIEW_ID = 'comm-2026-09-view-001';

function readHtml() {
  assert.ok(existsSync(HTML_DOC), 'paper HTML should exist');
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

test('paper: is a self-contained, email-safe HTML document', () => {
  const html = readHtml();
  assert.match(html, /<!DOCTYPE html>/i, 'should be a complete HTML document');
  assert.match(html, /<html\b/i, 'should declare an html root');
  assert.doesNotMatch(html, /<svg\b/i, 'should avoid inline SVG');
  assert.doesNotMatch(html, /<img\b/i, 'should not depend on external images');
});

test('paper: follows the standard scientific structure', () => {
  const html = readHtml();
  assert.match(html, /摘要/, 'should have an abstract');
  assert.match(html, /1　引言|引言/, 'should have an introduction');
  assert.match(html, /相关工作/, 'should have related work');
  assert.match(html, /方法/, 'should have a method section');
  assert.match(html, /实验设置/, 'should have an experimental setup');
  assert.match(html, /结果与分析/, 'should have results and analysis');
  assert.match(html, /讨论|局限/, 'should have a discussion / limitations section');
  assert.match(html, /结论与展望/, 'should have a conclusion');
  assert.match(html, /参考文献/, 'should have references');
});

test('paper: presents the evaluation with data figures (bar charts)', () => {
  const html = readHtml();
  const diagrams = (html.match(/class="diagram/g) || []).length;
  assert.ok(diagrams >= 4, `should render at least 4 data-figure charts (found ${diagrams})`);
  assert.match(html, /图 1/, 'should label figure 1');
  assert.match(html, /图 2/, 'should label figure 2');
  assert.match(html, /图 3/, 'should label figure 3');
  assert.match(html, /图 4/, 'should label figure 4');
  assert.match(html, /bgcolor=/, 'charts should be drawn as email-safe table bars');
  assert.match(html, /width="9[0-9]/ , 'charts should encode values as bar widths');
});

test('paper: cites the concrete evaluation numbers', () => {
  const html = readHtml();
  assert.match(html, /94\.6/, 'should cite recall@1 baseline 94.6%');
  assert.match(html, /99\.4/, 'should cite recall@5 99.4%');
  assert.match(html, /99\.3/, 'should cite rerank recall@1 99.3%');
  assert.match(html, /0\.967/, 'should cite MRR 0.967');
  assert.match(html, /0\.70|0\.686|0\.833/, 'should cite the threshold calibration');
  assert.match(html, /5\.7\s*ms|5\.7ms/, 'should cite the latency');
});

test('paper: aligns with industry memory benchmarks', () => {
  const html = readHtml();
  assert.match(html, /LongMemEval/, 'should align with LongMemEval');
  assert.match(html, /LOCOMO/, 'should align with LOCOMO');
  assert.match(html, /BEAM/, 'should align with BEAM');
  assert.match(html, /拒答/, 'should cover abstention');
});

test('paper: method covers the authentic graph, write gates and read optimization', () => {
  const html = readHtml();
  assert.match(html, /本真图谱/, 'should name the authentic graph');
  assert.match(html, /去重/, 'should cover dedup');
  assert.match(html, /无损/, 'should cover lossless');
  assert.match(html, /墓碑/, 'should cover tombstone');
  assert.match(html, /三层记忆/, 'should cover layered memory');
  assert.match(html, /召回/, 'should cover recall');
});

test('paper: graph contains the work package with a doc attribute and a GIVEN-WHEN-THEN testcase', () => {
  const el = elementById(ELEMENT_ID);
  assert.equal(el.name, ELEMENT_NAME, 'element name should match');
  assert.equal(el.type, 'Work Package', 'element should be a Work Package');
  const attributeNames = (el.attributes || []).map((a) => a.name);
  assert.ok(attributeNames.includes('doc'), 'element should record the HTML doc path');
  assert.ok(Array.isArray(el.testcases) && el.testcases.length > 0, 'element should carry testcases');
  assert.ok(el.testcases.some((tc) => isGivenWhenThen(tc.description || '')), 'testcase should be GIVEN-WHEN-THEN');
});

test('paper: the full text is stored in the graph', () => {
  const bo = elementById(ARTICLE_ID);
  const text = (bo.attributes || []).find((a) => a.name === 'paper');
  assert.ok(text, 'paper element should carry the full text');
  assert.ok(text.value.length > 1200, 'stored paper text should be substantial');
  assert.match(text.value, /本真图谱/, 'stored text should contain the core term');
  assert.match(text.value, /recall@1|召回/, 'stored text should contain the metrics');
});

test('paper: deliverable is a member of the content publication view', () => {
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.ok(view.included_elements.includes(ELEMENT_ID), `${VIEW_ID} should include the work package`);
});
