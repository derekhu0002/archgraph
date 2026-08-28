'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const NAV_RUN = path.join(ROOT, 'scripts', 'navigation-eval-run.js');

// External-view acceptance tests for the navigation-capability eval harness:
// running it must evaluate all 20 navigation questions across the 4 dimensions
// and reach the full baseline (navigation is the "read well" core of the map).

test('AT navigation-eval-run: harness runs 20/20 with 4 dimensions', () => {
  // GIVEN the navigation eval harness
  assert.ok(fs.existsSync(NAV_RUN), 'navigation-eval-run.js must exist');
  // WHEN it runs with --json
  const r = spawnSync(process.execPath, [NAV_RUN, '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  // THEN it exits 0 and reports 20/20 overall plus per-dimension 5/5
  assert.equal(r.status, 0, `exit should be 0, stderr: ${String(r.stderr || '').slice(0, 500)}`);
  const lines = String(r.stdout || '').split('\n').filter(l => l.trim().startsWith('{'));
  const summary = JSON.parse(lines[lines.length - 1]);
  assert.equal(summary.overall.correct, 20);
  assert.equal(summary.overall.total, 20);
  for (const dim of ['定位', '可达', '视角切换', '边界内导航']) {
    assert.equal(summary.byDimension[dim].correct, 5, `${dim} should be 5/5`);
    assert.equal(summary.byDimension[dim].total, 5);
  }
});

test('AT navigation-eval-run: report file is written', () => {
  // GIVEN a prior run produced results/navigation-eval-report.json
  const reportPath = path.join(ROOT, 'results', 'navigation-eval-report.json');
  assert.ok(fs.existsSync(reportPath), 'report must be written');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  // THEN it has dataset metadata and per-question results
  assert.match(report.dataset, /navigation|导航/i);
  assert.equal(report.perQuestion.length, 20);
  assert.equal(report.overall.correct, 20);
});
