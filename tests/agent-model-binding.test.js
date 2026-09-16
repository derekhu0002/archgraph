'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, '.opencode', 'agents');
const REQUIRED_MODEL = 'deepseek/deepseek-flash';

function parseFrontmatter(md) {
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!m) {
    throw new Error('agent definition is missing a YAML frontmatter block');
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

function agentFiles() {
  return readdirSync(AGENTS_DIR).filter(name => name.endsWith('.md'));
}

test('agent-model-binding: every repo agent pins the unified DeepSeek flash model', () => {
  // GIVEN the repository defines OpenCode agents under .opencode/agents/
  // WHEN each agent definition's frontmatter is inspected
  // THEN it pins the single unified model id deepseek/deepseek-flash
  const files = agentFiles();
  assert.ok(files.length > 0, 'repo should define at least one OpenCode agent');

  for (const name of files) {
    const md = readFileSync(path.join(AGENTS_DIR, name), 'utf8');
    const meta = parseFrontmatter(md);
    assert.equal(
      meta.model,
      REQUIRED_MODEL,
      `${name} must pin model "${REQUIRED_MODEL}"`,
    );
  }
});

test('agent-model-binding: no repo agent pins a non-DeepSeek provider', () => {
  // GIVEN the team standardized on one DeepSeek flash model
  // WHEN each agent definition is inspected
  // THEN no agent references a qwen / alibaba-cn provider binding
  for (const name of agentFiles()) {
    const md = readFileSync(path.join(AGENTS_DIR, name), 'utf8');
    assert.doesNotMatch(md, /alibaba-cn|qwen/i, `${name} must not bind a Qwen provider`);
  }
});
