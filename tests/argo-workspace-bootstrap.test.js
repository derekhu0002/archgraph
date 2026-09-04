'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const { initializeWorkspace } = require(path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js'));

const DEFAULT_GRAPH_SOURCE = path.join(ROOT, 'argo', 'defaults', 'design', 'KG', 'SystemArchitecture.json');
const DEFAULT_EA_SOURCE = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');

function createEmptyWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-workspace-bootstrap-'));
  const workspaceRoot = path.join(tempRoot, 'my-project');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return { tempRoot, workspaceRoot };
}

function listRootEaFiles(workspaceRoot) {
  return fs.readdirSync(workspaceRoot).filter(n => /\.(qea|feap|eap)$/i.test(n));
}

test('initializeWorkspace copies default SystemArchitecture.json and project-named qea into an empty workspace', async () => {
  const { tempRoot, workspaceRoot } = createEmptyWorkspace();
  try {
    const result = await initializeWorkspace(workspaceRoot);

    assert.equal(result.status, 'ok');
    assert.equal(result.targetEaName, 'my-project.qea');

    const graphPath = path.join(workspaceRoot, 'design', 'KG', 'SystemArchitecture.json');
    assert.ok(fs.existsSync(graphPath), 'design/KG/SystemArchitecture.json must be created');
    assert.deepEqual(
      JSON.parse(fs.readFileSync(graphPath, 'utf8')),
      JSON.parse(fs.readFileSync(DEFAULT_GRAPH_SOURCE, 'utf8')),
      'copied graph must match the bundled default',
    );

    const qeaPath = path.join(workspaceRoot, 'my-project.qea');
    assert.ok(fs.existsSync(qeaPath), '<project>.qea must be created with the project name');
    // init immediately full-projects the canonical graph into the bootstrapped .qea,
    // so assert semantic consistency (SQLite with the default graph's elements) instead
    // of pristine-template byte equality.
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(qeaPath);
    const canonical = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const count = db.prepare('SELECT COUNT(*) AS c FROM t_object').get().c;
    db.close();
    assert.equal(count, canonical.elements.length, 'bootstrapped .qea must hold every canonical default element');

    assert.ok(result.createdFiles.includes('design/KG/SystemArchitecture.json'));
    assert.ok(result.createdFiles.includes('my-project.qea'));
    assert.deepEqual(listRootEaFiles(workspaceRoot), ['my-project.qea'], 'no legacy .feap may be bootstrapped');
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
    assert.ok(second.skippedSteps.some(step => step.includes('my-project.qea already exists')));
    assert.deepEqual(listRootEaFiles(workspaceRoot), ['my-project.qea'], 'no .feap may appear on re-init');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('initializeWorkspace does not bootstrap a second EA file when a .qea already exists in the workspace root', async () => {
  const { tempRoot, workspaceRoot } = createEmptyWorkspace();
  try {
    fs.mkdirSync(path.join(workspaceRoot, 'design', 'KG'), { recursive: true });
    fs.copyFileSync(DEFAULT_GRAPH_SOURCE, path.join(workspaceRoot, 'design', 'KG', 'SystemArchitecture.json'));
    fs.copyFileSync(DEFAULT_EA_SOURCE, path.join(workspaceRoot, 'archgraph.qea'));

    const result = await initializeWorkspace(workspaceRoot);

    assert.equal(result.status, 'ok');
    assert.equal(result.targetEaName, 'my-project.qea');
    assert.ok(!result.createdFiles.some(f => /\.(qea|feap|eap)$/i.test(f)), 'no EA file may be created');
    assert.ok(fs.existsSync(path.join(workspaceRoot, 'archgraph.qea')), 'existing .qea untouched');
    assert.ok(!fs.existsSync(path.join(workspaceRoot, 'my-project.qea')), 'no project-named .qea bootstrapped');
    assert.ok(!fs.existsSync(path.join(workspaceRoot, 'my-project.feap')), 'no legacy .feap bootstrapped');
    assert.ok(
      result.skippedSteps.some(step => step.includes('EA model already present (archgraph.qea)')),
      'skip reason must name the existing EA file',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('initializeWorkspace treats a legacy root .feap as an existing EA model and does not force a .qea', async () => {
  const { tempRoot, workspaceRoot } = createEmptyWorkspace();
  try {
    fs.writeFileSync(path.join(workspaceRoot, 'archgraph.feap'), 'legacy sentinel', 'utf8');

    const result = await initializeWorkspace(workspaceRoot);

    assert.equal(result.status, 'ok');
    assert.ok(!result.createdFiles.some(f => /\.(qea|feap|eap)$/i.test(f)), 'no EA file may be created');
    assert.ok(fs.existsSync(path.join(workspaceRoot, 'archgraph.feap')), 'legacy .feap untouched');
    assert.ok(!fs.existsSync(path.join(workspaceRoot, 'my-project.qea')), 'no .qea forced next to a legacy .feap');
    assert.ok(
      result.skippedSteps.some(step => step.includes('EA model already present (archgraph.feap)')),
      'skip reason must name the legacy EA file',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
