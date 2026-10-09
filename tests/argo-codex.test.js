'use strict';

// Acceptance tests for the Codex (OpenAI Codex CLI / desktop app) adaptation of
// the ARGO deployment script. Each testcase mirrors the GIVEN-WHEN-THEN
// acceptance criteria registered in the intent graph on the work package
// 「增加archgraph对codex的适配」:
//   AT-codex-01 rules  -> ~/.codex/AGENTS.md (frontmatter stripped, merged)
//   AT-codex-02 skills -> ~/.codex/skills/{argo-init,ea-human-reconcile}
//   AT-codex-03 MCP    -> ~/.codex/config.toml [mcp_servers.argo] + [mcp_servers.graph-mcp]
//   AT-codex-04 workspace: stdio server follows the Codex session cwd, so
//                 ARGO_REPO_ROOT is NOT pinned by default (no env table)
//   AT-codex-05 update -> a stale managed table is replaced, not duplicated,
//                 and unrelated config.toml content is preserved
//   AT-codex-06 -SkipCodex skips the Codex deployment entirely
//   AT-codex-07 -CodexRepoRoot pins env.ARGO_REPO_ROOT (fixed-workspace opt-in)
//
// Evidence captured on the target machine (codex-cli 0.162.0-alpha.2):
//   - `codex debug prompt-input` injects $CODEX_HOME/AGENTS.md verbatim;
//   - user skills are discovered from $CODEX_HOME/skills/<name>/SKILL.md
//     (frontmatter name+description, file must be written WITHOUT a BOM);
//   - `codex mcp add` writes [mcp_servers.<name>] tables into config.toml;
//   - a stdio MCP server is spawned with the session workspace as its cwd and
//     without ARGO_* env, so the argo server follows whichever workspace the
//     user opened (the argo-paths resolution falls back to process.cwd()).

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'install-argo.ps1');
const GRAPH_MCP_URL = 'https://argo.derekworkspacev5.com/mcp';

function hostPaths(tmp) {
  return {
    argoRoot: path.join(tmp, '.argo'),
    skillsRoot: path.join(tmp, '.copilot', 'skills'),
    promptsRoot: path.join(tmp, 'Code', 'User', 'prompts'),
    mcpPath: path.join(tmp, 'vscode', 'mcp.json'),
    cursorSkillsRoot: path.join(tmp, '.cursor', 'skills'),
    cursorMcpPath: path.join(tmp, '.cursor', 'mcp.json'),
    cursorRulesRoot: path.join(tmp, '.cursor', 'rules'),
    openCodeSkillsRoot: path.join(tmp, '.config', 'opencode', 'skills'),
    openCodeAgentsPath: path.join(tmp, '.config', 'opencode', 'AGENTS.md'),
    openCodeConfigPath: path.join(tmp, '.config', 'opencode', 'opencode.json'),
    copilotAgentsRoot: path.join(tmp, '.copilot', 'agents'),
    cursorAgentsRoot: path.join(tmp, '.cursor', 'agents'),
    openCodeAgentsRoot: path.join(tmp, '.config', 'opencode', 'agents'),
    pluginsRoot: path.join(tmp, '.argo', 'plugins'),
    dshHome: path.join(tmp, '.dsh'),
    openClawHome: path.join(tmp, '.openclaw'),
    openClawWorkspace: path.join(tmp, '.openclaw', 'workspace'),
    codexHome: path.join(tmp, '.codex'),
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
    '-CodexHome', opts.codexHome,
    ...(opts.codexRepoRoot ? ['-CodexRepoRoot', opts.codexRepoRoot] : []),
    '-SkipDsh',
    '-SkipOpenClaw',
    '-SkipDoubao',
    '-SkipDeps',
    ...(opts.skipEnv ? ['-SkipEnv'] : []),
    ...(opts.skipMcp ? ['-SkipMcp'] : []),
    ...(opts.skipCodex ? ['-SkipCodex'] : []),
  ];
}

function runInstall(opts) {
  return spawnSync('powershell.exe', buildInstallArgs(opts), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
  });
}

function readConfigToml(codexHome) {
  return fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
}

test('install-argo.ps1 deploys Codex rules, skills, and MCP registration', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-codex-'));
  const paths = hostPaths(tmp);
  const { codexHome } = paths;
  try {
    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    // AT-codex-01: rules -> $CODEX_HOME/AGENTS.md.
    // The global AGENTS.md is injected verbatim into every Codex session
    // (`codex debug prompt-input` proves it), so the wakeup gate is always on.
    const agents = fs.readFileSync(path.join(codexHome, 'AGENTS.md'), 'utf8');
    assert.ok(!agents.startsWith('---'), 'Codex AGENTS.md must not start with YAML frontmatter');
    assert.match(agents, /<WakeupGuideline>/, 'must carry the wakeup gate');
    assert.match(agents, /<CoreRules>/, 'must carry the core rules');
    assert.match(agents, /UNCONDITIONAL STARTUP GATE/, 'must carry the rule body verbatim');
    assert.match(agents, /—/, 'em dash (U+2014) must survive the deploy intact');
    assert.doesNotMatch(agents, /\uFFFD/, 'no replacement characters may appear');

    // AT-codex-02: skills -> $CODEX_HOME/skills/<name>/SKILL.md.
    const initSkill = fs.readFileSync(path.join(codexHome, 'skills', 'argo-init', 'SKILL.md'), 'utf8');
    assert.match(initSkill, /name: argo-init/, 'argo-init skill frontmatter must be preserved');
    assert.ok(!/^\uFEFF/.test(initSkill), 'SKILL.md must have no UTF-8 BOM (Codex would drop it)');
    assert.ok(fs.existsSync(path.join(codexHome, 'skills', 'ea-human-reconcile', 'SKILL.md')),
      'ea-human-reconcile skill must be deployed to Codex');

    // AT-codex-03: MCP -> $CODEX_HOME/config.toml.
    const toml = readConfigToml(codexHome);
    assert.match(toml, /\[mcp_servers\.argo\]/, 'argo stdio server table must exist');
    assert.match(toml, /\[mcp_servers\.argo\][\s\S]*?command\s*=\s*"node"/,
      'argo server must launch node');
    assert.match(toml, /args\s*=\s*\[[^\]]*argo-mcp-server\.js[^\]]*\]/,
      'argo server args must point at argo-mcp-server.js');
    assert.match(toml, /\[mcp_servers\.graph-mcp\]/, 'graph-mcp table must exist');
    assert.match(toml, /url\s*=\s*"https:\/\/argo\.derekworkspacev5\.com\/mcp"/,
      'graph-mcp must be registered as a streamable HTTP url server');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 does not pin ARGO_REPO_ROOT for Codex by default (session-workspace follow)', () => {
  // GIVEN Codex spawns each stdio MCP server with the SESSION workspace as its
  // cwd (verified) and the argo server resolves process.cwd() when no
  // ARGO_REPO_ROOT is set
  // WHEN the installer deploys the Codex integration without -CodexRepoRoot
  // THEN config.toml carries NO [mcp_servers.argo.env] / ARGO_REPO_ROOT, so the
  // single global argo server follows whichever workspace the user opened.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-codex-nopin-'));
  const paths = hostPaths(tmp);
  try {
    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);
    const toml = readConfigToml(paths.codexHome);
    assert.doesNotMatch(toml, /\[mcp_servers\.argo\.env\]/, 'no argo env table by default');
    assert.doesNotMatch(toml, /ARGO_REPO_ROOT/, 'ARGO_REPO_ROOT must not be pinned by default');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 replaces a stale Codex argo table and preserves unrelated config.toml', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-codex-update-'));
  const paths = hostPaths(tmp);
  const { codexHome } = paths;
  try {
    // Seed a realistic config.toml: unrelated desktop settings, an unrelated MCP
    // server, and a stale ArchGraph-managed argo table (the shape `codex mcp add`
    // would leave from an earlier deploy).
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'config.toml'), [
      '[desktop]',
      'followUpQueueMode = "steer"',
      '',
      '[mcp_servers.node_repl]',
      'command = "node_repl.exe"',
      '',
      '[mcp_servers.argo]',
      'command = "node"',
      'args = ["C:/stale/argo-mcp-server.js"]',
      '',
      '[mcp_servers.argo.env]',
      'ARGO_REPO_ROOT = "C:/stale/workspace"',
      '',
    ].join('\n'), 'utf8');

    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const toml = readConfigToml(codexHome);
    // AT-codex-05: the stale table is replaced, never duplicated (duplicate TOML
    // tables are a parse error), and the stale pin is cleared.
    const argoHeaders = toml.split('[mcp_servers.argo]').length - 1;
    assert.equal(argoHeaders, 1, 'exactly one [mcp_servers.argo] table must remain');
    assert.doesNotMatch(toml, /C:\/stale/, 'the stale argo server path must be replaced');
    assert.doesNotMatch(toml, /\[mcp_servers\.argo\.env\]/, 'the stale ARGO_REPO_ROOT pin must be cleared');
    assert.match(toml, /args\s*=\s*\[[^\]]*argo-mcp-server\.js[^\]]*\]/, 'fresh argo args present');
    // Unrelated content must be preserved.
    assert.match(toml, /\[desktop\]/, 'unrelated [desktop] table must be preserved');
    assert.match(toml, /followUpQueueMode = "steer"/, 'unrelated desktop setting must be preserved');
    assert.match(toml, /\[mcp_servers\.node_repl\]/, 'unrelated MCP server must be preserved');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 -CodexRepoRoot pins env.ARGO_REPO_ROOT (fixed-workspace opt-in)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-codex-pin-'));
  const paths = hostPaths(tmp);
  try {
    const pinned = path.join(tmp, 'pinned-workspace');
    const result = runInstall({ ...paths, skipEnv: true, codexRepoRoot: pinned });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);
    const toml = readConfigToml(paths.codexHome);
    assert.match(toml, /\[mcp_servers\.argo\.env\]/, 'argo env table must exist when pinning');
    assert.match(toml, /ARGO_REPO_ROOT\s*=\s*"[^"]*pinned-workspace"/,
      'ARGO_REPO_ROOT must pin the requested workspace');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 -SkipCodex skips the Codex deployment entirely', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-codex-skip-'));
  const paths = hostPaths(tmp);
  const { codexHome } = paths;
  try {
    const result = runInstall({ ...paths, skipEnv: true, skipCodex: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);
    assert.ok(!fs.existsSync(path.join(codexHome, 'AGENTS.md')),
      'Codex AGENTS.md must not be written when skipped');
    assert.ok(!fs.existsSync(path.join(codexHome, 'skills', 'argo-init', 'SKILL.md')),
      'Codex skill must not be deployed when skipped');
    assert.ok(!fs.existsSync(path.join(codexHome, 'config.toml')),
      'Codex MCP config must not be written when skipped');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

module.exports = { GRAPH_MCP_URL };
