'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(WORKSPACE_ROOT, 'argo', 'scripts', 'argo-mcp-server.js');

function runMcp(requests) {
  const input = `${requests.map(r => JSON.stringify(r)).join('\n')}\n`;
  const result = spawnSync(process.execPath, [SERVER_PATH], {
    cwd: WORKSPACE_ROOT, encoding: 'utf8', env: { ...process.env, ARGO_REPO_ROOT: WORKSPACE_ROOT },
    input, maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `server exited ${result.status}: ${result.stderr}`);
  return String(result.stdout).split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}
function payload(responses, id) { return JSON.parse(responses.find(e => e.id === id).result.content[0].text); }
function base(id, name, args) { return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }; }

// Structural reads omit agent-useless bookkeeping (attributes/testcases) by
// default and return them only on opt-in — WITHOUT dropping them from the
// semantic match surface (semantic retrieval embeds their text) and WITHOUT
// changing queryNeo4jGraph (the caller's explicit projection).

test('AT-agent-read-projection-01: view read omits attributes/testcases by default, opt-in restores them', () => {
  const responses = runMcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    base(2, 'getArchitectureViewContext', { view_id: '176' }),
    base(3, 'getArchitectureViewContext', { view_id: '176', includeAttributes: true, includeTestcases: true }),
  ]);
  const def = payload(responses, 2);
  const full = payload(responses, 3);
  assert.equal(def.status, 'passed');
  // the member that DOES carry bookkeeping (1331) has it omitted by default
  const e1331def = def.elements.find(e => e.id === '1331');
  const e1331full = full.elements.find(e => e.id === '1331');
  assert.ok(e1331def && e1331full);
  assert.equal(e1331def.attributes, undefined, 'attributes omitted by default');
  assert.equal(e1331def.testcases, undefined, 'testcases omitted by default');
  assert.ok(Array.isArray(e1331def.attributes) === false);
  // default read reports the omission so the agent knows how to get them
  assert.ok(def.projection && def.projection.attributesOmitted > 0, 'projection note must report omissions');
  assert.match(def.projection.note, /includeAttributes/);
  // opt-in returns them verbatim
  assert.ok(Array.isArray(e1331full.attributes) && e1331full.attributes.length > 0, 'opt-in restores attributes');
  assert.ok(Array.isArray(e1331full.testcases) && e1331full.testcases.length > 0, 'opt-in restores testcases');
  assert.equal(full.projection, undefined, 'no omission note when nothing omitted');
  // non-bookkeeping content is untouched
  assert.equal(e1331def.description, e1331full.description);
  assert.equal(e1331def.name, e1331full.name);
});

test('AT-agent-read-projection-02: an element read keeps the FOCUS element bookkeeping', () => {
  const responses = runMcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    base(2, 'getIntentElementContext', { elementId: '1331' }),
  ]);
  const p = payload(responses, 2);
  assert.equal(p.status, 'passed');
  const focus = p.subgraph.elements.find(e => e.id === '1331');
  assert.ok(Array.isArray(focus.attributes) && focus.attributes.length > 0, 'focus element keeps its own attributes');
});

test('AT-agent-read-projection-03: semantic retrieval and raw Cypher are NOT pruned', () => {
  const src = fs.readFileSync(path.join(WORKSPACE_ROOT, 'argo', 'scripts', 'systemarchitecture-mcp-server.js'), 'utf8');
  // the projector is a structural-read helper; it must not be wired into the
  // semantic builder nor into the raw Cypher passthrough.
  const projCalls = (src.match(/projectAgentFields\(/g) || []).length;
  assert.ok(projCalls >= 3, 'projection used by the structural builders');
  assert.ok(!/buildSystemArchitecture[\s\S]{0,400}projectAgentFields/.test(src), 'semantic builder must not prune');
});

test('AT-agent-read-projection-04: semantic hits keep attribute/testcase-derived fields; neighbours drop them', () => {
  const sem = require('../argo/scripts/systemarchitecture-mcp-server.js');
  const source = {
    seedsByType: { elements: [{ id: 'hit-1' }], views: [], relationships: [] },
    provenance: { objects: [{ objectType: 'Element', objectId: 'hit-1', firstInclusionReason: 'semantic-seed', supplementaryReasons: [] }] },
    closure: {
      elements: [
        { id: 'hit-1', name: 'Hit', type: 'Business Object', description: 'the hit', attributes: [{ name: 'commit', value: 'abc' }], testcases: [{ name: 'AT-1', description: 'covers' }] },
        { id: 'n-1', name: 'Neighbour', type: 'Business Object', description: 'neighbour', attributes: [{ name: 'commit', value: 'zzz' }], testcases: [{ name: 'AT-2', description: 'x' }] },
      ],
    },
  };
  const s = sem.buildBusinessSemanticSummary(source, { purpose: 'general', intent: 'x' });
  const els = s.businessObjects.elements;
  const hit = els.find(e => e.id === 'hit-1');
  const neighbour = els.find(e => e.id === 'n-1');
  assert.ok(hit, 'hit element present');
  assert.ok(Array.isArray(hit.testCoverage), 'hit keeps testcase-derived fields');
  assert.ok('functionalPoints' in hit, 'hit keeps attribute-derived fields');
  assert.equal(neighbour.testCoverage, undefined, 'neighbour drops testcase-derived fields');
  assert.equal(neighbour.functionalPoints, undefined, 'neighbour drops attribute-derived fields');
  assert.equal(neighbour.bookkeepingOmitted, true, 'neighbour is flagged as omitted');
  assert.ok(typeof hit.matchedSnippet === 'string' && hit.matchedSnippet.length > 0, 'hit carries WHY it matched');
  assert.equal(neighbour.matchedSnippet, undefined, 'neighbour carries no matchedSnippet');
  // identity/description are always kept
  assert.equal(neighbour.name, 'Neighbour');
  assert.equal(neighbour.descriptionSummary, 'neighbour');
});

test('AT-agent-read-projection-05: memory_search hits carry the matching bookkeeping snippet', () => {
  const sem = require('../argo/scripts/systemarchitecture-mcp-server.js');
  const element = {
    id: 'm1', name: 'Memo', type: 'Business Object', semanticScore: 0.9,
    description: 'a short description',
    attributes: [{ name: 'decision', value: 'retrieval recall first', description: 'never trade recall for speed' }],
    testcases: [{ name: 'AT-m1', description: 'recall must not drop' }],
  };
  const card = sem.memoryHitCard(element, 800, 'retrieval recall');
  assert.equal(card.id, 'm1');
  assert.ok(typeof card.matchedSnippet === 'string', 'matchedSnippet present when bookkeeping exists');
  assert.match(card.matchedSnippet, /decision/, 'snippet surfaces the attribute');
  // no bookkeeping -> no snippet
  const bare = sem.memoryHitCard({ id: 'm2', name: 'Bare', type: 'Business Object', semanticScore: 0.5, description: 'x' }, 800, 'q');
  assert.equal(bare.matchedSnippet, undefined);
});
