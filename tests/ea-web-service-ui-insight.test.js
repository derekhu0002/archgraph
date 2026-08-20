'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'ea-web-service-ui-insight.md');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const INSIGHT_ID = '2766';
const INSIGHT_NAME = '本地Web服务 UI/UX 技术洞察';
const EA_TOOLING_VIEW_ID = '1800';
const ACTOR_ID = '2737'; // 规划专家 Business Actor tanwen

function readDoc() {
  assert.ok(existsSync(DOC), 'UI/UX insight report should exist');
  return readFileSync(DOC, 'utf8');
}

function insightElement() {
  const matches = GRAPH.elements.filter((entry) => entry.name === INSIGHT_NAME);
  assert.equal(matches.length, 1, `exactly one element named ${INSIGHT_NAME} should exist`);
  return matches[0];
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('ea-web-service-ui-insight: report exists and contains candidate comparison table', () => {
  // GIVEN the planning expert has researched open-source graph UI candidates
  // WHEN the insight report is inspected
  // THEN it exists and contains a candidate comparison table with license and capability columns
  const doc = readDoc();
  assert.match(doc, /对比表/, 'report should contain a comparison table');
  assert.match(doc, /许可证/, 'comparison table should include a license column');
  assert.match(doc, /社区活跃度/, 'comparison table should include an activity column');
  assert.match(doc, /AntV\s*G6/, 'report should cover AntV G6');
  assert.match(doc, /Cytoscape/, 'report should cover Cytoscape.js');
  assert.match(doc, /React\s*Flow/, 'report should cover React Flow (xyflow)');
  assert.match(doc, /draw\.io|diagrams\.net/, 'report should cover draw.io/diagrams.net');
  assert.match(doc, /Neo4j\s*Browser/, 'report should cover Neo4j Browser');
});

test('ea-web-service-ui-insight: report concludes on self-built SPA vs open-source graph core', () => {
  // GIVEN the question is whether the built-in single-page UI suffices
  // WHEN the report is inspected
  // THEN it states the conclusion: keep the SPA shell + adopt an open-source graph core
  const doc = readDoc();
  assert.match(doc, /核心结论/, 'report should have a one-line conclusion');
  assert.match(doc, /自研\s*SPA\s*外壳/, 'conclusion should keep a self-built SPA shell');
  assert.match(doc, /开源图内核|开源图库|成熟开源图库/, 'conclusion should adopt an open-source graph core');
  assert.match(doc, /内置单页\s*UI.*够用|单页应用形态本身|形态.*成立/, 'report should state the SPA form suffices');
});

test('ea-web-service-ui-insight: report gives concrete AD-c / AD-g revision advice', () => {
  // GIVEN the system designer needs feedback on AD-c and AD-g
  // WHEN the report is inspected
  // THEN it contains explicit "建议改为 / 理由 / 被否方案" revision clauses for both
  const doc = readDoc();
  assert.match(doc, /AD-c\s*修订建议/, 'report should give AD-c revision advice');
  assert.match(doc, /AD-g\s*修订建议/, 'report should give AD-g revision advice');
  assert.match(doc, /建议改为/, 'revision advice should use 建议改为');
  assert.match(doc, /理由/, 'revision advice should include rationale');
  assert.match(doc, /被否方案/, 'revision advice should include rejected alternatives');
});

test('ea-web-service-ui-insight: graph contains a Skill insight element with a GIVEN-WHEN-THEN testcase', () => {
  // GIVEN the planning expert has registered the insight in the intent graph
  // WHEN a caller looks up the element
  // THEN a Skill element exists with parent 1249 and a GIVEN-WHEN-THEN testcase
  const el = insightElement();
  assert.equal(el.id, INSIGHT_ID, 'insight element id should be 2766');
  assert.equal(el.type, 'Skill', 'insight element should be a Skill');
  assert.equal(el.parent, '1249', 'insight element should hang under Implementation and Migration Viewpoint (1249)');
  assert.ok(el.description && el.description.trim().length > 0, 'insight element should carry a description');

  assert.ok(Array.isArray(el.testcases) && el.testcases.length >= 1, 'insight element should have at least one testcase');
  const tc = el.testcases[0];
  assert.ok(isGivenWhenThen(tc.description), 'testcase description should be GIVEN-WHEN-THEN');
  assert.ok(tc.Input && tc.Input.includes('ea-web-service-ui-insight.test.js'), 'testcase Input should point to this test file');
});

test('ea-web-service-ui-insight: insight element is in the EA Tooling view and under the actor long-term memory sub-view', () => {
  // GIVEN the insight element must be discoverable from both the EA Tooling view and the actor memory
  // WHEN views are inspected
  // THEN view 1800 includes the element and a sub-view mounted under actor 2737 also includes it
  const eaTooling = GRAPH.views.find((v) => v.view_id === EA_TOOLING_VIEW_ID);
  assert.ok(eaTooling, `view ${EA_TOOLING_VIEW_ID} should exist`);
  assert.ok(eaTooling.included_elements.includes(INSIGHT_ID), 'EA Tooling view should include the insight element');

  const memoryView = GRAPH.views.find((v) => v.parent_element_id === ACTOR_ID);
  assert.ok(memoryView, `a long-term memory sub-view should exist under actor ${ACTOR_ID}`);
  assert.ok(
    memoryView.included_elements.includes(INSIGHT_ID),
    'actor long-term memory sub-view should include the insight element'
  );
});
