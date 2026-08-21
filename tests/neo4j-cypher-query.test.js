'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const neo4j = require('neo4j-driver');
const {
  assertReadOnlyCypher,
  buildNeo4jGraphSchema,
  serializeNeo4jValue,
} = require('../argo/scripts/neo4j-system-architecture-store.js');
const {
  callTool,
  TOOLS,
} = require('../argo/scripts/systemarchitecture-mcp-server.js');

test('assertReadOnlyCypher accepts read-only MATCH and introspection queries', () => {
  // GIVEN read-only Cypher statements
  const queries = [
    "MATCH (e:Element {graphKey: $graphKey}) RETURN e.id, e.name",
    "MATCH (a:Element {graphKey: $graphKey, type: 'Business Actor'})-[r:ARCHIMATE_RELATES]->(b:Element {graphKey: $graphKey}) RETURN a.name, b.name",
    'CALL db.labels() YIELD label RETURN label',
    'CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType',
    'SHOW CONSTRAINTS',
  ];
  // WHEN each is validated
  // THEN none throws
  for (const cypher of queries) {
    assert.equal(assertReadOnlyCypher(cypher), true, `should accept: ${cypher}`);
  }
});

test('assertReadOnlyCypher rejects write clauses', () => {
  // GIVEN Cypher statements that mutate the graph
  const queries = [
    'CREATE (e:Element {id: "x"})',
    'MERGE (e:Element {id: "x"})',
    'MATCH (e:Element {id: "x"}) DELETE e',
    'MATCH (e:Element {id: "x"}) DETACH DELETE e',
    'MATCH (e:Element {id: "x"}) SET e.name = "y"',
    'MATCH (e:Element {id: "x"}) REMOVE e.name',
    'DROP CONSTRAINT argo_architecture_element_key',
    'LOAD CSV FROM "file:///x.csv" AS row RETURN row',
    'FOREACH (x IN [1,2] | CREATE (n {v: x}))',
    'CALL { CREATE (n) } IN TRANSACTIONS',
  ];
  // WHEN each is validated
  // THEN each throws a READ_ONLY_CYPHER_REQUIRED error
  for (const cypher of queries) {
    assert.throws(
      () => assertReadOnlyCypher(cypher),
      error => error.category === 'READ_ONLY_CYPHER_REQUIRED',
      `should reject: ${cypher}`,
    );
  }
});

test('assertReadOnlyCypher ignores mutation keywords inside strings and comments', () => {
  // GIVEN a read-only query whose strings/comments contain write-looking words
  const cypher = [
    "MATCH (e:Element {graphKey: $graphKey, name: 'create set delete'})",
    '// SET and CREATE are only in this comment',
    'RETURN e.id',
  ].join('\n');
  // WHEN validated
  // THEN it is accepted (strings and comments are stripped before keyword scan)
  assert.equal(assertReadOnlyCypher(cypher), true);
});

test('assertReadOnlyCypher rejects empty and oversize queries', () => {
  // GIVEN a blank query
  assert.throws(
    () => assertReadOnlyCypher('   '),
    error => error.category === 'CYPHER_QUERY_REQUIRED',
  );
  // GIVEN an oversized query
  const oversized = `RETURN ${'x'.repeat(20001)}`;
  assert.throws(
    () => assertReadOnlyCypher(oversized),
    error => error.category === 'CYPHER_QUERY_TOO_LONG',
  );
});

test('buildNeo4jGraphSchema exposes labels, relationship types, and graphKey', () => {
  // GIVEN a canonical graph path
  const schema = buildNeo4jGraphSchema();
  // THEN it names the graphKey and the structural projection vocabulary
  assert.equal(schema.graphKey, 'design/KG/SystemArchitecture.json');
  assert.deepEqual(Object.keys(schema.nodeLabels).sort(), [
    'ArchitectureGraph',
    'ArchitectureRelationship',
    'Element',
    'View',
  ]);
  for (const relType of [
    'OWNS_ELEMENT',
    'OWNS_RELATIONSHIP',
    'OWNS_VIEW',
    'RELATIONSHIP_SOURCE',
    'RELATIONSHIP_TARGET',
    'ARCHIMATE_RELATES',
    'VIEW_OF',
    'INCLUDES_ELEMENT',
    'INCLUDES_RELATIONSHIP',
    'HAS_SUBDIAGRAM',
  ]) {
    assert.ok(schema.relationshipTypes[relType], `missing relationship type: ${relType}`);
  }
  assert.ok(schema.nodeLabels.Element.properties.includes('type'));
  assert.ok(schema.nodeLabels.Element.properties.includes('id'));
});

test('serializeNeo4jValue serializes integers, arrays, and nested objects', () => {
  // GIVEN Neo4j driver values
  const intValue = neo4j.int(42);
  // WHEN serialized
  // THEN they become JSON-safe primitives
  assert.equal(serializeNeo4jValue(intValue), 42);
  assert.equal(serializeNeo4jValue(neo4j.int(Number.MAX_SAFE_INTEGER + 5)), String(Number.MAX_SAFE_INTEGER + 5));
  assert.deepEqual(serializeNeo4jValue([intValue, 'a']), [42, 'a']);
  assert.deepEqual(serializeNeo4jValue({ n: intValue, s: 'x', missing: undefined }), { n: 42, s: 'x', missing: null });
});

test('queryNeo4jGraph schema mode returns the projection schema without a live Neo4j', async () => {
  // GIVEN a request for the projection schema
  const result = await callTool('queryNeo4jGraph', { schema: true });
  // THEN it passes and carries the labels, relationship types, and ArchiMate enums
  assert.equal(result.status, 'passed');
  assert.equal(result.graphKey, 'design/KG/SystemArchitecture.json');
  assert.ok(result.schema.nodeLabels.Element);
  assert.ok(result.schema.relationshipTypes.ARCHIMATE_RELATES);
  assert.ok(Array.isArray(result.schema.archimateElementTypes));
  assert.ok(result.schema.archimateElementTypes.includes('Business Actor'));
  assert.ok(Array.isArray(result.schema.archimateRelationshipTypes));
  assert.ok(result.schema.archimateRelationshipTypes.includes('Assignment'));
});

test('queryNeo4jGraph rejects write queries without requiring a live Neo4j', async () => {
  // GIVEN a Cypher statement that mutates the graph
  const result = await callTool('queryNeo4jGraph', { cypher: 'CREATE (n:Element {id: "x"})' });
  // THEN it fails with the read-only category before touching Neo4j
  assert.equal(result.status, 'failed');
  assert.equal(result.error.category, 'READ_ONLY_CYPHER_REQUIRED');
});

test('queryNeo4jGraph rejects an empty Cypher query', async () => {
  // GIVEN a blank Cypher query
  const result = await callTool('queryNeo4jGraph', { cypher: '   ' });
  // THEN it fails with a required-query category
  assert.equal(result.status, 'failed');
  assert.equal(result.error.category, 'CYPHER_QUERY_REQUIRED');
});

test('queryNeo4jGraph is registered in the tool list', () => {
  // GIVEN the deep module tool registry
  const tool = TOOLS.find(entry => entry.name === 'queryNeo4jGraph');
  // THEN the tool is registered with cypher and schema parameters
  assert.ok(tool);
  assert.ok(tool.inputSchema.properties.cypher);
  assert.ok(tool.inputSchema.properties.schema);
});

test('archgraph-rules-document-queryNeo4jGraph', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = fs.readFileSync(
    path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md'),
    'utf8',
  );
  // THEN it documents the queryNeo4jGraph interface and its read-only contract
  assert.match(rules, /queryNeo4jGraph/);
  assert.match(rules, /GraphQueryGuideline/);
  assert.match(rules, /\$graphKey/);
  assert.match(rules, /CREATE/);
  assert.match(rules, /MERGE/);
  assert.match(rules, /DELETE/);
});
