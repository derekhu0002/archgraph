'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'tablet-archgraph-app-insight.md');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const INSIGHT_ID = 'insight-lead-milestone-tablet-app-001';
const INSIGHT_NAME = '里程碑：Android平板「一页」架构图App方向洞察';
const LTM_VIEW_ID = 'insight-lead-ltm-001';
const ACTOR_ID = 'insight-lead-001';

function readDoc() {
  assert.ok(existsSync(DOC), 'tablet app insight report should exist');
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

test('tablet-app-insight: report covers the five McKinsey steps', () => {
  // GIVEN the insight team produced a direction insight via the McKinsey five-step method
  // WHEN the report is inspected
  // THEN it contains the problem statement, MECE issue tree, hypotheses, evidence-based
  //      verification and the synthesis sections
  const doc = readDoc();
  assert.match(doc, /问题陈述/, 'report should contain a problem statement');
  assert.match(doc, /议题树/, 'report should contain an issue tree');
  assert.match(doc, /MECE/, 'report should state the MECE decomposition');
  assert.match(doc, /假设/, 'report should contain a hypotheses section');
  assert.match(doc, /来源清单/, 'report should contain a source list');
  assert.match(doc, /核心结论/, 'report should drive to core conclusions');
});

test('tablet-app-insight: report states the honest BAILIAN coverage limitation', () => {
  // GIVEN the validation step could not use the mandated BAILIAN MCP
  // WHEN the report is inspected
  // THEN it explicitly declares the coverage limitation instead of substituting model memory
  const doc = readDoc();
  assert.match(doc, /BAILIAN/, 'report should mention the BAILIAN MCP channel');
  assert.match(doc, /未挂载|未完成/, 'report should declare BAILIAN was not mounted/complete');
  assert.match(doc, /webfetch/, 'report should state the actual retrieval channel used');
});

test('tablet-app-insight: report recommends a thin-client PWA->TWA tablet app with hub reachability/security', () => {
  // GIVEN the direction must decide form factor and reachability
  // WHEN the report is inspected
  // THEN it recommends thin client + PWA->TWA, names the loopback blocker and the secure exposure options
  const doc = readDoc();
  assert.match(doc, /瘦客户端/, 'report should recommend a thin client');
  assert.match(doc, /PWA/, 'report should cover PWA');
  assert.match(doc, /TWA/, 'report should cover TWA packaging');
  assert.match(doc, /127\.0\.0\.1/, 'report should name the loopback binding blocker');
  assert.match(doc, /Cloudflare\s*Tunnel/, 'report should name Cloudflare Tunnel as an exposure option');
  assert.match(doc, /ngrok/, 'report should name ngrok as an exposure option');
  assert.match(doc, /preview\s*→\s*apply|preview→apply/, 'report should keep the preview->apply write gate');
});

test('tablet-app-insight: report gives a phased roadmap and route comparison', () => {
  // GIVEN the synthesis must be decision-ready
  // WHEN the report is inspected
  // THEN it contains a route comparison table and a P0/P1/P2 phased roadmap
  const doc = readDoc();
  assert.match(doc, /实现路线对比表/, 'report should contain an implementation route comparison table');
  assert.match(doc, /分期路线/, 'report should contain a phased roadmap');
  assert.match(doc, /P0/, 'roadmap should include P0');
  assert.match(doc, /P1/, 'roadmap should include P1');
  assert.match(doc, /P2/, 'roadmap should include P2');
});

test('tablet-app-insight: graph contains the milestone Business Object with a GIVEN-WHEN-THEN testcase', () => {
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

test('tablet-app-insight: milestone is a member of the insight-lead T2 long-term memory view', () => {
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
