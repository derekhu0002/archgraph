'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const { initializeWorkspace } = require(path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js'));

const DEFAULT_GRAPH_SOURCE = path.join(ROOT, 'argo', 'defaults', 'design', 'KG', 'SystemArchitecture.json');
const DEFAULT_FEAP_SOURCE = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');

function createEmptyWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-workspace-bootstrap-'));
  const workspaceRoot = path.join(tempRoot, 'my-project');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return { tempRoot, workspaceRoot };
}

test('initializeWorkspace copies default SystemArchitecture.json and project-named feap into an empty workspace', async () => {
  const { tempRoot, workspaceRoot } = createEmptyWorkspace();
  try {
    const result = await initializeWorkspace(workspaceRoot);

    assert.equal(result.status, 'ok');
    assert.equal(result.targetFeapName, 'my-project.feap');

    const graphPath = path.join(workspaceRoot, 'design', 'KG', 'SystemArchitecture.json');
    assert.ok(fs.existsSync(graphPath), 'design/KG/SystemArchitecture.json must be created');
    assert.deepEqual(
      JSON.parse(fs.readFileSync(graphPath, 'utf8')),
      JSON.parse(fs.readFileSync(DEFAULT_GRAPH_SOURCE, 'utf8')),
      'copied graph must match the bundled default',
    );

    const feapPath = path.join(workspaceRoot, 'my-project.feap');
    assert.ok(fs.existsSync(feapPath), '<project>.feap must be created with the project name');
    assert.equal(
      fs.statSync(feapPath).size,
      fs.statSync(DEFAULT_FEAP_SOURCE).size,
      'copied feap must match the bundled default size',
    );

    assert.ok(result.createdFiles.includes('design/KG/SystemArchitecture.json'));
    assert.ok(result.createdFiles.includes('my-project.feap'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('initializeWorkspace is idempotent when default files already exist', async () => {
  const { tempRoot, workspaceRoot } = createEmptyWorkspace();
  try {
    await initializeWorkspace(workspaceRoot);
    const second = await initializeWorkspace(workspaceRoot);

    assert.equal(second.status, 'ok');
    assert.deepEqual(second.createdFiles, []);
    assert.ok(second.skippedSteps.some(step => step.includes('SystemArchitecture.json already exists')));
    assert.ok(second.skippedSteps.some(step => step.includes('my-project.feap already exists')));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
