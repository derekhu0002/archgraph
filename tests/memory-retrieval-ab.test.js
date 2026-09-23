'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
