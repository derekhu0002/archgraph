'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'install-argo.ps1');

const ENV_KEYS = [
  'ARGO_EMBEDDING_BASE_URL',
  'ARGO_EMBEDDING_MODEL',
  'ARGO_EMBEDDING_PROVIDER',
  'ARGO_EMBEDDING_MODEL_VERSION',
  'ARGO_EMBEDDING_DIMENSIONS',
  'ARGO_NEO4J_DATABASE_URL',
  'ARGO_NEO4J_DATABASE_USERNAME',
  'ARGO_NEO4J_DATABASE_PASSWORD',
  'QWEN_KEY',
  'ARGO_LIVE_PROVIDER_E2E',
  'ARGO_W31_LIVE_MUTATION_VECTOR_E2E',
];

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
    '-OpenCodeSkillsRoot', opts.openCodeSkillsRoot,
    '-OpenCodeAgentsPath', opts.openCodeAgentsPath,
    '-OpenCodeConfigPath', opts.openCodeConfigPath,
    '-SkipDeps',
    ...(opts.skipEnv ? ['-SkipEnv'] : []),
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
    openCodeSkillsRoot: path.join(tmp, '.config', 'opencode', 'skills'),
    openCodeAgentsPath: path.join(tmp, '.config', 'opencode', 'AGENTS.md'),
    openCodeConfigPath: path.join(tmp, '.config', 'opencode', 'opencode.json'),
  };
}

function runInstall(opts) {
  const spawnOpts = { cwd: ROOT, encoding: 'utf8' };
  if (opts.timeout) {
    spawnOpts.timeout = opts.timeout;
  }
  return spawnSync('powershell.exe', buildInstallArgs(opts), spawnOpts);
}

test('install-argo.ps1 deploys toolchain, skill, and rules without secrets or temp', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-test-'));
  const paths = hostPaths(tmp);
  const {
    argoRoot, skillsRoot, promptsRoot, mcpPath,
    cursorSkillsRoot, cursorMcpPath,
    openCodeSkillsRoot, openCodeAgentsPath, openCodeConfigPath,
  } = paths;
  try {
    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    // 1) schema
    assert.ok(fs.existsSync(path.join(argoRoot, 'schema', 'SystemArchitecture.schema.json')));
    // 2) scripts
    assert.ok(fs.existsSync(path.join(argoRoot, 'scripts', 'argo-mcp-server.js')));
    // 2b) defaults (workspace bootstrap templates)
    assert.ok(fs.existsSync(path.join(argoRoot, 'defaults', 'design', 'KG', 'SystemArchitecture.json')));
    assert.ok(fs.existsSync(path.join(argoRoot, 'defaults', 'EA-model-template.feap')));
    // 3) argo-init skill
    assert.ok(fs.existsSync(path.join(skillsRoot, 'argo-init', 'SKILL.md')));
    // 4) global rule
    assert.ok(fs.existsSync(path.join(promptsRoot, 'archgraph.instructions.md')));

    // 5) dependency manifest is deployed so `npm install` can resolve neo4j-driver.
    const manifestPath = path.join(argoRoot, 'package.json');
    assert.ok(fs.existsSync(manifestPath), 'dependency manifest must be deployed');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.dependencies && manifest.dependencies['neo4j-driver']);

    // 5b) npm package manifest ships the defaults directory.
    const npmManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(Array.isArray(npmManifest.files) && npmManifest.files.includes('argo/defaults'));

    // temp stays in the repository, and no .env is written in non-interactive mode.
    assert.ok(!fs.existsSync(path.join(argoRoot, 'temp')), 'temp must not be deployed');
    assert.ok(!fs.existsSync(path.join(argoRoot, '.env')), '.env must only be generated interactively');

    // 6) VS Code (Copilot) MCP config registers the deployed argo server.
    assert.ok(fs.existsSync(mcpPath), 'VS Code MCP config must be written');
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(mcp.servers && mcp.servers.argo);
    assert.equal(mcp.servers.argo.type, 'stdio');
    assert.equal(mcp.servers.argo.command, 'node');
    assert.ok(mcp.servers.argo.args[0].endsWith('argo-mcp-server.js'));
    assert.ok(!mcp.servers.argo.cwd, 'cwd must be omitted; workspace is discovered dynamically via MCP roots');
    assert.ok(!mcp.servers.argo.env, 'env must be omitted; workspace is discovered dynamically via MCP roots');

    // 7) Cursor skill + MCP config.
    assert.ok(fs.existsSync(path.join(cursorSkillsRoot, 'argo-init', 'SKILL.md')), 'Cursor skill must be deployed');
    assert.ok(fs.existsSync(cursorMcpPath), 'Cursor MCP config must be written');
    const cursorMcp = JSON.parse(fs.readFileSync(cursorMcpPath, 'utf8'));
    assert.ok(cursorMcp.mcpServers && cursorMcp.mcpServers.argo);
    assert.equal(cursorMcp.mcpServers.argo.type, 'stdio');
    assert.equal(cursorMcp.mcpServers.argo.command, 'node');
    assert.ok(cursorMcp.mcpServers.argo.args[0].endsWith('argo-mcp-server.js'));
    assert.ok(!cursorMcp.mcpServers.argo.cwd, 'Cursor cwd must be omitted; roots resolve the workspace');
    assert.ok(!cursorMcp.mcpServers.argo.env, 'Cursor env must be omitted; roots resolve the workspace');

    // 8) OpenCode skill + global rule.
    assert.ok(fs.existsSync(path.join(openCodeSkillsRoot, 'argo-init', 'SKILL.md')), 'OpenCode skill must be deployed');
    assert.ok(fs.existsSync(openCodeAgentsPath), 'OpenCode global AGENTS.md must be written');
    assert.match(fs.readFileSync(openCodeAgentsPath, 'utf8'), /ArchGraph ARGO Workflow Rules/);

    // 9) OpenCode MCP config registers a local argo server without a hardcoded cwd.
    assert.ok(fs.existsSync(openCodeConfigPath), 'OpenCode MCP config must be written');
    const openCode = JSON.parse(fs.readFileSync(openCodeConfigPath, 'utf8'));
    assert.ok(openCode.mcp && openCode.mcp.argo);
    assert.equal(openCode.mcp.argo.type, 'local');
    assert.equal(openCode.mcp.argo.command[0], 'node');
    assert.ok(openCode.mcp.argo.command[1].endsWith('argo-mcp-server.js'));
    assert.equal(openCode.mcp.argo.enabled, true);
    assert.ok(!openCode.mcp.argo.cwd, 'OpenCode cwd must be omitted; default is the project directory');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 keeps existing .env values and skips prompts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-env-'));
  const paths = hostPaths(tmp);
  fs.mkdirSync(paths.argoRoot, { recursive: true });

  const seeded = ENV_KEYS.map(key => `${key}=existing-${key}`).join('\n');
  fs.writeFileSync(path.join(paths.argoRoot, '.env'), `# Argo live-provider and Neo4j configuration.\n${seeded}\n`);

  try {
    // No -SkipEnv and no stdin: the script must not call Read-Host because
    // every known variable already holds a non-empty value. The timeout guards
    // against an accidental interactive prompt hanging the test.
    const result = runInstall({ ...paths, skipEnv: false, timeout: 30000 });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const env = fs.readFileSync(path.join(paths.argoRoot, '.env'), 'utf8');
    for (const key of ENV_KEYS) {
      assert.match(env, new RegExp(`^${key}=existing-${key}$`, 'm'), `${key} must keep its existing value`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
