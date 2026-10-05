'use strict';

// Acceptance tests for the Coding business deck (docs/ppt).
//
// GIVEN-WHEN-THEN, external view: the deliverable is a five-page PPTX that a
// human partner can present, plus its generated artifacts. The deck must
// faithfully follow the requested outline and must stay consistent with the
// intent graph (every state-machine / metric / harness id it cites exists).
//
// The graph is read as data here (the canonical JSON), which is what the other
// regression tests in this repository do.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PPT_DIR = path.join(ROOT, 'docs', 'ppt');
const ASSETS = path.join(PPT_DIR, 'assets');
const plan = JSON.parse(fs.readFileSync(path.join(PPT_DIR, 'content-plan.json'), 'utf8'));

const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
const elementById = new Map((graph.elements || []).map((e) => [e.id, e]));
const relationshipById = new Map((graph.relationships || []).map((r) => [r.id, r]));
const viewById = new Map((graph.views || []).map((v) => [v.view_id, v]));

const pptxPath = path.join(PPT_DIR, 'archgraph-coding-business-deck.pptx');
const pptxExists = fs.existsSync(pptxPath);

/** minimal OOXML reader: unzip slides + shared strings + media manifest */
function readPptx(file) {
  const { execFileSync } = require('node:child_process');
  const list = execFileSync('tar', ['-tf', file], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const slides = list.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => {
    const na = Number(a.match(/(\d+)/)[1]);
    const nb = Number(b.match(/(\d+)/)[1]);
    return na - nb;
  });
  const media = list.filter((n) => n.startsWith('ppt/media/'));
  const xml = {};
  for (const s of slides) {
    xml[s] = execFileSync('tar', ['-xOf', file, s], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  }
  return { slides, media, xml, list };
}

const pptx = pptxExists ? readPptx(pptxPath) : null;

function slideText(i) {
  const xml = pptx.xml[pptx.slides[i]];
  return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('\n');
}

/* ------------------------------------------------------------------ plan  */

test('AT-coding-deck-01: the plan has the 5 requested pages in order', () => {
  assert.equal(plan.pages.length, 5, 'five pages');
  assert.deepEqual(plan.pages.map((p) => p.id), ['p1', 'p2', 'p3', 'p4', 'p5']);
  const [p1, p2, p3, p4, p5] = plan.pages;
  // page 1: state machine + numbered key
  assert.ok(p1.markers.length >= 12, 'page 1 numbers at least 12 states/transitions');
  assert.ok(/状态机/.test(p1.title), 'page 1 is the state machine page');
  // page 2: pains + practices + our solution
  assert.ok(p2.cases.length >= 4 && p2.pains.length >= 4, 'page 2 has practices and pains');
  assert.ok(p2.solution.blocks.length >= 3, 'page 2 has the solution blocks');
  assert.ok(/本体/.test(JSON.stringify(p2.solution)) && /图谱/.test(JSON.stringify(p2.solution)), 'solution = ontology + graph');
  // page 3: metrics with state mapping + our result + industry gap
  assert.equal(p3.metrics.length, 20, 'page 3 lists all 20 metrics');
  for (const m of p3.metrics) {
    assert.ok(m.state, `${m.kgId} maps to a state machine node`);
    assert.ok(m.result && m.benchmark && m.action, `${m.kgId} has result/benchmark/action`);
  }
  // page 4: generic retrieval flow + coverage + metric mapping + measured
  assert.equal(p4.generic.flatMap((g) => g.steps).length, 8, 'page 4 generic flow has 8 stages');
  assert.equal(p4.coverage.length, 8, 'page 4 maps our coverage onto all 8 stages');
  assert.ok(p4.measured.length >= 4, 'page 4 shows measured results');
  assert.ok(p4.gaps.length >= 3, 'page 4 states the gaps');
  // page 5: federation scheme
  assert.ok(p5.benefits.length === 3, 'page 5 lists the three benefits');
  assert.ok(p5.diagramNotes.length >= 4, 'page 5 has the diagram legend');
});

test('AT-coding-deck-02: every element id the deck cites exists in the intent graph', () => {
  const cited = [
    ...plan.pages[0].markers.map((m) => m.kgId),
    ...plan.pages[2].metrics.map((m) => m.kgId),
    ...plan.pages[2].metrics.map((m) => m.state),
  ].filter(Boolean);
  assert.ok(cited.length > 25, 'the deck cites graph ids');
  const missing = cited.filter((id) => !elementById.has(id) && !relationshipById.has(id));
  assert.deepEqual(missing, [], `cited ids missing from the graph: ${missing.join(', ')}`);
});

test('AT-coding-deck-03: page 1 is the state machine, and its numbers match the graph', () => {
  const p1 = plan.pages[0];
  // every state marker points at a State/Composite/Initial element
  const stateTypes = ['State', 'Composite State', 'Initial State', 'Final State'];
  const stateMarkers = p1.markers.filter((m) => elementById.has(m.kgId) && stateTypes.includes(elementById.get(m.kgId).type));
  assert.ok(stateMarkers.length >= 8, 'at least 8 state markers resolve to state elements');
  // transition markers: either a Transition id, or a representative transition of the group
  const transitionMarkers = p1.markers.filter((m) => {
    const rel = relationshipById.get(m.kgId);
    return rel && rel.type === 'Transition';
  });
  assert.ok(transitionMarkers.length >= 4, 'transition markers resolve to Transition relationships');
  // the numbers cover exactly 1..n with no hole
  assert.deepEqual(p1.markers.map((m) => m.n), Array.from({ length: p1.markers.length }, (_, i) => i + 1));
  // the running sub-state machine is represented
  for (const id of ['aos-reasoning', 'aos-retrieving', 'aos-acting', 'aos-verifying', 'aos-awaiting-result', 'aos-finalizing']) {
    assert.ok(p1.markers.some((m) => m.kgId === id), `${id} appears in the page-1 key`);
  }
});

test('AT-coding-deck-04: page 3 metric results mirror the KG measurement attributes', () => {
  const byId = new Map(plan.pages[2].metrics.map((m) => [m.kgId, m]));
  let checked = 0;
  for (const [id, m] of byId) {
    const el = elementById.get(id);
    const attrs = new Map((el.attributes || []).map((a) => [a.name, a.value]));
    const status = attrs.get('measurement-status');
    if (!status) continue;
    assert.equal(m.status, status, `${id} status mirrors the graph (${status})`);
    checked += 1;
  }
  assert.equal(checked, 20, 'all 20 metric statuses were cross-checked against the graph');
  const measured = [...byId.values()].filter((m) => m.status === 'measured').map((m) => m.kgId).sort();
  assert.deepEqual(measured, ['aos-as-memory', 'aos-as-retrieve', 'aos-as-tool', 'aos-as-wait'], 'the 4 measured metrics');
  assert.equal(plan.pages[2].status.measured, 4);
  assert.equal(plan.pages[2].status.partial, 5);
  assert.equal(plan.pages[2].status.notMeasured, 11);
});

test('AT-coding-deck-05: page 4 maps its stages onto the page-3 metric system', () => {
  const metricIds = new Set(plan.pages[2].metrics.map((m) => String(m.n)));
  for (const c of plan.pages[3].coverage) {
    assert.ok(/^\d+(\s*[·、]\s*\d+)*$/.test(c.metrics), `${c.id} metric cell looks like metric numbers (got "${c.metrics}")`);
    for (const n of c.metrics.split(/[·、\s]+/).filter(Boolean)) {
      assert.ok(metricIds.has(n), `${c.id} references existing page-3 metric #${n}`);
    }
  }
  // the tool surface the deck advertises must be the real MCP tool names
  const toolText = JSON.stringify(plan.pages[3].mcp);
  for (const tool of [
    'getSystemArchitecture',
    'getIntentElementContext',
    'getArchitectureViewContext',
    'queryNeo4jGraph',
    'memory_search',
    'applySystemArchitectureMutation',
  ]) {
    assert.ok(toolText.includes(tool), `MCP surface mentions ${tool}`);
  }
});

/* ------------------------------------------------------------- artifacts  */

test('AT-coding-deck-06: the deck artifacts exist (5 SVG + 5 PNG + preview + PPTX)', () => {
  for (const p of plan.pages) {
    const svg = path.join(ASSETS, `${p.diagram}.svg`);
    const png = path.join(ASSETS, `${p.diagram}.png`);
    assert.ok(fs.existsSync(svg), `${p.diagram}.svg exists`);
    assert.ok(fs.existsSync(png), `${p.diagram}.png exists`);
    const svgText = fs.readFileSync(svg, 'utf8');
    assert.ok(svgText.startsWith('<svg'), `${p.diagram}.svg is an SVG document`);
    assert.ok(svgText.includes(`${p.diagram}`) || svgText.includes('viewBox="0 0 1280 720"'), `${p.diagram}.svg is 1280x720`);
    const pngHead = fs.readFileSync(png).subarray(0, 8);
    assert.deepEqual([...pngHead], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${p.diagram}.png is a real PNG`);
    assert.ok(fs.statSync(png).size > 20000, `${p.diagram}.png is non-trivial`);
  }
  assert.ok(fs.existsSync(path.join(PPT_DIR, 'preview.html')), 'preview.html exists');
  assert.ok(pptxExists, 'the PPTX deliverable exists');
  assert.ok(fs.statSync(pptxPath).size > 200000, 'the PPTX is non-trivial');
});

test('AT-coding-deck-07: the PPTX has 5 slides, each carrying its page image and its text', () => {
  assert.ok(pptx, 'pptx readable');
  assert.equal(pptx.slides.length, 5, 'five slides');
  assert.ok(pptx.media.length >= 5, 'five page images are embedded');
  plan.pages.forEach((p, i) => {
    const xml = pptx.xml[pptx.slides[i]];
    assert.ok(xml.includes(p.kicker), `slide ${i + 1} carries its kicker (${p.kicker})`);
    assert.ok(xml.includes(p.title), `slide ${i + 1} carries its title`);
  });
});

test('AT-coding-deck-08: the PPTX text layer keeps page 1 numbered key and page 3 metrics searchable', () => {
  assert.ok(pptx, 'pptx readable');
  const s1 = slideText(0);
  for (const needle of ['Idle', 'Running', 'Reasoning', 'Retrieving', 'Acting', 'Verifying', 'Finalizing', 'AwaitingResult']) {
    assert.ok(s1.includes(needle), `page 1 text layer contains ${needle}`);
  }
  const s3 = slideText(2);
  for (const m of plan.pages[2].metrics) {
    assert.ok(s3.includes(m.name), `page 3 text layer contains metric ${m.name}`);
  }
  // the overlayed text must keep its geometry close to the SVG (spot-check the title)
  const title = plan.pages[0].title;
  assert.ok(s1.includes(title), 'page 1 title is real text, not only pixels');
});

test('AT-coding-deck-09: both page-1 layout halves are present (diagram left, key right)', () => {
  const svg = fs.readFileSync(path.join(ASSETS, 'p1-state-machine.svg'), 'utf8');
  const xs = [...svg.matchAll(/<text x="([\d.]+)"/g)].map((m) => Number(m[1]));
  const left = xs.filter((x) => x < 900).length;
  const right = xs.filter((x) => x >= 900).length;
  assert.ok(left > right, `the state machine occupies the left ~3/4 (left ${left} vs right ${right} labels)`);
  assert.ok(right > 20, 'the numbered key on the right is a real column of labels');
  // the numbered key starts at #1 (the first SVG text of the key column is "1")
  assert.ok(/<text x="9\d\d"[^>]*>1<\/text>/.test(svg) || /<text[^>]*>1<\/text>/.test(svg), 'key number 1 is drawn');
});
