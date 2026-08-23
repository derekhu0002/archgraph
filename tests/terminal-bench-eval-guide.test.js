'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GUIDE = path.join(ROOT, 'docs', 'terminal-bench-eval-guide.md');

test('terminal-bench-eval-guide-ready: evaluation guide document exists with required sections', () => {
  // GIVEN 需要指导如何用 ARCHGRAPH 框架参加 Terminal-Bench 评测
  // WHEN 读者打开 docs/terminal-bench-eval-guide.md
  // THEN 文档包含：archgraph-eval 工程结构、Harbor agent 适配、多轮构建 harness、k=5 冒烟、全量评测、对照实验、上榜流程
  assert.ok(existsSync(GUIDE), 'guide doc should exist');
  const md = readFileSync(GUIDE, 'utf8');

  assert.match(md, /archgraph-eval/, 'doc should describe the archgraph-eval project structure');
  assert.match(md, /Harbor/, 'doc should describe the Harbor agent adapter');
  assert.match(md, /多轮构建/, 'doc should describe the multi-round harness build loop');
  assert.match(md, /k=5/, 'doc should describe the local k=5 smoke run');
  assert.match(md, /全量/, 'doc should describe running the full 89-task suite');
  assert.match(md, /对照实验/, 'doc should describe the baseline vs ARCHGRAPH comparison');
  assert.match(md, /上榜/, 'doc should describe the leaderboard submission flow');
});

test('terminal-bench-eval-guide-no-redeploy: guide states argo is user-level deployed', () => {
  // GIVEN argo 框架已部署在用户级（~/.argo 等）
  // WHEN 读者按指导搭建 archgraph-eval
  // THEN 指导明确说明无需重新部署 argo 工具链，只依赖用户级已部署的框架
  const md = readFileSync(GUIDE, 'utf8');

  assert.match(md, /用户级/, 'doc should mention user-level deployment');
  assert.match(md, /无需重新部署/, 'doc should state no redeployment is needed');
});
