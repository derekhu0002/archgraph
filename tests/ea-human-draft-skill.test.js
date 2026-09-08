'use strict';

// WP2792 (AT-2792-07): ea-human-draft skill — an independent argo skill (shipped in the
// archgraph-argo npm package, deployed like argo-init) that wraps the human-draft
// convergence procedure: assert preconditions -> extract semantic diff (ea-human-diff)
// -> git restore the .qea back to the committed baseline -> hand the proposal to the
// agent/user to write back into the canonical graph via ARGO.
//
// External-view acceptance: the skill file exists with its identity frontmatter and wraps
// the whole procedure (not just the diff tool), the npm package ships it, and the
// installer deploys it to every harness skill root (copilot / cursor / opencode / dsh /
// openclaw) without disturbing the existing 22 numbered deploy steps.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'argo', 'skills', 'ea-human-draft', 'SKILL.md');
const PKG = path.join(ROOT, 'package.json');
const INSTALL = path.join(ROOT, 'install-argo.ps1');
const TOOL = path.join(ROOT, 'argo', 'scripts', 'ea-human-diff.js');

test('ea-human-draft-skill (AT-2792-07): independent skill wraps assert -> diff -> revert -> handoff, packaged and deployed like argo-init', () => {
  // GIVEN the independent ea-human-draft skill ships in the argo npm package
  // THEN the SKILL.md exists with its identity frontmatter and wraps the full
  //   procedure — not just the diff extraction.
  assert.ok(fs.existsSync(SKILL), 'argo/skills/ea-human-draft/SKILL.md must exist');
  const skill = fs.readFileSync(SKILL, 'utf8');
  const name = skill.match(/^name:\s*(.+)$/m);
  assert.ok(name, 'frontmatter must carry name');
  assert.equal(name[1].trim(), 'ea-human-draft', 'skill name must equal its folder');

  // wraps: assertion, diff extraction (tool), revert, ARGO write-back handoff
  assert.ok(fs.existsSync(TOOL), 'referenced diff tool must exist in-repo');
  assert.match(skill, /ea-human-diff\.js/, 'skill must invoke the ea-human-diff tool');
  assert.match(skill, /git restore <项目\.qea>/, 'skill must revert the project .qea to the committed baseline (no hardcoded filename)');
  assert.match(skill, /previewSystemArchitectureMutation/, 'skill must write back through ARGO preview');
  assert.match(skill, /applySystemArchitectureMutation/, 'skill must write back through ARGO apply');
  assert.match(skill, /kg_sync_meta/, 'skill must state it reads the visible object model, not the mirror');
  assert.match(skill, /Assert/, 'skill must have an assertion phase');
  assert.match(skill, /MUST NOT/, 'skill must carry MUST NOT rules');

  // package.json ships the skill folder
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('argo/skills/ea-human-draft'),
    'package.json files must include argo/skills/ea-human-draft');

  // installer deploys it to every harness skill root …
  const install = fs.readFileSync(INSTALL, 'utf8');
  for (const dest of [
    '$SkillsRoot\\ea-human-draft',
    '$CursorSkillsRoot\\ea-human-draft',
    '$OpenCodeSkillsRoot\\ea-human-draft',
  ]) {
    assert.ok(install.includes(dest), 'installer must deploy ea-human-draft to ' + dest);
  }
  // dsh + openclaw (two extra destinations, via Join-Path on their home)
  const occurrences = install.split("skills') 'ea-human-draft'").length - 1;
  assert.ok(occurrences >= 2, 'installer must deploy ea-human-draft to dsh and openclaw skill homes');

  // …and the 22 numbered deploy steps with their required markers are untouched
  for (let i = 1; i <= 22; i++) {
    assert.ok(install.includes('[' + i + '/22]'), 'step marker [' + i + '/22] must exist');
  }
  assert.match(install, /\[16\/22\][^\n]*skills\\argo-init/, 'step 16 still deploys the argo-init skill (dsh)');
  assert.match(install, /\[21\/22\][^\n]*skills\\argo-init/, 'step 21 still deploys the argo-init skill (openclaw)');
});
