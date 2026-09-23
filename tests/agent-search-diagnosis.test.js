'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const diag = require('../argo/scripts/agentSearchDiagnose.js');

function tmpWs() { return fs.mkdtempSync(path.join(os.tmpdir(), 'diag-test-')); }
function ndjson(events) { return events.map(e => JSON.stringify(e)).join('\n') + '\n'; }

const SESSION = ndjson([
  { type: 'step_start', timestamp: 1000 },
  { type: 'message.part', timestamp: 1100, part: { type: 'tool', tool: 'argo_getSystemArchitecture', state: { status: 'completed', time: { start: 1100, end: 2500 }, input: { query: { intent: '项目愿景' } }, output: 'found overseer-vision-001' } } },
  { type: 'message.part', timestamp: 2600, part: { type: 'tool', tool: 'grep', state: { status: 'completed', time: { start: 2600, end: 2700 }, input: { pattern: 'vision' }, output: '' } } },
  { type: 'message.part', timestamp: 2800, part: { type: 'tool', tool: 'grep', state: { status: 'completed', time: { start: 2800, end: 2900 }, input: { pattern: 'vision' }, output: '' } } },
  { type: 'message.part', timestamp: 3000, part: { type: 'tool', tool: 'read', state: { status: 'error', error: 'EACCES', time: { start: 3000, end: 3100 }, input: { filePath: 'design/KG/SystemArchitecture.json' }, output: '' } } },
  { type: 'step_finish', timestamp: 5000, part: { finish: { tokens: { input: 6470, output: 20, reasoning: 5 }, cost: 0.01 } } },
]);

// External-view acceptance tests for the agent-search-diagnosis skill + script:
// it turns one session into a self-contained diagnostic bundle (summary +
// metrics + raw evidence) at the fixed temp2.2 bundle path.

test('AT-agent-search-diagnosis-01: diagnose surfaces over-search signals + timing split', () => {
  const m = diag.diagnose(diag.parseSession(SESSION), { wallMs: 4000, workspace: 'ws', sessionId: 's1' });
  assert.equal(m.overview.toolCalls, 4);
  assert.equal(m.overview.roundTrips, 1, 'graph→repo is one backend round-trip');
  assert.equal(m.overview.mcpMs, 1400, 'MCP (graph) tool time is separated');
  assert.equal(m.overview.repoToolMs, 300);
  assert.equal(m.overview.modelMs, 4000 - 1700, 'model time = wall - tool time');
  assert.ok(m.overSearch.duplicateCalls.length >= 1, 'the repeated grep is flagged');
  assert.ok(m.overSearch.emptyOrError >= 3, 'empty results + error are counted');
  assert.ok(m.overSearch.noProgressStreak >= 3);
  assert.ok(Array.isArray(m.hints) && m.hints.length >= 1);
});

test('AT-agent-search-diagnosis-02: writeBundle emits the fixed temp2.2 bundle', () => {
  const ws = tmpWs();
  try {
    const file = path.join(ws, 's1.ndjson');
    fs.writeFileSync(file, SESSION);
    fs.mkdirSync(path.join(ws, '.argo', 'temp'), { recursive: true });
    fs.writeFileSync(path.join(ws, '.argo', 'temp', 'agent-cost-log.ndjson'), JSON.stringify({ source: 'host', sessionID: 's1', tool: 'grep' }) + '\n');
    const { outDir, manifest } = diag.writeBundle({ session: file, workspace: ws, sessionId: 's1' });
    assert.equal(outDir, path.join(ws, '.argo', 'temp', 'diagnosis', 's1'));
    for (const f of ['diagnosis.md', 'metrics.json', 'session.ndjson', 'cost-log.slice.ndjson', 'manifest.json']) {
      assert.ok(fs.existsSync(path.join(outDir, f)), `${f} must exist in the bundle`);
    }
    assert.equal(manifest.bundleVersion, 'temp2.2');
    assert.ok(manifest.files.length === 4, 'manifest lists the four data files');
    assert.match(fs.readFileSync(path.join(outDir, 'diagnosis.md'), 'utf8'), /过度搜索信号/);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('AT-agent-search-diagnosis-03: cost-log slice is filtered to the session', () => {
  const text = [JSON.stringify({ sessionID: 'a' }), JSON.stringify({ sessionID: 'b' }), JSON.stringify({ sessionID: 'a' })].join('\n');
  const slice = diag.sliceCostLog(text, 'a');
  assert.equal(slice.trim().split('\n').length, 2);
  assert.ok(!slice.includes('"sessionID":"b"'));
});

test('AT-agent-search-diagnosis-05: accepts the opencode export JSON form ({info, messages})', () => {
  const exp = {
    info: { id: 'ses_x' },
    messages: [
      { info: { role: 'assistant', tokens: { input: 100, output: 10, reasoning: 0 }, time: { completed: 2000 } },
        parts: [
          { type: 'step-start' },
          { type: 'tool', tool: 'argo_queryNeo4jGraph', state: { status: 'completed', time: { start: 1000, end: 1500 }, input: { cypher: 'MATCH (n) RETURN n' }, output: 'row' } },
        ] },
    ],
  };
  const text = JSON.stringify(exp);
  assert.equal(diag.isExportJson(text), true);
  const s = diag.parseSession(diag.exportToNdjson(text));
  assert.equal(s.toolCalls.length, 1);
  assert.equal(s.toolCalls[0].tool, 'argo_queryNeo4jGraph');
  assert.equal(s.toolCalls[0].durationMs, 500);
  assert.equal(s.steps, 1);
  assert.equal(s.tokensIn, 100);
});

test('AT-agent-search-diagnosis-04: the skill + script ship with the framework', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'argo', 'skills', 'agent-search-diagnosis', 'SKILL.md')), 'skill must exist');
  assert.ok(fs.existsSync(path.join(ROOT, 'argo', 'scripts', 'agentSearchDiagnose.js')), 'script must exist');
  const skill = fs.readFileSync(path.join(ROOT, 'argo', 'skills', 'agent-search-diagnosis', 'SKILL.md'), 'utf8');
  assert.match(skill, /name: agent-search-diagnosis/);
  assert.match(skill, /agentSearchDiagnose\.js/, 'skill must invoke the diagnose script');
  assert.match(skill, /diagnosis\//, 'skill must document the bundle dir');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('argo/skills/agent-search-diagnosis'), 'npm package must ship the skill');
  const installer = fs.readFileSync(path.join(ROOT, 'install-argo.ps1'), 'utf8');
  assert.match(installer, /agent-search-diagnosis/, 'installer must deploy the skill');
});
