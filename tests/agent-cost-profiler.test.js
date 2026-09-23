'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const recorder = require('../argo/scripts/graph-rag/agentCostProfiler.js');

function tmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'argo-cost-profiler-'));
}

function traceFileFor(root) {
  return path.join(root, '.argo', 'temp', 'argo-cost-trace.ndjson');
}

// External-view acceptance tests for the FRAMEWORK agent-cost recorder: it runs
// as a zero-config background observer that RECORDS to a fixed, known path (the
// user fetches the file directly). By design it exposes NO MCP tool and NO CLI —
// the tests assert that contract, and that recording never changes retrieval.

test('AT-agent-cost-profiler-01: classifies tools by backend and read/write kind', () => {
  assert.deepEqual(recorder.classifyTool('getSystemArchitecture'), { backend: 'graph', kind: 'read' });
  assert.deepEqual(recorder.classifyTool('mcp__argo__getIntentElementContext'), { backend: 'graph', kind: 'read' });
  assert.deepEqual(recorder.classifyTool('memory_search'), { backend: 'graph', kind: 'read' });
  assert.deepEqual(recorder.classifyTool('applySystemArchitectureMutation'), { backend: 'graph', kind: 'write' });
  assert.deepEqual(recorder.classifyTool('validateSystemArchitecture'), { backend: 'framework', kind: 'framework' });
  assert.deepEqual(recorder.classifyTool('read'), { backend: 'other', kind: 'other' });
  assert.deepEqual(recorder.classifyTool('mystery'), { backend: 'other', kind: 'other' });
});

test('AT-agent-cost-profiler-02: records to the fixed path, honors disable, rotates, never logs raw args', () => {
  const ws = tmpWorkspace();
  const prevFlag = process.env.ARGO_COST_PROFILER;
  const prevMax = process.env.ARGO_COST_TRACE_MAX_BYTES;
  try {
    // GIVEN profiling enabled and a completed graph read call
    delete process.env.ARGO_COST_PROFILER;
    recorder.traceToolCall(ws, {
      tool: 'getSystemArchitecture', args: { query: { intent: '项目愿景' }, apiKey: 'super-secret' },
      result: { content: [{ type: 'text', text: 'found overseer-vision-001' }] }, durationMs: 42,
    });
    // THEN the record lands at the KNOWN, fixed path
    const file = traceFileFor(ws);
    assert.equal(recorder.traceFilePath(ws), file, 'trace path must be the documented fixed path');
    assert.ok(fs.existsSync(file), 'trace file must be written');
    const raw = fs.readFileSync(file, 'utf8');
    const rec = JSON.parse(raw.trim());
    assert.equal(rec.tool, 'getSystemArchitecture');
    assert.equal(rec.backend, 'graph');
    assert.equal(rec.kind, 'read');
    assert.equal(rec.durationMs, 42);
    assert.equal(rec.ok, true);
    assert.ok(rec.resultTokens > 0);
    assert.equal(rec.args.intentPreview, '项目愿景', 'semantic intent preview aids analysis');
    assert.ok(!raw.includes('super-secret'), 'raw argument values (e.g. secrets) must never be logged');

    // WHEN disabled, nothing more is appended
    const before = raw;
    process.env.ARGO_COST_PROFILER = '0';
    recorder.traceToolCall(ws, { tool: 'read', args: {}, result: null, durationMs: 1 });
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'disabled recorder must not write');

    // AND rotation keeps the trace bounded (previous file preserved as .1)
    delete process.env.ARGO_COST_PROFILER;
    process.env.ARGO_COST_TRACE_MAX_BYTES = '50';
    recorder.traceToolCall(ws, { tool: 'read', args: {}, result: { content: [{ type: 'text', text: 'x'.repeat(200) }] }, durationMs: 1 });
    assert.ok(fs.existsSync(`${file}.1`), 'a full trace must rotate to .1');
  } finally {
    if (prevFlag === undefined) delete process.env.ARGO_COST_PROFILER; else process.env.ARGO_COST_PROFILER = prevFlag;
    if (prevMax === undefined) delete process.env.ARGO_COST_TRACE_MAX_BYTES; else process.env.ARGO_COST_TRACE_MAX_BYTES = prevMax;
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('AT-agent-cost-profiler-03: readTrace returns the recorded calls with backend/kind/tokens', () => {
  const ws = tmpWorkspace();
  try {
    recorder.traceToolCall(ws, { tool: 'getSystemArchitecture', args: {}, result: { content: [{ type: 'text', text: 'a'.repeat(400) }] }, durationMs: 100 });
    recorder.traceToolCall(ws, { tool: 'applySystemArchitectureMutation', args: {}, result: null, error: new Error('Boom'), durationMs: 5 });
    const { records } = recorder.readTrace(ws);
    assert.equal(records.length, 2);
    assert.equal(records[0].backend, 'graph');
    assert.equal(records[0].kind, 'read');
    assert.ok(records[0].resultTokens > 0);
    assert.equal(records[1].kind, 'write');
    assert.equal(records[1].ok, false);
    assert.equal(records[1].errorKind, 'Error');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('AT-agent-cost-profiler-04: MCP server records every call but adds NO log-retrieval interface', () => {
  // GIVEN the framework MCP server dispatch
  const src = fs.readFileSync(path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js'), 'utf8');
  // THEN every tool call is traced (background, best-effort)…
  assert.match(src, /agentCostProfiler\.js/, 'server must require the recorder');
  assert.match(src, /traceToolCall\(/, 'server must trace tool calls');
  // …and NO MCP tool / CLI is added to fetch the trace (the user reads the file).
  assert.doesNotMatch(src, /getAgentCostDigest/, 'no log-retrieval MCP tool may be added');
  // the recorder module itself is record-only (no summarise/analysis/CLI surface).
  for (const absent of ['summarize', 'parseHostSession', 'scoreEvidence', 'mergeHostSession', 'main']) {
    assert.equal(typeof recorder[absent], 'undefined', `recorder must not expose ${absent}`);
  }
  // AND it ships with the framework (deployed under argo/scripts).
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('argo/scripts'), 'npm package must ship argo/scripts (incl. the recorder)');
});
