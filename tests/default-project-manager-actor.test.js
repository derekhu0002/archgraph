'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_GRAPH_SOURCE = path.join(ROOT, 'argo', 'defaults', 'design', 'KG', 'SystemArchitecture.json');

const { initializeWorkspace } = require(path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js'));
const { validateGraphSemantics, validateArchiMateEndpointMatrix, validateViewElementLimits } = require(
  path.join(ROOT, 'argo', 'scripts', 'graph-semantics.js'),
);

const DEFAULT_ACTOR_ID = 'project-manager-001';
const DEFAULT_ACTOR_NAME = '项目经理';
const MEMORY_SUBVIEWS = [
  { view_id: 'project-manager-001-wm-001', view_name: '项目经理工作记忆' },
  { view_id: 'project-manager-001-ltm-001', view_name: '项目经理长期记忆' },
  { view_id: 'project-manager-001-archive-001', view_name: '项目经理档案' },
];

function readDefaultGraph() {
  return JSON.parse(fs.readFileSync(DEFAULT_GRAPH_SOURCE, 'utf8'));
}

function findDefaultActor(graph) {
  return graph.elements.find((entry) => entry.id === DEFAULT_ACTOR_ID);
}

test('default-project-manager-actor: bundled default graph ships a 项目经理 Business Actor', () => {
  // GIVEN the framework bootstraps new projects from argo/defaults
  // WHEN the bundled default graph is read
  // THEN it carries exactly one default Business Actor named 项目经理
  const graph = readDefaultGraph();
  const named = graph.elements.filter((entry) => entry.name === DEFAULT_ACTOR_NAME);

  assert.equal(named.length, 1, 'the default graph must define exactly one 项目经理 element');
  const actor = findDefaultActor(graph);
  assert.ok(actor, `default graph must define element '${DEFAULT_ACTOR_ID}'`);
  assert.equal(actor.type, 'Business Actor', '项目经理 must be a Business Actor');
  assert.ok(
    actor.description && actor.description.trim().length > 0,
    '项目经理 must carry a non-empty description (default primary actor of the project)',
  );
});

test('default-project-manager-actor: default actor is a first-class member of the root view', () => {
  // GIVEN the default actor exists in the bundled graph
  // WHEN the top-level SystemArchitecture view is inspected
  // THEN it includes the actor, so the actor is visible in every new project
  const graph = readDefaultGraph();
  const rootView = graph.views.find((view) => !view.parent_element_id);
  assert.ok(rootView, 'the default graph must have a top-level view');
  assert.equal(rootView.view_name, 'SystemArchitecture', 'top-level view must be SystemArchitecture');
  assert.ok(
    rootView.included_elements.includes(DEFAULT_ACTOR_ID),
    'the root SystemArchitecture view must include the default 项目经理 actor',
  );
});

test('default-project-manager-actor: default actor carries T1/T2/T3 memory sub-views', () => {
  // GIVEN every Business Actor keeps its three-tier memory in sub-views mounted under it
  // WHEN the default actor is inspected
  // THEN it declares and mounts wm/ltm/archive sub-views parented to itself
  const graph = readDefaultGraph();
  const actor = findDefaultActor(graph);
  assert.ok(actor, 'default actor must exist');

  for (const expected of MEMORY_SUBVIEWS) {
    const declared = (actor.subdiagram_views || []).find((view) => view.view_id === expected.view_id);
    assert.ok(declared, `default actor must declare sub-view ${expected.view_id}`);
    assert.equal(declared.view_name, expected.view_name, `sub-view ${expected.view_id} must keep its name`);

    const view = graph.views.find((entry) => entry.view_id === expected.view_id);
    assert.ok(view, `default graph must define view ${expected.view_id}`);
    assert.equal(view.parent_element_id, DEFAULT_ACTOR_ID, `view ${expected.view_id} must be parented to the actor`);
    assert.equal(view.parent_element_name, DEFAULT_ACTOR_NAME, `view ${expected.view_id} must name its parent actor`);
  }
});

test('default-project-manager-actor: bundled default graph stays structurally valid', () => {
  // GIVEN the bundled default graph is copied verbatim into every new project
  // WHEN the canonical graph-semantics checks run against it
  // THEN it has exactly one top-level view, every element belongs to a view, and the endpoint matrix holds
  const graph = readDefaultGraph();
  const errors = [];
  validateGraphSemantics(graph, errors);
  validateArchiMateEndpointMatrix(graph, errors);
  validateViewElementLimits(graph, errors);

  assert.deepEqual(errors, [], `bundled default graph must be valid, got: ${errors.join('; ')}`);
});

test('default-project-manager-actor: initializeWorkspace bootstraps the default actor into a new project', async () => {
  // GIVEN an empty workspace root
  // WHEN initializeWorkspace bootstraps the framework defaults
  // THEN the new project graph exposes the default 项目经理 actor with its memory sub-views
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-default-pm-'));
  const workspaceRoot = path.join(tempRoot, 'fresh-project');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  try {
    const result = await initializeWorkspace(workspaceRoot);
    assert.equal(result.status, 'ok');

    const bootstrapped = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'),
    );
    const actor = findDefaultActor(bootstrapped);
    assert.ok(actor, 'bootstrapped project must contain the default 项目经理 actor');
    assert.equal(actor.name, DEFAULT_ACTOR_NAME);
    assert.equal(actor.type, 'Business Actor');

    const mountedIds = bootstrapped.views
      .filter((view) => view.parent_element_id === DEFAULT_ACTOR_ID)
      .map((view) => view.view_id)
      .sort();
    assert.deepEqual(
      mountedIds,
      MEMORY_SUBVIEWS.map((view) => view.view_id).sort(),
      'bootstrapped project must mount the actor memory sub-views',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
