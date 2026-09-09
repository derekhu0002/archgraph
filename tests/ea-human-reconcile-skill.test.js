'use strict';

// AT-2792-12 (ea-human-reconcile skill): a global argo skill that wraps the LAST step of the
// human-draft flow — after `extract-human-draft` produced results/human-draft.md, the human
// hands it to the Agent, which analyzes it against the WHOLE architecture and gives advice,
// then the HUMAN decides. Static-review test:
//   - the skill exists at argo/skills/ea-human-reconcile/SKILL.md with identity frontmatter
//   - it states the division of labor: Agent analyzes + advises, human decides
//   - it MUST NOT apply without human decision
//   - it must analyze by reading the canonical graph (design/KG/SystemArchitecture.json) plus
//     ARGO MCP semantic context, not just the draft fields
//   - it must enumerate all 9 proposal ops and flag destructive ones (remove*) for confirmation
//   - package.json ships it; install-argo.ps1 deploys it to every harness skill root (like
//     argo-init) without disturbing the 22 numbered deploy steps

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'argo', 'skills', 'ea-human-reconcile', 'SKILL.md');
const PKG = path.join(ROOT, 'package.json');
const INSTALL = path.join(ROOT, 'install-argo.ps1');

test('ea-human-reconcile-skill (AT-2792-12): global skill wraps analyze-vs-whole-architecture -> advise -> human decides', () => {
  // GIVEN the global ea-human-reconcile skill ships in the argo npm package
  assert.ok(fs.existsSync(SKILL), 'argo/skills/ea-human-reconcile/SKILL.md must exist');
  const skill = fs.readFileSync(SKILL, 'utf8');
  const name = skill.match(/^name:\s*(.+)$/m);
  assert.ok(name, 'frontmatter must carry name');
  assert.equal(name[1].trim(), 'ea-human-reconcile', 'skill name must equal its folder');

  // division of labor: agent analyzes the draft against the whole architecture -> advises -> human decides
  assert.match(skill, /human-draft\.md/, 'skill must consume the EA human-draft extraction output');
  assert.match(skill, /结合全局分析|全局分析|结合.*全局/, 'skill must state the agent analyzes against the whole architecture');
  assert.match(skill, /人类裁决|由人类裁决|人类.*拍板/, 'skill must state the human is the final decision maker');
  assert.match(skill, /disable-model-invocation:\s*true/, 'skill must not be auto-invoked by the model (human-triggered only)');

  // MUST NOT apply without human decision; write-back goes through preview then apply
  assert.match(skill, /MUST NOT[\s\S]*applySystemArchitectureMutation/, 'skill must forbid applying without human decision');
  assert.match(skill, /MUST NOT[\s\S]*未经人类裁决/, 'skill must forbid applying before the human rules');
  assert.match(skill, /previewSystemArchitectureMutation[\s\S]*applySystemArchitectureMutation/, 'skill must preview before applying after the human agrees');

  // analyze the whole architecture, not just the draft fields
  assert.match(skill, /design[\/\\\\]KG[\/\\\\]SystemArchitecture\.json/, 'skill must reference the canonical graph as the analysis basis');
  assert.match(skill, /getIntentElementContext|getSystemArchitecture|queryNeo4jGraph/, 'skill must give the agent concrete query methods (semantic context + Cypher)');
  assert.match(skill, /queryNeo4jGraph/, 'skill must mention neo4j cypher as an analysis query path');

  // categorize proposals: destructive (remove*), add/update, and views
  assert.match(skill, /removeElement|removeRelationship|removeView/, 'skill must flag destructive (remove*) proposals');
  assert.match(skill, /删除\/破坏性/, 'skill must group destructive proposals for confirmation');
  assert.match(skill, /新增\/更新/, 'skill must cover add/update proposals');
  assert.match(skill, /级联|引用|依赖|悬空/, 'skill must reason about cascading/in-dependents/lingering references');

  // package.json ships it
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('argo/skills/ea-human-reconcile'),
    'package.json files must include argo/skills/ea-human-reconcile');

  // installer deploys it to every harness skill root, 22 numbered steps untouched
  const install = fs.readFileSync(INSTALL, 'utf8');
  for (const dest of ['$SkillsRoot\\ea-human-reconcile', '$CursorSkillsRoot\\ea-human-reconcile', '$OpenCodeSkillsRoot\\ea-human-reconcile']) {
    assert.ok(install.includes(dest), 'installer must deploy ea-human-reconcile to ' + dest);
  }
  const occurrences = install.split("skills\\ea-human-reconcile") .length - 1;
  assert.ok(occurrences >= 4, 'installer must deploy ea-human-reconcile to dsh + openclaw too');
  for (let i = 1; i <= 22; i++) {
    assert.ok(install.includes('[' + i + '/22]'), 'step marker [' + i + '/22] must exist');
  }
  assert.match(install, /\[16\/22\][^\n]*skills\\argo-init/, 'step 16 still deploys argo-init (dsh)');
  assert.match(install, /\[21\/22\][^\n]*skills\\argo-init/, 'step 21 still deploys argo-init (openclaw)');
});
