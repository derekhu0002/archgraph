'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'argo-deploy', 'bin', 'argo-deploy.js');

function runDeploy(workspace) {
  return spawnSync(process.execPath, [BIN, '--workspace', workspace], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
}

test('argo-deploy installs toolchain, skills, and rules into a workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-deploy-test-'));
  try {
    const result = runDeploy(workspace);
    assert.equal(result.status, 0, `CLI exited with ${result.status}: ${result.stderr}`);

    // Toolchain assets are deployed without secrets or runtime state.
    assert.ok(fs.existsSync(path.join(workspace, '.argo', 'scripts', 'argo-mcp-server.js')));
    assert.ok(fs.existsSync(path.join(workspace, '.argo', 'schema', 'SystemArchitecture.schema.json')));
    assert.ok(fs.existsSync(path.join(workspace, '.argo', '.env.example')));
    assert.ok(!fs.existsSync(path.join(workspace, '.argo', '.env')));
    assert.ok(!fs.existsSync(path.join(workspace, '.argo', 'temp')));

    // Skills are deployed into the project skills directory.
    assert.ok(fs.existsSync(path.join(workspace, '.github', 'skills', 'argo-init', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(workspace, '.github', 'skills', 'diagram-draw', 'renderExcalidrawSvg.js')));

    // Rules are deployed into the project .github directory.
    assert.ok(fs.existsSync(path.join(workspace, '.github', 'kglibrary.instructions.md')));
    assert.ok(fs.existsSync(path.join(workspace, '.github', 'intent-architecture-global-rule.md')));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
