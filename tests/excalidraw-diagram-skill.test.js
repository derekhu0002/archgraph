'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(ROOT, '.opencode', 'skills', 'excalidraw-diagram');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
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
  assert.ok(existsSync(SKILL_MD), 'SKILL.md must exist');
  const skill = readFileSync(SKILL_MD, 'utf8');
  const name = skill.match(/^name:\s*(.+)$/m);
  assert.ok(name, 'SKILL.md must carry a name frontmatter');
  assert.equal(name[1].trim(), 'excalidraw-diagram', 'the skill name must be excalidraw-diagram');

  for (const ref of REFERENCES) {
    assert.ok(
      existsSync(path.join(SKILL_DIR, 'references', ref)),
      `references/${ref} must exist in the verbatim upstream skill`,
    );
  }
});
