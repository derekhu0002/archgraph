'use strict';

// Acceptance tests for the canonical-graph cross-process write lock (L0 bug fix).
//
// The canonical graph is one JSON file written with a whole-file read-modify-write.
// Two MCP server processes (one per agent/session) could each read v1, mutate, and
// write v2/v2', so the later write silently dropped the earlier one (lost update).
// The lock serializes that window across processes; previews stay lock-free.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js');
const GRAPH_REL = ['design', 'KG', 'Concurrency.json'];

const {
  withGraphWriteLock,
  graphWriteLockPath,
} = require('../argo/scripts/graph-write-lock.js');
const {
  callTool,
} = require('../argo/scripts/systemarchitecture-mcp-server.js');

function fixtureDocument() {
  return {
    name: 'graph-write-lock-fixture',
    description: 'graph-write-lock-fixture',
    elements: [
      { id: 'parent', name: 'Parent', type: 'Grouping' },
      { id: 'seed', name: 'Seed', type: 'Application Component' },
    ],
    relationships: [
      {
        id: 'seed-association',
        name: 'SeedAssociation',
        type: 'Association',
        source_id: 'seed',
        target_id: 'parent',
        source_name: 'Seed',
        target_name: 'Parent',
        statement: 'Seed --(Association)--> Parent',
      },
    ],
    views: [
      {
        view_id: 'top',
        view_name: 'SystemArchitecture',
        included_elements: ['parent', 'seed'],
        included_relationships: ['seed-association'],
      },
    ],
  };
}

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-graph-lock-'));
  const graphPath = path.join(workspaceRoot, ...GRAPH_REL);
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(graphPath, JSON.stringify(fixtureDocument(), null, 2), 'utf8');
  return { workspaceRoot, graphPath, graphRel: GRAPH_REL.join('/') };
}

function readIds(graphPath) {
  return new Set(JSON.parse(fs.readFileSync(graphPath, 'utf8')).elements.map((element) => element.id));
}

// Spawn a process that acquires the canonical write lock, reports "held" on stdout,
// then keeps holding it until it exits (or `holdMs` elapses).
function holdLockInChildProcess(graphPath, holdMs) {
  const code = [
    `const { withGraphWriteLock } = require(${JSON.stringify(path.join(ROOT, 'argo', 'scripts', 'graph-write-lock.js'))});`,
    `withGraphWriteLock(${JSON.stringify(graphPath)}, async () => {`,
    `  process.stdout.write('held\\n');`,
    `  await new Promise((resolve) => setTimeout(resolve, ${holdMs}));`,
    `}).then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });`,
  ].join('\n');
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('child never acquired the lock')), 15000);
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString();
      if (buffered.includes('held')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => { buffered += chunk.toString(); });
    child.on('error', reject);
  });
}

// Spawn one real MCP server process and return a callable that issues tool calls.
function spawnMcpServer(workspaceRoot) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      ARGO_REPO_ROOT: workspaceRoot,
      ARGO_MCP_SEMANTIC_DEDUP: '0',
      // Keep the test isolated from the host's configured ontology-validation
      // extension (a live engine call with a ~5s timeout per write).
      ARGO_VALIDATION_EXTENSIONS: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  const waiters = [];
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message && message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lock-at', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  let nextId = 1;
  return {
    child,
    stderr: () => stderr,
    call(name, args) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`MCP call ${name} timed out; stderr=${stderr.slice(0, 300)}`)), 60000);
        pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
        send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
      });
    },
    stop() {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    },
    waiters,
  };
}

function payloadOf(message) {
  assert.ok(message && message.result, `no tool result: ${JSON.stringify(message).slice(0, 300)}`);
  return JSON.parse(message.result.content[0].text);
}

async function addElement(server, graphRel, id) {
  const payload = payloadOf(await server.call('addArchitectureElement', {
    architecturePath: graphRel,
    element: { id, name: id, type: 'Application Component', description: 'concurrent-add' },
    view_ids: ['top'],
  }));
  return payload;
}

// AT-graph-write-lock-01
test('AT-graph-write-lock-01: the canonical write lock serializes across processes', async () => {
  // GIVEN a graph whose write lock is held by another process
  const { workspaceRoot, graphPath } = makeWorkspace();
  try {
    const holder = await holdLockInChildProcess(graphPath, 600);
    try {
      // WHEN this process tries to acquire it
      const startedAt = Date.now();
      await withGraphWriteLock(graphPath, async () => {});
      const waitedMs = Date.now() - startedAt;
      // THEN it waits for the holder to release (no concurrent entry)
      assert.ok(waitedMs >= 250, `expected to wait for the cross-process holder, waited ${waitedMs}ms`);
      assert.equal(fs.existsSync(graphWriteLockPath(graphPath)), false, 'lock file must be released');
    } finally {
      holder.kill('SIGKILL');
    }
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

// AT-graph-write-lock-02
test('AT-graph-write-lock-02: an apply waits on the lock while preview and dryRun stay lock-free', async () => {
  const { workspaceRoot, graphPath, graphRel } = makeWorkspace();
  try {
    const holder = await holdLockInChildProcess(graphPath, 900);
    try {
      // GIVEN a lock held elsewhere, WHEN preview runs
      const previewStarted = Date.now();
      const preview = await callTool('previewSystemArchitectureMutation', {
        workspaceRoot,
        architecturePath: graphRel,
        mutations: [{ type: 'addElement', element: { id: 'preview-only', name: 'preview-only', type: 'Application Component' }, view_ids: ['top'] }],
      });
      const previewMs = Date.now() - previewStarted;
      assert.equal(preview.status, 'passed');
      assert.ok(previewMs < 600, `preview must not wait for the write lock, took ${previewMs}ms`);

      // AND a dryRun single-object write does not wait either
      const dryRunStarted = Date.now();
      const dryRun = await callTool('addArchitectureElement', {
        workspaceRoot,
        architecturePath: graphRel,
        dryRun: true,
        element: { id: 'dry-run-only', name: 'dry-run-only', type: 'Application Component' },
        view_ids: ['top'],
      });
      const dryRunMs = Date.now() - dryRunStarted;
      assert.equal(dryRun.status, 'passed');
      assert.ok(dryRunMs < 600, `dryRun must not wait for the write lock, took ${dryRunMs}ms`);

      // AND an apply waits for the holder, then writes
      const applyStarted = Date.now();
      const applied = await callTool('applySystemArchitectureMutation', {
        workspaceRoot,
        architecturePath: graphRel,
        mutations: [{ type: 'addElement', element: { id: 'apply-after-lock', name: 'apply-after-lock', type: 'Application Component' }, view_ids: ['top'] }],
      });
      const applyMs = Date.now() - applyStarted;
      assert.equal(applied.status, 'passed');
      assert.equal(applied.written, true);
      assert.ok(applyMs >= 300, `apply must wait for the cross-process holder, took ${applyMs}ms`);
      assert.ok(readIds(graphPath).has('apply-after-lock'), 'the apply must land after the lock is acquired');
    } finally {
      holder.kill('SIGKILL');
    }
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

// AT-graph-write-lock-03
test('AT-graph-write-lock-03: two concurrent agent processes never lose each other\'s writes', async () => {
  // GIVEN two independent MCP server processes on the SAME workspace/graph
  const { workspaceRoot, graphPath, graphRel } = makeWorkspace();
  const a = spawnMcpServer(workspaceRoot);
  const b = spawnMcpServer(workspaceRoot);
  const idsA = Array.from({ length: 6 }, (_, index) => `agent-a-${index}`);
  const idsB = Array.from({ length: 6 }, (_, index) => `agent-b-${index}`);
  try {
    // WHEN both start writing at the same moment (their reads would race without a lock)
    const [resultsA, resultsB] = await Promise.all([
      (async () => { const out = []; for (const id of idsA) out.push(await addElement(a, graphRel, id)); return out; })(),
      (async () => { const out = []; for (const id of idsB) out.push(await addElement(b, graphRel, id)); return out; })(),
    ]);
    // THEN every write reports success ...
    for (const payload of [...resultsA, ...resultsB]) {
      assert.equal(payload.status, 'passed', `concurrent write failed: ${JSON.stringify(payload.errors || payload).slice(0, 300)}`);
      assert.equal(payload.written, true);
    }
    // ... and ALL of them survive in the canonical document (no lost update)
    const ids = readIds(graphPath);
    const missing = [...idsA, ...idsB].filter((id) => !ids.has(id));
    assert.deepEqual(missing, [], `lost updates: ${missing.join(', ')}`);
  } finally {
    a.stop();
    b.stop();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

// AT-graph-write-lock-04
test('AT-graph-write-lock-04: every mutating MCP tool routes through the lock helper', () => {
  // GIVEN the MCP dispatcher source
  const source = fs.readFileSync(path.join(ROOT, 'argo', 'scripts', 'systemarchitecture-mcp-server.js'), 'utf8');
  const writeTools = [
    'applySystemArchitectureMutation',
    'addArchitectureElement',
    'updateArchitectureElement',
    'removeArchitectureElement',
    'addArchitectureRelationship',
    'updateArchitectureRelationship',
    'removeArchitectureRelationship',
    'addArchitectureView',
    'updateArchitectureView',
    'removeArchitectureView',
  ];
  // WHEN the handler block of each write tool is inspected
  // THEN each one goes through runMutationCall (read + lock + write), so no write
  //      path can bypass the serialization ...
  for (const tool of writeTools) {
    const marker = `if (name === '${tool}')`;
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${tool} handler must exist`);
    const next = source.indexOf("if (name === '", start + marker.length);
    const block = source.slice(start, next < 0 ? source.length : next);
    assert.match(block, /runMutationCall\(/, `${tool} must route through runMutationCall (canonical write lock)`);
  }
  // ... and the read-only preview does not.
  const previewStart = source.indexOf("if (name === 'previewSystemArchitectureMutation')");
  assert.ok(previewStart >= 0);
  const previewEnd = source.indexOf("if (name === '", previewStart + 10);
  const previewBlock = source.slice(previewStart, previewEnd < 0 ? source.length : previewEnd);
  assert.doesNotMatch(previewBlock, /runMutationCall\(/, 'preview must stay lock-free');
});

// AT-graph-write-lock-05
test('AT-graph-write-lock-05: the lock file is <graph>.lock and a stale holder is stolen', async () => {
  // GIVEN the shared lock convention (the EA web service locks <graph>.lock too)
  const { workspaceRoot, graphPath } = makeWorkspace();
  try {
    // THEN the lock path is exactly <canonical graph>.lock, so both writers interoperate
    assert.equal(graphWriteLockPath(graphPath), `${graphPath}.lock`);

    // AND a lock left behind by a crashed holder is stolen instead of blocking forever
    fs.writeFileSync(graphWriteLockPath(graphPath), 'stale-holder', 'utf8');
    const staleAt = Date.now() - 60 * 60 * 1000;
    fs.utimesSync(graphWriteLockPath(graphPath), new Date(staleAt), new Date(staleAt));
    const result = await withGraphWriteLock(graphPath, async () => 'stolen', { waitMs: 3000, staleMs: 60 * 1000 });
    assert.equal(result, 'stolen', 'a stale lock must be stolen');
    assert.equal(fs.existsSync(graphWriteLockPath(graphPath)), false, 'the lock must be released after the action');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
