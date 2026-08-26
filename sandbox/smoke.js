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
 * Writes /results/sandbox-report.json (mounted to the host results dir).
 */
const fs = require('node:fs');
const path = require('node:path');

process.env.ARGO_REPO_ROOT = process.env.ARGO_REPO_ROOT || '/workspace';
const HOME = process.env.USERPROFILE || process.env.HOME || '/root';
const WORKSPACE = process.env.ARGO_REPO_ROOT;
const PACKAGE = '/tmp/install/node_modules/archgraph-argo';
const REPORT = process.env.REPORT_PATH || '/results/sandbox-report.json';

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail) });
}
function rel(p) { return path.relative(HOME, p); }

async function runMcp() {
  const { callTool } = require(path.join(PACKAGE, 'argo/scripts/argo-mcp-server.js'));
  try {
    const r1 = await callTool('getArchitectureViewContext', { view_id: 'overseer-ltm-001' }, null, undefined);
    check(
      'mcp: getArchitectureViewContext(overseer-ltm-001)',
      r1 && r1.status === 'passed' && r1.view && r1.view.view_id === 'overseer-ltm-001',
      (r1 && r1.status) || 'no status',
    );
  } catch (e) { check('mcp: getArchitectureViewContext(overseer-ltm-001)', false, e.message); }

  try {
    const r2 = await callTool('getIntentElementContext', { elementId: 'project-overseer-001' }, null, undefined);
    check(
      'mcp: getIntentElementContext(project-overseer-001)',
      r2 && r2.status === 'passed' && r2.focusElementId === 'project-overseer-001',
      (r2 && r2.status) || 'no status',
    );
  } catch (e) { check('mcp: getIntentElementContext(project-overseer-001)', false, e.message); }

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
