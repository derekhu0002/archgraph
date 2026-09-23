'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const profiler = require('../argo/scripts/graph-rag/agentCostProfiler.js');

function tmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'argo-cost-profiler-'));
}

function traceFileFor(root) {
  return path.join(root, '.argo', 'temp', 'argo-cost-trace.ndjson');
}

// External-view acceptance tests for the FRAMEWORK agent-cost profiler: it must
// run as a zero-config background observer (collect without changing retrieval),
// aggregate into a digest, fold in a host session for cross-backend metrics, and
// score evidence recall so a recall-shrinking optimisation can never be hidden.

test('AT-agent-cost-profiler-01: classifies tools by backend and read/write kind', () => {
  assert.deepEqual(profiler.classifyTool('getSystemArchitecture'), { backend: 'graph', kind: 'read' });
  assert.deepEqual(profiler.classifyTool('mcp__argo__getIntentElementContext'), { backend: 'graph', kind: 'read' });
  assert.deepEqual(profiler.classifyTool('memory_search'), { backend: 'graph', kind: 'read' });
  assert.deepEqual(profiler.classifyTool('applySystemArchitectureMutation'), { backend: 'graph', kind: 'write' });
  assert.deepEqual(profiler.classifyTool('validateSystemArchitecture'), { backend: 'framework', kind: 'framework' });
  assert.deepEqual(profiler.classifyTool('read'), { backend: 'repo', kind: 'read' });
  assert.deepEqual(profiler.classifyTool('grep'), { backend: 'repo', kind: 'read' });
  assert.deepEqual(profiler.classifyTool('mystery'), { backend: 'other', kind: 'other' });
});

test('AT-agent-cost-profiler-02: traceToolCall appends NDJSON, honors disable, and rotates', () => {
  const ws = tmpWorkspace();
  const prevFlag = process.env.ARGO_COST_PROFILER;
  const prevMax = process.env.ARGO_COST_TRACE_MAX_BYTES;
  try {
    // GIVEN profiling enabled and a completed graph read call
    delete process.env.ARGO_COST_PROFILER;
    profiler.traceToolCall(ws, {
      tool: 'getSystemArchitecture', args: { query: { intent: '项目愿景' } },
      result: { content: [{ type: 'text', text: 'found overseer-vision-001' }] }, durationMs: 42,
    });
    const file = traceFileFor(ws);
    assert.ok(fs.existsSync(file), 'trace file must be written');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    assert.equal(rec.tool, 'getSystemArchitecture');
    assert.equal(rec.backend, 'graph');
    assert.equal(rec.kind, 'read');
    assert.equal(rec.durationMs, 42);
    assert.equal(rec.ok, true);
    assert.ok(rec.resultTokens > 0);
    assert.equal(rec.args.intentPreview, '项目愿景', 'semantic intent preview aids analysis');
    assert.ok(!JSON.stringify(rec).includes('"raw"'), 'no raw argument values are logged');

    // WHEN disabled, nothing more is appended
    const before = fs.readFileSync(file, 'utf8');
    process.env.ARGO_COST_PROFILER = '0';
    profiler.traceToolCall(ws, { tool: 'read', args: {}, result: null, durationMs: 1 });
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'disabled profiler must not write');

    // AND rotation keeps the trace bounded (previous file preserved as .1)
    delete process.env.ARGO_COST_PROFILER;
    process.env.ARGO_COST_TRACE_MAX_BYTES = '50';
    profiler.traceToolCall(ws, { tool: 'read', args: {}, result: { content: [{ type: 'text', text: 'x'.repeat(200) }] }, durationMs: 1 });
    assert.ok(fs.existsSync(`${file}.1`), 'a full trace must rotate to .1');
  } finally {
    if (prevFlag === undefined) delete process.env.ARGO_COST_PROFILER; else process.env.ARGO_COST_PROFILER = prevFlag;
    if (prevMax === undefined) delete process.env.ARGO_COST_TRACE_MAX_BYTES; else process.env.ARGO_COST_TRACE_MAX_BYTES = prevMax;
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('AT-agent-cost-profiler-03: summarize aggregates by tool/backend/kind with latency percentiles and tokens', () => {
  const ws = tmpWorkspace();
  try {
    profiler.traceToolCall(ws, { tool: 'getSystemArchitecture', args: {}, result: { content: [{ type: 'text', text: 'a'.repeat(400) }] }, durationMs: 100 });
    profiler.traceToolCall(ws, { tool: 'getSystemArchitecture', args: {}, result: { content: [{ type: 'text', text: 'b'.repeat(400) }] }, durationMs: 300 });
    profiler.traceToolCall(ws, { tool: 'read', args: {}, result: { content: [{ type: 'text', text: 'c' }] }, durationMs: 10 });
    profiler.traceToolCall(ws, { tool: 'applySystemArchitectureMutation', args: {}, result: null, error: new Error('Boom'), durationMs: 5 });
    const s = profiler.summarize(ws);
    assert.equal(s.calls.total, 4);
    assert.equal(s.calls.errors, 1);
    assert.equal(s.byTool.getSystemArchitecture.calls, 2);
    assert.equal(s.byTool.getSystemArchitecture.maxMs, 300);
    assert.equal(s.byBackend.graph.calls, 3);
    assert.equal(s.byBackend.repo.calls, 1);
    assert.equal(s.byKind.write.calls, 1);
    assert.ok(s.tokens.total > 0);
    // most expensive tool by returned tokens is the graph read
    assert.equal(s.topToolsByTokens[0].tool, 'getSystemArchitecture');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

function ndjson(events) { return events.map(e => JSON.stringify(e)).join('\n') + '\n'; }

test('AT-agent-cost-profiler-04: parseHostSession yields turns, backend mix, round-trips, tokens', () => {
  const text = ndjson([
    { type: 'step_start', time: { start: 1000, end: 1000 } },
    { part: { type: 'tool', tool: 'argo_getSystemArchitecture', state: { output: 'x' } } },
    { part: { type: 'tool', tool: 'read', state: { output: 'y' } } },
    { part: { type: 'tool', tool: 'grep', state: { output: 'z' } } },
    { type: 'step_finish', part: { finish: { cost: 0.03, tokens: { input: 100, output: 20, reasoning: 5 } } }, time: { start: 1000, end: 6000 } },
  ]);
  const host = profiler.parseHostSession(text);
  assert.equal(host.turns, 1);
  assert.equal(host.toolCalls, 3);
  assert.deepEqual(host.byBackend, { graph: 1, repo: 2, other: 0 });
  assert.equal(host.roundTrips, 1, 'graph→repo is one round-trip');
  assert.equal(host.tokens, 125);
  assert.equal(host.cost, 0.03);
  assert.equal(host.latencyMs, 5000);
});

test('AT-agent-cost-profiler-05: scoreEvidence reports recall/precision and surfaces missing evidence', () => {
  const oracle = { elements: ['overseer-vision-001'], repoPaths: ['docs/actor-memory-tiers.md'] };
  const full = profiler.scoreEvidence(oracle, 'saw overseer-vision-001 and docs/actor-memory-tiers.md', null);
  assert.equal(full.evidenceRecall, 1);
  assert.deepEqual(full.missing, []);
  const shrunk = profiler.scoreEvidence(oracle, 'only saw overseer-vision-001', null);
  assert.equal(shrunk.evidenceRecall, 0.5);
  assert.deepEqual(shrunk.missing, ['docs/actor-memory-tiers.md']);
  // a universe with decoys lowers precision but must not change recall
  const noisy = profiler.scoreEvidence(oracle, 'overseer-vision-001 docs/actor-memory-tiers.md decoy-1', { ids: ['overseer-vision-001', 'decoy-1'], paths: ['docs/actor-memory-tiers.md'] });
  assert.equal(noisy.evidenceRecall, 1);
  assert.equal(noisy.evidencePrecision, 0.667);
});

test('AT-agent-cost-profiler-06: mergeHostSession combines session metrics with the graph trace', () => {
  const ws = tmpWorkspace();
  try {
    profiler.traceToolCall(ws, { tool: 'getSystemArchitecture', args: {}, result: { content: [{ type: 'text', text: 'ok' }] }, durationMs: 7 });
    const summary = profiler.summarize(ws);
    const host = profiler.parseHostSession(ndjson([
      { part: { type: 'tool', tool: 'getSystemArchitecture', state: { output: 'ok' } } },
      { part: { type: 'tool', tool: 'grep', state: { output: 'ok' } } },
    ]));
    const merged = profiler.mergeHostSession(host, summary);
    assert.equal(merged.graph.callsFromHost, 1);
    assert.equal(merged.graph.callsFromTrace, 1);
    assert.equal(merged.repo.callsFromHost, 1);
    assert.equal(merged.roundTrips, 1);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('AT-agent-cost-profiler-07: the ARGO MCP server wires the profiler and exposes the digest tool', () => {
  // GIVEN the framework MCP server dispatch
  const src = fs.readFileSync(path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js'), 'utf8');
  // THEN every tool call is traced via the profiler (background, best-effort)…
  assert.match(src, /agentCostProfiler\.js/, 'server must require the profiler');
  assert.match(src, /traceToolCall\(/, 'server must trace tool calls');
  // …and a digest tool is exposed for on-demand reporting.
  assert.match(src, /name:\s*'getAgentCostDigest'/, 'digest tool must be declared');
  assert.match(src, /PROFILER_TOOL_NAMES/, 'digest tool must be dispatched');
  // AND the profiler ships with the framework (deployed under argo/scripts).
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('argo/scripts'), 'npm package must ship argo/scripts (incl. the profiler)');
});
