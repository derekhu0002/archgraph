'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, statSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX = path.join(ROOT, 'sandbox');
const DOCKERFILE = path.join(SANDBOX, 'Dockerfile');
const ENTRYPOINT = path.join(SANDBOX, 'entrypoint.sh');
const SMOKE = path.join(SANDBOX, 'smoke.js');
const ORCH = path.join(ROOT, 'scripts', 'sandbox-test.js');

test('sandbox-framework-artifacts: sandbox env files exist (Dockerfile/entrypoint/smoke/orchestrator)', () => {
  // GIVEN 需要为整套 ArchGraph 框架建一个隔离测试环境
  // WHEN 检查 sandbox/ 与 scripts/sandbox-test.js
  // THEN Dockerfile、entrypoint.sh、smoke.js、scripts/sandbox-test.js 均存在
  for (const f of [DOCKERFILE, ENTRYPOINT, SMOKE, ORCH]) {
    assert.ok(existsSync(f), `should exist: ${f}`);
  }
  const df = readFileSync(DOCKERFILE, 'utf8');
  assert.match(df, /FROM \$\{BASE_IMAGE\}/, 'Dockerfile bases on the configurable BASE_IMAGE');
  assert.match(df, /BASE_IMAGE=node:/, 'Dockerfile default base is a node image');
  assert.match(df, /pwsh/, 'Dockerfile installs PowerShell Core (pwsh) for argo-deploy');
  const ep = readFileSync(ENTRYPOINT, 'utf8');
  assert.match(ep, /npm install --no-audit --no-fund/, 'entrypoint installs the tarball like a user');
  assert.match(ep, /npx --no-install argo-deploy/, 'entrypoint deploys via npx argo-deploy');
  assert.match(ep, /USERPROFILE=.*\/root/, 'entrypoint pins USERPROFILE to the container HOME');
  assert.doesNotMatch(ep, /\/fixture\/|cp \$FIXTURE/, 'entrypoint must not copy a production fixture graph');
});

test('sandbox-framework-isolation: deploy targets stay inside the container HOME', () => {
  // GIVEN 用户担心沙箱改到本机配置
  // WHEN 检查 entrypoint.sh 与 smoke.js 的部署根
  // THEN 所有部署根都位于 /root 下，且不使用宿主用户目录/APPDATA 路径
  const ep = readFileSync(ENTRYPOINT, 'utf8');
  const roots = ['/root/.argo', '/root/.cursor', '/root/.config/opencode', '/root/.copilot', '/root/prompts'];
  for (const r of roots) {
    assert.ok(ep.includes(`-ArgoRoot /root/.argo`) || ep.includes(r) || ep.includes(r.replace('/root', '/root')), `deploy root should be container-local: ${r}`);
  }
  assert.doesNotMatch(ep, /AppData|Users\\/, 'must not reference host user-dir paths');
});

test('sandbox-framework-no-publish: orchestrator uses npm pack, never npm publish', () => {
  // GIVEN 不允许自动 npm publish
  // WHEN 检查 scripts/sandbox-test.js
  // THEN 使用 npm pack 生成本地 tarball，且不含 npm publish
  const orc = readFileSync(ORCH, 'utf8');
  assert.match(orc, /npm.*pack/, 'orchestrator should npm pack');
  assert.doesNotMatch(orc, /\['publish'\]/, 'orchestrator must never invoke npm publish');
  assert.match(orc, /docker.*build/, 'orchestrator should docker build');
  assert.match(orc, /docker.*run/, 'orchestrator should docker run the sandbox');
});

test('sandbox-framework-levelb: Level B full-capability checks (Neo4j + embedding) are wired', () => {
  // GIVEN 需要验证框架全能力（语义检索 + Neo4j 投影查询）
  // WHEN 检查 sandbox/smoke.js 与 scripts/sandbox-test.js
  // THEN smoke 加载挂载的 argo/.env、把 Neo4j 指向 host.docker.internal、使用
  //      queryNeo4jGraph 与 getSystemArchitecture 语义检索；编排器在有 argo/.env 时挂载之
  const smoke = readFileSync(SMOKE, 'utf8');
  assert.match(smoke, /\/env\/argo\.env/, 'smoke should load the mounted argo/.env');
  assert.match(smoke, /host\.docker\.internal/, 'smoke should point Neo4j at host.docker.internal');
  assert.match(smoke, /ARGO_NEO4J_DATABASE/, 'smoke should pin an isolated Neo4j database');
  assert.match(smoke, /queryNeo4jGraph/, 'smoke should exercise queryNeo4jGraph');
  assert.match(smoke, /getSystemArchitecture/, 'smoke should exercise semantic getSystemArchitecture');
  assert.match(smoke, /initializeWorkspace/, 'smoke should generate the initial graph via argo init');
  const orc = readFileSync(ORCH, 'utf8');
  assert.match(orc, /argo.*\.env/, 'orchestrator should mount argo/.env when present');
});

test('sandbox-framework-levelc: full-stack OpenCode agent eval (agent -> ARGO MCP) is wired', () => {
  // GIVEN 测试对象应为运行在 OpenCode 上的 Agent，由 Agent 调沙箱内 ARGO MCP
  // WHEN 检查 sandbox/smoke.js 与 Dockerfile
  // THEN smoke 安装 opencode、配置阿里 compatible-mode provider（ali-dashscope）、
  //      用 opencode run headless 驱动 Agent，并断言 Agent 用了 argo 工具且答对
  const df = readFileSync(DOCKERFILE, 'utf8');
  assert.match(df, /opencode-ai/, 'Dockerfile should install the OpenCode CLI');
  const smoke = readFileSync(SMOKE, 'utf8');
  assert.match(smoke, /opencode.*run/, 'smoke should drive the OpenCode agent headlessly');
  assert.match(smoke, /ali-dashscope/, 'smoke should configure the Ali DashScope provider');
  assert.match(smoke, /openai-compatible/, 'smoke should use the openai-compatible provider adapter');
  assert.match(smoke, /toolUsed.*answered|c: opencode agent/, 'smoke should assert agent tool usage and answer');
});

test('sandbox-framework-check: orchestrator --check reports docker availability', () => {
  // GIVEN 需要确认宿主能跑 Docker 沙箱
  // WHEN 运行 node scripts/sandbox-test.js --check
  // THEN 输出 JSON（docker 字段为版本字符串或 null），退出码 0
  const r = spawnSync(process.execPath, [ORCH, '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `--check exited ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim());
  assert.ok('docker' in out, 'check output should include docker field');
  assert.ok(typeof out.docker === 'string' || out.docker === null, 'docker field should be a string or null');
});
