'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

function sectionAfter(md, heading) {
  const re = new RegExp('## ' + heading + '[\\s\\S]*?(?=\\n## |$)');
  const match = md.match(re);
  return match ? match[0] : '';
}

test('readme: leads with the framework + knowledge-graph + own-ontology + MCP positioning', () => {
  // GIVEN the README is the project's front door
  // WHEN a reader opens it
  // THEN the title/intro frame ArchGraph as a knowledge-graph framework with a
  //      customizable ontology, wired into the agent through one MCP interface, and
  //      the low-cost promise is explicit
  assert.match(README, /knowledge-graph framework/i, 'should name the framework as a knowledge-graph framework');
  assert.match(README, /ontology you define/i, 'should headline the customizable ontology');
  assert.match(README, /MCP/i, 'should name the MCP interface');
  assert.match(README, /coding agent/i, 'should address the coding-agent user');
  assert.match(README, /one MCP interface to install and learn|one MCP/i, 'should state the low onboarding cost');
});

test('readme: what-is-this frames one graph as the source of truth with deduped writes', () => {
  // GIVEN README stays concise (goal + benefits; feature detail lives on the home page)
  // WHEN a reader opens the What is this? section
  // THEN it frames the graph as the single source of truth via MCP, with deduplicated writes
  const section = sectionAfter(README, 'What is this');
  assert.ok(section, 'README should have a What is this? section');
  assert.match(section, /one architecture graph/i, 'should state the one-graph design');
  assert.match(section, /single source of truth/i, 'should state the single source of truth');
  assert.match(section, /MCP/i, 'should mention the read/write MCP interface');
  assert.match(section, /duplicat/i, 'should mention write deduplication');
});

test('readme: bring-your-own-ontology section states the schema bundle and links the case', () => {
  // GIVEN the framework decouples the core from the ontology (schema bundle)
  // WHEN a reader opens the Bring your own ontology section
  // THEN it names .argo/schema/, the extends mechanism, and links the worked case + example
  const section = sectionAfter(README, 'Bring your own ontology');
  assert.ok(section, 'README should have a Bring your own ontology section');
  assert.match(section, /schema bundle/i, 'should name the schema bundle');
  assert.match(section, /\.argo\/schema/, 'should point at .argo/schema/');
  assert.match(section, /extends/, 'should mention the extends mechanism');
  assert.match(section, /docs\/case-team-graph\.html/, 'should link the worked case page');
  assert.match(section, /custom-schema\//, 'should link the runnable example');
  assert.doesNotMatch(section, /Acme/, 'should not surface the internal placeholder bundle name');
});

test('readme: install section documents npm deployment and the semantic prerequisites', () => {
  // GIVEN the ARGO toolchain is published as an npm package
  // WHEN a reader opens the Install section
  // THEN it shows npm install + argo-deploy, names the registered MCP server, and the
  //      Neo4j + embedding requirements for semantic queries
  const section = sectionAfter(README, 'Install');
  assert.ok(section, 'README should have an Install section');
  assert.match(section, /npm install -g archgraph-argo/, 'should show the npm install command');
  assert.match(section, /argo-deploy/, 'should show the argo-deploy command');
  assert.match(section, /MCP server/, 'should mention the registered MCP server');
  assert.match(section, /Neo4j/, 'should state the Neo4j requirement');
  assert.match(section, /embedding/i, 'should state the embedding requirement');
  for (const host of ['GitHub Copilot', 'Cursor', 'OpenCode', 'DeepSeek Harness', 'OpenClaw', 'Codex']) {
    assert.match(section, new RegExp(host), `should list ${host}`);
  }
});

test('readme: quick start documents argo init and the semantic caveat', () => {
  // GIVEN the workspace bootstrap is the first user step
  // WHEN a reader opens the Quick start section
  // THEN it describes argo init / initializeWorkspace, the source of truth, and the
  //      Neo4j prerequisite boundary without overclaiming
  const section = sectionAfter(README, 'Quick start');
  assert.ok(section, 'README should have a Quick start section');
  assert.match(section, /argo init/, 'should mention argo init');
  assert.match(section, /initializeWorkspace/, 'should name the initializeWorkspace MCP call');
  assert.match(section, /single source of truth/i, 'should state the graph is the single source of truth');
  assert.match(section, /Neo4j/, 'should name the Neo4j prerequisite for semantic retrieval');
  assert.match(section, /without them|without Neo4j/i, 'should state what still works without Neo4j');
});

test('readme: supported-harnesses table lists every adapted harness including OpenClaw', () => {
  // GIVEN ArchGraph deploys into all major coding-agent environments
  // WHEN a reader opens the Supported Harnesses section
  // THEN the table lists each harness (OpenClaw included)
  const section = sectionAfter(README, 'Supported Harnesses');
  assert.ok(section, 'README should have a Supported Harnesses section');
  for (const host of ['GitHub Copilot', 'Cursor', 'OpenCode', 'DeepSeek Harness', 'OpenClaw', 'Codex']) {
    assert.match(section, new RegExp(host), `should list ${host} in the harness table`);
  }
});

test('readme: how-to-use section explains the user workflow', () => {
  // GIVEN the README documents how to use the framework
  // WHEN a reader opens the How to use section
  // THEN it describes the workspace bootstrap and the coding-agent workflow
  const section = sectionAfter(README, 'How to use');
  assert.ok(section, 'README should have a How to use section');
  assert.match(section, /argo init/, 'should mention the argo init workspace bootstrap');
  assert.match(section, /coding agent/i, 'should describe the coding-agent workflow');
  assert.match(section, /Skills and Rules/, 'should mention arming with Skills and Rules');
  assert.match(section, /single source of truth/i, 'should state the graph is the single source of truth');
});

test('readme: community section documents the federated registry', () => {
  // GIVEN the community shares reusable subgraphs through a federated registry (CoreRule 12)
  // WHEN a reader opens the Community section
  // THEN it explains federation: register/discover/authorize/read by reference, denied by default,
  //      sovereign graphs, and the registry-broker center
  const section = sectionAfter(README, 'Community');
  assert.ok(section, 'README should have a Community section');
  assert.match(section, /federat/i, 'should name the federated sharing model');
  assert.match(section, /sovereign/i, 'should state each project keeps a sovereign graph');
  assert.match(section, /register/, 'should mention registering a subgraph');
  assert.match(section, /by reference/i, 'should state that reads return a reference');
  assert.match(section, /denied by default/i, 'should state that cross-member access is denied by default');
  assert.match(section, /registry/i, 'should name the registry role');
  assert.match(section, /broker/i, 'should name the broker role');
  assert.match(section, /argo\.derekworkspacev5\.com\/archgraph\//, 'should link the community site');
  assert.match(section, /github\.com\/derekhu0002\/graph-wiki/, 'should link the graph-wiki asset repository');
  assert.doesNotMatch(README, /distributed knowledge graph/i, 'must not mislabel the model as distributed');
});

test('readme: Why ArchGraph points at the one canonical comparison and states the real differentiator', () => {
  // GIVEN the comparison is NOT triplicated: docs/capabilities.html#compare is canonical
  // WHEN a reader opens the README Why section
  // THEN it links that page, states the real differentiator (not "custom vs locked"), keeps no table
  const section = sectionAfter(README, 'Why ArchGraph');
  assert.ok(section, 'README should keep a Why ArchGraph section');
  assert.match(section, /docs\/capabilities\.html#compare/, 'Why must link the canonical comparison');
  assert.match(section, /first-class, validated, runtime-resolved schema bundle/i, 'must state the real differentiator');
  assert.match(section, /one MCP interface/i, 'must tie the differentiator to one MCP interface');
  assert.doesNotMatch(section, /\n\|/, 'Why must not re-inline the comparison table');
  assert.doesNotMatch(section, /locked single-ontology/i, 'must not use the locked-ontology straw man');
});

test('readme: schema copy names the extends:default base precisely (ArchiMate 3.2 + ARGO extensions)', () => {
  // GIVEN the neutral default bundle is ArchiMate 3.2 + ARGO extensions (not bare ArchiMate 3.2)
  // WHEN a reader opens the ontology section
  // THEN the extends base is named precisely and the placeholder name still does not leak
  const section = sectionAfter(README, 'Bring your own ontology');
  assert.match(section, /extends: "default"/, 'must state extends: "default"');
  assert.match(section, /ArchiMate 3\.2 \+ ARGO extensions/, 'must name the base as ArchiMate 3.2 + ARGO extensions');
  assert.doesNotMatch(section, /extends ArchiMate 3\.2 with/, 'must not reduce the base to plain ArchiMate 3.2');
  assert.doesNotMatch(section, /Acme/, 'must not surface the internal placeholder bundle name');
});

test('readme: links every detail page and archived doc', () => {
  // GIVEN detail has moved to linked pages
  // WHEN a reader scans the Capabilities and Docs sections
  // THEN the README links the detail pages and they exist
  for (const rel of ['docs/getting-started.html', 'docs/capabilities.html', 'docs/case-team-graph.html', 'docs/insights.html']) {
    assert.match(README, new RegExp(rel.replace(/\./g, '\\.')), `README should link ${rel}`);
    assert.ok(existsSync(path.join(ROOT, rel)), `${rel} must exist`);
  }
});
