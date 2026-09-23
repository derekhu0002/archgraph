'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML_DOC = path.join(ROOT, 'docs', 'org-federation-vision.html');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const ELEMENT_ID = 'wp-org-federation-vision-001';
const ELEMENT_NAME = '撰写『项目即国家、组织即联邦』新型组织形态过渡畅想文章（意见）';
const ARTICLE_ID = 'org-federation-vision-article-001';
const VIEW_ID = '180';

function readHtml() {
  assert.ok(existsSync(HTML_DOC), 'org-federation vision HTML should exist');
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

test('org-federation: is a self-contained, email-safe HTML document', () => {
  // GIVEN the think-piece is delivered as an HTML email
  // WHEN the source is inspected
  // THEN it is complete and avoids constructs mail clients strip
  const html = readHtml();
  assert.match(html, /<!DOCTYPE html>/i, 'should be a complete HTML document');
  assert.match(html, /<html\b/i, 'should declare an html root');
  assert.doesNotMatch(html, /<svg\b/i, 'should avoid inline SVG (stripped by many mail clients)');
  assert.doesNotMatch(html, /<img\b/i, 'should not depend on external images');
});

test('org-federation: states the project-as-block thesis and the one-person-army context', () => {
  // GIVEN the piece argues the basic block shifts from people to projects
  // WHEN the HTML is inspected
  // THEN the thesis, the "one-person army" context and the building-vs-pill analogy are present
  const html = readHtml();
  assert.match(html, /以「项目」为基本\s*block|项目[\s\S]{0,6}基本\s*block/, 'should state the project-as-block thesis');
  assert.match(html, /一人成军/, 'should frame the one-person-army context');
  assert.match(html, /盖楼|口服药/, 'should use the building-vs-pill analogy');
});

test('org-federation: builds the nation-federation idea with a hub and project-nations', () => {
  // GIVEN the piece uses the nation-federation metaphor
  // WHEN the HTML is inspected
  // THEN the three building blocks and the minimal federation law are present
  const html = readHtml();
  assert.match(html, /联盟中枢/, 'should establish a federation hub');
  assert.match(html, /项目\s*[A-C]|国家\s*[A-C]/, 'should present project-nations');
  assert.match(html, /联邦法则/, 'should state the minimal federation law');
  assert.match(html, /引用/, 'should rely on references, not copies');
  assert.match(html, /默认拒绝/, 'should state the default-deny border baseline');
});

test('org-federation: covers the transition from a people-org to the "policy-family" form', () => {
  // GIVEN the transition question is central
  // WHEN the HTML is inspected
  // THEN the policy-family term, projectization and the L1-L4 path are present
  const html = readHtml();
  assert.match(html, /政策家人/, 'should name the policy-family organizational form');
  assert.match(html, /项目化/, 'should frame projectization as the entry point');
  assert.match(html, /L1/, 'should describe stage L1');
  assert.match(html, /L4/, 'should describe stage L4');
});

test('org-federation: probes the likely problems before recommending', () => {
  // GIVEN the user asked to probe likely problems
  // WHEN the HTML is inspected
  // THEN a risk list is present with concrete failure modes
  const html = readHtml();
  assert.match(html, /可能遇到的问题|风险|难题/, 'should have a problems section');
  assert.match(html, /中心悖论/, 'should name the hub paradox');
  assert.match(html, /引用漂移/, 'should name reference drift');
  assert.match(html, /失败模式/, 'should name failure modes');
});

test('org-federation: pairs the narrative with email-safe diagrams', () => {
  // GIVEN the user asked for illustrative diagrams
  // WHEN the HTML is inspected
  // THEN at least two table-based diagrams are embedded and labelled
  const html = readHtml();
  const diagramCount = (html.match(/class="diagram/g) || []).length;
  const figureCount = (html.match(/<figure\b/g) || []).length;
  assert.ok(diagramCount >= 2, `should embed at least 2 diagram tables (found ${diagramCount})`);
  assert.ok(figureCount >= 2, `should wrap them in at least 2 figures (found ${figureCount})`);
  assert.match(html, /图 1/, 'should label figure 1');
  assert.match(html, /图 2/, 'should label figure 2');
});

test('org-federation: graph contains the work package with a doc attribute and a GIVEN-WHEN-THEN testcase', () => {
  // GIVEN the deliverable was stored in the intent graph
  // WHEN the work package is looked up
  // THEN it is a Work Package with the doc path and an executable testcase
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

test('org-federation: the full article text is stored in the graph', () => {
  // GIVEN content storage is KG-first
  // WHEN the article object is looked up
  // THEN it holds the full article text as an attribute
  const bo = elementById(ARTICLE_ID);
  const article = (bo.attributes || []).find((a) => a.name === 'article');
  assert.ok(article, 'article element should carry the full text as an attribute');
  assert.ok(article.value.length > 800, 'stored article text should be substantial');
  assert.match(article.value, /政策家人/, 'stored article should contain the core term');
  assert.match(article.value, /联盟中枢/, 'stored article should contain the hub term');
});

test('org-federation: deliverable is a member of the content publication view', () => {
  // GIVEN the deliverable is filed under the content publication view
  // WHEN views are inspected
  // THEN the view exists and includes the work package
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.ok(view.included_elements.includes(ELEMENT_ID), `${VIEW_ID} should include the work package`);
});
