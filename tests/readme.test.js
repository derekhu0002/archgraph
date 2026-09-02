'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

test('readme: what-is-this states the unified-language goal', () => {
  // GIVEN the project positions itself as a unified language for harness and product design
  // WHEN a reader opens README.md
  // THEN What is this? states the unified-language, one-model, single-view positioning (matching the homepage)
  const section = sectionAfter(README, 'What is this');
  assert.ok(section, 'README should have a What is this? section');
  assert.match(section, /unified language/, 'should state the unified-language goal');
  assert.match(section, /one model/, 'should state the one-model design');
  assert.match(section, /single view/, 'should state the single view');
});

function sectionAfter(md, heading) {
  const re = new RegExp('## ' + heading + '[\\s\\S]*?(?=\\n## |$)');
  const match = md.match(re);
  return match ? match[0] : '';
}

test('readme: how-to-use section explains the user workflow', () => {
  // GIVEN the README documents how to use the framework
  // WHEN a reader opens the How to use section
  // THEN it describes the coding-agent workflow and the graph as the single source of truth
  const section = sectionAfter(README, 'How to use');
  assert.ok(section, 'README should have a How to use section');
  assert.match(section, /ArchiMate 3\.2/, 'should state ArchiMate 3.2 compliance');
  assert.match(section, /coding agent/, 'should describe the coding-agent workflow');
  assert.match(section, /Skills and Rules/, 'should mention arming with Skills and Rules');
  assert.match(section, /single source of truth/, 'should state the graph is the single source of truth');
});

test('readme: install section documents npm deployment and semantic requirements', () => {
  // GIVEN the ARGO toolchain is published as an npm package
  // WHEN a reader opens README.md
  // THEN it shows a minimal install: npm install + argo-deploy, plus a one-line note on Neo4j + vector engine for semantic queries
  const section = sectionAfter(README, 'Install');
  assert.ok(section, 'README should have an Install section');
  assert.match(section, /npm install -g archgraph-argo/, 'should show the npm install command');
  assert.match(section, /argo-deploy/, 'should show the argo-deploy command');
  assert.match(section, /MCP server/, 'should mention the registered MCP server');
  assert.match(section, /Neo4j/, 'should state the Neo4j requirement for semantic queries');
  assert.match(section, /vector engine/, 'should state the vector engine requirement');
});

test('readme: supported harnesses include OpenClaw', () => {
  // GIVEN ArchGraph has been adapted for OpenClaw (WP 2780 completed)
  // WHEN a reader opens README.md
  // THEN the Supported Harnesses table lists OpenClaw and the Install note mentions it
  const section = sectionAfter(README, 'Supported Harnesses');
  assert.ok(section, 'README should have a Supported Harnesses section');
  assert.match(section, /OpenClaw/, 'should list OpenClaw in the harness table');
  assert.match(README, /OpenClaw/, 'README should mention OpenClaw in the install/deploy note');
});

test('readme: community section links the community site and graph-wiki asset repo', () => {
  // GIVEN a dedicated ArchGraph community hub and graph-wiki asset repository exist
  // WHEN a reader opens README.md
  // THEN a Community section links to the community site and the graph-wiki asset repo
  const section = sectionAfter(README, 'Community');
  assert.ok(section, 'README should have a Community section');
  assert.match(
    section,
    /argo\.derekworkspacev5\.com\/archgraph\//,
    'should link the ArchGraph community site'
  );
  assert.match(
    section,
    /github\.com\/derekhu0002\/graph-wiki/,
    'should link the graph-wiki asset repository'
  );
});
