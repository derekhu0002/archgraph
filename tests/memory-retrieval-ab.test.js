'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ab = require('../scripts/memory-retrieval-ab.js');

// External-view acceptance tests for the memory-retrieval A/B harness: it must
// compare "MCP off" vs "MCP on" with a SINGLE variable (the memory backend) —
// same model/prompt/repo, isolated configs, neutral instructions — and score
// tokens / time / turns / tool mix plus evidence recall against the task oracle.

test('AT-memory-retrieval-ab-01: harness options parse', () => {
  const a = ab.parseArgs(['--limit', '3', '--tasks', 'AC-01, AC-05', '--model', 'm', '--keep']);
  assert.equal(a.limit, 3);
  assert.deepEqual(a.tasks, ['AC-01', 'AC-05']);
  assert.equal(a.model, 'm');
  assert.equal(a.keep, true);
  assert.equal(ab.parseArgs([]).limit, 0);
});

test('AT-memory-retrieval-ab-02: the two arms differ ONLY by the argo MCP mount', () => {
  const argoEnv = { ARGO_RERANK_API_KEY: 'test-key', ARGO_RERANK_BASE_URL: 'https://api.deepseek.com' };
  const off = ab.writeArmConfig('off', { model: 'deepseek-flash', argoEnv });
  const on = ab.writeArmConfig('on', { model: 'deepseek-flash', argoEnv });
  const cfgOff = JSON.parse(fs.readFileSync(path.join(off, '.config', 'opencode', 'opencode.json'), 'utf8'));
  const cfgOn = JSON.parse(fs.readFileSync(path.join(on, '.config', 'opencode', 'opencode.json'), 'utf8'));
  try {
    // same model + provider in both arms
    assert.equal(cfgOff.model, cfgOn.model);
    assert.deepEqual(Object.keys(cfgOff.provider), Object.keys(cfgOn.provider));
    // the single variable: the argo MCP is present only in the "on" arm
    assert.equal(cfgOff.mcp, undefined, 'off arm must have no MCP');
    assert.ok(cfgOn.mcp && cfgOn.mcp.argo, 'on arm must mount the argo MCP');
    assert.ok(cfgOn.mcp.argo.command.join(' ').includes('argo-mcp-server.js'));
  } finally {
    fs.rmSync(off, { recursive: true, force: true });
    fs.rmSync(on, { recursive: true, force: true });
  }
});

test('AT-memory-retrieval-ab-03: the harness reuses the R7 scorer and a task oracle', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'memory-retrieval-ab.js'), 'utf8');
  assert.match(src, /require\('\.\/agent-cost-eval\.js'\)/, 'must reuse the R7 scorer');
  assert.match(src, /scoreTask\(/, 'must score evidence recall against the oracle');
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'eval-seeds', 'agent-cost-seed.json'), 'utf8'));
  for (const q of seed.questions) assert.ok(q.oracle, `${q.id} needs an oracle`);
});

test('AT-memory-retrieval-ab-05: the on arm resolves the sanctioned env file under an isolated HOME', () => {
  // GIVEN an isolated arm home (single-variable fairness keeps HOME overridden)
  const home = path.join(os.tmpdir(), 'argo-ab', 'on');
  const envFile = 'C:/Users/x/.argo/.env';
  const argoEnv = { ARGO_RERANK_API_KEY: 'k', ARGO_NEO4J_DATABASE_URL: 'bolt://x' };
  // WHEN building each arm's process environment
  const on = ab.buildArmEnv('on', home, argoEnv, envFile);
  const off = ab.buildArmEnv('off', home, argoEnv, envFile);
  // THEN the isolated HOME still gets an explicit ARGO_ENV_FILE so the MCP's
  //      getArgoEnvPath() never falls back to an unreadable repo argo/.env
  assert.equal(on.HOME, home);
  assert.equal(on.USERPROFILE, home);
  assert.equal(on.ARGO_ENV_FILE, envFile, 'on arm must point the MCP at the sanctioned env file');
  assert.equal(on.ARGO_REPO_ROOT, ROOT);
  assert.equal(on.ARGO_NEO4J_DATABASE_URL, 'bolt://x');
  // AND the off arm receives none of the graph configuration (single variable)
  assert.equal(off.ARGO_ENV_FILE, undefined);
  assert.equal(off.ARGO_REPO_ROOT, undefined);
  assert.equal(off.ARGO_NEO4J_DATABASE_URL, undefined);
});

test('AT-memory-retrieval-ab-06: headless runs auto-approve tools so the arms are not timed waiting', () => {
  // GIVEN the headless opencode invocation args
  const args = ab.buildRunArgs('deepseek-flash', 'hello');
  // THEN tools are auto-approved (no approval stall contaminating wall-time)
  assert.ok(args.includes('--auto'), 'headless runs must auto-approve to avoid approval stalls');
  // AND fairness is preserved (no host plugins) and the model is pinned
  assert.ok(args.includes('--pure'));
  assert.ok(args.includes('--format') && args.includes('json'));
  assert.ok(args.join(' ').includes('ab/deepseek-flash'));
});

test('AT-memory-retrieval-ab-07: the off arm strips host-inherited graph config (single variable holds)', () => {
  // GIVEN a host env that already exports graph config (the architecture test
  // runner / a fixed-workspace host does this)
  const saved = {
    ARGO_REPO_ROOT: process.env.ARGO_REPO_ROOT,
    ARGO_ENV_FILE: process.env.ARGO_ENV_FILE,
    ARGO_NEO4J_DATABASE_URL: process.env.ARGO_NEO4J_DATABASE_URL,
  };
  process.env.ARGO_REPO_ROOT = 'D:/host/workspace';
  process.env.ARGO_ENV_FILE = 'C:/host/.argo/.env';
  process.env.ARGO_NEO4J_DATABASE_URL = 'bolt://host';
  try {
    // WHEN building the off arm's environment
    const off = ab.buildArmEnv('off', path.join(os.tmpdir(), 'argo-ab', 'off'), { ARGO_NEO4J_DATABASE_URL: 'bolt://on' }, 'C:/Users/x/.argo/.env');
    // THEN none of the host graph config leaks into it (single-variable fairness)
    assert.equal(off.ARGO_REPO_ROOT, undefined);
    assert.equal(off.ARGO_ENV_FILE, undefined);
    assert.equal(off.ARGO_NEO4J_DATABASE_URL, undefined);
    // AND the on arm still gets only the sanctioned config
    const on = ab.buildArmEnv('on', path.join(os.tmpdir(), 'argo-ab', 'on'), { ARGO_NEO4J_DATABASE_URL: 'bolt://on' }, 'C:/Users/x/.argo/.env');
    assert.equal(on.ARGO_REPO_ROOT, ROOT);
    assert.equal(on.ARGO_ENV_FILE, 'C:/Users/x/.argo/.env');
    assert.equal(on.ARGO_NEO4J_DATABASE_URL, 'bolt://on');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
