'use strict';

// AT-2100-OPT-05（WP2100）：无头运行器在隔离 COM scratch 副本上编排
//   import-from-kg.js（SQL 通道）→ export-to-kg.js → 回环比较器 → 幂等复查。
//
// 前提（环境门，不满足则显式 skip 计通过）：
//   - EA 本机可用且非交互占用（测试前应无 EA 实例 / 或由 run-headless 自动 -KillEA）
//   - 显式开启：$env:EA_RUN_HEADLESS = "1"（默认关闭，避免在无 EA/交互占用时挂起）
//   - 隔离副本必须源于 argo/defaults/EA-model-template.qea（优先，EA16+ SQLite）或 .feap（回退），扩展名保留
//
// 运行方式：
//   $env:EA_RUN_HEADLESS="1"
//   node --test tests/ea-headless-roundtrip.test.js
//
// 说明：真实 EA Repository.Execute 核心表写入在部分环境会阻塞（见交付报告的环境卡点），
// 该门控 + skip 语义保证本用例不会在无头不可用环境挂起 CI。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_QEA = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');
const TEMPLATE_FEAP = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.feap');
const TEMPLATE = fs.existsSync(TEMPLATE_QEA) ? TEMPLATE_QEA : TEMPLATE_FEAP;
const TEMPLATE_EXT = TEMPLATE.endsWith('.qea') ? '.qea' : '.feap'; // EA 按扩展名识别文件库类型
const GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const RUNNER = path.join(ROOT, 'eatool', 'EA-jsscript', 'headless', 'run-headless.ps1');
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

test('ea-headless-roundtrip (AT-2100-OPT-05): 隔离副本 import→export→比较→幂等复查', (t) => {
  // GIVEN EA 无头运行器 + 隔离 .feap 副本 + 真实图谱
  // WHEN 副本上依次跑 import（SQL 通道）→ export → 回环比较器比较 → 再 import 复查幂等
  // THEN 导出与源图谱内容一致（忽略顺序）；重复导入无重复行
  if (process.env.EA_RUN_HEADLESS !== '1') {
    t.skip('EA 无头回环未开启（需 $env:EA_RUN_HEADLESS=1 且 EA 可用/非交互占用）——显式 skip 计通过');
    return;
  }
  if (!fs.existsSync(TEMPLATE)) { t.skip(`模板缺失，跳过：${TEMPLATE}`); return; }
  if (!fs.existsSync(RUNNER)) { t.skip(`无头运行器缺失，跳过：${RUNNER}`); return; }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-headless-rt-'));
  const feap = path.join(tmp, 'isolated' + TEMPLATE_EXT);
  const exportJson = path.join(tmp, 'export.json');
  const responseFile = path.join(tmp, 'responses.txt'); // 删除确认：默认跳过删除
  fs.copyFileSync(TEMPLATE, feap);
  fs.writeFileSync(responseFile, '');

  try {
    // 1) import（SQL 通道）——首次
    const imp1 = ps1(['-Feap', feap, '-Mode', 'import', '-Graph', GRAPH, '-KillEA', '-TimeoutSec', '300', '-Response', responseFile]);
    const imp1Json = ps(imp1.stdout);
    assert.ok(imp1Json && imp1Json.ok, `headless import #1 失败：${JSON.stringify(imp1Json || imp1.stdout).slice(0, 500)}`);

    // 2) export
    const exp = ps1(['-Feap', feap, '-Mode', 'export', '-Output', exportJson, '-KillEA', '-TimeoutSec', '300']);
    const expJson = ps(exp.stdout);
    assert.ok(expJson && expJson.ok, `headless export 失败：${JSON.stringify(expJson || exp.stdout).slice(0, 500)}`);
    assert.ok(fs.existsSync(exportJson), '导出 JSON 应生成');

    // 3) 回环比较
    const origDoc = JSON.parse(fs.readFileSync(GRAPH, 'utf8').replace(/^\uFEFF/, ''));
    const expDoc = JSON.parse(fs.readFileSync(exportJson, 'utf8'));
    const report = compareRoundtrip(origDoc, expDoc, { ignoreOrigOnly: ['status'] });
    const rendered = formatReport(report, 40);
    assert.ok(report.equal, `回环内容不一致：${rendered.text}`);

    // 4) 幂等复查：再次 import 应全为 updated，added=0（无重复行）
    const imp2 = ps1(['-Feap', feap, '-Mode', 'import', '-Graph', GRAPH, '-KillEA', '-TimeoutSec', '300', '-Response', responseFile]);
    const imp2Json = ps(imp2.stdout);
    assert.ok(imp2Json && imp2Json.ok, `headless import #2 失败：${JSON.stringify(imp2Json || imp2.stdout).slice(0, 500)}`);
    const log2 = imp2Json.log || '';
    assert.match(log2, /Elements added: 0/, `重复导入元素不应新增：${log2.slice(-800)}`);
    assert.match(log2, /Relationships added: 0/, `重复导入关系不应新增：${log2.slice(-800)}`);
    assert.match(log2, /Views added: 0/, `重复导入视图不应新增：${log2.slice(-800)}`);
  } finally {
    // 清理：测试自己拉起的 EA/cscript 进程由 run-headless 内已处理；此处兜底清理自身副本
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
