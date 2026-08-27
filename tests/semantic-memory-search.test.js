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
  assert.ok(props && props.max_desc_len, 'schema must expose max_desc_len to bound the excerpt size');
  assert.equal(tool.inputSchema.type, 'object');
});

test('AT memory_search: returns compact excerpt cards with max_desc_len default 800', () => {
  // GIVEN the memory card builder and a long memory description
  const { memoryHitCard } = systemArchitectureMcp;
  const longDescription = 'x'.repeat(5000);
  const card = memoryHitCard({ id: 'mem-1', name: 'M', type: 'Business Object', semanticScore: 0.9, description: longDescription }, 800);
  // THEN the card carries the full length, a bounded excerpt, and a truncated flag
  assert.equal(card.description_length, 5000);
  assert.equal(card.truncated, true);
  assert.equal(card.score, 0.9);
  // AND the excerpt uses distributed sampling: head + middle + tail markers
  assert.match(card.description, /…\[5000 chars total\]…/);
  assert.ok(card.description.indexOf(longDescription.slice(0, 20)) >= 0, 'head region present');
  assert.ok(card.description.indexOf(longDescription.slice(-20)) >= 0, 'tail region present');
  // AND max_desc_len=0 returns the full description without truncation
  const full = memoryHitCard({ id: 'mem-2', name: 'M', type: 'Business Object', semanticScore: 0.9, description: longDescription }, 0);
  assert.equal(full.description.length, 5000);
  assert.equal(full.truncated, undefined);
  // AND max_desc_len=-1 omits the description body but keeps the length
  const lenOnly = memoryHitCard({ id: 'mem-3', name: 'M', type: 'Business Object', semanticScore: 0.9, description: longDescription }, -1);
  assert.equal(lenOnly.description_length, 5000);
  assert.equal(lenOnly.description, undefined);
  // AND a short description is not truncated and not marked
  const short = memoryHitCard({ id: 'mem-4', name: 'M', type: 'Business Object', semanticScore: 0.9, description: 'short memory' }, 800);
  assert.equal(short.description, 'short memory');
  assert.equal(short.truncated, undefined);
});

test('AT memory_search: requires a query argument', async () => {
  // GIVEN a call to memory_search without a query
  const result = await systemArchitectureMcp.callTool('memory_search', {}, undefined);
  // THEN it fails with a clear MEMORY_QUERY_REQUIRED error
  assert.equal(result.status, 'failed');
  assert.equal(result.error && result.error.category, 'MEMORY_QUERY_REQUIRED');
});
