'use strict';

// AT-2786-01 / AT-2786-02（WP2786）：EA 本地 Web 服务纳入 npm 部署包并随
// install-argo.ps1（argo-deploy）后台启动。
// AT-2786-01：npm pack --dry-run 产物清单含服务脚本与 web 静态资源（含 vendor MaxGraph）。
// AT-2786-02：临时宿主 + 植入项目工作区 → 部署文件落 ArgoRoot、后台服务发现植入项目、
//              重复执行幂等（不重复拉起）、-SkipEaWeb 不启动后台进程；finally 清理进程。

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'install-argo.ps1');

function hostPaths(tmp) {
  return {
    argoRoot: path.join(tmp, '.argo'),
    skillsRoot: path.join(tmp, '.copilot', 'skills'),
    promptsRoot: path.join(tmp, 'Code', 'User', 'prompts'),
    mcpPath: path.join(tmp, 'vscode', 'mcp.json'),
    cursorSkillsRoot: path.join(tmp, '.cursor', 'skills'),
    cursorMcpPath: path.join(tmp, '.cursor', 'mcp.json'),
    cursorMcpBridgesRoot: path.join(tmp, '.cursor', 'mcp-bridges'),
    openCodeSkillsRoot: path.join(tmp, '.config', 'opencode', 'skills'),
    openCodeAgentsPath: path.join(tmp, '.config', 'opencode', 'AGENTS.md'),
    openCodeConfigPath: path.join(tmp, '.config', 'opencode', 'opencode.json'),
    copilotAgentsRoot: path.join(tmp, '.copilot', 'agents'),
    cursorAgentsRoot: path.join(tmp, '.cursor', 'agents'),
    cursorRulesRoot: path.join(tmp, '.cursor', 'rules'),
    openCodeAgentsRoot: path.join(tmp, '.config', 'opencode', 'agents'),
    pluginsRoot: path.join(tmp, '.argo', 'plugins'),
    dshHome: path.join(tmp, '.dsh'),
    openClawHome: path.join(tmp, '.openclaw'),
    openClawWorkspace: path.join(tmp, '.openclaw', 'workspace'),
  };
}

function buildInstallArgs(opts) {
  return [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT,
    '-ArgoRoot', opts.argoRoot,
    '-SkillsRoot', opts.skillsRoot,
    '-PromptsRoot', opts.promptsRoot,
    '-McpPath', opts.mcpPath,
    '-CursorSkillsRoot', opts.cursorSkillsRoot,
    '-CursorMcpPath', opts.cursorMcpPath,
    '-CursorMcpBridgesRoot', opts.cursorMcpBridgesRoot,
    '-CursorRulesRoot', opts.cursorRulesRoot,
    '-OpenCodeSkillsRoot', opts.openCodeSkillsRoot,
    '-OpenCodeAgentsPath', opts.openCodeAgentsPath,
    '-OpenCodeConfigPath', opts.openCodeConfigPath,
    '-CopilotAgentsRoot', opts.copilotAgentsRoot,
    '-CursorAgentsRoot', opts.cursorAgentsRoot,
    '-OpenCodeAgentsRoot', opts.openCodeAgentsRoot,
    '-PluginsRoot', opts.pluginsRoot,
    '-DshHome', opts.dshHome,
    '-OpenClawHome', opts.openClawHome,
    '-OpenClawWorkspace', opts.openClawWorkspace,
    '-SkipOpenClaw',
    '-SkipDeps',
    '-SkipEnv',
    '-EaWebPort', String(opts.eaWebPort),
    ...(opts.eaWebRoot ? ['-EaWebRoot', opts.eaWebRoot] : []),
    ...(opts.skipEaWeb ? ['-SkipEaWeb'] : []),
  ];
}

function runInstall(opts) {
  return spawnSync('powershell.exe', buildInstallArgs(opts), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
  });
}

// 植入最小合法图谱项目（discoverProjects 以 design/KG/SystemArchitecture.json 为 marker）。
function seedWorkspace(ws) {
  const graphDir = path.join(ws, 'proj', 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.writeFileSync(path.join(graphDir, 'SystemArchitecture.json'), JSON.stringify({
    name: 'DeployFixture',
    description: 'ea web deploy fixture',
    elements: [{ id: '1', name: 'A', type: 'Application Component' }],
    relationships: [],
    views: [{ view_id: '100', view_name: 'Main', included_elements: ['1'], included_relationships: [] }],
  }, null, 2));
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const tryPort = (attempt) => {
      if (attempt >= 20) {
        reject(new Error('no free port found'));
        return;
      }
      const port = 20000 + Math.floor(Math.random() * 10000);
      const server = net.createServer();
      server.once('error', () => tryPort(attempt + 1));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(port));
      });
    };
    tryPort(0);
  });
}

function portListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForProjects(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/projects`);
      if (res.status === 200) {
        return await res.json();
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`EA web service 未在 ${timeoutMs}ms 内就绪（端口 ${port}）：${lastError}`);
}

// 清理后台进程：找到监听端口的 PID 并连同进程树强杀。返回被杀 PID 列表。
function killPort(port) {
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
  const pids = new Set();
  for (const line of (out.stdout || '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5 && parts[0] === 'TCP' && parts[3] === 'LISTENING' && parts[1].endsWith(`:${port}`)) {
      pids.add(parts[4]);
    }
  }
  for (const pid of pids) {
    spawnSync('taskkill', ['/PID', pid, '/F', '/T'], { encoding: 'utf8' });
  }
  return [...pids];
}

test('AT-2786-01: npm pack --dry-run 清单包含服务脚本与 web 静态资源', () => {
  // GIVEN archgraph-argo 包定义（package.json files）
  // WHEN npm pack --dry-run
  // THEN 产物清单含服务脚本与 web/（含 vendor/maxgraph/maxgraph.js）
  const result = spawnSync('npm.cmd', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    timeout: 120000,
  });
  assert.equal(result.status, 0, `npm pack --dry-run failed: ${result.stderr}`);

  let files = [];
  try {
    const parsed = JSON.parse(result.stdout);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    files = (entry.files || []).map((f) => f.path.replace(/\\/g, '/'));
  } catch {
    files = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  assert.ok(files.length > 0, 'npm pack --dry-run 应返回文件清单');
  for (const required of [
    'scripts/ea-web-service.js',
    'scripts/ea-layout-store.js',
    'web/index.html',
    'web/app.js',
    'web/style.css',
    'web/vendor/maxgraph/maxgraph.js',
  ]) {
    assert.ok(files.includes(required), `产物清单应包含 ${required}`);
  }
});

test('AT-2786-02: 部署文件落 ArgoRoot、后台服务发现植入项目、重复执行幂等', async () => {
  // GIVEN 临时宿主环境与植入测试项目的临时工作区
  // WHEN 执行 install-argo.ps1（-EaWebRoot 工作区 -EaWebPort 随机端口）
  // THEN 服务文件部署到 ArgoRoot，后台服务发现植入项目；重复执行不重复拉起
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-web-deploy-'));
  const paths = hostPaths(tmp);
  const ws = path.join(tmp, 'workspace');
  seedWorkspace(ws);
  const port = await pickFreePort();
  try {
    const first = runInstall({ ...paths, eaWebPort: port, eaWebRoot: ws });
    assert.equal(first.status, 0, `install exited with ${first.status}: ${first.stderr}`);

    // ① 部署文件落位
    assert.ok(fs.existsSync(path.join(paths.argoRoot, 'scripts', 'ea-web-service.js')), 'ea-web-service.js 应部署');
    assert.ok(fs.existsSync(path.join(paths.argoRoot, 'scripts', 'ea-layout-store.js')), 'ea-layout-store.js 应部署');
    for (const rel of ['index.html', 'app.js', 'style.css', path.join('vendor', 'maxgraph', 'maxgraph.js')]) {
      assert.ok(fs.existsSync(path.join(paths.argoRoot, 'web', rel)), `web/${rel} 应部署`);
    }

    // ② 后台服务就绪且发现植入项目
    const body = await waitForProjects(port);
    assert.ok(body.projects.some((p) => p.name === 'proj'), '服务应发现植入项目');

    // ③ 同参重跑：幂等，不重复拉起
    const second = runInstall({ ...paths, eaWebPort: port, eaWebRoot: ws });
    assert.equal(second.status, 0, `re-install exited with ${second.status}: ${second.stderr}`);
    assert.match(second.stdout, /already listening/, '重跑应检测到端口已监听并跳过启动');
    const body2 = await waitForProjects(port, 5000);
    assert.ok(body2.projects.some((p) => p.name === 'proj'), '重跑后服务仍可用');
  } finally {
    killPort(port);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(await portListening(port), false, '清理后不应有残留监听进程');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AT-2786-02b: -SkipEaWeb 部署文件但不启动后台进程', async () => {
  // GIVEN 临时宿主环境与植入测试项目的临时工作区
  // WHEN 执行 install-argo.ps1 -SkipEaWeb（新随机端口）
  // THEN 部署文件仍落位，但该端口无后台监听
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-web-deploy-skip-'));
  const paths = hostPaths(tmp);
  const ws = path.join(tmp, 'workspace');
  seedWorkspace(ws);
  const port = await pickFreePort();
  try {
    const result = runInstall({ ...paths, eaWebPort: port, eaWebRoot: ws, skipEaWeb: true });
    assert.equal(result.status, 0, `install exited with ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /skipped \(-SkipEaWeb\)/, '应打印跳过启动');
    assert.ok(fs.existsSync(path.join(paths.argoRoot, 'scripts', 'ea-web-service.js')), '文件仍应部署');
    assert.ok(fs.existsSync(path.join(paths.argoRoot, 'web', 'index.html')), 'web 静态资源仍应部署');
    assert.equal(await portListening(port), false, '-SkipEaWeb 不应启动后台服务');
  } finally {
    killPort(port);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
