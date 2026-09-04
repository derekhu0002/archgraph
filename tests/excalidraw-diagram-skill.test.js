'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
// The skill is deployed to the user-level harness skill roots (not in-repo).
const SKILL_DIRS = [
  path.join(HOME, '.copilot', 'skills', 'excalidraw-diagram'),
  path.join(HOME, '.config', 'opencode', 'skills', 'excalidraw-diagram'),
];
const REFERENCES = [
  'color-palette.md',
  'element-templates.md',
  'json-schema.md',
  'render_excalidraw.py',
  'render_template.html',
  'pyproject.toml',
];

test('excalidraw-diagram-skill: verbatim upstream skill is deployed at user level', () => {
  // GIVEN the mainstream coleam00/excalidraw-diagram-skill is deployed verbatim
  // WHEN a developer or agent checks the user-level harness skill roots
  // THEN the SKILL.md and its references live under ~/.copilot/skills/excalidraw-diagram/
  //    AND ~/.config/opencode/skills/excalidraw-diagram/
  for (const dir of SKILL_DIRS) {
    const skillMd = path.join(dir, 'SKILL.md');
    assert.ok(existsSync(skillMd), `${dir}/SKILL.md must exist`);
    const skill = readFileSync(skillMd, 'utf8');
    const name = skill.match(/^name:\s*(.+)$/m);
    assert.ok(name, `${dir}/SKILL.md must carry a name frontmatter`);
    assert.equal(name[1].trim(), 'excalidraw-diagram', `the skill name must be excalidraw-diagram (${dir})`);

    for (const ref of REFERENCES) {
      assert.ok(
        existsSync(path.join(dir, 'references', ref)),
        `${dir}/references/${ref} must exist in the verbatim upstream skill`,
      );
    }
  }
});
