'use strict';
/**
 * First-hop report (2026-10-28).
 *
 * Answers ONE question over the consolidated host cost log
 * (<workspace>/.argo/temp/agent-cost-log.ndjson): for each agent run, did the
 * first content READ go to the intent graph (KG) or to the repository?
 *
 * Why this metric: the framework's rule is graph-first retrieval, but a rule in
 * the system prompt is not a controller. The cheapest, host-agnostic instrument
 * is the log's own kind/backend classification (README of agentCostLog.js):
 *
 *   - a run is one pid, split again after a gap longer than --gap-minutes
 *     (default 30) with no tool call;
 *   - the first hop is the FIRST record with kind=read and backend in
 *     {graph, repo} — writes, shell runs, validators and host utilities are not
 *     reads and must never count (that was the 0.29.26 instrument fix);
 *   - graph hops are split into schema (STEP 0 schema read: queryNeo4jGraph with
 *     a `schema` argument), semantic (getSystemArchitecture / memory_search) and
 *     structural (the rest), because only the semantic ones show that retrieval
 *     actually started in the graph;
 *   - runs produced by an older instrument are reported separately and NOT
 *     mixed into the headline: if any record contradicts the current classifier
 *     (e.g. `bash` recorded as kind=read), that run's labels cannot be trusted.
 *
 * Read-only. Usage:
 *   node scripts/first-hop-report.js [--log PATH] [--since ISO]
 *                                    [--gap-minutes N] [--json] [--details]
 */
const path = require('node:path');

const { classifyTool, readLog, logFilePath } = require('../argo/scripts/graph-rag/agentCostLog.js');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_GAP_MINUTES = 30;
const HOP_BACKENDS = ['graph', 'repo'];
const REPO_FIRST_TARGET_PCT = 20;

// Host tool names vary (`read`, `mcp__argo__getSystemArchitecture`, `argo_x`,
// `functions.read`). This mirrors agentCostLog.toolKey so the report can name a
// hop without re-deriving the backend (which classifyTool already owns).
function toolKeyOf(tool) {
  const lower = String(tool || '').trim().toLowerCase();
  const tail = lower.split('__').pop();
  const segments = tail.split(/[.:]/);
  return segments[segments.length - 1].replace(/^argo_/, '');
}

const SEMANTIC_TOOLS = new Set(['getsystemarchitecture', 'memory_search']);

function timeOf(record) {
  const t = Date.parse(record && record.at);
  return Number.isFinite(t) ? t : null;
}

function isToolRecord(record) {
  return !!record && record.type === 'tool';
}

// A run is one process (pid), split by a long idle gap. We do not split on
// sessionID: a session survives host restarts (new pid) and one pid can host
// several sessions, so pid + gap is the stable, host-independent boundary.
function splitRuns(records, options = {}) {
  const gapMs = (Number.isFinite(options.gapMinutes) ? options.gapMinutes : DEFAULT_GAP_MINUTES) * 60 * 1000;
  const tools = (records || [])
    .filter(isToolRecord)
    .map(r => ({ record: r, t: timeOf(r) }))
    .filter(x => x.t !== null && x.record.pid !== undefined)
    .sort((a, b) => a.t - b.t || String(a.record.callID || '').localeCompare(String(b.record.callID || '')));

  const runs = [];
  const byPid = new Map();
  for (const entry of tools) {
    const pid = entry.record.pid;
    if (!byPid.has(pid)) byPid.set(pid, []);
    byPid.get(pid).push(entry);
  }
  for (const entries of byPid.values()) {
    let current = null;
    for (const { record, t } of entries) {
      if (!current || t - current.lastT > gapMs) {
        current = {
          pid: record.pid,
          start: record.at,
          end: record.at,
          startMs: t,
          lastT: t,
          sessionIds: new Set(),
          records: [],
        };
        runs.push(current);
      }
      current.records.push(record);
      current.lastT = t;
      current.end = record.at;
      if (record.sessionID) current.sessionIds.add(record.sessionID);
    }
  }
  runs.sort((a, b) => a.startMs - b.startMs);
  return runs;
}

// Did this run's log come from the current instrument? Any record whose kind
// disagrees with the live classifier (or has no kind at all) means no.
function runHasTrustworthyKinds(run) {
  return (run.records || []).every(record => {
    if (!record.kind || !record.backend) return false;
    const expected = classifyTool(record.tool);
    return expected.kind === record.kind && expected.backend === record.backend;
  });
}

// The first content read of a run: the retrieval decision we are measuring.
function firstHopOf(run) {
  for (const record of run.records || []) {
    if (record.kind === 'read' && HOP_BACKENDS.includes(record.backend)) return record;
  }
  return null;
}

function graphHopType(record) {
  const key = toolKeyOf(record.tool);
  if (key === 'queryneo4jgraph') {
    const keys = (record.args && Array.isArray(record.args.keys)) ? record.args.keys : [];
    return keys.includes('schema') ? 'schema' : 'structural';
  }
  return SEMANTIC_TOOLS.has(key) ? 'semantic' : 'structural';
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function buildFirstHopReport(records, options = {}) {
  const sinceMs = options.since ? Date.parse(options.since) : null;
  const gapMinutes = Number.isFinite(options.gapMinutes) ? options.gapMinutes : DEFAULT_GAP_MINUTES;
  const rows = (records || []).filter(record => {
    if (!isToolRecord(record)) return false;
    if (sinceMs === null) return true;
    const t = timeOf(record);
    return t !== null && t >= sinceMs;
  });

  const runs = splitRuns(rows, { gapMinutes });
  const legacy = [];
  const measured = [];
  for (const run of runs) {
    (runHasTrustworthyKinds(run) ? measured : legacy).push(run);
  }

  const hop = { graph: 0, repo: 0, none: 0 };
  const graphBreakdown = { schema: 0, semantic: 0, structural: 0 };
  const graphHopTools = {};
  const argsRecorded = rows.some(record => record.args && Array.isArray(record.args.keys) && record.args.keys.length > 0);
  const details = [];
  for (const run of measured) {
    const first = firstHopOf(run);
    if (!first) {
      hop.none += 1;
      details.push({ pid: run.pid, start: run.start, end: run.end, sessions: [...run.sessionIds], hop: null });
      continue;
    }
    hop[first.backend] += 1;
    let graphType = null;
    if (first.backend === 'graph') {
      graphType = graphHopType(first);
      graphBreakdown[graphType] += 1;
      const key = toolKeyOf(first.tool);
      graphHopTools[key] = (graphHopTools[key] || 0) + 1;
    }
    details.push({
      pid: run.pid, start: run.start, end: run.end, sessions: [...run.sessionIds],
      hop: { backend: first.backend, tool: first.tool, at: first.at, graphType },
    });
  }

  const hops = hop.graph + hop.repo;
  const repoFirstPct = pct(hop.repo, hops);
  return {
    generatedAt: new Date().toISOString(),
    gapMinutes,
    since: options.since || null,
    runs: {
      scanned: runs.length,
      legacyExcluded: legacy.length,
      measured: measured.length,
      legacy: legacy.map(run => ({ pid: run.pid, start: run.start, end: run.end })),
    },
    firstHop: hop,
    graphFirstBreakdown: graphBreakdown,
    graphHopTools,
    instrument: { argsRecorded },
    percentages: {
      repoFirst: repoFirstPct,
      graphFirst: pct(hop.graph, hops),
      graphSemanticFirst: pct(graphBreakdown.semantic, hops),
      graphSchemaFirst: pct(graphBreakdown.schema, hops),
    },
    target: { repoFirstPctBelow: REPO_FIRST_TARGET_PCT, met: repoFirstPct !== null && repoFirstPct < REPO_FIRST_TARGET_PCT },
    details,
  };
}

function formatReport(report, options = {}) {
  const lines = [];
  lines.push('First-hop report');
  lines.push(`generated: ${report.generatedAt}   gap: ${report.gapMinutes} min` + (report.since ? `   since: ${report.since}` : ''));
  lines.push(`runs: ${report.runs.measured} measured, ${report.runs.legacyExcluded} legacy-excluded, ${report.runs.scanned} scanned`);
  if (report.runs.legacyExcluded > 0) {
    lines.push('  (legacy = logged by an older instrument; labels contradict the current classifier, so they are not mixed in)');
  }
  const h = report.firstHop;
  lines.push(`first hop: graph ${h.graph} (${fmt(report.percentages.graphFirst)}%) | repo ${h.repo} (${fmt(report.percentages.repoFirst)}%) | none ${h.none}`);
  const g = report.graphFirstBreakdown;
  lines.push(`graph hops: schema ${g.schema} | semantic ${g.semantic} | structural ${g.structural}`);
  if (!report.instrument.argsRecorded) {
    lines.push('note: tool arguments were NOT recorded, so STEP-0 schema reads cannot be separated');
    lines.push('      from other graph queries (queryNeo4jGraph counted as structural).');
  }
  lines.push(`target: repo-first < ${report.target.repoFirstPctBelow}% -> ${report.target.met ? 'MET' : 'NOT MET'}`);
  if (options.details) {
    lines.push('');
    lines.push('details:');
    for (const d of report.details) {
      const hop = d.hop ? `${d.hop.backend}/${d.hop.tool}${d.hop.graphType ? ` (${d.hop.graphType})` : ''}` : 'none';
      lines.push(`  ${d.start} pid=${d.pid} sessions=${d.sessions.join(',') || '-'} -> ${hop}`);
    }
  }
  return lines.join('\n');
}

function fmt(value) {
  return value === null || value === undefined ? '-' : String(value);
}

function parseArgs(argv) {
  const options = { workspaceRoot: ROOT, gapMinutes: DEFAULT_GAP_MINUTES, json: false, details: false, log: null, since: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--details') options.details = true;
    else if (arg === '--log') options.log = argv[++i];
    else if (arg === '--since') options.since = argv[++i];
    else if (arg === '--gap-minutes') options.gapMinutes = Number(argv[++i]);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  let records;
  let logPath;
  if (options.log) {
    logPath = path.resolve(options.log);
    const raw = require('node:fs').readFileSync(logPath, 'utf8');
    records = [];
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try { records.push(JSON.parse(t)); } catch { /* skip malformed */ }
    }
  } else {
    logPath = logFilePath(options.workspaceRoot);
    records = readLog(options.workspaceRoot).records;
  }
  const report = buildFirstHopReport(records, options);
  report.log = logPath;
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report, options)}\n`);
  return report;
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  DEFAULT_GAP_MINUTES,
  REPO_FIRST_TARGET_PCT,
  toolKeyOf,
  splitRuns,
  runHasTrustworthyKinds,
  firstHopOf,
  graphHopType,
  buildFirstHopReport,
  formatReport,
  parseArgs,
  main,
};
