'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML_DOC = path.join(ROOT, 'docs', 'archgraph-intro-email.html');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const ELEMENT_ID = 'wp-archgraph-intro-email-001';
const ELEMENT_NAME = '编制 ArchGraph 框架使用介绍邮件（面向利益相关者）';
const VIEW_ID = '180';
const RECIPIENT = 'hudonghua@huawei.com';

function readHtml() {
  assert.ok(existsSync(HTML_DOC), 'intro email HTML should exist');
  return readFileSync(HTML_DOC, 'utf8');
}

function emailElement() {
  const matches = GRAPH.elements.filter((entry) => entry.id === ELEMENT_ID);
  assert.equal(matches.length, 1, `exactly one element with id ${ELEMENT_ID} should exist`);
  return matches[0];
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('intro-email: is a self-contained, email-safe HTML document addressed to colleagues', () => {
  // GIVEN the framework introduction email is a broadcast to many colleagues
  // WHEN the source is inspected
  // THEN it is complete, greets the group, and avoids constructs mail clients strip
  const html = readHtml();
  assert.match(html, /<!DOCTYPE html>/i, 'should be a complete HTML document');
  assert.match(html, /<html\b/i, 'should declare an html root');
  assert.match(html, /大家好/, 'should greet the group, not one individual');
  assert.doesNotMatch(html, /<svg\b/i, 'should avoid inline SVG (stripped by many mail clients)');
  assert.doesNotMatch(html, /<img\b/i, 'should not depend on external images');
});

test('intro-email: teaches the four basic-operation steps with real commands', () => {
  // GIVEN the reader must learn how to install, deploy and prepare
  // WHEN the HTML is inspected
  // THEN install / deploy / prepare / initialize commands and prerequisites are present
  const html = readHtml();
  assert.match(html, /npm install -g archgraph-argo/, 'should show the install command');
  assert.match(html, /argo-deploy/, 'should show the deploy command');
  assert.match(html, /argo init/, 'should show the workspace initialization step');
  assert.match(html, /前置准备/, 'should have a prerequisites section');
  assert.match(html, /Node\.js 18/, 'should state the Node.js requirement');
  assert.match(html, /Neo4j/, 'should name the Neo4j prerequisite');
  assert.match(html, /语义检索/, 'should name the semantic-search / embedding prerequisite');
  assert.match(html, /自建|离线|内网/, 'should mention self-hosted / offline embedding');
});

test('intro-email: conveys the project-as-container core idea and the harnesses', () => {
  // GIVEN the core idea is "project as unit / container"
  // WHEN the HTML is inspected
  // THEN the container idea and the supported tools are spelled out
  const html = readHtml();
  assert.match(html, /以项目为中心/, 'should present the project-centric idea');
  assert.match(html, /麻烦|痛点/, 'should open with the pain points');
  assert.match(html, /容器/, 'should frame the project as a container');
  assert.match(html, /OpenCode/, 'should name OpenCode');
  assert.match(html, /Cursor/, 'should name Cursor');
  assert.match(html, /同一张(图|地图)|共同/, 'should state the shared map');
});

test('intro-email: explains the knowledge graph as asset and business evolution', () => {
  // GIVEN the email explains memory, assets and evolution
  // WHEN the HTML is inspected
  // THEN the graph-as-asset formula and the learning loop are present
  const html = readHtml();
  assert.match(html, /知识图谱/, 'should name the knowledge graph');
  assert.match(html, /资产/, 'should state the asset concept');
  assert.match(html, /仓库/, 'should include the repository in the asset');
  assert.match(html, /记忆/, 'should describe agent memory');
  assert.match(html, /进化|越用越懂/, 'should describe business understanding evolution');
  assert.match(html, /歧义/, 'should cover resolving ambiguity by conversation');
});

test('intro-email: states the session-end interaction discipline', () => {
  // GIVEN the discipline: the agent cannot detect session end
  // WHEN the HTML is inspected
  // THEN it explicitly asks the human to announce session end
  const html = readHtml();
  assert.match(html, /会话结束/, 'should cover session end');
  assert.match(html, /明确(告知|通知|告诉)|打个招呼/, 'should ask for an explicit session-end signal');
  assert.match(html, /交互纪律/, 'should present it as a discipline');
});

test('intro-email: states the goal and stakeholder value', () => {
  // GIVEN the audience is non-technical stakeholders
  // WHEN the HTML is inspected
  // THEN the goal and concrete value are highlighted
  const html = readHtml();
  assert.match(html, /价值/, 'should have a value section');
  assert.match(html, /起步快|交接稳|越用越省|可规模化/, 'should give concrete value points');
});

test('intro-email: pairs the narrative with email-safe diagrams', () => {
  // GIVEN the user asked for illustrative diagrams that survive mail clients
  // WHEN the HTML is inspected
  // THEN at least four table-based diagrams are embedded and labelled
  const html = readHtml();
  const diagramCount =
    (html.match(/class="diagram/g) || []).length + (html.match(/class="seq"/g) || []).length;
  const figureCount = (html.match(/<figure\b/g) || []).length;
  assert.ok(diagramCount >= 4, `should embed at least 4 diagram tables (found ${diagramCount})`);
  assert.ok(figureCount >= 4, `should wrap them in at least 4 figures (found ${figureCount})`);
  assert.match(html, /图 1/, 'should label figure 1');
  assert.match(html, /图 4/, 'should label figure 4');
});

test('intro-email: graph contains the deliverable with attributes and a GIVEN-WHEN-THEN testcase', () => {
  // GIVEN the email deliverable was stored in the intent graph
  // WHEN the element is looked up
  // THEN it is a Work Package carrying a description, the doc path and an executable testcase
  const el = emailElement();
  assert.equal(el.name, ELEMENT_NAME, 'element name should match');
  assert.equal(el.type, 'Work Package', 'element should be a Work Package');
  assert.ok(el.description && el.description.trim().length > 0, 'element should carry a description');
  const attributeNames = (el.attributes || []).map((a) => a.name);
  assert.ok(attributeNames.includes('doc'), 'element should record the HTML doc path');
  assert.ok(attributeNames.includes('recipient'), 'element should record the recipient');
  const recipient = (el.attributes || []).find((a) => a.name === 'recipient');
  assert.equal(recipient.value, RECIPIENT, 'recipient attribute should match');
  assert.ok(Array.isArray(el.testcases) && el.testcases.length > 0, 'element should carry testcases');
  assert.ok(
    el.testcases.some((tc) => isGivenWhenThen(tc.description || '')),
    'at least one testcase should be written GIVEN-WHEN-THEN'
  );
});

test('intro-email: deliverable is a member of the content publication view', () => {
  // GIVEN the deliverable is filed under the content publication view
  // WHEN views are inspected
  // THEN the view exists and includes the email element
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.ok(
    view.included_elements.includes(ELEMENT_ID),
    `${VIEW_ID} should include the email element`
  );
});
