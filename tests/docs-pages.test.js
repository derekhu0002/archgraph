'use strict';

// Acceptance tests for the Chinese detail pages linked from the homepage/README:
//   docs/getting-started.html   (使用介绍)
//   docs/capabilities.html      (能力总览)
//   docs/case-team-graph.html   (使用案例)
//
// External view: a visitor who clicks a "read more" link lands on a real, self-consistent
// Chinese page whose nav and images resolve, and whose content matches the recorded capabilities.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const PAGES = {
  'getting-started.html': '使用介绍',
  'capabilities.html': '能力总览',
  'case-team-graph.html': '使用案例',
};

function read(name) {
  return readFileSync(path.join(DOCS, name), 'utf8');
}

function imgSrcs(html) {
  return [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
}

function internalLinks(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)]
    .map(m => m[1])
    .filter(h => !/^(https?:|mailto:|#)/.test(h));
}

test('AT docs-pages: every detail page exists, is Chinese, and shares the docs shell', () => {
  // GIVEN the homepage/README link three detail pages
  // WHEN each is opened
  // THEN it exists, declares zh-CN, and loads the shared docs/site.css
  for (const [file, label] of Object.entries(PAGES)) {
    const p = path.join(DOCS, file);
    assert.ok(existsSync(p), `${file} must exist`);
    const html = read(file);
    assert.match(html, /<html[^>]*lang="zh-CN"/, `${file} must declare lang="zh-CN"`);
    assert.match(html, new RegExp(label), `${file} should present the ${label} label`);
    assert.match(html, /href="site\.css"/, `${file} must link the shared docs/site.css`);
  }
  assert.ok(existsSync(path.join(DOCS, 'site.css')), 'docs/site.css must exist');
});

test('AT docs-pages: every internal link and image resolves to a real file', () => {
  // GIVEN the detail pages navigate to each other and embed diagrams
  // WHEN each link/img is resolved relative to docs/
  // THEN it exists (no dead "read more")
  for (const file of Object.keys(PAGES)) {
    const html = read(file);
    for (const href of internalLinks(html)) {
      const resolved = path.resolve(DOCS, href.split('#')[0]);
      assert.ok(existsSync(resolved), `${file}: link "${href}" must resolve (expected ${resolved})`);
    }
    for (const src of imgSrcs(html)) {
      const resolved = path.resolve(DOCS, src);
      assert.ok(existsSync(resolved), `${file}: image "${src}" must exist (expected ${resolved})`);
    }
  }
});

test('AT docs-pages: getting-started covers the real install/config/init surface', () => {
  // GIVEN the onboarding page must be actionable
  // WHEN a reader follows it
  // THEN it names the install commands, the init call, and the concrete .env keys
  const html = read('getting-started.html');
  for (const token of [
    'npm install -g archgraph-argo',
    'argo-deploy',
    'initializeWorkspace',
    'argo init',
    'Neo4j',
    'embedding',
    'ARGO_NEO4J_DATABASE_URL',
    'ARGO_EMBEDDING_MODEL',
    'ARGO_EMBEDDING_PROFILE',
    'QWEN_KEY',
  ]) {
    assert.match(html, new RegExp(token.replace(/\./g, '\\.')), `getting-started should mention ${token}`);
  }
});

test('AT docs-pages: capabilities page carries the moved capability set and its diagrams', () => {
  // GIVEN the homepage capability cards moved here
  // WHEN a visitor reads the capabilities page
  // THEN the key capabilities and their illustrations are present
  const html = read('capabilities.html');
  for (const token of [
    'matchedSnippet',
    'projectId',
    'GIVEN-WHEN-THEN',
    'Graph RAG',
    'Enterprise Architect',
    'ARGO_EMBEDDING_PROFILE',
  ]) {
    assert.match(html, new RegExp(token.replace(/\./g, '\\.')), `capabilities should mention ${token}`);
  }
  for (const img of ['cap-memory-tiers.svg', 'cap-lean-reads.svg', 'cap-federation.svg', 'global-architecture.svg']) {
    assert.match(html, new RegExp('diagrams/' + img.replace('.', '\\.')), `capabilities should embed ${img}`);
  }
});

test('AT docs-pages: capabilities#compare is the canonical, honest comparison (no straw man, cost disclosed)', () => {
  // GIVEN the homepage and README tease the comparison instead of triplicating it
  // WHEN a reader opens the canonical comparison
  // THEN it names real alternatives that DO allow extension, states the REAL differentiator
  //      (a first-class validated runtime-resolved schema bundle behind one MCP interface),
  //      and discloses what ArchGraph itself costs; it must NOT use the locked-ontology straw man
  const html = read('capabilities.html');
  const section = html.slice(html.indexOf('id="compare"'), html.indexOf('id="ontology"'));
  assert.ok(section, 'capabilities page should expose the #compare section');
  // real differentiator, not "custom vs locked"
  assert.match(section, /schema bundle/i, 'must name the schema bundle');
  assert.match(section, /运行时解析/, 'must state the bundle is runtime-resolved');
  assert.match(section, /一等公民/, 'must state the ontology is first-class');
  assert.match(section, /MCP/, 'must tie it to the single MCP interface');
  // honest alternatives: real tools that DO allow extending the model
  for (const tool of ['Protégé', 'Neo4j', 'TerminusDB', 'Archi']) {
    assert.match(section, new RegExp(tool), `must name ${tool} as an alternative that allows extension`);
  }
  // row-2 precision: the vector-store shortfall is SEMANTIC/TYPED dedup, not dedup at large
  assert.match(section, /语义 ?\/ ?类型化去重/, 'vector shortfall must be semantic/typed dedup');
  // honest cost, inside the comparison itself: Neo4j + embedding + argo-deploy + .env + restart
  for (const token of ['Neo4j', 'embedding', 'argo-deploy', '\\.env', '重启']) {
    assert.match(section, new RegExp(token), `cost disclosure must mention ${token}`);
  }
  // no straw man
  assert.doesNotMatch(section, /锁死单一本体/, 'must not use the locked-ontology straw man');
  assert.doesNotMatch(section, /无法为你的业务域建模/, 'must not claim other tools cannot model your domain');
});

test('AT docs-pages: case page is a runnable custom-ontology walkthrough', () => {
  // GIVEN the human asked for a step-by-step "define an ontology, build the graph" case
  // WHEN a reader follows the case page
  // THEN it starts from a real schema bundle, authors the mandatory graph, and builds it via MCP
  const html = read('case-team-graph.html');
  for (const token of [
    'schema-bundle.rules.json',
    'Agent Node',
    'actorElementType',
    'applySystemArchitectureMutation',
    'NO_DEFAULT_GRAPH',
    'design/KG/SystemArchitecture.json',
  ]) {
    assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')), `case page should mention ${token}`);
  }
  for (const img of ['team-graph-ontology.svg', 'team-graph-elements-relations.svg', 'team-graph-view-composition.svg', 'team-graph-mcp-recall-sequence.svg']) {
    assert.match(html, new RegExp('diagrams/' + img.replace('.', '\\.')), `case page should embed ${img}`);
  }
});

test('AT docs-pages: no detail page surfaces the internal placeholder bundle name', () => {
  // GIVEN "Acme" is an internal placeholder, not public copy
  // WHEN the detail pages are read
  // THEN none exposes it
  for (const file of Object.keys(PAGES)) {
    assert.doesNotMatch(read(file), /Acme/, `${file} must not surface the placeholder bundle name`);
  }
});
