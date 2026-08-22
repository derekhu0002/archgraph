'use strict';

// Acceptance tests for the OpenClaw adaptation of the ARGO deployment script
// (Work Package 2780「增加archgraph对openclaw的适配」). Each testcase mirrors
// the GIVEN-WHEN-THEN acceptance criteria registered in the intent graph:
//   AT-2780-01 rules -> OpenClaw workspace AGENTS.md (frontmatter stripped, merged)
//   AT-2780-02 skill  -> ~/.openclaw/skills/argo-init
//   AT-2780-03 MCP    -> ~/.openclaw/openclaw.json mcp.servers.argo (env ARGO_REPO_ROOT)
//   AT-2780-04 UTF-8  -> non-ASCII (em dash) survives the deploy intact

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'install-argo.ps1');

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
    ...(opts.openClawRepoRoot ? ['-OpenClawRepoRoot', opts.openClawRepoRoot] : []),
    '-SkipDsh',
    '-SkipDeps',
    ...(opts.skipEnv ? ['-SkipEnv'] : []),
    ...(opts.skipMcp ? ['-SkipMcp'] : []),
    ...(opts.skipOpenClaw ? ['-SkipOpenClaw'] : []),
  ];
}

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
  };
}

function runInstall(opts) {
  return spawnSync('powershell.exe', buildInstallArgs(opts), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeout,
  });
}

test('install-argo.ps1 deploys OpenClaw rules, skill, and MCP registration', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-openclaw-'));
  const paths = hostPaths(tmp);
  const { openClawHome, openClawWorkspace } = paths;
  try {
    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    // AT-2780-01: rules -> OpenClaw workspace AGENTS.md.
    // Frontmatter stripped (OpenClaw injects AGENTS.md verbatim into Project
    // Context), rule body injected verbatim with NO adapter prose.
    const agents = fs.readFileSync(path.join(openClawWorkspace, 'AGENTS.md'), 'utf8');
    assert.ok(!agents.startsWith('---'), 'OpenClaw AGENTS.md must not start with YAML frontmatter');
    assert.match(agents, /<WakeupGuideline>/, 'must carry the wakeup gate');
    assert.match(agents, /<CoreRules>/, 'must carry the core rules');
    assert.match(agents, /<ToolsGuideline>/, 'must carry the tools guideline');
    assert.match(agents, /UNCONDITIONAL STARTUP GATE/, 'must carry the rule body verbatim');
    assert.doesNotMatch(agents, /OpenClaw adapter note|OpenClaw edition|OpenClaw-specific/,
      'must not inject adapter/deployment prose into the working rule');

    // AT-2780-02: skill -> ~/.openclaw/skills/argo-init (managed/shared root).
    const skill = fs.readFileSync(path.join(openClawHome, 'skills', 'argo-init', 'SKILL.md'), 'utf8');
    assert.match(skill, /name: argo-init/, 'skill must keep its OpenClaw-compatible frontmatter');

    // AT-2780-03: MCP -> ~/.openclaw/openclaw.json mcp.servers.argo.
    // OpenClaw is a fixed-workspace host; the workspace is pinned explicitly
    // via env.ARGO_REPO_ROOT to the repository root.
    const configPath = path.join(openClawHome, 'openclaw.json');
    assert.ok(fs.existsSync(configPath), 'OpenClaw config must be written');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(config.mcp && config.mcp.servers && config.mcp.servers.argo,
      'mcp.servers.argo must be registered');
    assert.equal(config.mcp.servers.argo.command, 'node');
    assert.ok(config.mcp.servers.argo.args[0].endsWith('argo-mcp-server.js'));
    assert.equal(
      config.mcp.servers.argo.env.ARGO_REPO_ROOT,
      ROOT,
      'ARGO_REPO_ROOT must pin the repository root for the fixed-workspace host',
    );

    // AT-2780-04: UTF-8 non-ASCII (em dash U+2014) survives the deploy intact.
    assert.match(agents, /—/, 'em dash (U+2014) must survive the deploy intact');
    assert.doesNotMatch(agents, /\uFFFD/, 'no replacement characters may appear');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 updates an outdated OpenClaw AGENTS.md block and preserves other content', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-openclaw-update-'));
  const paths = hostPaths(tmp);
  try {
    fs.mkdirSync(paths.openClawWorkspace, { recursive: true });

    // Seed an outdated ArchGraph rules block (with the marker) plus unrelated
    // user content below it, the way a user's personal OpenClaw AGENTS.md might
    // look after a previous (stale) deployment.
    fs.writeFileSync(path.join(paths.openClawWorkspace, 'AGENTS.md'), [
      '# My OpenClaw notes',
      'keep this line',
      '',
      '<WakeupGuideline>',
      'stale gate content',
      '</ToolsGuideline>',
      '',
    ].join('\n'), 'utf8');

    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const agents = fs.readFileSync(path.join(paths.openClawWorkspace, 'AGENTS.md'), 'utf8');
    // The outdated block must be replaced by the current rule content.
    assert.match(agents, /UNCONDITIONAL STARTUP GATE/, 'AGENTS.md must be updated to the current rule');
    assert.doesNotMatch(agents, /stale gate content/, 'the outdated block must be replaced');
    // Unrelated user content must be preserved.
    assert.match(agents, /# My OpenClaw notes/);
    assert.match(agents, /keep this line/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 -SkipOpenClaw skips the OpenClaw deployment entirely', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-openclaw-skip-'));
  const paths = hostPaths(tmp);
  const { openClawHome, openClawWorkspace } = paths;
  try {
    const result = runInstall({ ...paths, skipEnv: true, skipOpenClaw: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    assert.ok(!fs.existsSync(path.join(openClawWorkspace, 'AGENTS.md')),
      'OpenClaw workspace AGENTS.md must not be written when skipped');
    assert.ok(!fs.existsSync(path.join(openClawHome, 'skills', 'argo-init', 'SKILL.md')),
      'OpenClaw skill must not be deployed when skipped');
    assert.ok(!fs.existsSync(path.join(openClawHome, 'openclaw.json')),
      'OpenClaw MCP config must not be written when skipped');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 preserves an existing OpenClaw ARGO_REPO_ROOT when run from a non-workspace dir', () => {
  // GIVEN openclaw.json already pins mcp.servers.argo.env.ARGO_REPO_ROOT to a
  // correct repo, and the installer runs from a non-workspace location (the
  // npm-global archgraph-argo package dir, simulated via -OpenClawRepoRoot)
  // WHEN the installer re-registers the argo MCP server
  // THEN the existing ARGO_REPO_ROOT is preserved (not clobbered), so OpenClaw
  // keeps targeting the correct Neo4j database instead of deriving one from
  // the npm package dir basename (e.g. archgraph-argo).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-openclaw-preserve-'));
  const paths = hostPaths(tmp);
  const { openClawHome } = paths;
  try {
    fs.mkdirSync(openClawHome, { recursive: true });
    const existingRoot = 'D:/existing-repo';
    fs.writeFileSync(path.join(openClawHome, 'openclaw.json'), JSON.stringify({
      gateway: { port: 18789 },
      mcp: { servers: { argo: { command: 'node', args: ['stale'], env: { ARGO_REPO_ROOT: existingRoot } } } },
    }, null, 2), 'utf8');

    // A non-workspace dir (no design/KG/SystemArchitecture.json inside).
    const nonWorkspace = path.join(tmp, 'non-workspace');
    fs.mkdirSync(nonWorkspace, { recursive: true });

    const result = runInstall({ ...paths, skipEnv: true, openClawRepoRoot: nonWorkspace });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const config = JSON.parse(fs.readFileSync(path.join(openClawHome, 'openclaw.json'), 'utf8'));
    assert.equal(
      config.mcp.servers.argo.env.ARGO_REPO_ROOT,
      existingRoot,
      'existing ARGO_REPO_ROOT must be preserved when the installer runs from a non-workspace dir',
    );
    assert.ok(config.mcp.servers.argo.args[0].endsWith('argo-mcp-server.js'),
      'the argo server path must still be refreshed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 omits the OpenClaw ARGO_REPO_ROOT env when run from a non-workspace dir with no prior pin', () => {
  // GIVEN the installer runs from a non-workspace location and openclaw.json
  // has no argo MCP entry yet
  // WHEN the installer registers the argo MCP server
  // THEN mcp.servers.argo is written WITHOUT env.ARGO_REPO_ROOT (nothing to
  // pin), and a warning is emitted instead of guessing a wrong root.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-openclaw-omit-'));
  const paths = hostPaths(tmp);
  const { openClawHome } = paths;
  try {
    const nonWorkspace = path.join(tmp, 'non-workspace');
    fs.mkdirSync(nonWorkspace, { recursive: true });

    const result = runInstall({ ...paths, skipEnv: true, openClawRepoRoot: nonWorkspace });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const configPath = path.join(openClawHome, 'openclaw.json');
    assert.ok(fs.existsSync(configPath), 'OpenClaw config must be written');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(config.mcp && config.mcp.servers && config.mcp.servers.argo,
      'mcp.servers.argo must still be registered');
    assert.equal(config.mcp.servers.argo.command, 'node');
    assert.ok(config.mcp.servers.argo.args[0].endsWith('argo-mcp-server.js'));
    assert.equal(config.mcp.servers.argo.env, undefined,
      'ARGO_REPO_ROOT must not be pinned when the installer runs from a non-workspace dir');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
