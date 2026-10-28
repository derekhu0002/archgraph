'use strict';

// Framework-level acceptance tests for the one-field semantic read path.
//
// Friction matters: an agent picks the cheapest tool that looks correct. The
// graph read used to require two free-form fields (query.purpose + query.intent)
// while grep/read take one, so the correct path was the more expensive one.
// `query.intent` alone must now be enough; `purpose` is a strictness opt-in
// (`audit`), not a required ceremony.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TOOLS,
  validateExplicitQuery,
} = require('../argo/scripts/systemarchitecture-mcp-server.js');
const argoMcp = require('../argo/scripts/argo-mcp-server.js');

const RULES = path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md');

test('AT read-friction: an intent-only query is valid and defaults purpose to general', () => {
  // GIVEN only a natural-language intent
  const result = validateExplicitQuery({ intent: '  图谱写入前的去重门禁  ' });
  // THEN it passes and the effective purpose is general
  assert.equal(result.status, 'passed');
  assert.equal(result.query.purpose, 'general');
  assert.equal(result.query.intent, '图谱写入前的去重门禁');
});

test('AT read-friction: a bare intent string is accepted as shorthand', () => {
  const result = validateExplicitQuery('语义检索怎么用');
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.query, { purpose: 'general', intent: '语义检索怎么用' });
});

test('AT read-friction: an explicit purpose is preserved (audit stays an opt-in)', () => {
  const result = validateExplicitQuery({ purpose: 'audit', intent: 'prove closure', subject: 'e1' });
  assert.equal(result.status, 'passed');
  assert.equal(result.query.purpose, 'audit');
  assert.equal(result.query.subject, 'e1');
});

test('AT read-friction: the audit strictness still fails closed without a subject', () => {
  const result = validateExplicitQuery({ purpose: 'audit', intent: 'prove closure' });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.category, 'AUDIT_SUBJECT_REQUIRED');
});

test('AT read-friction: an unsupported purpose still fails closed', () => {
  const result = validateExplicitQuery({ purpose: 'browse', intent: 'x' });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.category, 'QUERY_PURPOSE_INVALID');
});

test('AT read-friction: a blank or missing intent still fails closed (never a silent full read)', () => {
  for (const query of [{}, { intent: '   ' }, '', 42, null, []]) {
    const result = validateExplicitQuery(query);
    assert.equal(result.status, 'failed', `expected a failure for ${JSON.stringify(query)}`);
    assert.equal(result.error.category, 'QUERY_INTENT_REQUIRED');
  }
});

test('AT read-friction: the tool schema advertises intent as the single required field', () => {
  const tool = TOOLS.find((candidate) => candidate.name === 'getSystemArchitecture');
  assert.ok(tool, 'getSystemArchitecture must be exposed');
  const query = tool.inputSchema.properties.query;
  // THEN query accepts an object or a bare intent string
  assert.ok(Array.isArray(query.anyOf), 'query must accept an object or a bare intent string');
  const objectBranch = query.anyOf.find((branch) => branch.type === 'object');
  const stringBranch = query.anyOf.find((branch) => branch.type === 'string');
  assert.ok(objectBranch && stringBranch);
  assert.deepEqual(objectBranch.required, ['intent'], 'only intent is required in the object form');
  assert.ok(objectBranch.properties.purpose, 'purpose remains available as an opt-in');
  assert.match(stringBranch.description, /intent/i);
  // AND the tool description no longer demands both fields up front
  assert.doesNotMatch(tool.description, /Always provide query\.purpose/);
  assert.match(tool.description, /query\.intent/);
  assert.match(tool.description, /defaults to/i);
});

test('AT read-friction: both MCP gateways advertise the same one-field contract', () => {
  // GIVEN the gateway (argo-mcp-server) and the domain server expose the tool twice
  const pick = (tools) => tools.find((tool) => tool.name === 'getSystemArchitecture');
  const argoTool = pick(argoMcp.TOOLS);
  const systemTool = pick(TOOLS);
  assert.ok(argoTool && systemTool, 'both servers must expose getSystemArchitecture');
  // THEN the schemas cannot drift (each server injects its own scoping param:
  // workspaceRoot on the gateway, projectId on the domain server)
  const normalize = (schema) => {
    const copy = JSON.parse(JSON.stringify(schema));
    for (const injected of ['workspaceRoot', 'projectId']) {
      if (copy.properties && copy.properties[injected]) delete copy.properties[injected];
    }
    return copy;
  };
  assert.deepEqual(
    normalize(argoTool.inputSchema),
    normalize(systemTool.inputSchema),
    'the gateway schema and the domain schema must stay identical',
  );
  // AND neither description restores the two-field ceremony
  for (const tool of [argoTool, systemTool]) {
    assert.match(tool.description, /one field is enough/i);
    assert.doesNotMatch(tool.description, /provide query\.purpose and query\.intent/i);
  }
});

test('AT read-friction: the rule text sends one field, not two', () => {
  const rules = fs.readFileSync(RULES, 'utf8');
  const tools = rules.match(/<ToolsGuideline>([\s\S]*?)<\/ToolsGuideline>/);
  const priority = rules.match(/<QueryPriorityGuideline>([\s\S]*?)<\/QueryPriorityGuideline>/);
  assert.ok(tools && priority);
  // THEN the rule no longer demands purpose + intent together
  assert.doesNotMatch(tools[1], /MUST supply query\.purpose \+ query\.intent/);
  assert.match(tools[1], /query\.intent/);
  assert.match(tools[1], /defaults to `?general`?/i);
  assert.match(priority[1], /query\.intent/);
  assert.match(priority[1], /query\.purpose`? defaults to `?general`?/i);
});
