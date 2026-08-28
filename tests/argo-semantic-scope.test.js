'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  TOOLS,
  applySemanticScopeFilter,
  resolveSemanticScope,
} = require('../argo/scripts/systemarchitecture-mcp-server.js');
const {
  scopeCanonicalIdentitiesForChannel,
} = require('../argo/scripts/graph-rag/defaultSemanticRetrieval.js');

// Scope identities come from the canonical graph as bare ids, but the semantic
// vector records store canonicalIdentity with a channel prefix. The scoped
// Cypher matches node.canonicalIdentity IN $canonicalIdentities, so bare scope
// ids must be normalised to the channel-prefixed form or scoped semantic
// retrieval silently returns empty (observed: scope view_id -> 0 elements while
// the unscoped query returned the same elements with sufficient scores).
test('scopeCanonicalIdentitiesForChannel: bare ids get the channel prefix', () => {
  // GIVEN bare element ids (as resolveSemanticScope returns) and the Element channel
  const elementChannel = { objectType: 'Element' };
  const ids = ['memory-eval-bench-wp-001', 'memory-eval-dataset-wp-001'];
  // WHEN normalising for the Element channel
  const normalised = scopeCanonicalIdentitiesForChannel(ids, elementChannel);
  // THEN each bare id gains the Element: prefix so it matches the vector records
  assert.deepEqual(normalised, ['Element:memory-eval-bench-wp-001', 'Element:memory-eval-dataset-wp-001']);
});

test('scopeCanonicalIdentitiesForChannel: prefixed ids pass through untouched', () => {
  // GIVEN ids that already carry a channel prefix (this or another channel)
  const elementChannel = { objectType: 'Element' };
  const ids = ['Element:e1', 'ArchitectureRelationship:r1', 'View:v1'];
  // WHEN normalising for the Element channel
  const normalised = scopeCanonicalIdentitiesForChannel(ids, elementChannel);
  // THEN prefixed ids are preserved (a non-Element prefix is a correct no-op)
  assert.deepEqual(normalised, ['Element:e1', 'ArchitectureRelationship:r1', 'View:v1']);
});

test('scopeCanonicalIdentitiesForChannel: non-array or empty returns as-is', () => {
  // GIVEN an undefined / empty scope
  // WHEN normalising
  // THEN it is passed through unchanged (no scoping applied)
  assert.equal(scopeCanonicalIdentitiesForChannel(undefined, { objectType: 'Element' }), undefined);
  assert.deepEqual(scopeCanonicalIdentitiesForChannel([], { objectType: 'Element' }), []);
});

const FIXTURE = {
  elements: [
    { id: 'e1', name: 'Root', type: 'Business Actor', subdiagram_views: [{ view_id: 'v1' }] },
    { id: 'e2', name: 'Member A', type: 'Business Object', subdiagram_views: [] },
    { id: 'e3', name: 'Member B', type: 'Business Object', subdiagram_views: [] },
    { id: 'e4', name: 'Outside', type: 'Business Object', subdiagram_views: [] },
  ],
  relationships: [
    { id: 'r1', name: 'rel', source_id: 'e2', target_id: 'e3' },
    { id: 'r2', name: 'rel2', source_id: 'e3', target_id: 'e4' },
  ],
  views: [
    { view_id: 'v1', name: 'View 1', included_elements: ['e1', 'e2', 'e3'], included_relationships: ['r1'] },
    { view_id: 'v2', name: 'View 2', included_elements: ['e4'], included_relationships: ['r2'] },
  ],
};

test('getSystemArchitecture tool schema documents the scope parameter', () => {
  // GIVEN the ARGO MCP tool registry
  const tool = TOOLS.find(entry => entry.name === 'getSystemArchitecture');
  assert.ok(tool, 'getSystemArchitecture tool must be registered');
  // THEN the query schema documents scope (view_id / element_id / depth)
  const queryProps = tool.inputSchema.properties.query.properties;
  assert.ok(queryProps.scope, 'query.scope must be documented');
  assert.ok(queryProps.scope.properties.view_id, 'scope must accept view_id');
  assert.ok(queryProps.scope.properties.element_id, 'scope must accept element_id');
  assert.ok(queryProps.scope.properties.depth, 'scope must accept depth');
});

test('resolveSemanticScope: view scope yields the view membership identities', () => {
  // GIVEN a canonical graph and a view_id scope
  const resolved = resolveSemanticScope(FIXTURE, { view_id: 'v1' });
  // THEN the identity set contains the view members but not the outside view
  assert.ok(Array.isArray(resolved.identities), 'identities must be an array');
  for (const id of ['e1', 'e2', 'e3', 'r1', 'v1']) {
    assert.ok(resolved.identities.includes(id), `scope must include ${id}`);
  }
  assert.ok(!resolved.identities.includes('e4'), 'scope must exclude outside element e4');
  assert.ok(!resolved.identities.includes('v2'), 'scope must exclude outside view v2');
});

test('resolveSemanticScope: element scope yields the subtree identities', () => {
  // GIVEN a canonical graph and an element_id scope with depth
  const resolved = resolveSemanticScope(FIXTURE, { element_id: 'e1', depth: 2 });
  // THEN the identity set contains the root element and its mounted sub-view members
  assert.ok(Array.isArray(resolved.identities), 'identities must be an array');
  for (const id of ['e1', 'e2', 'e3', 'r1', 'v1']) {
    assert.ok(resolved.identities.includes(id), `subtree scope must include ${id}`);
  }
  assert.ok(!resolved.identities.includes('e4'), 'subtree scope must exclude outside element e4');
});

test('resolveSemanticScope: unknown view or element fails with a clear category', () => {
  // GIVEN scopes pointing at missing objects
  const missingView = resolveSemanticScope(FIXTURE, { view_id: 'nope' });
  const missingElement = resolveSemanticScope(FIXTURE, { element_id: 'nope' });
  // THEN they fail with SCOPE_* categories
  assert.equal(missingView.status, 'failed');
  assert.equal(missingView.error.category, 'SCOPE_VIEW_NOT_FOUND');
  assert.equal(missingElement.status, 'failed');
  assert.equal(missingElement.error.category, 'SCOPE_ELEMENT_NOT_FOUND');
});

test('applySemanticScopeFilter: canonical document is bounded to the scope', () => {
  // GIVEN a canonical-shaped document and a scope identity set
  const document = {
    elements: [...FIXTURE.elements],
    relationships: [...FIXTURE.relationships],
    views: [...FIXTURE.views],
  };
  const filtered = applySemanticScopeFilter(document, ['e1', 'e2', 'r1', 'v1']);
  // THEN only in-scope objects remain
  assert.deepEqual(filtered.elements.map(e => e.id).sort(), ['e1', 'e2']);
  assert.deepEqual(filtered.relationships.map(r => r.id), ['r1']);
  assert.deepEqual(filtered.views.map(v => v.view_id), ['v1']);
});

test('applySemanticScopeFilter: business summary is bounded to the scope', () => {
  // GIVEN a business-summary-shaped document and a scope identity set
  const document = {
    responseProfile: 'business-summary',
    purpose: 'implementation-design',
    businessObjects: {
      elements: FIXTURE.elements.map(e => ({ id: e.id, name: e.name })),
      relationships: FIXTURE.relationships.map(r => ({ id: r.id, name: r.name })),
      views: FIXTURE.views.map(v => ({ view_id: v.view_id, view_name: v.name })),
    },
    semanticSeeds: [
      { objectType: 'Element', objectId: 'e1' },
      { objectType: 'Element', objectId: 'e4' },
    ],
    hitReasons: [
      { objectType: 'Element', objectId: 'e2' },
      { objectType: 'View', objectId: 'v2' },
    ],
  };
  const filtered = applySemanticScopeFilter(document, ['e1', 'e2', 'r1', 'v1']);
  // THEN only in-scope objects remain across all sections
  assert.deepEqual(filtered.businessObjects.elements.map(e => e.id).sort(), ['e1', 'e2']);
  assert.deepEqual(filtered.businessObjects.relationships.map(r => r.id), ['r1']);
  assert.deepEqual(filtered.businessObjects.views.map(v => v.view_id), ['v1']);
  assert.deepEqual(filtered.semanticSeeds.map(s => s.objectId), ['e1']);
  assert.deepEqual(filtered.hitReasons.map(h => h.objectId), ['e2']);
});
