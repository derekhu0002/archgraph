'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'argo', 'skills', 'argo-init', 'SKILL.md');
const HARNESS = path.join(ROOT, 'argo', 'scripts', 'ensureArgoHarnessEnvironment.js');

// External-view acceptance tests for moving argo-init's deterministic tasks
// into the initializeWorkspace MCP interface: the skill must drive init through
// the MCP tool (in-process) instead of executing workspace-external scripts,
// and the harness module must expose its report builder for in-process reuse.

test('AT argo-init: skill drives deterministic init via initializeWorkspace (no workspace-external script)', () => {
  // GIVEN the argo-init skill
  const skill = fs.readFileSync(SKILL, 'utf8');
  // THEN it keeps its identity frontmatter, drives init via initializeWorkspace…
  assert.match(skill, /name: argo-init/, 'frontmatter name must be argo-init');
  assert.match(skill, /initializeWorkspace/, 'skill must call the initializeWorkspace interface');
  // …and must NOT instruct executing the workspace-external harness script
  assert.ok(!/ensureArgoHarnessEnvironment\.js/.test(skill), 'skill must not run the external harness script');
});

test('AT argo-init: ensureArgoHarnessEnvironment exports buildHarnessReport for in-process reuse', () => {
  // GIVEN the harness module
  const mod = require(HARNESS);
  // THEN it exposes the deterministic report builder (used by initializeWorkspace)
  // and keeps the CLI entry, guarded so requiring the module has no side effects
  assert.equal(typeof mod.buildHarnessReport, 'function', 'must export buildHarnessReport');
  assert.equal(typeof mod.main, 'function', 'must keep the CLI main');
});
