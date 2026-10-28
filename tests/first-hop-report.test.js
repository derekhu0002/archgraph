'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const report = require('../scripts/first-hop-report.js');
const costLog = require('../argo/scripts/graph-rag/agentCostLog.js');

// External-view acceptance tests for the first-hop report. The report is the
// durable, host-independent way to answer "did the agent's first content read
// go to the graph or to the repository?" — the metric that judges the
// graph-first retrieval rule. These tests pin the reporting rules, not the
// current numbers.

function tool(at, fields) {
  return { at, pid: 1, source: 'host', type: 'tool', ...fields };
}

test('AT-first-hop-01: a run is one pid, split again only after a gap longer than the threshold', () => {
  // GIVEN tool records from two processes with varying idle gaps
  const records = [
    tool('2026-10-28T00:00:00Z', { pid: 1, tool: 'grep', backend: 'repo', kind: 'read' }),
    tool('2026-10-28T00:10:00Z', { pid: 1, tool: 'read', backend: 'repo', kind: 'read' }),
    tool('2026-10-28T00:40:00Z', { pid: 1, tool: 'read', backend: 'repo', kind: 'read' }),
    tool('2026-10-28T00:30:00Z', { pid: 2, tool: 'read', backend: 'repo', kind: 'read' }),
    tool('2026-10-28T01:30:00Z', { pid: 1, tool: 'read', backend: 'repo', kind: 'read' }),
  ];
  // WHEN split into runs
  const runs = report.splitRuns(records, { gapMinutes: 30 });
  // THEN pid boundaries and >30min idle gaps start a new run (an exactly-30min gap does not)
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map(r => r.pid), [1, 2, 1]);
  assert.deepEqual(runs.map(r => r.records.length), [3, 1, 1]);
  assert.equal(runs[0].start, '2026-10-28T00:00:00Z');
  assert.equal(runs[0].end, '2026-10-28T00:40:00Z');
});

test('AT-first-hop-02: only a content read counts as the hop; writes, shell runs and host utilities do not', () => {
  // GIVEN a run that writes, runs a shell command and edits the task list before reading
  const run = {
    records: [
      tool('2026-10-28T00:00:00Z', { tool: 'applySystemArchitectureMutation', backend: 'graph', kind: 'write' }),
      tool('2026-10-28T00:00:01Z', { tool: 'bash', backend: 'repo', kind: 'exec' }),
      tool('2026-10-28T00:00:02Z', { tool: 'todowrite', backend: 'other', kind: 'other' }),
      tool('2026-10-28T00:00:03Z', { tool: 'validateSystemArchitecture', backend: 'framework', kind: 'framework' }),
      tool('2026-10-28T00:00:04Z', { tool: 'grep', backend: 'repo', kind: 'read' }),
      tool('2026-10-28T00:00:05Z', { tool: 'getSystemArchitecture', backend: 'graph', kind: 'read' }),
    ],
  };
  // WHEN taking the first hop
  const hop = report.firstHopOf(run);
  // THEN the first READ wins and non-reads are ignored
  assert.equal(hop.tool, 'grep');
  assert.equal(hop.backend, 'repo');
  assert.equal(report.firstHopOf({ records: [] }), null, 'a run with no read has no hop');
});

test('AT-first-hop-03: runs logged by an older instrument are excluded, never mixed into the headline', () => {
  // GIVEN one trustworthy run and one whose labels contradict the current classifier
  const records = [
    tool('2026-10-28T00:00:00Z', { pid: 1, tool: 'getSystemArchitecture', backend: 'graph', kind: 'read' }),
    tool('2026-10-28T00:00:30Z', { pid: 1, tool: 'getIntentElementContext', backend: 'graph', kind: 'read' }),
    // old instrument recorded shell runs as reads
    tool('2026-10-28T01:00:00Z', { pid: 2, tool: 'bash', backend: 'repo', kind: 'read' }),
    tool('2026-10-28T01:00:30Z', { pid: 2, tool: 'getSystemArchitecture', backend: 'graph', kind: 'read' }),
  ];
  // WHEN building the report
  const result = report.buildFirstHopReport(records);
  // THEN the legacy run is set aside and the headline counts only trusted runs
  assert.equal(result.runs.scanned, 2);
  assert.equal(result.runs.legacyExcluded, 1);
  assert.equal(result.runs.measured, 1);
  assert.deepEqual(result.runs.legacy.map(r => r.pid), [2]);
  assert.equal(result.firstHop.graph, 1);
  assert.equal(result.firstHop.repo, 0);
});

test('AT-first-hop-04: graph hops split into schema / semantic / structural and the target is judged', () => {
  // GIVEN five runs: 4 graph-first (1 schema, 1 semantic, 2 structural) and 1 repo-first
  const at = (minutes) => new Date(Date.UTC(2026, 9, 28, 0, minutes)).toISOString();
  const records = [
    tool(at(0), { pid: 1, tool: 'queryNeo4jGraph', backend: 'graph', kind: 'read', args: { keys: ['schema'], bytes: 20 } }),
    tool(at(1), { pid: 2, tool: 'memory_search', backend: 'graph', kind: 'read', args: { keys: [], bytes: 2 } }),
    tool(at(2), { pid: 3, tool: 'mcp__argo__getSystemArchitecture', backend: 'graph', kind: 'read' }),
    tool(at(3), { pid: 4, tool: 'queryNeo4jGraph', backend: 'graph', kind: 'read', args: { keys: ['cypher'], bytes: 30 } }),
    tool(at(4), { pid: 5, tool: 'read', backend: 'repo', kind: 'read' }),
  ];
  // WHEN building the report
  const result = report.buildFirstHopReport(records);
  // THEN each graph hop is named by what it could prove
  assert.deepEqual(result.graphFirstBreakdown, { schema: 1, semantic: 2, structural: 1 });
  assert.equal(result.firstHop.graph, 4);
  assert.equal(result.firstHop.repo, 1);
  assert.equal(result.percentages.repoFirst, 20);
  assert.equal(result.percentages.graphSemanticFirst, 40);
  // AND the target is strict: exactly 20% is not below 20%
  assert.equal(result.target.met, false, 'repo-first must be strictly below the target');
  // WHEN one more graph-first run is added
  records.push(tool(at(5), { pid: 6, tool: 'getSystemArchitecture', backend: 'graph', kind: 'read' }));
  const better = report.buildFirstHopReport(records);
  // THEN 1/6 repo-first clears the target
  assert.equal(better.percentages.repoFirst, 16.7);
  assert.equal(better.target.met, true);
});

test('AT-first-hop-05: reads the real log file, applies --since, and survives a missing log', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-first-hop-'));
  const prev = process.env.ARGO_COST_PROFILER;
  try {
    delete process.env.ARGO_COST_PROFILER;
    const base = { source: 'host', type: 'tool', pid: 42 };
    costLog.appendRecord(ws, { ...base, at: '2026-10-28T00:00:00.000Z', tool: 'grep', backend: 'repo', kind: 'read' });
    costLog.appendRecord(ws, { ...base, at: '2026-10-28T02:00:00.000Z', tool: 'getSystemArchitecture', backend: 'graph', kind: 'read' });

    // WHEN reporting the whole log
    const all = report.buildFirstHopReport(costLog.readLog(ws).records);
    // THEN both runs are measured
    assert.equal(all.runs.measured, 2);
    assert.equal(all.firstHop.repo, 1);
    assert.equal(all.firstHop.graph, 1);

    // WHEN a cutoff excludes the older run
    const recent = report.buildFirstHopReport(costLog.readLog(ws).records, { since: '2026-10-28T01:00:00.000Z' });
    // THEN only the newer run counts
    assert.equal(recent.runs.measured, 1);
    assert.equal(recent.firstHop.graph, 1);
    assert.equal(recent.firstHop.repo, 0);

    // WHEN the log does not exist
    const emptyWs = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-first-hop-empty-'));
    try {
      const empty = report.buildFirstHopReport(costLog.readLog(emptyWs).records);
      // THEN the report is well-formed and never throws
      assert.equal(empty.runs.measured, 0);
      assert.equal(empty.percentages.repoFirst, null);
      assert.equal(empty.target.met, false);
      assert.doesNotThrow(() => JSON.stringify(empty));
    } finally { fs.rmSync(emptyWs, { recursive: true, force: true }); }
  } finally {
    if (prev === undefined) delete process.env.ARGO_COST_PROFILER; else process.env.ARGO_COST_PROFILER = prev;
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
