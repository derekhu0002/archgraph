'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIRS = [
  path.join(ROOT, '.opencode', 'skills', 'excalidraw-diagram'),
  path.join(ROOT, '.github', 'skills', 'excalidraw-diagram'),
];
const REFERENCES = [
  'color-palette.md',
  'element-templates.md',
  'json-schema.md',
  'render_excalidraw.py',
  'render_template.html',
  'pyproject.toml',
];

test('excalidraw-diagram-skill: verbatim upstream skill is installed', () => {
  // GIVEN the mainstream coleam00/excalidraw-diagram-skill is installed verbatim
  // WHEN a developer or agent inspects the repository
  // THEN the SKILL.md and its references live under .opencode/skills/excalidraw-diagram/
  //    AND .github/skills/excalidraw-diagram/
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
