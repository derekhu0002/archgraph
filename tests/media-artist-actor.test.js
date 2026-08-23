'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);
const AGENT_FILE = path.join(ROOT, 'argo', 'agents', 'media-artist.agent.md');

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

test('media-artist-actor: a dedicated Business Actor is registered for media generation', () => {
  // GIVEN the intent graph models the AgentOrganization team
  // WHEN a caller looks up the dedicated image/video generation Business Actor
  // THEN a unique Business Actor named 媒体艺术家 exists under AgentOrganization with a non-empty description
  const actors = GRAPH.elements.filter((entry) => entry.name === '媒体艺术家');
  assert.equal(actors.length, 1, 'exactly one Business Actor named 媒体艺术家 should exist');
  const actor = actors[0];
  assert.equal(actor.type, 'Business Actor', '媒体艺术家 should be a Business Actor');
  assert.equal(actor.parent, '1962', '媒体艺术家 should hang under AgentOrganization');
  assert.ok(
    actor.description && actor.description.trim().length > 0,
    '媒体艺术家 should carry a non-empty description (system prompt)'
  );
  assert.match(actor.description, /图片/, 'description should mention image generation');
  assert.match(actor.description, /DashScope/, 'description should mention DashScope');
});

test('media-artist-actor: the actor is assigned to the 图片视频生成 Business Role', () => {
  // GIVEN the dedicated media generation actor exists
  // WHEN a caller inspects its assignment
  // THEN it is assigned to the 图片视频生成 Business Role via an Assignment relationship
  const actor = GRAPH.elements.find((entry) => entry.name === '媒体艺术家' && entry.type === 'Business Actor');
  const role = GRAPH.elements.find((entry) => entry.name === '图片视频生成' && entry.type === 'Business Role');
  assert.ok(actor, 'actor should exist');
  assert.ok(role, 'role should exist');
  assert.equal(role.parent, '1962', '图片视频生成 role should hang under AgentOrganization');

  const assignment = GRAPH.relationships.find((rel) => (
    rel.type === 'Assignment' && rel.source_id === actor.id && rel.target_id === role.id
  ));
  assert.ok(assignment, 'an Assignment relationship should link 媒体艺术家 to 图片视频生成');
  assert.equal(assignment.statement, '媒体艺术家 --(Assignment)--> 图片视频生成');
});

test('media-artist-actor: role uses the media generation and visual inspection skills', () => {
  // GIVEN the media role is responsible for generating images and videos
  // WHEN a caller inspects its skill usage
  // THEN it is associated with dashscope-media-generator and qwen3-vl-visual-inspection
  const role = GRAPH.elements.find((entry) => entry.name === '图片视频生成' && entry.type === 'Business Role');
  assert.ok(role, 'role should exist');

  const genSkill = GRAPH.elements.find((entry) => entry.name === 'dashscope-media-generator' && entry.type === 'Skill');
  const vlSkill = GRAPH.elements.find((entry) => entry.name === 'qwen3-vl-visual-inspection' && entry.type === 'Skill');
  assert.ok(genSkill, 'dashscope-media-generator skill should exist');
  assert.ok(vlSkill, 'qwen3-vl-visual-inspection skill should exist');

  const genRel = GRAPH.relationships.find((rel) => (
    rel.type === 'Association' && rel.source_id === role.id && rel.target_id === genSkill.id
  ));
  const vlRel = GRAPH.relationships.find((rel) => (
    rel.type === 'Association' && rel.source_id === role.id && rel.target_id === vlSkill.id
  ));
  assert.ok(genRel, 'role should be associated with dashscope-media-generator');
  assert.ok(vlRel, 'role should be associated with qwen3-vl-visual-inspection');
});

test('media-artist-actor: actor, role, and relationships are visible in the 媒体创作团队 view', () => {
  // GIVEN the dedicated media sub-view exists under AgentOrganization
  // WHEN a caller resolves the 媒体创作团队 view
  // THEN it includes the actor, the role, both skills, and the Assignment/Association relationships
  const actor = GRAPH.elements.find((entry) => entry.name === '媒体艺术家' && entry.type === 'Business Actor');
  const role = GRAPH.elements.find((entry) => entry.name === '图片视频生成' && entry.type === 'Business Role');
  const genSkill = GRAPH.elements.find((entry) => entry.name === 'dashscope-media-generator');
  const vlSkill = GRAPH.elements.find((entry) => entry.name === 'qwen3-vl-visual-inspection');
  const assignment = GRAPH.relationships.find((rel) => (
    rel.type === 'Assignment' && rel.source_id === actor.id && rel.target_id === role.id
  ));

  const view = GRAPH.views.find((entry) => entry.view_id === 'media-team-001');
  assert.ok(view, 'view media-team-001 should exist');
  assert.equal(view.view_name, '媒体创作团队');
  assert.equal(view.parent_element_id, '1962');
  assert.ok(view.included_elements.includes(actor.id), 'view should include the actor');
  assert.ok(view.included_elements.includes(role.id), 'view should include the role');
  assert.ok(view.included_elements.includes(genSkill.id), 'view should include dashscope-media-generator');
  assert.ok(view.included_elements.includes(vlSkill.id), 'view should include qwen3-vl-visual-inspection');
  assert.ok(view.included_relationships.includes(assignment.id), 'view should include the assignment');
});

test('media-artist-agent-file: a VS Code custom agent defines the media artist role', () => {
  // GIVEN the 媒体艺术家 needs to be invokable as a VS Code custom agent
  // WHEN a caller inspects the agent definition file
  // THEN argo/agents/media-artist.agent.md exists with name/tools frontmatter and DashScope constraints
  const md = readFileSync(AGENT_FILE, 'utf8');
  const meta = parseAgentFrontmatter(md);

  assert.equal(meta.name, '媒体艺术家', 'frontmatter should name the agent 媒体艺术家');
  assert.ok(meta.model, 'frontmatter should declare a model');
  assert.ok(meta.tools, 'frontmatter should declare a tools list');
  assert.match(meta.tools, /read/, 'tools should include read');
  assert.match(meta.tools, /edit/, 'tools should include edit');
  assert.match(meta.tools, /search/, 'tools should include search');
  assert.match(meta.tools, /execute/, 'tools should include execute');
  assert.match(md, /text2image/, 'agent body should document the text2image endpoint');
  assert.match(md, /qwen-image/, 'agent body should document the qwen-image model');
  assert.match(md, /qwen3-vl-plus/, 'agent body should document visual inspection');
  assert.match(md, /QWEN_KEY/, 'agent body should reference the QWEN_KEY credential');
});
