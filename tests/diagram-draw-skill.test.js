'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, existsSync, mkdtempSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, '.opencode', 'skills', 'diagram-draw', 'renderExcalidrawSvg.js');

// Minimal Excalidraw JSON v2 fixture: a rectangle band, a text label, and an arrow.
const FIXTURE = {
  type: 'excalidraw',
  version: 2,
  elements: [
    { id: 'technology_band', type: 'rectangle', x: 60, y: 60, width: 200, height: 60, backgroundColor: 'transparent', strokeColor: '#7048e8', strokeStyle: 'dashed', strokeWidth: 1, roughness: 0, opacity: 100 },
    { id: 'actor_box', type: 'rectangle', x: 80, y: 200, width: 160, height: 60, backgroundColor: '#d0ebff', strokeColor: '#1971c2', strokeWidth: 2, roughness: 0, opacity: 100 },
    { id: 'technology_label', type: 'text', x: 60, y: 30, width: 200, height: 20, text: 'Technology', textAlign: 'center', verticalAlign: 'middle', fontSize: 16, strokeColor: '#7048e8' },
    { id: 'actor_label', type: 'text', x: 80, y: 200, width: 160, height: 60, text: 'Human', textAlign: 'center', verticalAlign: 'middle', fontSize: 16, strokeColor: '#1971c2' },
    { id: 'realize', type: 'arrow', x: 160, y: 120, points: [[0, 0], [0, 80]], strokeColor: '#3b5bdb', endArrowhead: 'arrow', strokeWidth: 2, roughness: 0, opacity: 100 },
  ],
};

function renderFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'diagram-draw-'));
  const input = path.join(dir, 'fixture.excalidraw');
  const output = path.join(dir, 'fixture.svg');
  writeFileSync(input, JSON.stringify(FIXTURE), 'utf8');
  return { dir, input, output };
}

test('diagram-draw-skill: renderer produces SVG from Excalidraw JSON', () => {
  // GIVEN a valid .excalidraw JSON v2 source describing a Layered Viewpoint diagram
  // WHEN the repository-native renderer is invoked on it
  // THEN it emits an SVG containing the rectangle bands, text labels and an arrow
  const { dir, input, output } = renderFixture();
  try {
    execFileSync(process.execPath, [RENDERER, input, output], { stdio: 'pipe' });
    assert.ok(existsSync(output), 'an SVG file should be produced');
    const svg = readFileSync(output, 'utf8');
    assert.match(svg, /<svg /, 'output should be an SVG document');
    assert.ok(svg.includes('<rect'), 'output should render rectangles');
    assert.ok(svg.includes('<text'), 'output should render text labels');
    assert.ok(svg.includes('<polyline'), 'output should render arrows/lines');
    assert.ok(svg.includes('Technology'), 'output should include the layer text');
    assert.ok(svg.includes('Human'), 'output should include the element text');
    assert.ok(svg.includes('marker-end'), 'arrow should carry the end arrowhead marker');
  } finally {
    // best-effort cleanup of the temp fixture
    try { require('node:fs').rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
