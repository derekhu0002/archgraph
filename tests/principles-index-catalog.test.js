'use strict';

// Project-level acceptance tests for THIS workspace's principle catalog.
//
// The framework contract is generic (<PrincipleIndexGuideline> reads the
// bundle-declared locators). This file verifies the ArchGraph workspace's own
// data: the bundle declaration and the graph catalog it points at must agree.
//
// Framework-level coverage lives in tests/argo-rules-principle-index.test.js and
// tests/schema-bundle-principle-index.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_PATH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const BUNDLE_CONFIG = path.join(ROOT, '.argo', 'schema', 'schema-bundle.config.json');
const RULES = path.join(ROOT, 'argo', 'rules', 'archgraph.instructions.md');
const INDEX_MAX_CHARS = 3000;

// Resident-tier principles that claim a governing rule section MUST point at a
// section that really is always loaded.
const RESIDENT_SECTIONS = {
  'archgraph-content-storage-policy-001': '<ContentStoragePolicy>',
  'overseer-memory-tiers-001': '<MemoryTierConventions>',
};

function readGraph() {
  return JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
}

function readDeclaration() {
  const config = JSON.parse(fs.readFileSync(BUNDLE_CONFIG, 'utf8'));
  return config.principleIndex;
}

function attr(element, name) {
  const hit = (element.attributes || []).find(a => a && a.name === name);
  return hit ? hit.value : undefined;
}

test('AT principle-catalog: the workspace bundle declares a complete catalog contract', () => {
  // GIVEN this workspace opts into the framework contract via its schema bundle
  const declaration = readDeclaration();
  assert.ok(declaration, 'this workspace must declare principleIndex in .argo/schema/schema-bundle.config.json');
  assert.equal(typeof declaration.indexElementId, 'string');
  assert.equal(declaration.principlesElementType, 'Principle');
  assert.equal(typeof declaration.viewId, 'string');
  for (const key of ['tier', 'summary', 'trigger']) {
    assert.equal(typeof declaration.attributes[key], 'string', `attributes.${key} must be declared`);
  }
  assert.ok(declaration.tiers.resident);
  assert.ok(declaration.tiers.onDemand);
  assert.notEqual(declaration.tiers.resident, declaration.tiers.onDemand);
});

test('AT principle-catalog: the declared index element and view exist in the graph', () => {
  const graph = readGraph();
  const declaration = readDeclaration();
  const index = (graph.elements || []).find(el => el.id === declaration.indexElementId);
  assert.ok(index, `declared index element ${declaration.indexElementId} must exist`);
  const view = (graph.views || []).find(v => v.view_id === declaration.viewId);
  assert.ok(view, `declared catalog view ${declaration.viewId} must exist`);
  assert.ok((view.included_elements || []).includes(declaration.indexElementId),
    'the index element must belong to the declared view');
});

test('AT principle-catalog: every principle is catalogued exactly once with a bounded index', () => {
  const graph = readGraph();
  const declaration = readDeclaration();
  const index = (graph.elements || []).find(el => el.id === declaration.indexElementId);
  const principles = (graph.elements || []).filter(el => el.type === declaration.principlesElementType);
  assert.ok(principles.length > 0, 'the graph must carry principles');
  for (const principle of principles) {
    const occurrences = (index.description || '').split(principle.id).length - 1;
    assert.equal(occurrences, 1, `${declaration.indexElementId} must list ${principle.id} exactly once`);
  }
  assert.ok((index.description || '').length <= INDEX_MAX_CHARS,
    `the index must stay cheap (<= ${INDEX_MAX_CHARS} chars)`);
  // AND loading the index must not pull principle bodies through edges
  const touching = (graph.relationships || []).filter(r => r.source_id === index.id || r.target_id === index.id);
  assert.equal(touching.length, 0, 'the index must have no relationships');
});

test('AT principle-catalog: the catalog view contains exactly the index plus the principles', () => {
  const graph = readGraph();
  const declaration = readDeclaration();
  const view = (graph.views || []).find(v => v.view_id === declaration.viewId);
  const byId = new Map((graph.elements || []).map(el => [el.id, el]));
  const members = new Set(view.included_elements || []);
  const principles = (graph.elements || []).filter(el => el.type === declaration.principlesElementType);
  for (const principle of principles) {
    assert.ok(members.has(principle.id), `${principle.id} must be catalogued`);
  }
  for (const member of members) {
    if (member === declaration.indexElementId) continue;
    const el = byId.get(member);
    assert.ok(el, `view member ${member} must resolve`);
    assert.equal(el.type, declaration.principlesElementType, `unexpected non-principle member ${member}`);
  }
});

test('AT principle-catalog: every principle declares the bundle-named tier, summary and trigger', () => {
  const graph = readGraph();
  const declaration = readDeclaration();
  const tiers = new Set([declaration.tiers.resident, declaration.tiers.onDemand]);
  const principles = (graph.elements || []).filter(el => el.type === declaration.principlesElementType);
  for (const principle of principles) {
    const tier = attr(principle, declaration.attributes.tier);
    const summary = attr(principle, declaration.attributes.summary);
    const trigger = attr(principle, declaration.attributes.trigger);
    assert.ok(tiers.has(tier), `${principle.id} must declare ${declaration.attributes.tier} (${[...tiers].join('|')})`);
    assert.ok(typeof summary === 'string' && summary.trim() !== '', `${principle.id} must declare a summary`);
    assert.ok(summary.length <= 160, `${principle.id} summary must stay a one-liner`);
    assert.ok(typeof trigger === 'string' && trigger.trim() !== '', `${principle.id} must declare a load trigger`);
  }
});

test('AT principle-catalog: resident-tier principles are genuinely encoded in an always-loaded rule section', () => {
  const graph = readGraph();
  const declaration = readDeclaration();
  const rules = fs.readFileSync(RULES, 'utf8').replace(/^\uFEFF/, '');
  for (const [id, section] of Object.entries(RESIDENT_SECTIONS)) {
    const principle = (graph.elements || []).find(el => el.id === id);
    assert.ok(principle, `${id} must exist`);
    assert.equal(attr(principle, declaration.attributes.tier), declaration.tiers.resident,
      `${id} must be a resident-tier principle`);
    assert.ok(rules.includes(section), `${id} declares ${section} but that rule section is missing`);
  }
});
