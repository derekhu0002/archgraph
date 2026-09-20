'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'graph-write-time-contradiction-insight.md');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const INSIGHT_ID = 'insight-lead-milestone-write-time-contradiction-001';
const INSIGHT_NAME = '里程碑：知识图谱写入时逻辑矛盾检测业界洞察';
const LTM_VIEW_ID = 'insight-lead-ltm-001';
const ACTOR_ID = 'insight-lead-001';

function readDoc() {
  assert.ok(existsSync(DOC), 'write-time contradiction insight report should exist');
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

test('write-contradiction-insight: report covers the five McKinsey steps', () => {
  // GIVEN the insight team ran the McKinsey five-step method on the write-time contradiction question
  // WHEN the report is inspected
  // THEN it contains the problem statement, MECE issue tree, hypotheses, evidence-based
  //      verification, the synthesis and an explicit limitations section
  const doc = readDoc();
  assert.match(doc, /问题陈述/, 'report should contain a problem statement');
  assert.match(doc, /议题树/, 'report should contain an issue tree');
  assert.match(doc, /MECE/, 'report should state the MECE decomposition');
  assert.match(doc, /假设/, 'report should contain a hypotheses section');
  assert.match(doc, /来源清单/, 'report should contain a source list');
  assert.match(doc, /核心结论/, 'report should drive to core conclusions');
  assert.match(doc, /局限/, 'report should state its limitations');
});

test('write-contradiction-insight: report states the honest BAILIAN coverage limitation', () => {
  // GIVEN the validation step could not use the mandated BAILIAN MCP
  // WHEN the report is inspected
  // THEN it explicitly declares the coverage limitation instead of substituting model memory
  const doc = readDoc();
  assert.match(doc, /BAILIAN/, 'report should mention the BAILIAN MCP channel');
  assert.match(doc, /未挂载/, 'report should declare BAILIAN was not mounted');
  assert.match(doc, /webfetch/, 'report should state the actual retrieval channel used');
  assert.match(doc, /401|DASHSCOPE_API_KEY/, 'report should name the concrete blocker');
});

test('write-contradiction-insight: report distinguishes contradiction from duplication', () => {
  // GIVEN the core question stresses that contradiction is not duplicate detection
  // WHEN the report is inspected
  // THEN it repeatedly frames contradiction as asymmetric entailment/negation vs symmetric similarity
  const doc = readDoc();
  assert.match(doc, /去重\s*≠\s*矛盾|矛盾\s*≠\s*重复|矛盾与去重/, 'report should state dedup != contradiction');
  assert.match(doc, /非对称/, 'report should call out the asymmetric (entailment/negation) nature');
  assert.match(doc, /相似度/, 'report should contrast against similarity');
});

test('write-contradiction-insight: report covers the formal, engine and industrial layers', () => {
  // GIVEN the MECE tree spans standards, engines and industrial practice
  // WHEN the report is inspected
  // THEN it names the representative standards, engines and practices across the axes
  const doc = readDoc();
  assert.match(doc, /OWL 2/, 'report should cover OWL 2');
  assert.match(doc, /SHACL/, 'report should cover SHACL');
  assert.match(doc, /SWRL/, 'report should cover SWRL');
  assert.match(doc, /ELK/, 'report should cover the ELK reasoner');
  assert.match(doc, /HermiT/, 'report should cover HermiT');
  assert.match(doc, /Openllet|Pellet/, 'report should cover Pellet/Openllet');
  assert.match(doc, /RDF4J|ShaclSail/, 'report should cover RDF4J ShaclSail');
  assert.match(doc, /Stardog/, 'report should cover Stardog ICV');
  assert.match(doc, /GraphDB|Ontotext/, 'report should cover Ontotext GraphDB');
  assert.match(doc, /Neo4j/, 'report should cover Neo4j');
  assert.match(doc, /Neptune/, 'report should cover Amazon Neptune');
  assert.match(doc, /ROBOT/, 'report should cover ontology CI (ROBOT)');
  assert.match(doc, /Great Expectations/, 'report should cover a data-quality framework');
});

test('write-contradiction-insight: report separates write-time blocking from advisory and deterministic from scoring', () => {
  // GIVEN the question demands distinguishing blocking vs offline and deterministic vs advisory
  // WHEN the report is inspected
  // THEN the distinction is explicit, including transaction-level blocking evidence
  const doc = readDoc();
  assert.match(doc, /写时阻塞/, 'report should discuss write-time blocking');
  assert.match(doc, /建议型|advisory/, 'report should discuss advisory checks');
  assert.match(doc, /事务/, 'report should discuss transactions');
  assert.match(doc, /commit\(\)/, 'report should cite commit()-time validation');
  assert.match(doc, /guard mode/, 'report should cite Stardog guard mode');
  assert.match(doc, /确定性/, 'report should distinguish deterministic rules');
});

test('write-contradiction-insight: report rules on the ML/LLM layer and its limits', () => {
  // GIVEN the MECE tree includes ML/LLM approaches
  // WHEN the report is inspected
  // THEN it treats NLI/LLM as advisory and rules out KGE for consistency
  const doc = readDoc();
  assert.match(doc, /NLI/, 'report should cover NLI');
  assert.match(doc, /contradiction/, 'report should name the NLI contradiction label');
  assert.match(doc, /KGE|知识图谱嵌入/, 'report should cover KGE');
  assert.match(doc, /link prediction|链接预测/, 'report should state KGE is for link prediction');
});

test('write-contradiction-insight: report gives a decision-ready comparison table and ArchGraph recommendations', () => {
  // GIVEN the synthesis must be decision-ready for ArchGraph's write gates
  // WHEN the report is inspected
  // THEN it gives a comparison table plus layered recommendations with preconditions
  const doc = readDoc();
  assert.match(doc, /对比表/, 'report should contain a comparison table');
  assert.match(doc, /L2/, 'report should propose an L2 contradiction gate alongside L0/L1');
  assert.match(doc, /severity/, 'report should reuse severity gating');
  assert.match(doc, /fail-open/, 'report should require fail-open default');
  assert.match(doc, /recall/, 'report should protect recall-first');
  assert.match(doc, /单写者/, 'report should keep a single-writer guard for concurrent emergence');
  assert.match(doc, /preview\s*→\s*apply|preview→apply/, 'report should keep the preview->apply write gate');
});

test('write-contradiction-insight: report declares the uncovered source categories', () => {
  // GIVEN some primary sources could not be retrieved
  // WHEN the report is inspected
  // THEN it names Wikidata and the Chinese/video coverage gaps instead of fabricating
  const doc = readDoc();
  assert.match(doc, /Wikidata/, 'report should name Wikidata');
  assert.match(doc, /抓取失败|transport error/, 'report should state the Wikidata fetch failure');
  assert.match(doc, /中文/, 'report should declare the Chinese-community gap');
  assert.match(doc, /YouTube/, 'report should declare the video-source gap');
});

test('write-contradiction-insight: graph contains the milestone Business Object with a GIVEN-WHEN-THEN testcase', () => {
  // GIVEN the insight was registered in the intent graph
  // WHEN the milestone element is looked up
  // THEN a Business Object exists with a description and an executable acceptance testcase
  const el = insightElement();
  assert.equal(el.id, INSIGHT_ID, 'insight element id should match');
  assert.equal(el.type, 'Business Object', 'insight element should be a Business Object');
  assert.ok(el.description && el.description.trim().length > 0, 'insight element should carry a description');
  assert.ok(Array.isArray(el.testcases) && el.testcases.length > 0, 'insight element should carry testcases');
  assert.ok(
    el.testcases.some((tc) => isGivenWhenThen(tc.description || '')),
    'at least one testcase should be written GIVEN-WHEN-THEN'
  );
});

test('write-contradiction-insight: milestone is a member of the insight-lead T2 long-term memory view', () => {
  // GIVEN the insight is the insight team's long-term memory
  // WHEN views are inspected
  // THEN the insight-lead long-term memory view includes the milestone element
  const view = GRAPH.views.find((v) => v.view_id === LTM_VIEW_ID);
  assert.ok(view, `view ${LTM_VIEW_ID} should exist`);
  assert.equal(view.parent_element_id, ACTOR_ID, `view ${LTM_VIEW_ID} should be mounted under ${ACTOR_ID}`);
  assert.ok(
    view.included_elements.includes(INSIGHT_ID),
    `${LTM_VIEW_ID} should include the insight element`
  );
});
