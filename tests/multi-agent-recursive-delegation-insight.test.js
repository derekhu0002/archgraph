'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'multi-agent-recursive-delegation-insight.md');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const INSIGHT_ID = 'insight-lead-milestone-multiagent-delegation-001';
const INSIGHT_NAME = '里程碑：框架级可递归派生通用Agent机制业界洞察';
const LTM_VIEW_ID = 'insight-lead-ltm-001';
const ACTOR_ID = 'insight-lead-001';

function readDoc() {
  assert.ok(existsSync(DOC), 'multi-agent delegation insight report should exist');
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

test('multiagent-insight: report covers the five McKinsey steps', () => {
  // GIVEN the insight team ran the McKinsey five-step method on the recursive-delegation question
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

test('multiagent-insight: report states the honest BAILIAN coverage limitation', () => {
  // GIVEN the validation step could not use the mandated BAILIAN MCP
  // WHEN the report is inspected
  // THEN it explicitly declares the coverage limitation instead of substituting model memory
  const doc = readDoc();
  assert.match(doc, /BAILIAN/, 'report should mention the BAILIAN MCP channel');
  assert.match(doc, /未挂载|未完成/, 'report should declare BAILIAN was not mounted/complete');
  assert.match(doc, /webfetch/, 'report should state the actual retrieval channel used');
  assert.match(doc, /401|Unauthorized|DASHSCOPE_API_KEY/, 'report should name the concrete blocker');
});

test('multiagent-insight: report compares the representative frameworks and protocols', () => {
  // GIVEN the question asks which representative solutions exist
  // WHEN the report is inspected
  // THEN it names and compares the major frameworks/protocols across the MECE axes
  const doc = readDoc();
  assert.match(doc, /Claude Code/, 'report should cover Claude Code subagents');
  assert.match(doc, /Anthropic/, 'report should cover the Anthropic orchestrator-worker system');
  assert.match(doc, /OpenAI (Agents SDK|Swarm)/, 'report should cover OpenAI handoffs');
  assert.match(doc, /AutoGen/, 'report should cover AutoGen');
  assert.match(doc, /CrewAI/, 'report should cover CrewAI');
  assert.match(doc, /ADK/, 'report should cover Google ADK');
  assert.match(doc, /LangGraph/, 'report should cover LangGraph');
  assert.match(doc, /A2A/, 'report should cover the A2A protocol');
  assert.match(doc, /AgentCard/, 'report should cover the A2A AgentCard definition/registry');
});

test('multiagent-insight: report rules on the four human settings including the permission conflict', () => {
  // GIVEN the human partner set four requirements (single generic role, recursion, feedback re-split,
  //       derived-permission inheritance)
  // WHEN the report is inspected
  // THEN it gives a per-setting verdict and exposes the least-privilege conflict on permissions
  const doc = readDoc();
  assert.match(doc, /单一通用角色/, 'report should rule on the single generic role setting');
  assert.match(doc, /递归派生/, 'report should rule on recursive spawning');
  assert.match(doc, /结果回馈|回馈/, 'report should rule on returning results to re-split');
  assert.match(doc, /派生权限/, 'report should rule on derived-permission inheritance');
  assert.match(doc, /least-privilege|最小权限/, 'report should cite the least-privilege practice');
  assert.match(doc, /权限放大/, 'report should name the privilege-amplification risk');
  assert.match(doc, /confused deputy/, 'report should name the confused-deputy risk');
});

test('multiagent-insight: report gives actionable ArchGraph recommendations and anti-patterns', () => {
  // GIVEN the synthesis must be decision-ready for the Graph framework integration
  // WHEN the report is inspected
  // THEN it contains concrete recommendations, the recursion depth bound, the preview->apply write gate,
  //      and an anti-pattern list
  const doc = readDoc();
  assert.match(doc, /反模式/, 'report should contain an anti-pattern list');
  assert.match(doc, /深度上限|3 层/, 'report should bound the recursion depth');
  assert.match(doc, /preview\s*→\s*apply|preview→apply/, 'report should keep the preview->apply write gate');
  assert.match(doc, /单写者|锁/, 'report should require a single writer for graph state');
});

test('multiagent-insight: graph contains the milestone Business Object with a GIVEN-WHEN-THEN testcase', () => {
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

test('multiagent-insight: milestone is a member of the insight-lead T2 long-term memory view', () => {
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
