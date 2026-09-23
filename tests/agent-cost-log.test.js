'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const log = require('../argo/scripts/graph-rag/agentCostLog.js');
const profiler = require('../argo/scripts/graph-rag/agentCostProfiler.js');

function tmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'argo-cost-log-'));
}

function logFileFor(root) {
  return path.join(root, '.argo', 'temp', 'agent-cost-log.ndjson');
}

// External-view acceptance tests for the consolidated agent-cost log: every
// source writes ONE file at a fixed path (so the user fetches one thing), the
// host collector captures all tool calls on both backends, the MCP fallback
// never double-counts, and nothing changes retrieval.

test('AT-agent-cost-log-01: one fixed path; tools classify across both backends', () => {
  const ws = tmpWorkspace();
  try {
    assert.equal(log.logFilePath(ws), logFileFor(ws), 'the single consolidated log path must be fixed');
    assert.deepEqual(log.classifyTool('getSystemArchitecture'), { backend: 'graph', kind: 'read' });
    assert.deepEqual(log.classifyTool('mcp__argo__memory_search'), { backend: 'graph', kind: 'read' });
    assert.deepEqual(log.classifyTool('applySystemArchitectureMutation'), { backend: 'graph', kind: 'write' });
    assert.deepEqual(log.classifyTool('validateSystemArchitecture'), { backend: 'framework', kind: 'framework' });
    assert.deepEqual(log.classifyTool('read'), { backend: 'repo', kind: 'read' });
    assert.deepEqual(log.classifyTool('grep'), { backend: 'repo', kind: 'read' });
    assert.deepEqual(log.classifyTool('mystery'), { backend: 'other', kind: 'other' });
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('AT-agent-cost-log-02: appendRecord writes the single file, honors disable, rotates', () => {
  const ws = tmpWorkspace();
  const prevFlag = process.env.ARGO_COST_PROFILER;
  const prevMax = process.env.ARGO_COST_TRACE_MAX_BYTES;
  try {
    delete process.env.ARGO_COST_PROFILER;
    log.appendRecord(ws, { source: 'host', type: 'tool', tool: 'grep', backend: 'repo', kind: 'read' });
    const file = logFileFor(ws);
    const rec = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    assert.equal(rec.source, 'host');
    assert.equal(rec.backend, 'repo');
    assert.ok(rec.at);

    const before = fs.readFileSync(file, 'utf8');
    process.env.ARGO_COST_PROFILER = '0';
    log.appendRecord(ws, { source: 'host', type: 'tool', tool: 'read' });
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'disabled log must not write');

    delete process.env.ARGO_COST_PROFILER;
    process.env.ARGO_COST_TRACE_MAX_BYTES = '10';
    log.appendRecord(ws, { source: 'host', type: 'tool', tool: 'read' });
    assert.ok(fs.existsSync(`${file}.1`), 'a full log must rotate to .1');
  } finally {
    if (prevFlag === undefined) delete process.env.ARGO_COST_PROFILER; else process.env.ARGO_COST_PROFILER = prevFlag;
    if (prevMax === undefined) delete process.env.ARGO_COST_TRACE_MAX_BYTES; else process.env.ARGO_COST_TRACE_MAX_BYTES = prevMax;
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('AT-agent-cost-log-03: host collector records every tool call (both backends) + token usage', () => {
  const ws = tmpWorkspace();
  try {
    log.markHostCollector(ws);
    assert.equal(log.hostCollectorActive(ws), true, 'marking activates the host collector');
    const hooks = log.createHostCollectorHooks(ws);
    // a graph call and a repo call, in order
    hooks.before({ callID: 'c1', sessionID: 's', tool: 'argo_getSystemArchitecture', args: { query: { intent: 'x' } } });
    hooks.after({ callID: 'c1', sessionID: 's', tool: 'argo_getSystemArchitecture' }, { output: 'found overseer-vision-001' });
    hooks.before({ callID: 'c2', sessionID: 's', tool: 'grep', args: { pattern: 'foo' } });
    hooks.after({ callID: 'c2', sessionID: 's', tool: 'grep' }, { output: 'a'.repeat(80) });
    // assistant usage event
    hooks.event({ event: { properties: { info: { id: 'm1', role: 'assistant', sessionID: 's', tokens: { input: 100, output: 20, reasoning: 5 }, cost: 0.02 } } } });

    const { records } = log.readLog(ws);
    const tools = records.filter(r => r.type === 'tool');
    assert.equal(tools.length, 2);
    assert.deepEqual(tools.map(r => r.backend), ['graph', 'repo'], 'both backends land in the ONE log');
    assert.equal(tools[1].kind, 'read');
    assert.ok(tools[1].resultTokens > 0);
    assert.ok(typeof tools[0].durationMs === 'number');
    const usage = records.filter(r => r.type === 'usage');
    assert.equal(usage.length, 1);
    assert.equal(usage[0].tokens.input, 100);
    assert.equal(usage[0].cost, 0.02);

    hooks.dispose();
    assert.equal(log.hostCollectorActive(ws), false, 'dispose clears the marker');
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('AT-agent-cost-log-04: MCP fallback records only when no host collector, and never logs raw args', () => {
  const ws = tmpWorkspace();
  try {
    // no host marker -> MCP fallback writes source:"mcp"
    profiler.traceToolCall(ws, {
      tool: 'getSystemArchitecture', args: { query: { intent: '项目愿景' }, apiKey: 'super-secret' },
      result: { content: [{ type: 'text', text: 'found overseer-vision-001' }] }, durationMs: 12,
    });
    let recs = log.readLog(ws).records;
    assert.equal(recs.length, 1);
    assert.equal(recs[0].source, 'mcp');
    assert.equal(recs[0].args.intentPreview, '项目愿景');
    assert.ok(!JSON.stringify(recs[0]).includes('super-secret'), 'raw argument values must never be logged');

    // host collector active -> MCP fallback stays silent (no double-counting)
    log.markHostCollector(ws);
    profiler.traceToolCall(ws, { tool: 'read', args: {}, result: null, durationMs: 1 });
    assert.equal(log.readLog(ws).records.length, 1, 'MCP fallback must not write while a host collector owns the log');
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('AT-agent-cost-log-05: server wires the recorder; the plugin ships+registers; no log-retrieval interface', () => {
  const server = fs.readFileSync(path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js'), 'utf8');
  assert.match(server, /agentCostProfiler\.js/, 'server must require the recorder');
  assert.match(server, /traceToolCall\(/, 'server must trace tool calls');
  assert.doesNotMatch(server, /getAgentCostDigest/, 'no log-retrieval MCP tool may be added');

  // the plugin ships with the framework and wires the shared host hooks
  const pluginPath = path.join(ROOT, 'argo', 'plugins', 'argo-cost-collector.js');
  assert.ok(fs.existsSync(pluginPath), 'the host collector plugin must exist');
  const plugin = fs.readFileSync(pluginPath, 'utf8');
  assert.match(plugin, /createHostCollectorHooks/, 'plugin must use the shared host hooks');
  assert.match(plugin, /markHostCollector/, 'plugin must mark host-collector activity');
  assert.match(plugin, /tool\.execute\.after/, 'plugin must record tool calls');
  assert.match(plugin, /\bevent\b/, 'plugin must record usage events');

  // and the installer registers it (so a deploy activates the complete collector)
  const installer = fs.readFileSync(path.join(ROOT, 'install-argo.ps1'), 'utf8');
  assert.match(installer, /argo-cost-collector\.js/, 'installer must register the collector plugin');
});
