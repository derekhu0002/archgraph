'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const systemArchitectureMcp = require('../argo/scripts/systemarchitecture-mcp-server.js');

// External-view acceptance tests for the memory_search semantic-memory tool:
// an agent should be able to discover a memory-oriented retrieval tool and call
// it with a natural-language query (returns memory hits with content + score),
// so the argo memory backend is discoverable/usable by arbitrary agents.

test('AT memory_search: is registered as an agent-facing tool with a query schema', () => {
  // GIVEN the argo MCP tool list
  const tool = (systemArchitectureMcp.TOOLS || []).find(t => t && t.name === 'memory_search');
  // THEN memory_search is exposed with a natural-language query schema
  assert.ok(tool, 'memory_search must be registered in the MCP tool list');
  assert.ok(tool.description && /memory/i.test(tool.description), 'description should signal memory retrieval');
  const props = tool.inputSchema && tool.inputSchema.properties;
  assert.ok(props && props.query, 'schema must require a query');
  assert.equal(tool.inputSchema.type, 'object');
});

test('AT memory_search: requires a query argument', async () => {
  // GIVEN a call to memory_search without a query
  const result = await systemArchitectureMcp.callTool('memory_search', {}, undefined);
  // THEN it fails with a clear MEMORY_QUERY_REQUIRED error
  assert.equal(result.status, 'failed');
  assert.equal(result.error && result.error.category, 'MEMORY_QUERY_REQUIRED');
});
