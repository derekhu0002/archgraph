'use strict';
/**
 * Memory-retrieval A/B: "MCP off" vs "MCP on", on the SAME tasks and model.
 *
 * Goal: measure, for a task that needs information, how much the agent spends
 * (turns / tool calls / tokens / wall-time) and how well it does (evidence
 * recall vs the task ORACLE, precision) WITH vs WITHOUT the ArchGraph MCP.
 *
 * Fairness (single variable = the memory backend):
 *   - Both arms run the same opencode agent, same model, same prompt, --pure
 *     (no host plugins), in the same repository, with an ISOLATED config/home.
 *   - Instructions are NEUTRAL in both arms (no argo-centric rule that an
 *     "off" arm could not satisfy) — otherwise the comparison is biased.
 *   - The ONLY difference is whether the argo MCP server is mounted.
 *
 * Usage:
 *   node scripts/memory-retrieval-ab.js [--limit N] [--seed <file>] [--tasks AC-01,AC-05]
 *                                      [--model deepseek-flash] [--keep]
 *
 * Report: results/memory-retrieval-ab-report.json
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseTrajectory, scoreTask, buildUniverse, aggregate } = require('./agent-cost-eval.js');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_PATH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const SEED_PATH = path.join(ROOT, 'data', 'eval-seeds', 'agent-cost-seed.json');
const REPORT_PATH = path.join(ROOT, 'results', 'memory-retrieval-ab-report.json');
const AB_HOME_ROOT = path.join(os.tmpdir(), 'argo-ab');
// Resolve the opencode CLI executable directly (avoids shell quoting for the
// multi-line prompt on Windows).
const NPM_GLOBAL = path.join(process.env.APPDATA || '', 'npm');
const OPENCODE_BIN = path.join(NPM_GLOBAL, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');

function parseEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch (_) { /* missing */ }
  return out;
}

function resolveArgoEnv() {
  const globalEnv = parseEnvFile(path.join(os.homedir(), '.argo', '.env'));
  const repoEnv = parseEnvFile(path.join(ROOT, '.argo', '.env'));
  return { ...globalEnv, ...repoEnv };
}

function parseArgs(argv) {
  const a = { limit: 0, tasks: null, seed: SEED_PATH, model: 'deepseek-flash', keep: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--limit') a.limit = Number(argv[++i]) || 0;
    else if (k === '--seed') a.seed = argv[++i];
    else if (k === '--tasks') a.tasks = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--model') a.model = argv[++i];
    else if (k === '--keep') a.keep = true;
  }
  return a;
}

function armHome(arm) {
  return path.join(AB_HOME_ROOT, arm);
}

function writeArmConfig(arm, { model, argoEnv }) {
  const home = armHome(arm);
  const cfgDir = path.join(home, '.config', 'opencode');
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(cfgDir, { recursive: true });
  const key = argoEnv.ARGO_RERANK_API_KEY;
  if (!key) throw new Error('ARGO_RERANK_API_KEY missing (set it in ~/.argo/.env)');
  const cfg = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      ab: {
        npm: '@ai-sdk/openai-compatible',
        name: 'AB',
        options: { baseURL: argoEnv.ARGO_RERANK_BASE_URL || 'https://api.deepseek.com', apiKey: key },
        models: { [model]: { name: model } },
      },
    },
    model: `ab/${model}`,
  };
  if (arm === 'on') {
    cfg.mcp = {
      argo: { type: 'local', command: ['node', path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js')], enabled: true },
    };
  }
  fs.writeFileSync(path.join(cfgDir, 'opencode.json'), JSON.stringify(cfg, null, 2), 'utf8');
  return home;
}

const NEUTRAL_HEADER = 'You are working in this repository. Find the requested information using the tools available to you, then answer concisely and end with the concrete answer (exact ids / file paths). Do not guess.';

function runTask(arm, home, task, { model, argoEnv }) {
  const prompt = `${NEUTRAL_HEADER}\n\nRequest: ${task.question}`;
  const env = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    APPDATA: path.join(home, 'AppData'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    ...(arm === 'on' ? { ARGO_REPO_ROOT: ROOT, ...argoEnv } : {}),
  };
  const started = Date.now();
  const bin = fs.existsSync(OPENCODE_BIN) ? OPENCODE_BIN : 'opencode';
  const res = spawnSync(bin, ['run', '--pure', '--format', 'json', '-m', `ab/${model}`, prompt], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, shell: !fs.existsSync(OPENCODE_BIN),
  });
  const raw = String(res.stdout || '');
  const wallMs = Date.now() - started;
  const parsed = parseTrajectory(raw);
  return { raw, parsed, wallMs, exit: res.status, stderr: String(res.stderr || '').slice(0, 800) };
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const seed = JSON.parse(fs.readFileSync(args.seed, 'utf8'));
  let tasks = seed.questions;
  if (args.tasks) tasks = tasks.filter(t => args.tasks.includes(t.id));
  if (args.limit > 0) tasks = tasks.slice(0, args.limit);

  const argoEnv = resolveArgoEnv();
  const universe = buildUniverse({ repoRoot: ROOT, graphPath: GRAPH_PATH });
  const arms = ['off', 'on'];
  const homes = {};
  for (const arm of arms) homes[arm] = writeArmConfig(arm, { model: args.model, argoEnv });

  const rows = [];
  for (const task of tasks) {
    for (const arm of arms) {
      const r = runTask(arm, homes[arm], task, { model: args.model, argoEnv });
      const scored = scoreTask(r.parsed, { id: task.id, dimension: task.dimension, oracle: task.oracle }, universe);
      const row = {
        taskId: task.id, dimension: task.dimension, arm,
        success: scored.success, evidenceRecall: scored.evidenceRecall, evidencePrecision: scored.evidencePrecision,
        missing: scored.missing,
        tokens: scored.tokens, tokensIn: r.parsed.tokensIn, tokensOut: r.parsed.tokensOut, tokensReasoning: r.parsed.tokensReasoning,
        wallMs: r.wallMs, eventMs: scored.latencyMs, turns: scored.turns, toolCalls: scored.toolCalls,
        byBackend: scored.byBackend, roundTrips: scored.roundTrips,
        // timing split: model time vs MCP(graph) tool time vs repo tool time
        toolTimeMs: r.parsed.toolTimeMs || 0,
        modelMs: Math.max(0, r.wallMs - (r.parsed.toolTimeMs || 0)),
        mcpToolMs: (r.parsed.byBackendTime && r.parsed.byBackendTime.graph) || 0,
        repoToolMs: (r.parsed.byBackendTime && r.parsed.byBackendTime.repo) || 0,
        toolErrors: r.parsed.toolErrors || 0,
        toolDurations: r.parsed.toolCalls.map(c => ({ tool: c.tool, ms: c.durationMs, ok: c.ok })),
        tools: [...new Set(r.parsed.toolCalls.map(c => c.tool))],
        answer: (r.parsed.fullText || '').slice(0, 400),
        exit: r.exit,
      };
      rows.push(row);
      console.log(`[ab] ${task.id} ${arm}: ok=${row.success} recall=${row.evidenceRecall} tok=${row.tokens} wall=${(row.wallMs / 1000).toFixed(1)}s (model=${(row.modelMs / 1000).toFixed(1)}s mcp=${(row.mcpToolMs / 1000).toFixed(1)}s repo=${(row.repoToolMs / 1000).toFixed(1)}s) turns=${row.turns} tools=${row.toolCalls}(g${row.byBackend.graph}/r${row.byBackend.repo}/o${row.byBackend.other}) err=${row.toolErrors} rt=${row.roundTrips}`);
      fs.writeFileSync(path.join(ROOT, 'results', `ab-${task.id}-${arm}.ndjson`), r.raw, 'utf8');
    }
  }

  // per-arm summary + per-task deltas
  const summary = {};
  for (const arm of arms) {
    const rs = rows.filter(r => r.arm === arm);
    const n = rs.length || 1;
    const avg = (f) => Math.round(rs.reduce((a, r) => a + f(r), 0) / n * 1000) / 1000;
    summary[arm] = {
      tasks: rs.length,
      successRate: Math.round(rs.filter(r => r.success).length / n * 1000) / 1000,
      avgEvidenceRecall: avg(r => r.evidenceRecall),
      avgEvidencePrecision: avg(r => r.evidencePrecision),
      avgTokens: avg(r => r.tokens), totalTokens: rs.reduce((a, r) => a + r.tokens, 0),
      avgWallMs: avg(r => r.wallMs), avgEventMs: avg(r => r.eventMs),
      avgModelMs: avg(r => r.modelMs), avgMcpToolMs: avg(r => r.mcpToolMs), avgRepoToolMs: avg(r => r.repoToolMs),
      totalToolErrors: rs.reduce((a, r) => a + r.toolErrors, 0),
      avgTurns: avg(r => r.turns), avgToolCalls: avg(r => r.toolCalls), avgRoundTrips: avg(r => r.roundTrips),
      byBackend: rs.reduce((a, r) => ({ graph: a.graph + r.byBackend.graph, repo: a.repo + r.byBackend.repo, other: a.other + r.byBackend.other }), { graph: 0, repo: 0, other: 0 }),
    };
  }
  const deltas = tasks.map(t => {
    const off = rows.find(r => r.taskId === t.id && r.arm === 'off') || {};
    const on = rows.find(r => r.taskId === t.id && r.arm === 'on') || {};
    return {
      taskId: t.id, dimension: t.dimension,
      tokenDelta: (on.tokens || 0) - (off.tokens || 0),
      wallDeltaMs: (on.wallMs || 0) - (off.wallMs || 0),
      turnDelta: (on.turns || 0) - (off.turns || 0),
      toolDelta: (on.toolCalls || 0) - (off.toolCalls || 0),
      recallOff: off.evidenceRecall, recallOn: on.evidenceRecall,
      successOff: off.success, successOn: on.success,
    };
  });

  const report = { generatedAt: new Date().toISOString(), model: args.model, tasks: tasks.map(t => t.id), summary, deltas, rows };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\n=== A/B summary (MCP off vs on) ===');
  for (const arm of arms) {
    const s = summary[arm];
    console.log(`${arm.toUpperCase()}: success=${(s.successRate * 100).toFixed(1)}% recall=${(s.avgEvidenceRecall * 100).toFixed(1)}% precision=${(s.avgEvidencePrecision * 100).toFixed(1)}% | tokens=${s.avgTokens} wall=${(s.avgWallMs / 1000).toFixed(1)}s = model ${(s.avgModelMs / 1000).toFixed(1)}s + mcp ${(s.avgMcpToolMs / 1000).toFixed(1)}s + repo ${(s.avgRepoToolMs / 1000).toFixed(1)}s | turns=${s.avgTurns} tools=${s.avgToolCalls} err=${s.totalToolErrors} rt=${s.avgRoundTrips} backend(g${s.byBackend.graph}/r${s.byBackend.repo}/o${s.byBackend.other})`);
  }
  console.log(`report: ${REPORT_PATH}`);
  return 0;
}

module.exports = { parseArgs, resolveArgoEnv, writeArmConfig, runTask, main };

if (require.main === module) process.exit(main());
