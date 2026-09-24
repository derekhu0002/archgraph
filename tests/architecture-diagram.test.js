'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const SVG_PATH = path.join(ROOT, 'docs', 'diagrams', 'global-architecture.svg');
const CORE_MODEL_SVG_PATH = path.join(ROOT, 'docs', 'diagrams', 'core-model.svg');
const GENERATOR_PATH = path.join(ROOT, 'scripts', 'gen-diagrams.js');
const CAPABILITY_SVGS = ['cap-federation.svg', 'cap-memory-tiers.svg', 'cap-lean-reads.svg'];

test('architecture-diagram: Layered Viewpoint diagram embedded in README', () => {
  // GIVEN the project documents its global architecture
  // WHEN a reader opens the README Architecture section
  // THEN it embeds a dark Layered Viewpoint diagram expressing the relationships among 人类, AGENT, ARGO MCP, graph, ArchiMate 3.2, EA and Neo4j
  assert.match(README, /docs\/diagrams\/global-architecture\.svg/, 'README should embed the architecture diagram');
  assert.ok(existsSync(SVG_PATH), 'the SVG diagram should exist');
  assert.ok(existsSync(GENERATOR_PATH), 'the reproducible diagram generator (editable source) should exist');

  const svg = readFileSync(SVG_PATH, 'utf8');
  for (const label of ['人类', 'AGENT', 'ARGO MCP', 'graph', 'ArchiMate 3.2', 'EA', 'Neo4j']) {
    assert.ok(svg.includes(label), `diagram should mention "${label}"`);
  }
  assert.match(svg, /viewBox=/, 'the diagram should be a scalable SVG');
  assert.match(svg, /#0a0e1a/, 'the diagram should carry the dark theme background');
});

test('core-model-diagram: unified-language model embedded under What is this?', () => {
  // GIVEN the project positions itself as a unified language for harness and product design
  // WHEN a reader opens the README What is this? section
  // THEN it embeds the core-model diagram with Harness Design, Target System Design, AgentHarness and Target Project
  assert.match(README, /docs\/diagrams\/core-model\.svg/, 'README should embed the core-model diagram');
  assert.ok(existsSync(CORE_MODEL_SVG_PATH), 'the core-model diagram should exist');

  const svg = readFileSync(CORE_MODEL_SVG_PATH, 'utf8');
  for (const label of ['Harness Design', 'Target System Design', 'AgentHarness', 'Target Project']) {
    assert.ok(svg.includes(label), `core model should mention "${label}"`);
  }
});

test('capability-diagrams: dark capability illustrations exist for the homepage', () => {
  // GIVEN the homepage spotlights federation, three-tier memory and lean reads
  // WHEN the capability illustrations are checked
  // THEN each is a self-contained dark SVG produced by the generator
  for (const file of CAPABILITY_SVGS) {
    const filePath = path.join(ROOT, 'docs', 'diagrams', file);
    assert.ok(existsSync(filePath), `${file} should exist`);
    const svg = readFileSync(filePath, 'utf8');
    assert.match(svg, /viewBox=/, `${file} should be a scalable SVG`);
    assert.match(svg, /#0a0e1a/, `${file} should carry the dark theme background`);
  }
});
