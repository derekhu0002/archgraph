'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'dsh-plugin-design.md');
const GRAPH_PATH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const GRAPH = JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));

const WP_ID = '2767';

function readDoc() {
  assert.ok(existsSync(DOC), 'docs/dsh-plugin-design.md should exist');
  return readFileSync(DOC, 'utf8');
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('dsh-plugin-design: design doc exists and describes the single-package bundle structure', () => {
  // GIVEN the system designer produced the bundle solution design
  // WHEN the design doc is inspected
  // THEN it describes the overall single-package bundle structure with a Mermaid data-flow diagram
  const doc = readDoc();
  assert.match(doc, /总体结构/, 'doc should have an overall structure section');
  assert.match(doc, /单包/, 'doc should state the bundle reuses the single archgraph-argo package');
  assert.match(doc, /mermaid|flowchart/i, 'doc should include a Mermaid diagram');
  assert.match(doc, /dsh\.bundle/, 'doc should reference dsh.bundle');
  assert.match(doc, /cordis\.patch\.yml/, 'doc should reference cordis.patch.yml');
});

test('dsh-plugin-design: design doc covers every AD decision with a rejected alternative', () => {
  // GIVEN the design must decide the bundle shape, patch rows, entry layout, build policy and no-regression stance
  // WHEN the design doc is inspected
  // THEN each AD (a-e) is present with decision + rationale + rejected alternative
  const doc = readDoc();
  for (const ad of ['AD-a', 'AD-b', 'AD-c', 'AD-d', 'AD-e']) {
    assert.ok(doc.includes(ad), `doc should contain ${ad}`);
  }
  const rejectedCount = (doc.match(/被否方案/g) || []).length;
  assert.ok(rejectedCount >= 5, `each AD should list a rejected alternative (found ${rejectedCount})`);
});

test('dsh-plugin-design: AD-a adds dsh.bundle to the single package and extends files + exports subpaths', () => {
  // GIVEN the bundle reuses the existing archgraph-argo package
  // WHEN the AD-a decision is inspected
  // THEN it declares dsh.bundle.patch, extends files with the patch + entry dirs, and exposes the two exports subpaths
  const doc = readDoc();
  assert.match(doc, /dsh\.bundle\.patch/, 'AD-a should declare dsh.bundle.patch');
  assert.match(doc, /files/, 'AD-a should extend the files list');
  assert.match(doc, /exports/, 'AD-a should declare exports subpaths');
  assert.match(doc, /\.\/dsh-argo-workspace/, 'AD-a should export ./dsh-argo-workspace');
  assert.match(doc, /\.\/dsh-argo-wakeup/, 'AD-a should export ./dsh-argo-wakeup');
  assert.match(doc, /不映射\s*["'`.]/, 'AD-a should deliberately not map the "." root entry');
});

test('dsh-plugin-design: AD-b inserts two package-name rows and locates serverPath via import.meta.url', () => {
  // GIVEN the patch must be portable across machines
  // WHEN the AD-b decision is inspected
  // THEN the two rows reference the package by name (not file://) and serverPath defaults to a package-relative argo-mcp-server.js
  const doc = readDoc();
  assert.match(doc, /argo-workspace/, 'AD-b should insert an argo-workspace row');
  assert.match(doc, /argo-wakeup/, 'AD-b should insert an argo-wakeup row');
  assert.match(doc, /archgraph-argo\/dsh-argo-workspace/, 'AD-b should name the workspace row archgraph-argo/dsh-argo-workspace');
  assert.match(doc, /archgraph-argo\/dsh-argo-wakeup/, 'AD-b should name the wakeup row archgraph-argo/dsh-argo-wakeup');
  assert.match(doc, /file:\/\//, 'AD-b should explain why file:// rows are rejected');
  assert.match(doc, /import\.meta\.url/, 'AD-b should locate serverPath via import.meta.url');
  assert.match(doc, /argo-mcp-server\.js/, 'AD-b should point the default at argo/scripts/argo-mcp-server.js');
  assert.match(doc, /config\.serverPath/, 'AD-b should treat config.serverPath as an override');
  assert.match(doc, /回退链|ARGO_SERVER_PATH/, 'AD-b should declare a fallback chain');
});

test('dsh-plugin-design: AD-c keeps the entry modules at the repo root and marks them ESM per-directory', () => {
  // GIVEN the acceptance contract asserts repo-root entry modules
  // WHEN the AD-c decision is inspected
  // THEN dsh-argo-workspace/index.js and dsh-argo-wakeup/index.js ship at the root and are ESM via directory-level package.json
  const doc = readDoc();
  assert.match(doc, /dsh-argo-workspace\/index\.js/, 'AD-c should keep dsh-argo-workspace/index.js at the repo root');
  assert.match(doc, /dsh-argo-wakeup\/index\.js/, 'AD-c should keep dsh-argo-wakeup/index.js at the repo root');
  assert.match(doc, /export (async )?function apply|export function apply/, 'AD-c should keep the apply export contract');
  assert.match(doc, /type["']?\s*:\s*["']module["']/, 'AD-c should mark the plugin dirs ESM with type:module');
  assert.match(doc, /CommonJS/, 'AD-c should preserve the root CommonJS scripts');
});

test('dsh-plugin-design: AD-d requires no build step and no prepare script for git install', () => {
  // GIVEN the package is pure JS
  // WHEN the AD-d decision is inspected
  // THEN no prepare script is needed and git install works directly
  const doc = readDoc();
  assert.match(doc, /prepare/, 'AD-d should address the prepare script question');
  assert.match(doc, /无需\s*prepare|不提供\s*prepare|无需构建|无构建|纯\s*JS/, 'AD-d should conclude no prepare/build is needed');
  assert.match(doc, /github:derekhu0002\/archgraph/, 'AD-d should name the git install command');
});

test('dsh-plugin-design: AD-e keeps install-argo.ps1 / argo-deploy unchanged (no regression)', () => {
  // GIVEN the existing DSH deployment path must keep working
  // WHEN the AD-e decision is inspected
  // THEN install-argo.ps1 and argo-deploy stay unchanged and the risk of source drift is recorded
  const doc = readDoc();
  assert.match(doc, /install-argo\.ps1/, 'AD-e should name install-argo.ps1');
  assert.match(doc, /argo-deploy/, 'AD-e should name argo-deploy');
  assert.match(doc, /保持不变|不改|无回归/, 'AD-e should keep the existing path unchanged');
  assert.match(doc, /风险|漂移/, 'AD-e should record the single-source-of-truth drift risk');
});

test('dsh-plugin-design: design doc includes executable GIVEN-WHEN-THEN design acceptance criteria (ADES)', () => {
  // GIVEN the design stage must itself be externally verifiable
  // WHEN the design doc is inspected
  // THEN it contains GIVEN-WHEN-THEN ADES criteria plus the mapping to AT-2767
  const doc = readDoc();
  assert.match(doc, /ADES-\d/, 'doc should contain ADES design acceptance criteria');
  assert.match(doc, /设计阶段验收标准/, 'doc should have a design acceptance section');
  assert.match(doc, /AT-2767-\d/, 'doc should map to the AT-2767 acceptance tests');
  assert.ok(isGivenWhenThen(doc), 'doc should contain GIVEN/WHEN/THEN clauses');
});

test('dsh-plugin-design: graph work package 2767 is the dsh-plugin Work Package (read-only, no new elements)', () => {
  // GIVEN the design registers its commit on the existing Work Package
  // WHEN the graph is read
  // THEN element 2767 exists and is the dsh-plugin Work Package (this test asserts no NEW element is required)
  const wp = GRAPH.elements.find((entry) => entry.id === WP_ID);
  assert.ok(wp, 'element 2767 should exist');
  assert.equal(wp.type, 'Work Package', '2767 should be a Work Package');
  assert.match(wp.name, /dsh-plugin|DSH 插件/, '2767 should be the dsh-plugin work package');
});
