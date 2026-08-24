'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'memory-eval-benchmarks.md');

test('memory-eval-benchmarks-ready: research doc exists with the three industry benchmarks', () => {
  // GIVEN 需要为长期记忆系统确立业界公认的评测基线
  // WHEN 读者打开 docs/memory-eval-benchmarks.md
  // THEN 文档包含三大基准 LongMemEval / LOCOMO / BEAM
  assert.ok(existsSync(DOC), 'research doc should exist');
  const md = readFileSync(DOC, 'utf8');

  assert.match(md, /LongMemEval/, 'doc should mention LongMemEval');
  assert.match(md, /LOCOMO/, 'doc should mention LOCOMO');
  assert.match(md, /BEAM/, 'doc should mention BEAM');
});

test('memory-eval-benchmarks-pipeline: doc describes Ingest→Search→Evaluate pipeline and core metrics', () => {
  // GIVEN 需要了解公认的评测方法与指标
  // WHEN 读者阅读 docs/memory-eval-benchmarks.md 的第 3 节
  // THEN 文档包含 Ingest→Search→Evaluate 流水线与核心指标（准确率/记忆召回/top-k/token 成本/时延）
  const md = readFileSync(DOC, 'utf8');

  assert.match(md, /Ingest/, 'doc should describe the ingest stage');
  assert.match(md, /Search/, 'doc should describe the search stage');
  assert.match(md, /Evaluate/, 'doc should describe the evaluate stage');
  assert.match(md, /记忆召回/, 'doc should mention memory recall');
  assert.match(md, /top-k/, 'doc should mention top-k retrieval');
  assert.match(md, /token/, 'doc should mention token cost');
  assert.match(md, /时延/, 'doc should mention latency');
});

test('memory-eval-benchmarks-rag-metrics: doc lists RAG-level retrieval metrics', () => {
  // GIVEN 需要精确定位检索环节的瓶颈
  // WHEN 读者阅读 docs/memory-eval-benchmarks.md 的第 4 节
  // THEN 文档包含 MRR 与 Hit Rate@K 等 RAG 底层指标
  const md = readFileSync(DOC, 'utf8');

  assert.match(md, /MRR/, 'doc should mention MRR');
  assert.match(md, /Hit Rate@K/, 'doc should mention Hit Rate@K');
});

test('memory-eval-benchmarks-implication: doc explains implications for ArchGraph', () => {
  // GIVEN 需要把业界基线落到 ArchGraph 自身
  // WHEN 读者阅读 docs/memory-eval-benchmarks.md 的第 5 节
  // THEN 文档包含对 ArchGraph 的意义与复用策略（借题不借后端、LTM 摄入、RAG 底层指标、诚实边界）
  const md = readFileSync(DOC, 'utf8');

  assert.match(md, /ArchGraph/, 'doc should mention ArchGraph');
  assert.match(md, /借题不借后端/, 'doc should describe the reuse strategy');
  assert.match(md, /LTM/, 'doc should mention our LTM as ingest');
});
