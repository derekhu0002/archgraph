'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'dsh-plugin-publish.md');
const PKG_PATH = path.join(ROOT, 'package.json');
const PATCH_PATH = path.join(ROOT, 'cordis.patch.yml');

function loadDoc() {
  assert.ok(existsSync(DOC_PATH), 'docs/dsh-plugin-publish.md should exist');
  return readFileSync(DOC_PATH, 'utf8');
}

function loadPackageJson() {
  assert.ok(existsSync(PKG_PATH), 'package.json should exist');
  return JSON.parse(readFileSync(PKG_PATH, 'utf8'));
}

test('requirements-ready: requirement analysis documents user scenarios and GIVEN-WHEN-THEN acceptance', () => {
  // GIVEN the product manager performs requirement analysis for publishing ArchGraph as a native dsh plugin
  // WHEN a reader opens the requirements document
  // THEN it documents user scenarios and GIVEN-WHEN-THEN acceptance criteria
  const doc = loadDoc();
  assert.match(doc, /用户场景|User scenarios/, 'doc should have a user-scenarios section');
  assert.match(doc, /US-1|安装/, 'doc should describe the install user scenario');
  assert.match(doc, /GIVEN/, 'doc should contain GIVEN clauses');
  assert.match(doc, /WHEN/, 'doc should contain WHEN clauses');
  assert.match(doc, /THEN/, 'doc should contain THEN clauses');
  assert.match(doc, /dsh\.bundle/, 'doc should reference the dsh.bundle manifest');
  assert.match(doc, /dsh-plugin/, 'doc should reference the dsh-plugin topic');
});

test('bundle-manifest: package.json declares a dsh.bundle patch pointing at cordis.patch.yml', () => {
  // GIVEN the repository is packaged as an installable dsh bundle
  // WHEN dsh plugin add installs the package
  // THEN package.json carries a dsh.bundle.patch manifest resolving to cordis.patch.yml
  const pkg = loadPackageJson();
  const bundle = pkg.dsh && pkg.dsh.bundle;
  assert.ok(bundle, 'package.json should declare dsh.bundle');
  assert.equal(bundle.patch, './cordis.patch.yml', 'dsh.bundle.patch should point to ./cordis.patch.yml');
});

test('bundle-patch: cordis.patch.yml inserts argo-workspace and argo-wakeup rows by package name', () => {
  // GIVEN the bundle contributes its configuration layer
  // WHEN a profile lists this bundle
  // THEN its patch inserts the argo-workspace and argo-wakeup plugin rows referencing the package name (not file://)
  assert.ok(existsSync(PATCH_PATH), 'cordis.patch.yml should exist');
  const patch = readFileSync(PATCH_PATH, 'utf8');
  assert.match(patch, /argo-workspace/, 'patch should insert an argo-workspace row');
  assert.match(patch, /argo-wakeup/, 'patch should insert an argo-wakeup row');
  assert.ok(!/file:\/\/\//.test(patch), 'patch rows should reference the package by name, not file:// paths');
});

test('bundle-entry: the dsh-argo-workspace and dsh-argo-wakeup plugin modules ship in the bundle', () => {
  // GIVEN the bundle ships its plugin modules
  // WHEN Node resolves the patch rows by package name
  // THEN both plugin entry modules exist and export an apply function
  const workspaceEntry = path.join(ROOT, 'dsh-argo-workspace', 'index.js');
  const wakeupEntry = path.join(ROOT, 'dsh-argo-wakeup', 'index.js');
  assert.ok(existsSync(workspaceEntry), 'dsh-argo-workspace/index.js should exist');
  assert.ok(existsSync(wakeupEntry), 'dsh-argo-wakeup/index.js should exist');
  const workspace = readFileSync(workspaceEntry, 'utf8');
  const wakeup = readFileSync(wakeupEntry, 'utf8');
  assert.match(workspace, /export (async )?function apply/, 'workspace plugin should export apply');
  assert.match(wakeup, /export function apply/, 'wakeup plugin should export apply');
});

test('topic-tag: the GitHub repository is tagged dsh-plugin', async (t) => {
  // GIVEN the repository is public and published to the dsh-plugin topic
  // WHEN the publisher queries the repository topics
  // THEN the names include dsh-plugin
  let res;
  try {
    res = await fetch('https://api.github.com/repos/derekhu0002/archgraph/topics', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'archgraph-acceptance-test',
      },
    });
  } catch (err) {
    t.skip(`GitHub API not reachable in this environment (${err && err.message ? err.message : err}); verify the dsh-plugin topic manually`);
    return;
  }
  if (!res.ok) {
    t.skip(`GitHub API returned ${res.status}; verify the dsh-plugin topic manually`);
    return;
  }
  const body = await res.json();
  const names = Array.isArray(body.names) ? body.names : [];
  assert.ok(
    names.includes('dsh-plugin'),
    `repository topics should include dsh-plugin, got: ${JSON.stringify(names)}`,
  );
});
