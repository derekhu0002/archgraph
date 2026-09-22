'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, statSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML_DOC = path.join(ROOT, 'docs', 'archgraph-introduction.html');
const PDF_DOC = path.join(ROOT, 'docs', 'archgraph-introduction.pdf');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const ELEMENT_ID = 'wp-archgraph-introduction-pdf-001';
const ELEMENT_NAME = '编制 ArchGraph 介绍 PDF（四大主题图文版）';
const VIEW_ID = '180';

function readHtml() {
  assert.ok(existsSync(HTML_DOC), 'introduction HTML source should exist');
  return readFileSync(HTML_DOC, 'utf8');
}

function introElement() {
  const matches = GRAPH.elements.filter((entry) => entry.id === ELEMENT_ID);
  assert.equal(matches.length, 1, `exactly one element with id ${ELEMENT_ID} should exist`);
  return matches[0];
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('introduction: document covers all four themes', () => {
  // GIVEN the ArchGraph introduction is organized around four themes
  // WHEN the HTML source is inspected
  // THEN the four theme headings are present
  const html = readHtml();
  assert.match(html, /项目大脑/, 'should contain the project-brain theme');
  assert.match(html, /人\s*\+\s*Agent\s*协作|人 \+ Agent 协作/, 'should contain the human+agent collaboration theme');
  assert.match(html, /项目互助/, 'should contain the project mutual-help theme');
  assert.match(html, /项目集群/, 'should contain the project-cluster theme');
});

test('introduction: theme 1 covers the knowledge graph, GraphRAG, write gate and retrieval', () => {
  // GIVEN theme 1 explains the "project brain"
  // WHEN the HTML source is inspected
  // THEN it names the graph, GraphRAG, dedup/lossless/tombstone gate and the retrieval techniques
  const html = readHtml();
  assert.match(html, /意图架构图谱/, 'should name the intent architecture graph');
  assert.match(html, /ArchiMate\s*3\.2/, 'should name ArchiMate 3.2');
  assert.match(html, /GraphRAG/, 'should explain GraphRAG');
  assert.match(html, /去重/, 'should cover dedup governance');
  assert.match(html, /无损/, 'should cover lossless write governance');
  assert.match(html, /墓碑/, 'should cover the tombstone ledger');
  assert.match(html, /allowDuplicate/, 'should name the explicit-override dedup path');
  assert.match(html, /acknowledgeLoss/, 'should name the loss acknowledgement gate');
  assert.match(html, /queryNeo4jGraph/, 'should name graph query');
  assert.match(html, /getIntentElementContext/, 'should name element context retrieval');
  assert.match(html, /getArchitectureViewContext/, 'should name view context retrieval');
  assert.match(html, /混合检索/, 'should cover hybrid retrieval');
  assert.match(html, /RERANK|重排/, 'should cover reranking');
  assert.match(html, /召回/, 'should state the recall-first discipline');
});

test('introduction: theme 2 covers the shared mental model and memory rhythm', () => {
  // GIVEN theme 2 explains human+agent collaboration
  // WHEN the HTML source is inspected
  // THEN it names the shared model plus the beginning/working/end-of-session memory triggers
  const html = readHtml();
  assert.match(html, /共同心智|ArchiMate/, 'should frame the shared mental model');
  assert.match(html, /WakeupGuideline/, 'should name the wakeup guideline');
  assert.match(html, /MemoryTriggerTiming/, 'should name the milestone immediate-write trigger');
  assert.match(html, /SessionMemorySummarization/, 'should name the session-end summary');
  assert.match(html, /T1/, 'should describe T1 working memory');
  assert.match(html, /T2/, 'should describe T2 long-term memory');
  assert.match(html, /T3/, 'should describe T3 archive');
});

test('introduction: theme 3 covers the Graph Store reuse loop and theme 4 the cluster path', () => {
  // GIVEN themes 3 and 4 explain mutual help and organizational scaling
  // WHEN the HTML source is inspected
  // THEN the sharing loop, the reuse unit and the maturity stages are present
  const html = readHtml();
  assert.match(html, /Graph Store/, 'should name the Graph Store');
  assert.match(html, /子图工作包/, 'should name the subgraph work package');
  assert.match(html, /导出/, 'should cover export');
  assert.match(html, /导入/, 'should cover import');
  assert.match(html, /敏感信息/, 'should cover the sensitive-info scan');
  assert.match(html, /argo-deploy|一套源多端/, 'should cover one-source-many-harness deployment');
  assert.match(html, /L1/, 'should describe maturity stage L1');
  assert.match(html, /L2/, 'should describe maturity stage L2');
  assert.match(html, /L3/, 'should describe maturity stage L3');
  assert.match(html, /L4/, 'should describe maturity stage L4');
  assert.match(html, /定位先行/, 'should restate locate-first discipline');
  assert.match(html, /验收先行/, 'should restate acceptance-first discipline');
  assert.match(html, /变更可证/, 'should restate traceability discipline');
  assert.match(html, /写入无害/, 'should restate write-safety discipline');
});

test('introduction: document pairs every theme with an inline diagram', () => {
  // GIVEN the user asked for image+text pairing
  // WHEN the HTML source is inspected
  // THEN at least four inline SVG figures are embedded
  const html = readHtml();
  const svgCount = (html.match(/<svg\b/g) || []).length;
  const figureCount = (html.match(/<figure\b/g) || []).length;
  assert.ok(svgCount >= 4, `should embed at least 4 inline SVG diagrams (found ${svgCount})`);
  assert.ok(figureCount >= 4, `should wrap them in at least 4 figures (found ${figureCount})`);
  assert.match(html, /图 1/, 'should label figure 1');
  assert.match(html, /图 4/, 'should label figure 4');
});

test('introduction: a valid non-empty PDF deliverable exists', () => {
  // GIVEN the user asked for a PDF compilation
  // WHEN the PDF file is inspected
  // THEN it exists, is non-trivially sized and starts with the PDF magic header
  assert.ok(existsSync(PDF_DOC), 'introduction PDF should exist');
  assert.ok(statSync(PDF_DOC).size > 10000, 'PDF should be non-trivially sized');
  const head = readFileSync(PDF_DOC).subarray(0, 5).toString('latin1');
  assert.equal(head, '%PDF-', 'PDF should start with the %PDF- magic header');
});

test('introduction: graph contains the deliverable with attributes and a GIVEN-WHEN-THEN testcase', () => {
  // GIVEN the introduction was stored in the intent graph
  // WHEN the element is looked up
  // THEN it is a Work Package carrying a description, the doc/pdf paths and an executable testcase
  const el = introElement();
  assert.equal(el.name, ELEMENT_NAME, 'element name should match');
  assert.equal(el.type, 'Work Package', 'element should be a Work Package');
  assert.ok(el.description && el.description.trim().length > 0, 'element should carry a description');
  const attributeNames = (el.attributes || []).map((a) => a.name);
  assert.ok(attributeNames.includes('doc'), 'element should record the HTML doc path');
  assert.ok(attributeNames.includes('pdf'), 'element should record the PDF path');
  assert.ok(Array.isArray(el.testcases) && el.testcases.length > 0, 'element should carry testcases');
  assert.ok(
    el.testcases.some((tc) => isGivenWhenThen(tc.description || '')),
    'at least one testcase should be written GIVEN-WHEN-THEN'
  );
});

test('introduction: deliverable is a member of the content publication view', () => {
  // GIVEN the deliverable is filed under the content publication view
  // WHEN views are inspected
  // THEN the view exists and includes the introduction element
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.ok(
    view.included_elements.includes(ELEMENT_ID),
    `${VIEW_ID} should include the introduction element`
  );
});
