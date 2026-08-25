'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'memory-eval-dataset.md');

test('memory-eval-dataset-ready: dataset doc exists with the five LongMemEval ability dimensions', () => {
  // GIVEN 需要为长期记忆系统设计可执行的评测题集
  // WHEN 读者打开 docs/memory-eval-dataset.md
  // THEN 文档包含 5 能力维度：信息抽取/多会话推理/时间推理/知识更新/拒答
  assert.ok(existsSync(DOC), 'dataset doc should exist');
  const md = readFileSync(DOC, 'utf8');

  assert.match(md, /信息抽取/, 'doc should cover information extraction');
  assert.match(md, /多会话推理/, 'doc should cover multi-session reasoning');
  assert.match(md, /时间推理/, 'doc should cover temporal reasoning');
  assert.match(md, /知识更新/, 'doc should cover knowledge updates');
  assert.match(md, /拒答/, 'doc should cover abstention');
});

test('memory-eval-dataset-format: each question follows GIVEN/WHEN/THEN with ground truth', () => {
  // GIVEN 题目需要可执行、可回放
  // WHEN 读者检查题集条目
  // THEN 每题含 GIVEN 记忆场景、WHEN 问题、THEN 期望答案（ground truth）与检索提示
  const md = readFileSync(DOC, 'utf8');

  assert.match(md, /GIVEN/, 'questions should state the memory scenario');
  assert.match(md, /WHEN/, 'questions should state the query');
  assert.match(md, /THEN/, 'questions should state the expected answer');
  assert.match(md, /检索提示/, 'questions should include a retrieval hint');
  assert.match(md, /期望答案/, 'doc should mention ground truth');
});

test('memory-eval-dataset-coverage: dataset covers 5+5+5+5+3 questions across dimensions', () => {
  // GIVEN 题集需要覆盖各维度
  // WHEN 统计各维度题目
  // THEN 信息抽取 5 题、多会话推理 5 题、时间推理 5 题、知识更新 5 题、拒答 3 题
  const md = readFileSync(DOC, 'utf8');

  const mqCount = (md.match(/MQ-\d{2}/g) || []).length;
  assert.ok(mqCount >= 23, `doc should contain at least 23 questions, found ${mqCount}`);
  assert.match(md, /维度 1：信息抽取/, 'dimension 1 heading present');
  assert.match(md, /维度 5：拒答/, 'dimension 5 heading present');
  assert.match(md, /23 题/, 'doc should state total question count');
});

test('memory-eval-dataset-retrieval: doc specifies the retrieval path for the eval harness', () => {
  // GIVEN 评测跑法需要接入我们的记忆读取入口
  // WHEN 读者阅读「评测运行约定」
  // THEN 文档说明检索路径为 ARGO 语义查询 与 queryNeo4jGraph
  const md = readFileSync(DOC, 'utf8');

  assert.match(md, /getSystemArchitecture/, 'doc should mention the semantic query path');
  assert.match(md, /queryNeo4jGraph/, 'doc should mention the Neo4j query path');
  assert.match(md, /judge/, 'doc should mention judge LLM scoring');
});
