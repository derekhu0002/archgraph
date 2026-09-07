'use strict';

// AT-2791-12（WP2791）：QEA 投影镜像（kg_sync_meta）存在时，EA 侧 export-to-kg.js
//   导出内容与 canonical SystemArchitecture.json 一致。
//
// 背景：MCP 写图 → JSON → syncGraphToQea 投影进 .qea。投影同时维护两层：
//   - kg_sync_meta = 无损 canonical 镜像（exportQeaToGraph 读取源，== JSON）；
//   - EA 可见对象模型 = 有损渲染（EA 重写 StyleEx 丢 schema_view_id、图 Notes 不保留…）。
// export-to-kg.js 修复后优先读投影镜像（kg_sync_meta），故投影 .qea 导出内容 == JSON。
//
// 前提（环境门，不满足则显式 skip 计通过）：
//   - EA 本机可用且非交互占用（run-headless 自动 -KillEA）
//   - 显式开启：$env:EA_RUN_HEADLESS = "1"
//   - 隔离副本源于 argo/defaults/EA-model-template.qea（EA16+ SQLite），扩展名保留
//
// 运行方式：
//   $env:EA_RUN_HEADLESS="1"
//   node --test tests/ea-export-mirror.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_QEA = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');
const TEMPLATE = fs.existsSync(TEMPLATE_QEA) ? TEMPLATE_QEA : null;
const GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const RUNNER = path.join(ROOT, 'eatool', 'EA-jsscript', 'headless', 'run-headless.ps1');
const qeaSync = require(path.join(ROOT, 'argo', 'scripts', 'ea-qea-sync-lib.js'));
const { compareRoundtrip, formatReport } = require(path.join(__dirname, '_ea-roundtrip-lib.js'));

function ps1(args) {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RUNNER, ...args], {
    encoding: 'utf8',
    timeout: 600000,
  });
}

function ps(json) {
  try { return JSON.parse(json); } catch { return null; }
}

test('ea-export-mirror (AT-2791-12): 投影 QEA（kg_sync_meta）经 export-to-kg.js 导出内容与 canonical JSON 一致', (t) => {
  // GIVEN EA 无头运行器 + 隔离 .qea 副本 + 真实图谱 + Node 投影模块
  // WHEN 副本经 fullProjection 投影（写 kg_sync_meta）→ 无头跑 export-to-kg.js 导出
  // THEN 导出内容与 SystemArchitecture.json 内容一致（compareRoundtrip equal=true）
  if (process.env.EA_RUN_HEADLESS !== '1') {
    t.skip('EA 无头回环未开启（需 $env:EA_RUN_HEADLESS=1 且 EA 可用/非交互占用）——显式 skip 计通过');
    return;
  }
  if (!TEMPLATE) { t.skip(`模板缺失，跳过：${TEMPLATE_QEA}`); return; }
  if (!fs.existsSync(GRAPH)) { t.skip(`图谱缺失，跳过：${GRAPH}`); return; }
  if (!fs.existsSync(RUNNER)) { t.skip(`无头运行器缺失，跳过：${RUNNER}`); return; }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-export-mirror-'));
  const qea = path.join(tmp, 'projected.qea');
  const exportJson = path.join(tmp, 'export.json');
  fs.copyFileSync(TEMPLATE, qea);

  try {
    // 1) 投影（Node fullProjection，写入 kg_sync_meta 无损镜像）
    const graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8').replace(/^\uFEFF/, ''));
    const proj = qeaSync.fullProjection(graph, qea, {});
    assert.ok(proj && proj.ok, `fullProjection 失败：${JSON.stringify(proj).slice(0, 400)}`);
    assert.ok(proj.verification && proj.verification.consistent, '投影后回环应一致');

    // 2) 无头 export-to-kg.js（镜像路径）
    const exp = ps1(['-Feap', qea, '-Mode', 'export', '-Output', exportJson, '-KillEA', '-TimeoutSec', '300']);
    const expJson = ps(exp.stdout);
    assert.ok(expJson && expJson.ok, `headless export 失败：${JSON.stringify(expJson || exp.stdout).slice(0, 500)}`);
    assert.ok(fs.existsSync(exportJson), '导出 JSON 应生成');

    // 3) 回环比较：导出内容 == canonical JSON
    const expDoc = JSON.parse(fs.readFileSync(exportJson, 'utf8'));
    const report = compareRoundtrip(graph, expDoc, {});
    const rendered = formatReport(report, 40);
    assert.ok(report.equal, `导出内容与 canonical 不一致：${rendered.text}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
