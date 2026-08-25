'use strict';

const { spawnSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'memory-eval-run.js');
const REPORT = path.join(ROOT, 'results', 'memory-eval-report.json');

function runRunner() {
  const result = spawnSync(process.execPath, [RUNNER, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ARGO_REPO_ROOT: ROOT },
  });
  assert.equal(result.status, 0, `runner exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

test('memory-eval-run-baseline: harness evaluates all 23 questions and reports metrics', () => {
  // GIVEN 已具备 23 题评测题集与 ARGO MCP 读路径
  // WHEN 运行 scripts/memory-eval-run.js --json
  // THEN 23 题全部评估（无 TOOL_ERROR 空判），报告含 5 维度/整体/拒答准确率与平均时延
  const summary = runRunner();

  assert.equal(summary.totalQuestions, 23, 'should evaluate exactly 23 questions');
  assert.equal(summary.failed, 0, 'no question should fail with a TOOL_ERROR');
  assert.equal(summary.dimStats.length, 5, 'should report 5 dimensions');
  assert.deepEqual(
    summary.dimStats.map(stat => stat.dimension),
    ['信息抽取', '多会话推理', '时间推理', '知识更新', '拒答'],
  );
  assert.equal(typeof summary.overallAccuracy, 'number');
  assert.ok(summary.avgLatencyMs >= 0, 'avg latency should be non-negative');
  assert.ok(summary.abstention, 'should report abstention accuracy');
  assert.ok(existsSync(REPORT), 'runner should write the report file');
  const report = JSON.parse(readFileSync(REPORT, 'utf8'));
  assert.equal(report.results.length, 23, 'report should contain 23 evaluated results');
});

test('memory-eval-run-fact: base fact question MQ-01 (项目总管) passes', () => {
  // GIVEN 项目总管是图谱中的 Business Actor
  // WHEN 运行评测 harness
  // THEN MQ-01 判定通过（取回 project-overseer-001「项目总管」）
  const report = JSON.parse(readFileSync(REPORT, 'utf8'));
  const mq01 = report.results.find(result => result.id === 'MQ-01');
  assert.ok(mq01, 'report should contain MQ-01');
  assert.equal(mq01.pass, true);
});

test('memory-eval-run-baseline-floor: overall accuracy meets the recorded baseline floor', () => {
  // GIVEN 2026-08-25 实测基线 = 23/23（100%），平均时延 5.7ms
  // WHEN 运行评测 harness
  // THEN 整体准确率不低于 0.85（基线回归阈值；跌破即提示记忆读取退化）
  const summary = runRunner();
  assert.ok(
    summary.overallAccuracy >= 0.85,
    `overall accuracy ${summary.overallAccuracy} dropped below the 0.85 baseline floor`,
  );
});
