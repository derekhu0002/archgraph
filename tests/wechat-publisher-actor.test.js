'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);
const AGENT_FILE = path.join(ROOT, 'argo', 'agents', 'wechat-publisher.agent.md');

function parseAgentFrontmatter(md) {
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!m) {
    throw new Error('agent file is missing a YAML frontmatter block');
  }
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) {
      let value = kv[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      meta[kv[1]] = value;
    }
  }
  return meta;
}

test('wechat-publisher-actor: a dedicated Business Actor is registered for WeChat publishing', () => {
  // GIVEN the intent graph models the AgentOrganization team
  // WHEN a caller looks up the dedicated WeChat publishing Business Actor
  // THEN a unique Business Actor named 公众号发布员 exists under AgentOrganization with a non-empty system prompt
  const actors = GRAPH.elements.filter((entry) => entry.name === '公众号发布员');
  assert.equal(actors.length, 1, 'exactly one Business Actor named 公众号发布员 should exist');
  const actor = actors[0];
  assert.equal(actor.type, 'Business Actor', '公众号发布员 should be a Business Actor');
  assert.equal(actor.parent, '1962', '公众号发布员 should hang under AgentOrganization');
  assert.ok(
    actor.description && actor.description.trim().length > 0,
    '公众号发布员 should carry a non-empty description (system prompt)'
  );
});

test('wechat-publisher-actor: the actor is assigned to the 公众号发布 Business Role', () => {
  // GIVEN the dedicated WeChat publishing actor exists
  // WHEN a caller inspects its assignment
  // THEN it is assigned to the 公众号发布 Business Role via an Assignment relationship
  const actor = GRAPH.elements.find((entry) => entry.name === '公众号发布员' && entry.type === 'Business Actor');
  const role = GRAPH.elements.find((entry) => entry.name === '公众号发布' && entry.type === 'Business Role');
  assert.ok(actor, 'actor should exist');
  assert.ok(role, 'role should exist');
  assert.equal(role.parent, '1962', '公众号发布 role should hang under AgentOrganization');

  const assignment = GRAPH.relationships.find((rel) => (
    rel.type === 'Assignment' && rel.source_id === actor.id && rel.target_id === role.id
  ));
  assert.ok(assignment, 'an Assignment relationship should link 公众号发布员 to 公众号发布');
  assert.equal(assignment.statement, '公众号发布员 --(Assignment)--> 公众号发布');
});

test('wechat-publisher-actor: actor, role, and assignment are visible in the 公众号发布团队 view', () => {
  // GIVEN the dedicated publishing sub-view exists under AgentOrganization
  // WHEN a caller resolves the 公众号发布团队 view
  // THEN it includes the actor, the role, and the Assignment relationship
  const actor = GRAPH.elements.find((entry) => entry.name === '公众号发布员' && entry.type === 'Business Actor');
  const role = GRAPH.elements.find((entry) => entry.name === '公众号发布' && entry.type === 'Business Role');
  const assignment = GRAPH.relationships.find((rel) => (
    rel.type === 'Assignment' && rel.source_id === actor.id && rel.target_id === role.id
  ));

  const view = GRAPH.views.find((entry) => entry.view_id === '433');
  assert.ok(view, 'view 433 should exist');
  assert.equal(view.view_name, '公众号发布团队');
  assert.equal(view.parent_element_id, '1962');
  assert.ok(view.included_elements.includes(actor.id), 'view should include the actor');
  assert.ok(view.included_elements.includes(role.id), 'view should include the role');
  assert.ok(view.included_relationships.includes(assignment.id), 'view should include the assignment');
});

test('wechat-publisher-agent-file: a VS Code custom agent defines the publisher role', () => {
  // GIVEN the 公众号发布员 needs to be invokable as a VS Code custom agent
  // WHEN a caller inspects the agent definition file
  // THEN .github/agents/wechat-publisher.agent.md exists with name/tools frontmatter and draft-only constraints
  const md = readFileSync(AGENT_FILE, 'utf8');
  const meta = parseAgentFrontmatter(md);

  assert.equal(meta.name, '公众号发布员', 'frontmatter should name the agent 公众号发布员');
  assert.equal(meta.model, 'Qwen3.7-Plus', 'frontmatter should pin the Qwen3.7-Plus model');
  assert.ok(meta.tools, 'frontmatter should declare a tools list');
  assert.match(meta.tools, /read/, 'tools should include read');
  assert.match(meta.tools, /edit/, 'tools should include edit');
  assert.match(meta.tools, /search/, 'tools should include search');
  assert.match(meta.tools, /execute/, 'tools should include execute');
  assert.match(md, /wechat:draft/, 'agent body should document the wechat:draft command');
  assert.match(md, /48001/, 'agent body should document the 48001 api unauthorized constraint');
});
