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

test('memory-eval-run-baseline: harness evaluates all 31 questions and reports metrics', () => {
  // GIVEN 已具备 31 题评测题集（23 基础 + 5 多跳召回 + 3 两步回忆）与 ARGO MCP 读路径
  // WHEN 运行 scripts/memory-eval-run.js --json
  // THEN 31 题全部评估（无 TOOL_ERROR 空判），报告含 7 维度/整体/拒答准确率、平均时延与成本统计
  const summary = runRunner();

  assert.equal(summary.totalQuestions, 31, 'should evaluate exactly 31 questions');
  assert.equal(summary.failed, 0, 'no question should fail with a TOOL_ERROR');
  assert.equal(summary.dimStats.length, 7, 'should report 7 dimensions');
  assert.deepEqual(
    summary.dimStats.map(stat => stat.dimension),
    ['信息抽取', '多会话推理', '时间推理', '知识更新', '拒答', '多跳召回', '两步回忆'],
  );
  assert.equal(typeof summary.overallAccuracy, 'number');
  assert.ok(summary.avgLatencyMs >= 0, 'avg latency should be non-negative');
  assert.ok(summary.abstention, 'should report abstention accuracy');
  assert.ok(existsSync(REPORT), 'runner should write the report file');
  const report = JSON.parse(readFileSync(REPORT, 'utf8'));
  assert.equal(report.results.length, 31, 'report should contain 31 evaluated results');
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
  // GIVEN 2026-08-26 实测基线 = 28/28（100%），平均时延 ~6.8ms
  // WHEN 运行评测 harness
  // THEN 整体准确率不低于 0.85（基线回归阈值；跌破即提示记忆读取退化）
  const summary = runRunner();
  assert.ok(
    summary.overallAccuracy >= 0.85,
    `overall accuracy ${summary.overallAccuracy} dropped below the 0.85 baseline floor`,
  );
});

test('memory-eval-run-multihop: multi-hop recall questions traverse topology links and pass', () => {
  // GIVEN 多跳召回题（MH-01..05）需沿图谱拓扑内链逐跳检索（pick 由上一步结果派生参数）
  // WHEN 运行评测 harness
  // THEN MH-01..05 全部判定通过（无 TOOL_ERROR / 无缺失）
  const report = JSON.parse(readFileSync(REPORT, 'utf8'));
  const mh = report.results.filter(result => result.id.startsWith('MH-'));
  assert.equal(mh.length, 5, 'should contain 5 multi-hop recall questions');
  for (const result of mh) {
    assert.equal(result.pass, true, `${result.id} should pass: ${result.reason}`);
  }
});

test('memory-eval-run-cost: cost stats report context compression and token cost', () => {
  // GIVEN LLM-Wiki 口径：高语义密度预压缩让下游 context 减 70~90%、token 成本极低
  // WHEN 运行评测 harness（--json）
  // THEN 报告含 costStats：压缩率 >= 0.7，平均检索 token 成本远低于原始语料（低成本）
  const summary = runRunner();
  assert.ok(summary.costStats, 'report should include costStats');
  assert.ok(summary.costStats.rawCorpusTokens > 0, 'raw corpus tokens should be measurable');
  assert.ok(
    summary.costStats.avgCompressionRatio >= 0.7,
    `compression ${summary.costStats.avgCompressionRatio} should be >= 0.7`,
  );
  assert.ok(
    summary.costStats.avgRetrievedTokens < 15000,
    `avg retrieved tokens ${summary.costStats.avgRetrievedTokens} should be < 15000`,
  );
});
