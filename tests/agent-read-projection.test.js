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
    base(2, 'getArchitectureViewContext', { view_id: '174' }),
    base(3, 'getArchitectureViewContext', { view_id: '174', includeAttributes: true, includeTestcases: true, maxBytes: 0 }),
  ]);
  const def = payload(responses, 2);
  const full = payload(responses, 3);
  assert.equal(def.status, 'passed');
  // the member that DOES carry bookkeeping (1318) has it omitted by default
  const e1318def = def.elements.find(e => e.id === '1318');
  const e1318full = full.elements.find(e => e.id === '1318');
  assert.ok(e1318def && e1318full);
  assert.equal(e1318def.attributes, undefined, 'attributes omitted by default');
  assert.equal(e1318def.testcases, undefined, 'testcases omitted by default');
  assert.ok(Array.isArray(e1318def.attributes) === false);
  // default read reports the omission so the agent knows how to get them
  assert.ok(def.projection && def.projection.attributesOmitted > 0, 'projection note must report omissions');
  assert.match(def.projection.note, /includeAttributes/);
  // opt-in returns them verbatim
  assert.ok(Array.isArray(e1318full.attributes) && e1318full.attributes.length > 0, 'opt-in restores attributes');
  assert.ok(Array.isArray(e1318full.testcases) && e1318full.testcases.length > 0, 'opt-in restores testcases');
  assert.equal(full.projection, undefined, 'no omission note when nothing omitted');
  // non-bookkeeping content is untouched
  assert.equal(e1318def.description, e1318full.description);
  assert.equal(e1318def.name, e1318full.name);
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

// --- Context output budget (issue #9) ----------------------------------------
// A hub structural read can expand to tens of KB; the HOST then cuts it mid-JSON
// and the agent gets a malformed partial observation. The framework must own the
// ceiling: above maxBytes the non-focus members degrade to identity, the focus
// element + boundary/hints are kept, and every included id is listed under
// `truncation` — always valid JSON, always navigable. Semantic retrieval is not
// affected (only these two structural builders).

const mcpModule = require('../argo/scripts/systemarchitecture-mcp-server.js');

function initRequests() {
  return [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'budget-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  ];
}
function stripVolatile(payloadValue) {
  const copy = JSON.parse(JSON.stringify(payloadValue));
  delete copy.neo4jRecovery;
  delete copy.warnings;
  return JSON.stringify(copy);
}

test('AT-budget-01: an over-budget hub element read degrades to identity + a complete id manifest (valid JSON, never host-truncated)', () => {
  const focus = 'overseer-vision-001';
  const unlimited = payload(runMcp([...initRequests(), base(2, 'getIntentElementContext', { elementId: focus, maxBytes: 0 })]), 2);
  assert.equal(unlimited.status, 'passed');
  assert.equal(unlimited.truncation, undefined, 'an unlimited read is never truncated');
  const unlimitedBytes = Buffer.byteLength(JSON.stringify(unlimited, null, 2));
  assert.ok(unlimitedBytes > 2000, `fixture read should be non-trivial, got ${unlimitedBytes}`);
  const allElementIds = unlimited.subgraph.elements.map(e => e.id).sort();

  const budget = Math.max(1500, Math.floor(unlimitedBytes / 3));
  const budgeted = payload(runMcp([...initRequests(), base(3, 'getIntentElementContext', { elementId: focus, maxBytes: budget })]), 3);
  assert.equal(budgeted.status, 'passed');
  assert.ok(budgeted.truncation && budgeted.truncation.truncated === true, 'must report truncation');
  assert.equal(budgeted.truncation.reason, 'context_budget_exceeded');
  assert.ok(budgeted.subgraph.elements.find(e => e.id === focus), 'focus element stays present');
  if (budgeted.truncation.manifestTruncated !== true) {
    const bytes = Buffer.byteLength(JSON.stringify(budgeted, null, 2));
    assert.ok(bytes <= budget, `bounded payload must be <= maxBytes (${budget}), got ${bytes}`);
    assert.deepEqual(
      (budgeted.truncation.includedElementIds || []).slice().sort(),
      allElementIds,
      'every included element id must be listed (lossless identity)',
    );
  }
  if (budgeted.truncation.tier === 'identity') {
    const neighbours = budgeted.subgraph.elements.filter(e => e.id !== focus);
    assert.ok(neighbours.every(e => e.description === undefined), 'neighbour detail dropped to identity');
  }
});

test('AT-budget-02: a sub-budget read (default budget) is identical to an unlimited read (no regression)', () => {
  const responses = runMcp([
    ...initRequests(),
    base(10, 'getIntentElementContext', { elementId: '1331' }),
    base(11, 'getIntentElementContext', { elementId: '1331', maxBytes: 0 }),
  ]);
  const def = payload(responses, 10);
  const unlimited = payload(responses, 11);
  assert.equal(def.truncation, undefined, 'a default read under budget must not be truncated');
  assert.equal(stripVolatile(def), stripVolatile(unlimited), 'default budget must not change a sub-budget read');
});

test('AT-budget-03: budget tiers + parameter resolution (identity fallback, complete manifest, 0 = unlimited)', () => {
  const big = {
    status: 'passed',
    focusElementId: 'f',
    subgraph: {
      elements: [
        { id: 'f', name: 'F', type: 'X', description: 'focus' },
        { id: 'n1', name: 'N1', type: 'Y', description: 'd'.repeat(2000) },
        { id: 'n2', name: 'N2', type: 'Y', description: 'd'.repeat(2000) },
        { id: 'n3', name: 'N3', type: 'Y', description: 'd'.repeat(2000) },
      ],
      relationships: [{ id: 'r1', name: 'R', type: 'Flow', source_id: 'f', target_id: 'n1', statement: 's'.repeat(1000) }],
      views: [{ view_id: 'v1', view_name: 'V', description: 'd'.repeat(1000), included_elements: ['f', 'n1', 'n2', 'n3'] }],
    },
    boundary: { truncatedDependencies: [], truncatedDependents: [] },
    explorationHints: [],
  };
  const out = mcpModule.applyContextBudget(big, 1500);
  assert.equal(out.truncation.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(out, null, 2)) <= 1500, 'identity tier must fit the budget');
  assert.equal(out.subgraph.elements.find(e => e.id === 'f').description, 'focus', 'focus kept full');
  assert.equal(out.subgraph.elements.find(e => e.id === 'n1').description, undefined, 'neighbours are identity only');
  assert.deepEqual(out.truncation.includedElementIds.slice().sort(), ['f', 'n1', 'n2', 'n3'], 'id manifest is complete');
  const focusBound = mcpModule.applyContextBudget(big, 40);
  assert.equal(focusBound.truncation.overBudgetByFocus, true, 'a budget below the focus element size is flagged');
  assert.deepEqual(focusBound.truncation.includedElementIds.slice().sort(), ['f', 'n1', 'n2', 'n3'], 'complete manifest kept when trimming ids cannot help');
  const wide = {
    status: 'passed',
    focusElementId: 'f',
    subgraph: {
      elements: [{ id: 'f', name: 'F', type: 'X', description: 'x' }]
        .concat(Array.from({ length: 300 }, (_, i) => ({ id: 'n' + i, name: 'N' + i, type: 'Y', description: 'd'.repeat(100) }))),
      relationships: [],
      views: [],
    },
    boundary: { truncatedDependencies: [], truncatedDependents: [] },
    explorationHints: [],
  };
  const trimmed = mcpModule.applyContextBudget(wide, 1200);
  assert.equal(trimmed.truncation.manifestTruncated, true, 'when the manifest itself is the binding constraint it is trimmed and flagged');
  assert.ok((trimmed.truncation.includedElementIds || []).length < 301, 'manifest trimmed');
  assert.equal(mcpModule.applyContextBudget(big, 0), big, '0 = unlimited');
  assert.equal(mcpModule.applyContextBudget(big, 10_000_000), big, 'a huge budget leaves the read untouched');

  const saved = process.env.ARGO_CONTEXT_MAX_BYTES;
  delete process.env.ARGO_CONTEXT_MAX_BYTES;
  assert.equal(mcpModule.resolveContextMaxBytes({}), 32000, 'default budget');
  assert.equal(mcpModule.resolveContextMaxBytes({ maxBytes: 0 }), 0, 'explicit 0 = unlimited');
  assert.equal(mcpModule.resolveContextMaxBytes({ maxBytes: 123 }), 123, 'explicit budget wins');
  process.env.ARGO_CONTEXT_MAX_BYTES = '777';
  assert.equal(mcpModule.resolveContextMaxBytes({}), 777, 'env override');
  assert.equal(mcpModule.resolveContextMaxBytes({ maxBytes: 5 }), 5, 'arg beats env');
  if (saved === undefined) { delete process.env.ARGO_CONTEXT_MAX_BYTES; } else { process.env.ARGO_CONTEXT_MAX_BYTES = saved; }
});

test('AT-budget-04: a large view read obeys the same budget with a complete id manifest', () => {
  const v = payload(runMcp([...initRequests(), base(20, 'getArchitectureViewContext', { view_id: '174', maxBytes: 6000 })]), 20);
  assert.equal(v.status, 'passed');
  assert.equal(v.view.view_id, '174');
  assert.ok(v.truncation && v.truncation.truncated === true, 'view read must report truncation');
  assert.equal((v.truncation.includedElementIds || []).length, 15, 'all 15 member ids listed');
  assert.equal((v.truncation.includedRelationshipIds || []).length, 9, 'all 9 relationship ids listed');
  assert.ok(v.elements.every(e => e.description === undefined), 'members degrade to identity');
  if (v.truncation.manifestTruncated !== true) {
    assert.ok(Buffer.byteLength(JSON.stringify(v, null, 2)) <= 6000, 'view read fits the budget');
  }
});
