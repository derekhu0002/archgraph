'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NAV_AGENT = path.join(ROOT, 'sandbox', 'navigation-agent-eval.js');

// External-view acceptance tests for the full-ArchGraph navigation AGENT eval:
// an OpenCode Agent navigates the real intent graph through the full argo MCP,
// and every run MUST package the RAW agent session records into the result
// bundle (so each answer is auditable against the actual agent conversation).
// These tests are host-executable (the module lazily loads the in-container
// argo package), so `node --test tests/navigation-agent-eval.test.js` runs
// without Docker.

test('AT navigation-agent-eval: agent eval defines the SEED questions across all dimensions', () => {
  // GIVEN the full-ArchGraph agent navigation eval script
  assert.ok(fs.existsSync(NAV_AGENT), 'navigation-agent-eval.js must exist');
  const mod = require(NAV_AGENT);
  // THEN it covers exactly the SEED questions (NV/CA/CR/CI)
  assert.equal(mod.QUESTIONS.length, 28, 'must cover all 28 SEED questions');
  // …across all navigation dimensions…
  const dims = [...new Set(mod.QUESTIONS.map(q => q.dimension))].sort();
  assert.deepEqual(dims, ['定位', '可达', '视角切换', '边界内导航', '验收用例定位', '提交登记', '变更影响'].sort());
  // …each with a ground-truth id/name to REACH (not a fact to extract)
  for (const q of mod.QUESTIONS) {
    assert.ok(q.id && /^[A-Z]{2}-\d{2}$/.test(q.id), `question ${q.id} needs a valid XX-nn id`);
    assert.ok(q.answer, `question ${q.id} needs a ground-truth answer`);
    assert.ok(Array.isArray(q.answerAlt) && q.answerAlt.length >= 1, `question ${q.id} needs answerAlt`);
  }
});

test('AT navigation-agent-eval: judgeAnswer reaches target by id/name', () => {
  const mod = require(NAV_AGENT);
  // GIVEN the agent reports a reached id/name (NV-04 target = project-overseer-001)
  // THEN it is judged correct only if the final answer contains the target
  assert.equal(mod.judgeAnswer('reached project-overseer-001', mod.QUESTIONS[3]), true);
  assert.equal(mod.judgeAnswer('the element could not be located', mod.QUESTIONS[3]), false);
});

test('AT navigation-agent-eval: raw agent session records are packaged per question', () => {
  // GIVEN the raw agent-session NDJSON stream for one navigation question
  const mod = require(NAV_AGENT);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-agent-raw-'));
  const raw = '{"type":"message.part","part":{"type":"text","text":"plan"}}\n{"type":"step_finish","part":{"type":"step-finish"}}\n';
  // WHEN the result-package writer saves it
  const saved = mod.saveRawSession('NV-RAW-TEST', raw, tmp);
  // THEN a .ndjson file exists under the result dir with the raw session verbatim
  assert.ok(fs.existsSync(saved.file), 'raw session file must be written');
  assert.ok(saved.file.endsWith(`${path.sep}NV-RAW-TEST.ndjson`), 'file must be named by question id');
  assert.equal(fs.readFileSync(saved.file, 'utf8'), raw, 'raw session must be captured verbatim');
  assert.ok(saved.bytes > 0, 'must record the byte size');
});

test('AT navigation-agent-eval: result package report records raw session files', { skip: !fs.existsSync(path.join(ROOT, 'results', 'navigation-agent-report.json')) }, () => {
  // GIVEN a completed agent-eval run whose report exists in the result bundle
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'results', 'navigation-agent-report.json'), 'utf8'));
  // THEN it declares the raw-session bundle with one record per question
  assert.ok(report.rawSessions && typeof report.rawSessions.count === 'number', 'report must declare rawSessions bundle');
  assert.equal(report.rawSessions.count, 28, '28 raw session records expected');
  assert.equal(report.rawSessions.files.length, 28);
  for (const f of report.rawSessions.files) {
    assert.ok(f && f.includes('.ndjson'), `raw session file listed: ${f}`);
    // paths in the report are container-absolute (/results/...); on the host
    // they map to <ROOT>/results/...
    const base = path.basename(f);
    assert.ok(fs.existsSync(path.join(ROOT, 'results', 'navigation-agent-raw', base)), `raw session file exists: ${base}`);
  }
});
