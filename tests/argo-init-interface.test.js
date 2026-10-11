'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'argo', 'skills', 'argo-init', 'SKILL.md');
const HARNESS = path.join(ROOT, 'argo', 'scripts', 'ensureArgoHarnessEnvironment.js');

// External-view acceptance tests for argo-init: init moved from an MCP tool
// (slow, human/skill-triggered, caused client timeouts) to the `argo-init` CLI,
// which runs the SAME implementation (initializeWorkspaceReport) — functionally
// identical. The harness module keeps its report builder.

test('AT argo-init: skill drives deterministic init via the argo-init CLI (init removed from MCP)', () => {
  // GIVEN the argo-init skill
  const skill = fs.readFileSync(SKILL, 'utf8');
  // THEN it keeps its identity frontmatter and drives the argo-init CLI ...
  assert.match(skill, /name: argo-init/, 'frontmatter name must be argo-init');
  assert.match(skill, /`argo-init`/, 'skill must drive the argo-init CLI');
  // ... referencing the shared implementation (so the CLI and the old MCP tool match)
  assert.match(skill, /initializeWorkspaceReport/, 'skill must reference the functionally-identical implementation');
  // ... and the CLI entry exists
  assert.ok(fs.existsSync(path.join(ROOT, 'bin', 'argo-init.js')), 'bin/argo-init.js must exist');
});

test('AT argo-init: ensureArgoHarnessEnvironment exports buildHarnessReport for in-process reuse', () => {
  // GIVEN the harness module
  const mod = require(HARNESS);
  // THEN it exposes the deterministic report builder (used by the init report)
  // and keeps the CLI entry, guarded so requiring the module has no side effects
  assert.equal(typeof mod.buildHarnessReport, 'function', 'must export buildHarnessReport');
  assert.equal(typeof mod.main, 'function', 'must keep the CLI main');
});
