'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const systemArchitectureMcp = require('../argo/scripts/systemarchitecture-mcp-server.js');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// External-view acceptance tests for the memory_search semantic-memory tool:
// an agent should be able to discover a memory-oriented retrieval tool and call
// it with a natural-language query (returns memory hits with content + score),
// so the argo memory backend is discoverable/usable by arbitrary agents.

// Minimal stdio MCP client for one spawned argo server process: answers the
// server's roots/list request with an EMPTY root list on purpose (the launch
// directory must stay the only fallback the server could accidentally use).
function startArgoServer(serverPath, cwd, env) {
  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  const pending = new Map();
  let nextId = 1;
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      const message = JSON.parse(line);
      if (message.method === 'roots/list') {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { roots: [] } })}\n`);
      }
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    close() {
      child.kill();
    },
  };
}

function toolPayload(response) {
  return JSON.parse(response.result.content[0].text);
}

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
  assert.equal(card.description.length, 800);
  assert.equal(card.truncated, true);
  assert.equal(card.score, 0.9);
  // AND max_desc_len=0 returns the full description without truncation
  const full = memoryHitCard({ id: 'mem-2', name: 'M', type: 'Business Object', semanticScore: 0.9, description: longDescription }, 0);
  assert.equal(full.description.length, 5000);
  assert.equal(full.truncated, undefined);
  // AND max_desc_len=-1 omits the description body but keeps the length
  const lenOnly = memoryHitCard({ id: 'mem-3', name: 'M', type: 'Business Object', semanticScore: 0.9, description: longDescription }, -1);
  assert.equal(lenOnly.description_length, 5000);
  assert.equal(lenOnly.description, undefined);
});

test('AT memory_search: requires a query argument', async () => {
  // GIVEN a call to memory_search without a query
  const result = await systemArchitectureMcp.callTool('memory_search', {}, undefined);
  // THEN it fails with a clear MEMORY_QUERY_REQUIRED error
  assert.equal(result.status, 'failed');
  assert.equal(result.error && result.error.category, 'MEMORY_QUERY_REQUIRED');
});

test('AT memory_search: returns an MCP-compliant result (content array) so agents can render it', async () => {
  // GIVEN a memory_search call (no query -> deterministic error path, no live backend)
  const result = await systemArchitectureMcp.callTool('memory_search', {}, undefined);
  // THEN the result carries the MCP content array (like every other argo tool)…
  assert.ok(Array.isArray(result.content), 'result.content must be an array (MCP contract)');
  assert.ok(result.content[0] && result.content[0].type === 'text', 'content[0] must be a text block');
  // …whose text is the JSON payload with the status still readable at the top level
  const text = result.content[0].text;
  const payload = JSON.parse(text);
  assert.equal(payload.status, 'failed');
  assert.equal(payload.error.category, 'MEMORY_QUERY_REQUIRED');
  assert.equal(result.status, 'failed', 'payload fields stay accessible at top level');
  assert.equal(result.isError, true);
});

test('AT memory_search: reads the canonical graph from the per-call workspaceRoot, never from the launch directory', async () => {
  // GIVEN an argo MCP server in a repository-external global installation (no
  // sibling design/KG, no ARGO_REPO_ROOT) launched from a foreign working
  // directory whose own canonical graph is corrupt
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-memory-root-'));
  const child = { close() {} };
  try {
    const installRoot = path.join(tempRoot, '.argo');
    fs.mkdirSync(installRoot, { recursive: true });
    fs.cpSync(
      path.join(WORKSPACE_ROOT, 'argo', 'scripts'),
      path.join(installRoot, 'scripts'),
      { recursive: true },
    );
    fs.cpSync(
      path.join(WORKSPACE_ROOT, 'argo', 'schema'),
      path.join(installRoot, 'schema'),
      { recursive: true },
    );
    const serverPath = path.join(installRoot, 'scripts', 'argo-mcp-server.js');

    const launchDir = path.join(tempRoot, 'launch-dir');
    fs.mkdirSync(path.join(launchDir, 'design', 'KG'), { recursive: true });
    fs.writeFileSync(
      path.join(launchDir, 'design', 'KG', 'SystemArchitecture.json'),
      '{ "elements": [ { "id": "corrupt", ',
    );

    // AND a requested workspace that holds a real canonical graph
    const requestedWorkspace = path.join(tempRoot, 'requested-workspace');
    fs.mkdirSync(path.join(requestedWorkspace, 'design', 'KG'), { recursive: true });
    fs.copyFileSync(
      path.join(WORKSPACE_ROOT, 'design', 'KG', 'SystemArchitecture.json'),
      path.join(requestedWorkspace, 'design', 'KG', 'SystemArchitecture.json'),
    );

    const env = { ...process.env };
    delete env.ARGO_REPO_ROOT;
    delete env.WORKSPACE_FOLDER;

    const client = startArgoServer(serverPath, launchDir, env);
    child.close = () => client.close();
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'semantic-memory-search-root-test', version: '1' },
    });
    client.notify('notifications/initialized', {});

    // WHEN memory_search and getSystemArchitecture are called with that per-call workspaceRoot
    const memorySearch = toolPayload(await client.request('tools/call', {
      name: 'memory_search',
      arguments: {
        query: 'Superset 与 Doris 的数据来源与数据流',
        top_k: 3,
        workspaceRoot: requestedWorkspace,
      },
    }));
    const systemArchitecture = toolPayload(await client.request('tools/call', {
      name: 'getSystemArchitecture',
      arguments: {
        query: { purpose: 'general', intent: 'Superset 与 Doris 的数据来源与数据流' },
        workspaceRoot: requestedWorkspace,
      },
    }));

    // THEN neither tool falls back to the launch directory's canonical graph:
    // the requested workspaceRoot alone governs the canonical read, so no
    // path/corruption of the launch-directory graph may leak into the result
    const memoryMessage = (memorySearch.error && memorySearch.error.message) || '';
    assert.ok(
      !/design[\\/]KG[\\/]SystemArchitecture\.json/.test(memoryMessage),
      `memory_search must not read a canonical graph outside the requested workspaceRoot: ${memoryMessage}`,
    );
    assert.ok(
      !memoryMessage.includes(launchDir),
      `memory_search must not reference the launch directory: ${memoryMessage}`,
    );

    // AND the retrieval really ran against the requested workspace's graph
    // (it reached the semantic backend instead of failing on a graph read)
    if (memorySearch.status !== 'passed') {
      assert.ok(
        /Cannot find module|neo4j|semantic/i.test(memoryMessage),
        `memory_search should reach the semantic backend for the requested workspace, got: ${memoryMessage}`,
      );
    }

    // AND the two semantic tools agree on which workspace they read
    const architectureMessage = (systemArchitecture.error && systemArchitecture.error.message) || '';
    assert.ok(
      !architectureMessage.includes(launchDir)
        && !/design[\\/]KG[\\/]SystemArchitecture\.json/.test(architectureMessage),
      `getSystemArchitecture must resolve the same per-call workspaceRoot: ${architectureMessage}`,
    );
  } finally {
    child.close();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup: a just-killed child may still hold the cwd handle
    }
  }
});
