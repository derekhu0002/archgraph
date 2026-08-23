'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

test('video-team-actor: dedicated Business Actors are registered for the video team', () => {
  // GIVEN the intent graph models the AgentOrganization team
  // WHEN a caller looks up the dedicated video production/review/lead Business Actors
  // THEN unique Business Actors named 视频制作 / 视频审核 / 视频制作Leader exist under AgentOrganization
  //      with non-empty descriptions
  const producer = GRAPH.elements.find((entry) => entry.name === '视频制作' && entry.type === 'Business Actor');
  const reviewer = GRAPH.elements.find((entry) => entry.name === '视频审核' && entry.type === 'Business Actor');
  const leader = GRAPH.elements.find((entry) => entry.name === '视频制作Leader' && entry.type === 'Business Actor');
  assert.ok(producer, '视频制作 should be a registered Business Actor');
  assert.ok(reviewer, '视频审核 should be a registered Business Actor');
  assert.ok(leader, '视频制作Leader should be a registered Business Actor');
  assert.equal(producer.parent, '1962', '视频制作 should hang under AgentOrganization');
  assert.equal(reviewer.parent, '1962', '视频审核 should hang under AgentOrganization');
  assert.equal(leader.parent, '1962', '视频制作Leader should hang under AgentOrganization');
  assert.ok(producer.description && producer.description.trim().length > 0, '视频制作 should carry a non-empty description');
  assert.ok(reviewer.description && reviewer.description.trim().length > 0, '视频审核 should carry a non-empty description');
  assert.ok(leader.description && leader.description.trim().length > 0, '视频制作Leader should carry a non-empty description');
  assert.match(producer.description, /视频/, '视频制作 description should mention video');
  assert.match(reviewer.description, /视频/, '视频审核 description should mention video');
});

test('video-team-actor: the video generation skill is registered', () => {
  // GIVEN the video team needs to synthesize videos
  // WHEN a caller looks up the video generation Skill
  // THEN a unique Skill named dashscope-video-generator exists with a non-empty description
  const skills = GRAPH.elements.filter((entry) => entry.name === 'dashscope-video-generator');
  assert.equal(skills.length, 1, 'exactly one Skill named dashscope-video-generator should exist');
  const skill = skills[0];
  assert.equal(skill.type, 'Skill', 'dashscope-video-generator should be a Skill');
  assert.equal(skill.parent, '1249', 'dashscope-video-generator should hang under Implementation and Migration Viewpoint');
  assert.ok(skill.description && skill.description.trim().length > 0, 'dashscope-video-generator should carry a non-empty description');
  assert.match(skill.description, /视频/, 'description should mention video generation');
  assert.match(skill.description, /DashScope/, 'description should mention DashScope');
});

test('video-team-actor: 视频制作 directly uses dashscope-video-generator', () => {
  // GIVEN the video producer actor synthesizes videos
  // WHEN a caller inspects its direct skill usage
  // THEN it is associated with dashscope-video-generator via a direct relationship
  const producer = GRAPH.elements.find((entry) => entry.name === '视频制作' && entry.type === 'Business Actor');
  const skill = GRAPH.elements.find((entry) => entry.name === 'dashscope-video-generator' && entry.type === 'Skill');
  assert.ok(producer, 'producer actor should exist');
  assert.ok(skill, 'dashscope-video-generator skill should exist');
  const rel = GRAPH.relationships.find((r) => r.source_id === producer.id && r.target_id === skill.id);
  assert.ok(rel, 'a direct relationship should link 视频制作 to dashscope-video-generator');
});

test('video-team-actor: 视频审核 directly uses qwen3-vl-visual-inspection', () => {
  // GIVEN the video reviewer verifies generated videos via keyframes
  // WHEN a caller inspects its direct skill usage
  // THEN it is associated with qwen3-vl-visual-inspection via a direct relationship
  const reviewer = GRAPH.elements.find((entry) => entry.name === '视频审核' && entry.type === 'Business Actor');
  const vlSkill = GRAPH.elements.find((entry) => entry.name === 'qwen3-vl-visual-inspection' && entry.type === 'Skill');
  assert.ok(reviewer, 'reviewer actor should exist');
  assert.ok(vlSkill, 'qwen3-vl-visual-inspection skill should exist');
  const rel = GRAPH.relationships.find((r) => r.source_id === reviewer.id && r.target_id === vlSkill.id);
  assert.ok(rel, 'a direct relationship should link 视频审核 to qwen3-vl-visual-inspection');
});

test('video-team-actor: 视频制作Leader orchestrates the producer and reviewer', () => {
  // GIVEN the video lead orchestrates the production workflow
  // WHEN a caller inspects its orchestration relationships
  // THEN it is related to both 视频制作 and 视频审核
  const leader = GRAPH.elements.find((entry) => entry.name === '视频制作Leader' && entry.type === 'Business Actor');
  const producer = GRAPH.elements.find((entry) => entry.name === '视频制作' && entry.type === 'Business Actor');
  const reviewer = GRAPH.elements.find((entry) => entry.name === '视频审核' && entry.type === 'Business Actor');
  assert.ok(leader, 'leader actor should exist');
  assert.ok(producer, 'producer actor should exist');
  assert.ok(reviewer, 'reviewer actor should exist');
  const toProducer = GRAPH.relationships.find((r) => r.source_id === leader.id && r.target_id === producer.id);
  const toReviewer = GRAPH.relationships.find((r) => r.source_id === leader.id && r.target_id === reviewer.id);
  assert.ok(toProducer, 'leader should relate to 视频制作');
  assert.ok(toReviewer, 'leader should relate to 视频审核');
});

test('video-team-actor: the shared 图片视频生成 role uses all three media skills', () => {
  // GIVEN the media role is responsible for generating images and videos
  // WHEN a caller inspects its skill usage
  // THEN it is associated with dashscope-media-generator, dashscope-video-generator
  //      and qwen3-vl-visual-inspection
  const role = GRAPH.elements.find((entry) => entry.name === '图片视频生成' && entry.type === 'Business Role');
  assert.ok(role, 'role should exist');
  const genSkill = GRAPH.elements.find((entry) => entry.name === 'dashscope-media-generator' && entry.type === 'Skill');
  const videoSkill = GRAPH.elements.find((entry) => entry.name === 'dashscope-video-generator' && entry.type === 'Skill');
  const vlSkill = GRAPH.elements.find((entry) => entry.name === 'qwen3-vl-visual-inspection' && entry.type === 'Skill');
  assert.ok(genSkill, 'dashscope-media-generator skill should exist');
  assert.ok(videoSkill, 'dashscope-video-generator skill should exist');
  assert.ok(vlSkill, 'qwen3-vl-visual-inspection skill should exist');
  const genRel = GRAPH.relationships.find((r) => r.source_id === role.id && r.target_id === genSkill.id);
  const videoRel = GRAPH.relationships.find((r) => r.source_id === role.id && r.target_id === videoSkill.id);
  const vlRel = GRAPH.relationships.find((r) => r.source_id === role.id && r.target_id === vlSkill.id);
  assert.ok(genRel, 'role should be associated with dashscope-media-generator');
  assert.ok(videoRel, 'role should be associated with dashscope-video-generator');
  assert.ok(vlRel, 'role should be associated with qwen3-vl-visual-inspection');
});

test('video-team-actor: actors, skills, and relationships are visible in the 视频创作团队 view', () => {
  // GIVEN the dedicated video team sub-view exists under AgentOrganization
  // WHEN a caller resolves the 视频创作团队 view
  // THEN it includes the three actors, the video generation skill, the visual inspection skill,
  //      and the team relationships
  const producer = GRAPH.elements.find((entry) => entry.name === '视频制作' && entry.type === 'Business Actor');
  const reviewer = GRAPH.elements.find((entry) => entry.name === '视频审核' && entry.type === 'Business Actor');
  const leader = GRAPH.elements.find((entry) => entry.name === '视频制作Leader' && entry.type === 'Business Actor');
  const videoSkill = GRAPH.elements.find((entry) => entry.name === 'dashscope-video-generator' && entry.type === 'Skill');
  const vlSkill = GRAPH.elements.find((entry) => entry.name === 'qwen3-vl-visual-inspection' && entry.type === 'Skill');
  const producerRel = GRAPH.relationships.find((r) => r.source_id === producer.id && r.target_id === videoSkill.id);
  const reviewerRel = GRAPH.relationships.find((r) => r.source_id === reviewer.id && r.target_id === vlSkill.id);
  const leadProducerRel = GRAPH.relationships.find((r) => r.source_id === leader.id && r.target_id === producer.id);
  const leadReviewerRel = GRAPH.relationships.find((r) => r.source_id === leader.id && r.target_id === reviewer.id);

  const view = GRAPH.views.find((entry) => entry.view_id === 'video-team-001');
  assert.ok(view, 'view video-team-001 should exist');
  assert.equal(view.view_name, '视频创作团队');
  assert.equal(view.parent_element_id, '1962');
  for (const el of [producer, reviewer, leader, videoSkill, vlSkill]) {
    assert.ok(view.included_elements.includes(el.id), `view should include ${el.name}`);
  }
  for (const rel of [producerRel, reviewerRel, leadProducerRel, leadReviewerRel]) {
    assert.ok(view.included_relationships.includes(rel.id), 'view should include the team relationships');
  }
});
