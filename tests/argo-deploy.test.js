'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'install-argo.ps1');

function runInstall(argoRoot, skillsRoot, promptsRoot, mcpPath) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT,
      '-ArgoRoot', argoRoot,
      '-SkillsRoot', skillsRoot,
      '-PromptsRoot', promptsRoot,
      '-McpPath', mcpPath,
      '-SkipEnv',
      '-SkipDeps',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

test('install-argo.ps1 deploys toolchain, skill, and rules without secrets or temp', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-test-'));
  const argoRoot = path.join(tmp, '.argo');
  const skillsRoot = path.join(tmp, '.copilot', 'skills');
  const promptsRoot = path.join(tmp, 'Code', 'User', 'prompts');
  const mcpPath = path.join(tmp, 'mcp.json');
  try {
    const result = runInstall(argoRoot, skillsRoot, promptsRoot, mcpPath);
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    // 1) schema
    assert.ok(fs.existsSync(path.join(argoRoot, 'schema', 'SystemArchitecture.schema.json')));
    // 2) scripts
    assert.ok(fs.existsSync(path.join(argoRoot, 'scripts', 'argo-mcp-server.js')));
    // 3) argo-init skill
    assert.ok(fs.existsSync(path.join(skillsRoot, 'argo-init', 'SKILL.md')));
    // 4) global rule
    assert.ok(fs.existsSync(path.join(promptsRoot, 'archgraph.instructions.md')));

    // 5) dependency manifest is deployed so `npm install` can resolve neo4j-driver.
    const manifestPath = path.join(argoRoot, 'package.json');
    assert.ok(fs.existsSync(manifestPath), 'dependency manifest must be deployed');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.dependencies && manifest.dependencies['neo4j-driver']);

    // temp stays in the repository, and no .env is written in non-interactive mode.
    assert.ok(!fs.existsSync(path.join(argoRoot, 'temp')), 'temp must not be deployed');
    assert.ok(!fs.existsSync(path.join(argoRoot, '.env')), '.env must only be generated interactively');

    // 6) VS Code MCP config registers the deployed argo server.
    assert.ok(fs.existsSync(mcpPath), 'VS Code MCP config must be written');
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(mcp.servers && mcp.servers.argo);
    assert.equal(mcp.servers.argo.command, 'node');
    assert.ok(mcp.servers.argo.args[0].endsWith('argo-mcp-server.js'));
    assert.ok(!mcp.servers.argo.cwd, 'cwd must be omitted; workspace is discovered dynamically via MCP roots');
    assert.ok(!mcp.servers.argo.env, 'env must be omitted; workspace is discovered dynamically via MCP roots');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
