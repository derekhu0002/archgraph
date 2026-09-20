'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, statSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML_DOC = path.join(ROOT, 'docs', 'semantic-web-validation-learning-guide.html');
const PDF_DOC = path.join(ROOT, 'docs', 'semantic-web-validation-learning-guide.pdf');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const ELEMENT_ID = 'semantic-web-validation-learning-guide-001';
const ELEMENT_NAME = '语义网校验/推理技术学习参考（SHACL·OWL·SWRL·RDF）';
const VIEW_ID = 'graph-consistency-tech-ref-001';
const PARENT_ID = '1249';

function readHtml() {
  assert.ok(existsSync(HTML_DOC), 'learning guide HTML source should exist');
  return readFileSync(HTML_DOC, 'utf8');
}

function guideElement() {
  const matches = GRAPH.elements.filter((entry) => entry.id === ELEMENT_ID);
  assert.equal(matches.length, 1, `exactly one element with id ${ELEMENT_ID} should exist`);
  return matches[0];
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('sw-learning-guide: document covers the technology map and clarifications', () => {
  // GIVEN the semantic-web learning guide was authored from the background explanation
  // WHEN the HTML source is inspected
  // THEN it contains terminology clarifications, the technology-stack map and the OWA/CWA distinction
  const html = readHtml();
  assert.match(html, /术语澄清/, 'should contain terminology clarifications');
  assert.match(html, /W3C/, 'should clarify what W3C is');
  assert.match(html, /SWRL/, 'should clarify SWRL');
  assert.match(html, /SHACL/, 'should clarify SHACL');
  assert.match(html, /OWA|开放世界/, 'should explain the open-world assumption');
  assert.match(html, /CWA|封闭世界/, 'should explain the closed-world assumption');
  assert.match(html, /entailment|推理/, 'should frame the entailment line');
  assert.match(html, /validation|校验/, 'should frame the validation line');
});

test('sw-learning-guide: document covers the per-technology survey and learning path', () => {
  // GIVEN the guide must be usable as a self-study reference
  // WHEN the HTML source is inspected
  // THEN it has a per-technology survey table and a staged learning path
  const html = readHtml();
  assert.match(html, /逐技术速览/, 'should contain the per-technology survey');
  assert.match(html, /学习路径/, 'should contain the learning path');
  assert.match(html, /阶段\s*0/, 'should stage the learning path');
  assert.match(html, /disjointWith/, 'should name OWL disjointness');
  assert.match(html, /FunctionalProperty/, 'should name OWL functional properties');
  assert.match(html, /maxCount/, 'should name the SHACL cardinality constraint');
  assert.match(html, /sh:not/, 'should name the SHACL negation constraint');
});

test('sw-learning-guide: document embeds a verifiable reference list with live links', () => {
  // GIVEN large sources are referenced by link instead of copied
  // WHEN the reference section is inspected
  // THEN the primary W3C specs, tools, the free book and industrial sources are linked
  const html = readHtml();
  assert.match(html, /参考资料与链接/, 'should contain the reference section');
  const links = [
    'https://www.w3.org/TR/rdf11-primer/',
    'https://www.w3.org/TR/owl2-primer/',
    'https://www.w3.org/TR/shacl/',
    'https://www.w3.org/TR/owl2-profiles/',
    'https://www.w3.org/Submission/SWRL/',
    'https://www.w3.org/TR/sparql11-query/',
    'http://book.validatingrdf.com/',
    'https://github.com/RDFLib/pySHACL',
    'https://github.com/liveontologies/elk-reasoner',
    'http://www.hermit-reasoner.com/',
    'https://rdf4j.org/documentation/programming/shacl/',
    'https://docs.stardog.com/data-quality-constraints',
    'https://graphdb.ontotext.com/documentation/10.8/shacl-validation.html',
    'https://neo4j.com/docs/cypher-manual/current/constraints/',
    'https://docs.aws.amazon.com/neptune/latest/userguide/feature-sparql-compliance.html',
    'http://robot.obolibrary.org/reason',
  ];
  for (const url of links) {
    assert.ok(html.includes(url), `reference list should include ${url}`);
  }
  assert.match(html, /已核验/, 'should mark which links were verified online');
});

test('sw-learning-guide: document maps the technologies to the ArchGraph L2 gate', () => {
  // GIVEN the guide exists to support the write-time contradiction gate
  // WHEN the mapping section is inspected
  // THEN it ties deterministic contradictions to SHACL blocking and others to advisory/offline
  const html = readHtml();
  assert.match(html, /L2/, 'should map back to the L2 contradiction gate');
  assert.match(html, /写时阻塞/, 'should state what can block write-time');
  assert.match(html, /建议型|advisory/, 'should state advisory-only cases');
  assert.match(html, /fail-open/, 'should keep the fail-open default');
  assert.match(html, /单写者/, 'should keep the single-writer guard');
});

test('sw-learning-guide: a valid non-empty PDF deliverable exists', () => {
  // GIVEN the user asked for a PDF compilation
  // WHEN the PDF file is inspected
  // THEN it exists, is non-trivially sized and starts with the PDF magic header
  assert.ok(existsSync(PDF_DOC), 'learning guide PDF should exist');
  assert.ok(statSync(PDF_DOC).size > 10000, 'PDF should be non-trivially sized');
  const head = readFileSync(PDF_DOC).subarray(0, 5).toString('latin1');
  assert.equal(head, '%PDF-', 'PDF should start with the %PDF- magic header');
});

test('sw-learning-guide: graph contains the guide Business Object with attributes and a GIVEN-WHEN-THEN testcase', () => {
  // GIVEN the learning guide was stored in the intent graph
  // WHEN the element is looked up
  // THEN it is a Business Object carrying a description, the doc/pdf paths and an executable testcase
  const el = guideElement();
  assert.equal(el.name, ELEMENT_NAME, 'element name should match');
  assert.equal(el.type, 'Business Object', 'element should be a Business Object');
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

test('sw-learning-guide: guide is a member of the consistency tech-reference view under its parent', () => {
  // GIVEN the guide is filed under the consistency tech-reference topic view
  // WHEN views are inspected
  // THEN the view exists, hangs off the parent grouping and includes the guide element
  const view = GRAPH.views.find((v) => v.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.equal(view.parent_element_id, PARENT_ID, `view ${VIEW_ID} should be mounted under ${PARENT_ID}`);
  assert.ok(
    view.included_elements.includes(ELEMENT_ID),
    `${VIEW_ID} should include the guide element`
  );
});
