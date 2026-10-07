'use strict';

// Acceptance tests for the Coding business deck (docs/ppt).
//
// GIVEN-WHEN-THEN, external view: the deliverable is a white, one-message-per-page
// PPTX a human partner can present, plus its generated artifacts and the editable
// Excalidraw sources. The deck must follow the requested outline and stay
// consistent with the intent graph (every state-machine / metric id it cites exists).
//
// The graph is read as data here (the canonical JSON), like the other regression
// tests in this repository.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PPT_DIR = path.join(ROOT, 'docs', 'ppt');
const ASSETS = path.join(PPT_DIR, 'assets');
const EX_DIR = path.join(PPT_DIR, 'excalidraw');
const plan = JSON.parse(fs.readFileSync(path.join(PPT_DIR, 'content-plan.json'), 'utf8'));

const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
const elementById = new Map((graph.elements || []).map((e) => [e.id, e]));

const pptxPath = path.join(PPT_DIR, 'archgraph-coding-business-deck.pptx');
const pptxExists = fs.existsSync(pptxPath);

function readPptx(file) {
  const { execFileSync } = require('node:child_process');
  const list = execFileSync('tar', ['-tf', file], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const slides = list.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  const media = list.filter((n) => n.startsWith('ppt/media/'));
  const xml = {};
  for (const s of slides) xml[s] = execFileSync('tar', ['-xOf', file, s], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { slides, media, xml };
}
const pptx = pptxExists ? readPptx(pptxPath) : null;
const slideText = (i) => [...pptx.xml[pptx.slides[i]].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('\n');

/* ------------------------------------------------------------------ plan  */

test('AT-coding-deck-01: the plan has the requested outline as 9 pages in order', () => {
  assert.equal(plan.pages.length, 9, '8 main pages + 1 appendix');
  assert.deepEqual(plan.pages.map((p) => p.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
  assert.deepEqual(
    plan.pages.map((p) => p.type),
    ['stateMachine', 'pains', 'practices', 'solution', 'metrics', 'pipeline', 'capability', 'federation', 'appendixMetrics']
  );
  // every page states one takeaway ("one message per page")
  for (const p of plan.pages) assert.ok(p.takeaway && p.takeaway.length >= 6, `${p.id} has a takeaway`);
  // callouts stay short — no dense paragraphs on a main page
  for (const p of plan.pages.slice(0, 8)) {
    for (const k of p.key || []) assert.ok(k.sub.length <= 22, `p1 key "${k.sub}" is short`);
    for (const c of p.cases || []) assert.ok(c.line.length <= 40, `p3 case "${c.line}" is short`);
    for (const pn of p.pains || []) assert.ok(pn.line.length <= 40, `p2 pain "${pn.line}" is short`);
  }
});

test('AT-coding-deck-02: every element id the deck cites exists in the intent graph', () => {
  const cited = [
    ...plan.pages[0].key.map((k) => k.kgId),
    ...plan.pages[4].groups.map((g) => g.kgId),
    ...plan.pages[8].metrics.map((m) => m.kgId),
  ].filter(Boolean);
  assert.ok(cited.length >= 35, 'the deck cites graph ids');
  const missing = cited.filter((id) => !elementById.has(id));
  assert.deepEqual(missing, [], `cited ids missing from the graph: ${missing.join(', ')}`);
});

test('AT-coding-deck-03: page 1 is the state machine, grounded in the graph', () => {
  const p1 = plan.pages[0];
  assert.ok(/状态机|回合/.test(p1.title), 'page 1 is the state-machine page');
  assert.ok(p1.key.length >= 8, 'page 1 numbers the key states');
  for (const id of ['aos-idle', 'aos-running', 'aos-reasoning', 'aos-retrieving', 'aos-acting', 'aos-verifying', 'aos-finalizing']) {
    assert.ok(p1.key.some((k) => k.kgId === id), `${id} appears in the page-1 key`);
  }
  const stateTypes = ['State', 'Composite State', 'Initial State', 'Final State'];
  const stateMarkers = p1.key.filter((k) => elementById.has(k.kgId) && stateTypes.includes(elementById.get(k.kgId).type));
  assert.ok(stateMarkers.length >= 8, 'most key markers resolve to state elements');
});

test('AT-coding-deck-04: page 9 metric results mirror the KG measurement attributes', () => {
  const metrics = plan.pages[8].metrics;
  assert.equal(metrics.length, 20, 'all 20 metrics are listed');
  let checked = 0;
  for (const m of metrics) {
    const el = elementById.get(m.kgId);
    assert.ok(el, `${m.kgId} exists`);
    const attrs = new Map((el.attributes || []).map((a) => [a.name, a.value]));
    const status = attrs.get('measurement-status');
    assert.ok(status, `${m.kgId} has a measurement-status`);
    assert.equal(m.status, status, `${m.kgId} status mirrors the graph`);
    assert.ok(m.result && m.benchmark && m.action, `${m.kgId} has result / benchmark / action`);
    checked += 1;
  }
  assert.equal(checked, 20, 'all 20 statuses cross-checked');
  const measured = metrics.filter((m) => m.status === 'measured').map((m) => m.kgId).sort();
  assert.deepEqual(measured, ['aos-as-memory', 'aos-as-retrieve', 'aos-as-tool', 'aos-as-wait'], 'the 4 measured metrics');
  assert.equal(plan.pages[4].status.measured, 4);
  assert.equal(plan.pages[4].status.partial, 5);
  assert.equal(plan.pages[4].status.notMeasured, 11);
});

test('AT-coding-deck-05: page 5 maps onto the state machine, page 6 onto the pipeline, page 7 names real tools', () => {
  assert.equal(plan.pages[4].groups.length, 9, 'page 5 groups the metric ↔ state mapping');
  assert.equal(plan.pages[5].stages.length, 8, 'page 6 has the 8-stage generic flow');
  assert.equal(plan.pages[5].coverage.length, 8, 'page 6 covers all 8 stages');
  const toolText = JSON.stringify(plan.pages[6].tools);
  for (const tool of ['getSystemArchitecture', 'getIntentElementContext', 'getArchitectureViewContext', 'queryNeo4jGraph', 'memory_search', 'applySystemArchitectureMutation']) {
    assert.ok(toolText.includes(tool), `page 7 mentions ${tool}`);
  }
});

/* ------------------------------------------------------------- artifacts  */

test('AT-coding-deck-06: the deck artifacts exist (9 SVG + 9 PNG + preview + PPTX)', () => {
  for (const p of plan.pages) {
    const svg = fs.readFileSync(path.join(ASSETS, `${p.diagram}.svg`), 'utf8');
    assert.ok(svg.startsWith('<svg'), `${p.diagram}.svg is an SVG document`);
    assert.ok(svg.includes('viewBox="0 0 1280 720"'), `${p.diagram}.svg is 1280x720`);
    const png = fs.readFileSync(path.join(ASSETS, `${p.diagram}.png`));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${p.diagram}.png is a PNG`);
    assert.ok(png.length > 20000, `${p.diagram}.png is non-trivial`);
  }
  assert.ok(fs.existsSync(path.join(PPT_DIR, 'preview.html')), 'preview.html exists');
  assert.ok(pptxExists && fs.statSync(pptxPath).size > 200000, 'the PPTX is non-trivial');
});

test('AT-coding-deck-07: the PPTX has 9 slides, each carrying its page image and its title', () => {
  assert.ok(pptx, 'pptx readable');
  assert.equal(pptx.slides.length, 9, 'nine slides');
  assert.ok(pptx.media.length >= 9, 'nine page images are embedded');
  plan.pages.forEach((p, i) => {
    const xml = pptx.xml[pptx.slides[i]];
    assert.ok(xml.includes(p.kicker), `slide ${i + 1} carries its kicker`);
    assert.ok(xml.includes(p.title), `slide ${i + 1} carries its title`);
  });
});

test('AT-coding-deck-08: the text layer keeps the takeaway and key terms searchable', () => {
  assert.ok(pptx, 'pptx readable');
  const s1 = slideText(0);
  for (const needle of ['Idle', 'Running', 'Reasoning', 'Retrieving', 'Acting', 'Verifying', 'Finalizing']) {
    assert.ok(s1.includes(needle), `page 1 text layer contains ${needle}`);
  }
  assert.ok(slideText(0).includes(plan.pages[0].takeaway.slice(0, 10)), 'page 1 takeaway is real text');
  const s9 = slideText(8);
  for (const m of plan.pages[8].metrics) assert.ok(s9.includes(m.name), `appendix text layer contains ${m.name}`);
});

test('AT-coding-deck-09: the deck is frugal — no main page is a text wall', () => {
  for (const p of plan.pages.slice(0, 8)) {
    const svg = fs.readFileSync(path.join(ASSETS, `${p.diagram}.svg`), 'utf8');
    const textCount = (svg.match(/<text /g) || []).length;
    assert.ok(textCount < 160, `${p.diagram} has a bounded amount of text (${textCount})`);
  }
  // page 1 keeps the requested split: diagram on the left, numbered key on the right
  const svg = fs.readFileSync(path.join(ASSETS, 'p1-state-machine.svg'), 'utf8');
  const xs = [...svg.matchAll(/<text x="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(xs.some((x) => x >= 900), 'the numbered key column is on the right');
  assert.ok(xs.filter((x) => x < 900).length > xs.filter((x) => x >= 900).length, 'the state machine dominates the left');
});

test('AT-coding-deck-10: every page ships an editable .excalidraw source; diagram pages have connectors', () => {
  const diagramPages = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p8']);
  for (const p of plan.pages) {
    const file = path.join(EX_DIR, `${p.diagram}.excalidraw`);
    assert.ok(fs.existsSync(file), `${p.diagram}.excalidraw exists`);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(doc.type, 'excalidraw');
    assert.equal(doc.version, 2);
    assert.equal(String(doc.appState.viewBackgroundColor).toLowerCase(), '#ffffff', `${p.diagram} white canvas`);
    assert.ok(Array.isArray(doc.elements) && doc.elements.length >= 20, `${p.diagram} scene is non-trivial`);
    const kinds = new Set(doc.elements.map((e) => e.type));
    assert.ok(kinds.has('rectangle') && kinds.has('text'), `${p.diagram} has boxes + labels`);
    if (diagramPages.has(p.id)) assert.ok(kinds.has('arrow'), `${p.diagram} has connectors (a real view, not a list)`);
    for (const e of doc.elements) {
      assert.ok(typeof e.id === 'string' && e.id.length > 0, `${p.diagram} element id`);
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `${p.diagram} element position`);
    }
  }
});

test('AT-coding-deck-11: the deck uses a white / light tech theme', () => {
  for (const p of plan.pages) {
    const svg = fs.readFileSync(path.join(ASSETS, `${p.diagram}.svg`), 'utf8');
    assert.ok(svg.includes('<rect width="1280" height="720" fill="#ffffff"/>'), `${p.diagram} paints a white page`);
    for (const dark of ['#0a0e1a', '#0b1120', '#0d1424', '#eef1f6']) {
      assert.ok(!svg.includes(dark), `${p.diagram} carries no dark-theme colour ${dark}`);
    }
  }
  assert.ok(fs.readFileSync(path.join(PPT_DIR, 'preview.html'), 'utf8').includes('data-theme="light"'), 'preview is light');
});
