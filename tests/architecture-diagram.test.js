'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const SVG_PATH = path.join(ROOT, 'docs', 'diagrams', 'global-architecture.svg');
const EXCALIDRAW_PATH = path.join(ROOT, 'docs', 'diagrams', 'global-architecture.excalidraw');
const CORE_MODEL_IMAGE_PATH = path.join(ROOT, 'docs', 'diagrams', 'image.png');

test('architecture-diagram: Layered Viewpoint diagram embedded in README', () => {
  // GIVEN the project documents its global architecture
  // WHEN a reader opens the README Architecture section
  // THEN it embeds a Layered Viewpoint diagram expressing the relationships among 人类, AGENT, ARGO MCP, graph, ArchiMate 3.2 and EA
  assert.match(README, /docs\/diagrams\/global-architecture\.svg/, 'README should embed the architecture diagram');
  assert.ok(existsSync(SVG_PATH), 'the SVG diagram should exist');
  assert.ok(existsSync(EXCALIDRAW_PATH), 'the Excalidraw source should exist');

  const svg = readFileSync(SVG_PATH, 'utf8');
  for (const label of ['人类', 'AGENT', 'ARGO MCP', 'graph', 'ArchiMate 3.2', 'EA', 'Neo4j']) {
    assert.ok(svg.includes(label), `diagram should mention "${label}"`);
  }
});

test('core-model-diagram: unified-language model image embedded under What is this?', () => {
  // GIVEN the project positions itself as a unified language for harness and product design
  // WHEN a reader opens the README What is this? section
  // THEN it embeds the core-model image (image.png)
  assert.match(README, /docs\/diagrams\/image\.png/, 'README should embed the core-model image');
  assert.ok(existsSync(CORE_MODEL_IMAGE_PATH), 'the core-model image should exist');
});
