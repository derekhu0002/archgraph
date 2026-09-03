'use strict';

// AT-2789-R1-01/02（WP2789 R-S1）：EA 同步桥环境对齐 + MCP 连通与位置不变性验证。
// AC-01：spawn MCP3.exe（stdio）→ tools/list 工具组 + 读工具冒烟返回真实内容 +
//         MCP_EA.log 本会话无 80070005/管道中断；环境不可用（EA 未运行 / add-in
//         管道不可用）时显式消息 skip 计通过（保障无 EA 环境基线不破）。
// AC-02（位置不变性）：记录元素 E 的 DiagramObject geometry → -enableEdit 仅改 Notes →
//         读回 geometry 逐字节相等 + -modifiedInfoPath 审计 CSV 记录。
//         安全门：仅在显式 --allow-scratch-write 且 EA 打开的项目位于 scratch 根下
//         （绝不位于仓库目录、绝不为 archgraph.feap）时执行；EA 生命周期归人类。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const DRIVER = path.join(ROOT, 'scripts', 'ea-sync-driver.js');
const { logHasSessionErrors } = require(DRIVER);

const READ_TOOLS = ['get_current_diagram', 'get_diagrams_information', 'find_elements_by_name', 'get_root_packages', 'get_elements_information'];
const WRITE_TOOLS = ['create_or_update_elements', 'create_or_update_connectors', 'create_or_update_diagram', 'place_elements_on_diagram'];
const DELETE_TOOLS = ['Model.Delete'].map((s) => s.toLowerCase());

function driver(args, timeoutMs = 300000) {
  const result = spawnSync(process.execPath, [DRIVER, ...args], { encoding: 'utf8', timeout: timeoutMs });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  return { result, parsed };
}

/**
 * 环境门：返回 { available, skipReason }。
 * EA 未运行 / 无 MCP3 / add-in 管道不可用 → 显式消息 skip 计通过。
 */
function envGate() {
  // --timeout 10：MCP3 的 -setTimeout 取小值，加快「管道不可用」判定的失败返回
  const { result, parsed } = driver(['env', '--timeout', '10'], 120000);
  if (!parsed) {
    return { available: false, skipReason: `驱动器 env 探测无输出（exit ${result.status}）：${(result.stderr || result.stdout || '').slice(0, 300)}` };
  }
  if (parsed.exitCode === 2) {
    return { available: false, skipReason: `EA MCP 环境缺失（${parsed.envStatus}）：EA 进程未运行或 MCP3.exe 不存在，跳过连通验证` };
  }
  if (parsed.exitCode === 3 || parsed.envStatus === 'ea-pipe-dead') {
    return { available: false, skipReason: `EA 在运行但 MCP add-in 管道不可用（${parsed.envStatus}）：${String(parsed.connectivity || '').slice(0, 200)}——请在 EA 中重新打开项目（或重启 EA）以重建 add-in 管道，再跑本用例`, env: parsed };
  }
  if (parsed.envStatus !== 'connected') {
    return { available: false, skipReason: `EA MCP 环境状态异常（${parsed.envStatus}）：${String(parsed.connectivity || '').slice(0, 200)}` };
  }
  return { available: true, env: parsed };
}

test('AT-2789-R1-01：MCP3 连通——工具清单（读/写组）+ 读工具冒烟 + 会话日志无 80070005/管道中断', (t) => {
  const gate = envGate();
  if (!gate.available) {
    t.skip(gate.skipReason);
    return;
  }

  // 1) 默认（只读）工具清单：含读工具组；无 -enableEdit 时不应出现写工具
  const ro = driver(['tools']);
  assert.equal(ro.result.status, 0, `tools 应成功：${(ro.result.stderr || '').slice(0, 300)}`);
  const roNames = ro.parsed.tools.map((tool) => tool.name);
  for (const name of READ_TOOLS) {
    assert.ok(roNames.includes(name), `只读模式工具清单应含 ${name}`);
  }
  for (const name of WRITE_TOOLS) {
    assert.ok(!roNames.includes(name), `只读模式不应暴露写工具 ${name}`);
  }

  // 2) -enableEdit 工具清单：出现写工具组；仍未开 -enableDelete → 不应出现删除类工具
  const rw = driver(['tools', '--enable-edit']);
  assert.equal(rw.result.status, 0, `tools --enable-edit 应成功：${(rw.result.stderr || '').slice(0, 300)}`);
  const rwNames = rw.parsed.tools.map((tool) => tool.name);
  for (const name of WRITE_TOOLS) {
    assert.ok(rwNames.includes(name), `enableEdit 模式工具清单应含 ${name}`);
  }
  for (const name of rwNames) {
    assert.ok(!DELETE_TOOLS.includes(name.toLowerCase()), `未开 -enableDelete 时不应暴露删除类工具：${name}`);
  }
  assert.ok(rw.parsed.toolCount > ro.parsed.toolCount, 'enableEdit 应解锁额外写工具');

  // 3) 读工具冒烟：返回 EA 中打开项目的真实内容
  const read = driver(['read', '--name', 'System'], 180000);
  assert.equal(read.result.status, 0, `read 冒烟应成功：${(read.result.stderr || '').slice(0, 300)}`);
  assert.equal(read.parsed.connectivity, 'ok', 'EA 连通性应为 ok');
  const rootPackages = read.parsed.calls.get_root_packages;
  assert.ok(rootPackages && rootPackages.ok, 'get_root_packages 应返回成功');
  assert.ok(rootPackages.text.length > 10, 'get_root_packages 应返回真实内容');
  const currentDiagram = read.parsed.calls.get_current_diagram;
  assert.ok(currentDiagram, 'get_current_diagram 应有结果（无打开的图时应返回空而非连接失败）');
  assert.ok(!/Failed to connect/.test(currentDiagram.text || ''), 'get_current_diagram 不应是连接失败');

  // 4) 会话日志无 80070005/管道中断（最近一次 Initialize 之后）
  const sessionErrors = logHasSessionErrors();
  assert.equal(sessionErrors.hasErrors, false, `本会话 MCP_EA.log 不应出现 80070005/管道中断（实际 ${sessionErrors.count} 处）`);
});

test('AT-2789-R1-02：位置不变性——仅改 Notes 后 DiagramObject geometry 逐字节不变 + 审计 CSV', (t) => {
  const gate = envGate();
  if (!gate.available) {
    t.skip(gate.skipReason);
    return;
  }

  // 安全门负例：无 --allow-scratch-write 必须被拒（退出码 4）
  const refused = driver(['probe-edit']);
  assert.equal(refused.result.status, 4, '缺少 --allow-scratch-write 必须被安全门拒绝');
  assert.match(refused.parsed.error, /--allow-scratch-write/, '拒绝消息应点名安全门①');

  // 正例：显式允许写 + EA 打开的项目在 scratch 根下
  const probe = driver(['probe-edit', '--allow-scratch-write'], 300000);
  if (probe.result.status === 4) {
    // 环境未就绪：EA 当前打开的不是 scratch 项目（安全门②拒绝）→ 显式消息 skip 计通过
    t.skip(`写探测环境未就绪，跳过位置不变性验证：${probe.parsed.error}${probe.parsed.gate ? `（EA 当前打开：${probe.parsed.gate.lastOpen || '未知'}）` : ''}。请把临时 scratch 副本（如 ${path.join(os.tmpdir(), 'ea-scratch', 'EA-model-template.feap')}）在 EA 中打开并展开任意图后重跑`);
    return;
  }
  if (probe.result.status === 3) {
    t.skip(`EA add-in 管道不可用，跳过位置不变性验证：${probe.parsed.error}`);
    return;
  }
  if (probe.result.status === 5) {
    t.skip(`EA 中无打开的图，跳过位置不变性验证：${probe.parsed.error}`);
    return;
  }
  assert.equal(probe.result.status, 0, `probe-edit 应成功：${JSON.stringify(probe.parsed).slice(0, 500)}`);

  // 核心断言：仅改 Notes → geometry 逐字节一致
  assert.ok(probe.parsed.elementID, '应定位到目标元素 E');
  assert.ok(probe.parsed.notesSet, '应写入 Notes 探针值');
  assert.equal(probe.parsed.geometryUnchanged, true, `元素 ${probe.parsed.elementID}（${probe.parsed.elementName}）的 DiagramObject geometry 在仅改 Notes 后必须逐字节不变；before=${probe.parsed.geometryBefore} after=${probe.parsed.geometryAfter}`);

  // 审计：-modifiedInfoPath CSV 应记录该变更
  assert.ok(probe.parsed.modifiedInfo, '应有 modifiedInfo 审计结果');
  assert.equal(probe.parsed.modifiedInfo.exists, true, `-modifiedInfoPath CSV 应存在：${probe.parsed.modifiedInfoPath}`);
  assert.ok(probe.parsed.modifiedInfo.mentionsChange, '审计 CSV 应提及本次变更（元素/工具名）');
});
