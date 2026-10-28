'use strict';

// Framework-level acceptance tests for principle catalog PRESENCE.
//
// The catalog declaration is a promise about the graph: `indexElementId` names an
// element the agent is told to read at session start. Bundle validation can only
// see the declaration, so a declared-but-absent index used to pass silently and
// the agent read zero rows and continued. The schema read now reports presence:
//
//   status: "present"          the declared index element exists
//   status: "declared-missing" the declaration points at nothing (observable)
//   status: "unknown"          the graph could not be inspected (non-fatal)
//
// Disabled (`"principleIndex": null`) stays exactly `null`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_PRINCIPLE_INDEX,
  withPrincipleIndexPresence,
} = require('../argo/scripts/schema-bundle.js');
const { callTool } = require('../argo/scripts/systemarchitecture-mcp-server.js');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SCHEMA = path.join(ROOT, 'argo', 'schema', 'SystemArchitecture.schema.json');

function makeWorkspace({ config = {}, elements } = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'principle-index-presence-'));
  const schemaDir = path.join(workspaceRoot, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.copyFileSync(DEFAULT_SCHEMA, path.join(schemaDir, 'SystemArchitecture.schema.json'));
  fs.writeFileSync(
    path.join(schemaDir, 'schema-bundle.config.json'),
    JSON.stringify({ language: 'Test Ontology', actorElementType: 'Business Actor', ...config }, null, 2),
  );
  if (elements !== undefined) {
    const graphPath = path.join(workspaceRoot, 'design', 'KG');
    fs.mkdirSync(graphPath, { recursive: true });
    fs.writeFileSync(
      path.join(graphPath, 'SystemArchitecture.json'),
      JSON.stringify({ name: 'Test Architecture', elements, relationships: [], views: [] }, null, 2),
    );
  }
  return workspaceRoot;
}

async function readSchema(workspaceRoot) {
  const result = await callTool('queryNeo4jGraph', { schema: true, workspaceRoot });
  return result;
}

test('AT principle-index-presence: a present index is reported as present', () => {
  // GIVEN a declaration and a graph that contains the declared element
  const described = withPrincipleIndexPresence(DEFAULT_PRINCIPLE_INDEX, true);
  // THEN the status says present and no gap hint is attached
  assert.equal(described.status, 'present');
  assert.equal(described.indexElementId, 'principle-index-001');
  assert.equal(described.hint, undefined);
});

test('AT principle-index-presence: a declared but absent index is observable, not silent', () => {
  // GIVEN a declaration that points at nothing
  const described = withPrincipleIndexPresence(DEFAULT_PRINCIPLE_INDEX, false);
  // THEN the status names the gap and a hint carries the declared id
  assert.equal(described.status, 'declared-missing');
  assert.match(described.hint, /principle-index-001/);
  assert.match(described.hint, /report/i);
});

test('AT principle-index-presence: an uninspectable graph degrades to unknown without inventing present', () => {
  assert.equal(withPrincipleIndexPresence(DEFAULT_PRINCIPLE_INDEX, null).status, 'unknown');
  assert.equal(withPrincipleIndexPresence(DEFAULT_PRINCIPLE_INDEX, undefined).status, 'unknown');
});

test('AT principle-index-presence: a disabled capability stays null (opt-out is unchanged)', () => {
  assert.equal(withPrincipleIndexPresence(null, true), null);
  assert.equal(withPrincipleIndexPresence(null, false), null);
});

test('AT principle-index-presence: the resolver never mutates the declared contract', () => {
  // GIVEN the framework defaults
  const before = JSON.stringify(DEFAULT_PRINCIPLE_INDEX);
  // WHEN presence is attached
  withPrincipleIndexPresence(DEFAULT_PRINCIPLE_INDEX, false);
  // THEN the defaults are untouched
  assert.equal(JSON.stringify(DEFAULT_PRINCIPLE_INDEX), before);
});

test('AT principle-index-presence: the schema read reports declared-missing for this shape of workspace', async () => {
  // GIVEN a workspace whose graph has no index element
  const workspaceRoot = makeWorkspace({ elements: [{ id: 'some-element', name: 'Something', type: 'Business Object' }] });
  // WHEN the agent reads the schema
  const result = await readSchema(workspaceRoot);
  // THEN the read still passes but the gap is explicit
  assert.equal(result.status, 'passed');
  assert.equal(result.schema.principleIndex.status, 'declared-missing');
  assert.match(result.schema.principleIndex.hint, /principle-index-001/);
});

test('AT principle-index-presence: the schema read reports present once the element exists', async () => {
  // GIVEN the declared index element exists in the graph
  const workspaceRoot = makeWorkspace({
    elements: [{ id: 'principle-index-001', name: 'Principles', type: 'Business Object' }],
  });
  // WHEN the agent reads the schema
  const result = await readSchema(workspaceRoot);
  // THEN presence is confirmed
  assert.equal(result.schema.principleIndex.status, 'present');
});

test('AT principle-index-presence: an opted-out workspace keeps principleIndex null', async () => {
  const workspaceRoot = makeWorkspace({ config: { principleIndex: null }, elements: [] });
  const result = await readSchema(workspaceRoot);
  assert.equal(result.schema.principleIndex, null);
});

test('AT principle-index-presence: a missing graph file degrades to unknown, never a failed schema read', async () => {
  // GIVEN no canonical graph at all
  const workspaceRoot = makeWorkspace({});
  // WHEN the schema is read
  const result = await readSchema(workspaceRoot);
  // THEN the schema still answers and the presence is unknown
  assert.equal(result.status, 'passed');
  assert.equal(result.schema.principleIndex.status, 'unknown');
});

test('AT principle-index-presence: this workspace index exists and covers every Principle (no drift)', () => {
  // GIVEN this repository's canonical graph
  const document = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
  const elements = Array.isArray(document.elements) ? document.elements : [];
  // WHEN the declared index and every Principle are compared
  const index = elements.find((element) => element && element.id === DEFAULT_PRINCIPLE_INDEX.indexElementId);
  // THEN the declared catalog exists (the dangling-promise defect cannot return)
  assert.ok(index, `the declared index '${DEFAULT_PRINCIPLE_INDEX.indexElementId}' must exist in the graph`);
  // AND no Principle is left uncatalogued (principlesElementType is null: the index is the only source)
  const uncatalogued = elements
    .filter((element) => element && element.type === 'Principle')
    .filter((element) => !String(index.description || '').includes(element.id))
    .map((element) => element.id);
  assert.deepEqual(uncatalogued, [], `every Principle must be registered in the index: ${uncatalogued.join(', ')}`);
});
