'use strict';
/**
 * In-container framework smoke test. Runs AFTER `npx argo-deploy` against the
 * package installed from the local tarball (simulating a real user install of
 * `archgraph-argo`). Verifies:
 *   1. deployed artifacts (core toolchain + skills/agents/rules/MCP for the
 *      Copilot / Cursor / OpenCode harnesses),
 *   2. MCP registration points at the installed argo server,
 *   3. the installed ARGO MCP server actually reads a graph, answers a focused
 *      context query, and validates the graph.
 *   Level B (full capability, when /env/argo.env is mounted):
 *   4. queryNeo4jGraph against the real Neo4j projection,
 *   5. getSystemArchitecture semantic retrieval against the real embedding provider.
 * Writes /results/sandbox-report.json (mounted to the host results dir).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.ARGO_REPO_ROOT = process.env.ARGO_REPO_ROOT || '/workspace';
const HOME = process.env.USERPROFILE || process.env.HOME || '/root';
const WORKSPACE = process.env.ARGO_REPO_ROOT;
const PACKAGE = '/tmp/install/node_modules/archgraph-argo';
const REPORT = process.env.REPORT_PATH || '/results/sandbox-report.json';
const ENV_FILE = process.env.ENV_FILE || '/env/argo.env';

// Level B: 加载宿主 argo/.env（挂载于 /env/argo.env）——真实 Embedding + Neo4j 参数。
// 容器内 127.0.0.1 是容器自身回环，Neo4j 必须经 host.docker.internal 访问；
// 沙箱使用独立的 Neo4j 数据库（ARGO_NEO4J_DATABASE=sandbox），与生产 archgraph 库隔离。
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k) process.env[k] = v;
  }
}
loadEnvFile(ENV_FILE);
if (!process.env.ARGO_NEO4J_DATABASE) process.env.ARGO_NEO4J_DATABASE = 'sandbox';
const neo4jUrl = (process.env.ARGO_NEO4J_DATABASE_URL || process.env.ARGO_NEO4J_URI || 'neo4j://host.docker.internal:7687')
  .replace('127.0.0.1', 'host.docker.internal')
  .replace('localhost', 'host.docker.internal');
process.env.ARGO_NEO4J_DATABASE_URL = neo4jUrl;
// 注意：ARGO_NEO4J_URI 是框架拒绝的 legacy 别名（rejectLegacyNeo4jEnvironment），只设批准键 DATABASE_URL。

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail) });
}
function rel(p) { return path.relative(HOME, p); }

async function runMcp() {
  const { callTool } = require(path.join(PACKAGE, 'argo/scripts/argo-mcp-server.js'));
  // 0) argo init：对空工作区调用 initializeWorkspace，从部署的 defaults/ 生成初始图谱
  //    （2 元素 / 1 关系 / 4 视图的初始模板）——验证真实新用户的初始化流程。
  try {
    const init = await callTool('initializeWorkspace', { workspaceRoot: WORKSPACE }, null, undefined);
    const text = (init && init.content && init.content[0] && init.content[0].text) || JSON.stringify(init);
    let payload = init;
    try { payload = JSON.parse(text); } catch (_) { /* keep raw */ }
    const created = ((payload && payload.createdFiles) || []).join(',');
    check(
      'init: initializeWorkspace generates initial graph',
      created.includes('SystemArchitecture.json'),
      text.replace(/\s+/g, ' ').slice(0, 200),
    );
  } catch (e) { check('init: initializeWorkspace generates initial graph', false, e.message); }

  try {
    const r1 = await callTool('getArchitectureViewContext', { view_id: '174' }, null, undefined);
    check(
      'mcp: getArchitectureViewContext(174)',
      r1 && r1.status === 'passed' && r1.view && r1.view.view_id === '174',
      (r1 && r1.status) || 'no status',
    );
  } catch (e) { check('mcp: getArchitectureViewContext(174)', false, e.message); }

  try {
    const r2 = await callTool('getIntentElementContext', { elementId: '1249' }, null, undefined);
    check(
      'mcp: getIntentElementContext(1249)',
      r2 && r2.status === 'passed' && r2.focusElementId === '1249',
      (r2 && r2.status) || 'no status',
    );
  } catch (e) { check('mcp: getIntentElementContext(1249)', false, e.message); }

  // validator 工具返回 { content: [{ type:'text', text: JSON }], isError } — status 在 text 里。
  try {
    const r3 = await callTool('validateSystemArchitecture', { workspaceRoot: WORKSPACE }, null, undefined);
    const payload = JSON.parse((r3 && r3.content && r3.content[0] && r3.content[0].text) || '{}');
    check(
      'mcp: validateSystemArchitecture',
      payload.status === 'passed',
      `${payload.status || 'no-status'} ${(payload.stderr || '').trim()}`.trim(),
    );
  } catch (e) { check('mcp: validateSystemArchitecture', false, e.message); }

  // ── Level B：全能力（真实 Neo4j 投影查询 + 真实 Embedding 语义检索）──
  // 框架的 recoverNeo4jSyncIfNeeded 靠 canonical digest 判定是否重建投影，不会自动建库；
  // 沙箱用独立库（ARGO_NEO4J_DATABASE=sandbox），须先显式跑一次框架自带 sync 建库+投影。
  let syncOk = false;
  let syncDetail = 'no sync';
  try {
    const syncScript = path.join(HOME, '.argo/scripts/syncSystemArchitectureToNeo4j.js');
    if (fs.existsSync(syncScript)) {
      const s = spawnSync(process.execPath, [syncScript, '--database', process.env.ARGO_NEO4J_DATABASE || 'sandbox'], {
        env: { ...process.env, ARGO_REPO_ROOT: WORKSPACE },
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      const out = String(s.stdout || '');
      const err = String(s.stderr || '').replace(/\s+/g, ' ').slice(0, 200);
      syncOk = s.status === 0 && out.includes('"matches": true');
      syncDetail = `exit=${s.status} ${err || out.replace(/\s+/g, ' ').slice(0, 140)}`;
    } else {
      syncDetail = 'sync script not found under ~/.argo/scripts';
    }
  } catch (e) { syncDetail = e.message; }
  check('b: syncSystemArchitectureToNeo4j (sandbox db)', syncOk, syncDetail);

  // 初始图谱 = 2 元素（1240 Application Cooperation Viewpoint / 1249 Implementation
  // and Migration Viewpoint），无 Business Actor——Level B 断言按初始图谱内容设计。
  try {
    const q = await callTool('queryNeo4jGraph', {
      cypher: "MATCH (e:Element {graphKey: $graphKey}) RETURN e.id, e.name ORDER BY e.id",
      workspaceRoot: WORKSPACE,
    }, null, undefined);
    const recs = (q && q.records) || [];
    const blob = JSON.stringify(recs);
    check('b: queryNeo4jGraph lists initial-graph elements', blob.includes('1249') && blob.includes('1240'), `records=${recs.length} ${blob.slice(0, 160)}`);
  } catch (e) { check('b: queryNeo4jGraph lists initial-graph elements', false, e.message); }

  try {
    const s = await callTool('getSystemArchitecture', {
      query: { purpose: 'audit', intent: 'Implementation and Migration Viewpoint 与 Application Cooperation Viewpoint', subject: '1249' },
      workspaceRoot: WORKSPACE,
    }, null, undefined);
    const elems = (s && s.document && s.document.elements) || [];
    const blob = JSON.stringify(elems);
    check(
      'b: getSystemArchitecture semantic returns hits',
      elems.some(el => el && el.id === '1249'),
      `elements=${elems.length} ${blob.slice(0, 160)}`,
    );
  } catch (e) { check('b: getSystemArchitecture semantic returns hits', false, e.message); }

  // ── Level C：全栈 Agent 评测（OpenCode CLI -> Agent -> 沙箱内 ARGO MCP）──
  // 用 OpenCode 的 headless `run` 与 Agent 对话；Agent 通过 install-argo.ps1 注册进
  // opencode.json 的 argo MCP（+ 部署的 AGENTS.md 规则/技能）读取记忆并作答。
  // 测试对象 = Agent 行为（准确性），而非直接调 MCP 接口。
  try {
    const oc = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
    check('c: opencode installed', oc.status === 0, String(oc.stdout || oc.stderr).trim());
  } catch (e) { check('c: opencode installed', false, e.message); }

  // 模型 provider：问答用 DeepSeek（embedding 仍用 QWEN 的 ARGO_EMBEDDING_*，互不影响）。
  process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  process.env.OPENCODE_MODEL = process.env.OPENCODE_MODEL || `deepseek-sandbox/${process.env.DEEPSEEK_MODEL || 'deepseek-chat'}`;

  // 模型 provider：DeepSeek 写成 OpenCode 自定义 provider（@ai-sdk/openai-compatible）。
  // embedding（ARGO_EMBEDDING_*/QWEN_KEY）保持不变，只换问答模型。
  // 严格对照（mode）：不同会话只看得到自己的记忆后端——mode='argo' 的 A 组会话只挂
  // argo MCP（清掉 lightrag），mode='lightrag' 的 B 组会话只挂 lightrag MCP（清掉 argo）；
  // 回读校验断言 opencode.json 里「只剩对应的那一个 MCP」，保证唯一变量=记忆后端。
  function configureOpenCodeModel(mode) {
    const configPath = path.join(HOME, '.config/opencode/opencode.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const baseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    if (!baseURL || !process.env.DEEPSEEK_API_KEY) return false;
    cfg.provider = cfg.provider || {};
    // 自定义 provider 命名为 deepseek-sandbox，避免与 OpenCode 内置 deepseek provider 冲突。
    cfg.provider['deepseek-sandbox'] = {
      npm: '@ai-sdk/openai-compatible',
      name: 'DeepSeek (sandbox)',
      options: { baseURL, apiKey: process.env.DEEPSEEK_API_KEY },
      models: { [model]: { name: model } },
    };
    cfg.mcp = cfg.mcp || {};
    if (mode === 'lightrag') {
      deleteMcpArgo(cfg); // B 组会话不得看到 argo MCP
      cfg.mcp['lightrag'] = {
        type: 'local',
        command: ['/opt/lightrag/bin/python3', '/opt/sandbox/lightrag-mcp.py'],
        enabled: true,
      };
    } else {
      delete cfg.mcp['lightrag']; // A 组会话不得看到 lightrag MCP（argo 已由部署写入 opencode.json）
    }
    cfg.model = `deepseek-sandbox/${model}`;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    // 回读校验：断言 model/provider/apiKey/baseURL 正确，且 mcp 里只剩对应的那一个后端。
    try {
      const verify = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const prov = verify.provider && verify.provider['deepseek-sandbox'];
      const hasArgo = !!((verify.mcp && verify.mcp.argo) || (verify.mcp && verify.mcp.servers && verify.mcp.servers.argo));
      const hasLightrag = !!(verify.mcp && verify.mcp['lightrag']);
      const isolated = mode === 'lightrag' ? (hasLightrag && !hasArgo) : (hasArgo && !hasLightrag);
      const ok = verify.model === `deepseek-sandbox/${model}`
        && !!prov
        && !!prov.options
        && prov.options.apiKey === process.env.DEEPSEEK_API_KEY
        && prov.options.baseURL === baseURL
        && isolated;
      return ok;
    } catch (_) { return false; }
  }

  function deleteMcpArgo(cfg) {
    if (!cfg.mcp) return;
    delete cfg.mcp.argo;
    if (cfg.mcp.servers) delete cfg.mcp.servers.argo;
  }

  // ── 口径 A：对照会话用中性指令（真正隔离记忆后端）──────────────────────────
  // 部署注入的 ArchGraph 规则（AGENTS.md）是 argo 中心的（WakeupGuideline STEP 0 硬门
  // 要求先查 ARGO MCP、QueryPriorityGuideline 要求任何检索先查意图图等）。若 A/B 会话
  // 都带着这套规则，B 组（只挂 lightrag MCP、无 argo）会收到无法满足的指令——系统性
  // 偏向，破坏「唯一变量=记忆后端」。因此对照会话（Level C/E）统一替换为中性指令：
  // 规则与提问完全相同、不含任何 MCP 名；唯一差异 = 会话里挂载的记忆后端。
  const NEUTRAL_AGENTS_MD = `# ArchGraph memory-eval session instructions (neutral)
You are an evaluation agent. Answer the question by reading the memory that is
available to you in this session.

1. Before answering, use the memory/retrieval tools present in this session to
   look up relevant information. Prefer grounding your answer in retrieved
   memory over prior knowledge.
2. Answer strictly from what you find. If the memory does not contain the
   answer, say so explicitly — never invent or guess.
3. Keep the answer concise and factual. If the memory contains an identifier,
   report it.
4. Use only the tools that actually exist in this session; do not expect tools
   that are not mounted here.`;
  function writeNeutralInstructions() {
    try {
      fs.writeFileSync(path.join(HOME, '.config/opencode/AGENTS.md'), NEUTRAL_AGENTS_MD);
      return true;
    } catch (_) { return false; }
  }

  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_BASE_URL) {
    const neutral = writeNeutralInstructions();
    const configured = configureOpenCodeModel('argo');
    // 中性提问：与 B 组（Level E）完全相同，不点名任何 MCP，只验证会话确实用了所挂后端。
    const question = '请用你可用的记忆工具查询，回答：元素 Implementation and Migration Viewpoint 的 id 是多少？';
    const t0 = Date.now();
    let agentOut = '';
    let agentExit = -1;
    try {
      const r = spawnSync('opencode', ['run', '--format', 'json', question], {
        env: process.env,
        cwd: WORKSPACE,
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 20 * 1024 * 1024,
      });
      agentExit = r.status;
      agentOut = `${String(r.stdout || '')}\n${String(r.stderr || '')}`;
      try { fs.writeFileSync('/results/agent-eval.log', agentOut); } catch (_) { /* results dir may be absent */ }
    } catch (e) { agentOut = `spawn error: ${e.message}`; }
    const latencyMs = Date.now() - t0;
    const toolUsed = /argo|getIntentElementContext|queryNeo4jGraph|getArchitectureViewContext|getSystemArchitecture/.test(agentOut);
    const answered = /1249|Implementation and Migration Viewpoint/.test(agentOut);
    check(
      'c: opencode agent answers via ARGO MCP',
      configured && toolUsed && answered,
      `cfg=${configured} neu=${neutral} exit=${agentExit} tool=${toolUsed} ans=${answered} ${latencyMs}ms ${agentOut.replace(/\s+/g, ' ').slice(0, 240)}`,
    );
  } else {
    check('c: opencode agent answers via ARGO MCP', false, 'missing OPENAI_BASE_URL/API_KEY (argo/.env not mounted)');
  }

  // ── Level D：lightrag MCP（容器内 Python + lightrag 包成 MCP，第二记忆后端）──
  // 用 MCP 客户端直连 lightrag-mcp.py，验证 insert + query 全链路可用（可作对照后端）。
  try {
    const r = spawnSync('/opt/lightrag/bin/python3', ['/opt/sandbox/test-lightrag-mcp.py'], {
      env: process.env,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 20 * 1024 * 1024,
    });
    const out = String(r.stdout || '') + '\n' + String(r.stderr || '');
    let parsed = null;
    const jsonLine = String(r.stdout || '').split('\n').filter(l => l.trim().startsWith('{')).pop();
    try { parsed = JSON.parse(jsonLine); } catch (_) { /* keep null */ }
    const toolsOk = parsed && Array.isArray(parsed.tools)
      && parsed.tools.includes('lightrag_query')
      && parsed.tools.includes('lightrag_insert');
    const answered = parsed && parsed.has_answer === true;
    check(
      'd: lightrag MCP (insert+query) works',
      r.status === 0 && toolsOk && answered,
      `exit=${r.status} tools=${toolsOk} ans=${answered} ${out.replace(/\s+/g, ' ').slice(0, 200)}`,
    );
  } catch (e) { check('d: lightrag MCP (insert+query) works', false, e.message); }

  // ── Level E：全栈 Agent 评测（OpenCode CLI -> Agent -> lightrag MCP）──
  // 与 Level C 完全对等：同一个 OpenCode Agent + DeepSeek，但记忆后端换成 lightrag
  // MCP——严格对照「双 MCP 同 Agent」的 B 组：configureOpenCodeModel('lightrag') 会
  // 清掉 argo MCP，所以本会话只看得到 lightrag MCP（A 组会话只看得到 argo，见 Level C）。
  // 前置：Level D 探针已把含 1249 的探针文档摄入 /opt/lightrag/rag_storage（同一容器）。
  // toolUsed 断言用工具名 lightrag_query（tool_use 事件会记录该名），避免问题文本
  // 里含 "lightrag" 造成的假阳性。
  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_BASE_URL) {
    const neutral = writeNeutralInstructions();
    const configured = configureOpenCodeModel('lightrag');
    // 中性提问：与 A 组（Level C）完全相同；验证 B 组会话确实调用了 lightrag_query。
    const question = '请用你可用的记忆工具查询，回答：元素 Implementation and Migration Viewpoint 的 id 是多少？';
    const t0 = Date.now();
    let agentOut = '';
    let agentExit = -1;
    try {
      const r = spawnSync('opencode', ['run', '--format', 'json', question], {
        env: process.env,
        cwd: WORKSPACE,
        encoding: 'utf8',
        timeout: 180000,
        maxBuffer: 20 * 1024 * 1024,
      });
      agentExit = r.status;
      agentOut = `${String(r.stdout || '')}\n${String(r.stderr || '')}`;
      try { fs.writeFileSync('/results/agent-eval-lightrag.log', agentOut); } catch (_) { /* results dir may be absent */ }
    } catch (e) { agentOut = `spawn error: ${e.message}`; }
    const latencyMs = Date.now() - t0;
    const toolUsed = /lightrag_query/.test(agentOut);
    const answered = /1249|Implementation and Migration Viewpoint/.test(agentOut);
    check(
      'e: opencode agent answers via lightrag MCP',
      configured && toolUsed && answered,
      `cfg=${configured} neu=${neutral} exit=${agentExit} tool=${toolUsed} ans=${answered} ${latencyMs}ms ${agentOut.replace(/\s+/g, ' ').slice(0, 240)}`,
    );
  } else {
    check('e: opencode agent answers via lightrag MCP', false, 'missing DEEPSEEK_API_KEY/BASE_URL (argo/.env not mounted)');
  }
}

function main() {
  // 1) 部署产物（核心工具链 + Copilot/Cursor/OpenCode 的 skills/agents/rules/MCP）
  const expected = [
    path.join(HOME, '.argo/schema/SystemArchitecture.schema.json'),
    path.join(HOME, '.argo/scripts/argo-mcp-server.js'),
    path.join(HOME, '.argo/scripts/validateSystemArchitecture.js'),
    path.join(HOME, '.argo/defaults'),
    path.join(HOME, '.argo/plugins'),
    path.join(HOME, '.argo/package.json'),
    path.join(HOME, '.argo/node_modules/neo4j-driver'),
    path.join(HOME, '.copilot/skills/argo-init/SKILL.md'),
    path.join(HOME, '.cursor/skills/argo-init/SKILL.md'),
    path.join(HOME, '.config/opencode/skills/argo-init/SKILL.md'),
    path.join(HOME, '.config/opencode/AGENTS.md'),
    path.join(HOME, '.cursor/rules/archgraph.mdc'),
    path.join(HOME, '.copilot/agents/wechat-publisher.agent.md'),
    path.join(HOME, '.cursor/agents/wechat-publisher.md'),
    path.join(HOME, '.config/opencode/agents/wechat-publisher.md'),
    path.join(HOME, '.cursor/mcp.json'),
    path.join(HOME, '.config/opencode/opencode.json'),
  ];
  for (const p of expected) check(`deploy: ${rel(p)}`, fs.existsSync(p), p);

  // 2) MCP 注册点指向已安装的 argo server
  // OpenCode MCP 配置为 mcp.<name> 直接键（Write-McpConfig ServersKey='mcp'），兼容 mcp.servers.<name>。
  try {
    const oc = JSON.parse(fs.readFileSync(path.join(HOME, '.config/opencode/opencode.json'), 'utf8'));
    const mcp = (oc && oc.mcp) || {};
    const argo = mcp.argo || (mcp.servers && mcp.servers.argo) || {};
    const blob = JSON.stringify(argo);
    check(
      'mcp: opencode.json registers argo server',
      blob.includes('node') && blob.includes('argo-mcp-server.js'),
      blob.slice(0, 200),
    );
  } catch (e) { check('mcp: opencode.json registers argo server', false, e.message); }

  // 3) 已安装框架的 MCP 服务器真实可用（读图 + 上下文 + 校验）
  runMcp().then(() => {
    const total = checks.length;
    const passed = checks.filter(c => c.pass).length;
    const framework = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')).version;
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify({
      generatedAt: new Date().toISOString(),
      framework,
      workspace: WORKSPACE,
      home: HOME,
      passed,
      total,
      allPassed: passed === total,
      checks,
    }, null, 2));
    console.log(`sandbox smoke: ${passed}/${total} checks passed (archgraph-argo@${framework})`);
    process.exit(passed === total ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(2);
  });
}

main();
