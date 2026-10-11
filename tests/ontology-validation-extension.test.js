'use strict';

// Acceptance tests for the generic, opt-in validation extension point and the
// production ontology-validation CLI that attaches through it.
//
// AT-ovx-1  no ARGO_VALIDATION_EXTENSIONS  -> no-op (default behaviour unchanged)
// AT-ovx-2  a configured extension that reports errors -> errors are merged (blocking)
// AT-ovx-3  a configured-but-unavailable extension -> fail-close (blocking error)
// AT-ovx-3b onError:"warn" opts an entry back to advisory
// AT-ovx-4  the ontology CLI (write mode) flags a constraint violation and passes a valid graph
// AT-ovx-5  malformed configuration is ignored (no crash)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveValidationExtensions, runValidationExtensions } = require('../argo/scripts/validation-extensions.js');

const REPO = path.resolve(__dirname, '..');
const CLI = path.join(REPO, 'argo', 'scripts', 'ontology-projection', 'cli.js');
const FIXTURE = path.join(REPO, 'sandbox', 'ontology-projection', 'samples', 'team-graph');

const nodeEval = (code) => [process.execPath, '-e', code];

function makeWorkspace(graphFile) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ovx-'));
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of ['SystemArchitecture.schema.json', 'schema-bundle.config.json', 'schema-bundle.rules.json', 'ontology-axioms.json']) {
    fs.copyFileSync(path.join(FIXTURE, '.argo', 'schema', name), path.join(schemaDir, name));
  }
  const graphDir = path.join(ws, 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, 'graphs', graphFile), path.join(graphDir, 'SystemArchitecture.json'));
  return ws;
}

function runCli(ws, mode, opts = {}) {
  const args = [CLI, '--workspace', ws, '--graph', path.join('design', 'KG', 'SystemArchitecture.json'), '--mode', mode];
  if (opts.scope) args.push('--scope', opts.scope);
  // host tests run the dependency-free deterministic engine; the real engine
  // (pySHACL + owlready2/HermiT) is exercised in the container.
  args.push('--engine', opts.engine || 'deterministic');
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, ...(opts.env || {}) } });
  assert.equal(result.status, 0, String(result.stderr));
  return JSON.parse(result.stdout);
}

function copySchema(ws) {
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of ['SystemArchitecture.schema.json', 'schema-bundle.config.json', 'schema-bundle.rules.json', 'ontology-axioms.json']) {
    fs.copyFileSync(path.join(FIXTURE, '.argo', 'schema', name), path.join(schemaDir, name));
  }
}

function makeWorkspaceWithGraph(graph) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ovx-g-'));
  copySchema(ws);
  const graphDir = path.join(ws, 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.writeFileSync(path.join(graphDir, 'SystemArchitecture.json'), JSON.stringify(graph));
  return ws;
}

test('AT-ovx-1 no extensions configured -> no-op (default unchanged)', () => {
  assert.deepEqual(resolveValidationExtensions({}), []);
  const result = runValidationExtensions({ workspaceRoot: '/x', graphPath: 'g.json', mode: 'write', env: {} });
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test('AT-ovx-2 configured extension errors are merged (blocking)', () => {
  const env = {
    ARGO_VALIDATION_EXTENSIONS: JSON.stringify([
      { name: 'demo', timings: ['write'], command: nodeEval('process.stdout.write(JSON.stringify({errors:["bad graph"]}))') },
    ]),
  };
  const result = runValidationExtensions({ workspaceRoot: '/x', graphPath: 'g.json', mode: 'write', env });
  assert.deepEqual(result.errors, ['[demo] bad graph']);
  assert.deepEqual(result.warnings, []);
});

test('AT-ovx-3 configured-but-unavailable extension -> fail-close (blocking error)', () => {
  const env = {
    ARGO_VALIDATION_EXTENSIONS: JSON.stringify([
      { name: 'ghost', timings: ['write'], command: ['definitely-not-a-real-binary-xyz'] },
    ]),
  };
  const result = runValidationExtensions({ workspaceRoot: '/x', graphPath: 'g.json', mode: 'write', env });
  assert.equal(result.warnings.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /unavailable/);
});

test('AT-ovx-3b onError:"warn" opts an entry back to advisory (non-blocking)', () => {
  const env = {
    ARGO_VALIDATION_EXTENSIONS: JSON.stringify([
      { name: 'ghost', onError: 'warn', timings: ['write'], command: ['definitely-not-a-real-binary-xyz'] },
    ]),
  };
  const result = runValidationExtensions({ workspaceRoot: '/x', graphPath: 'g.json', mode: 'write', env });
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /unavailable/);
});

test('AT-ovx-4 ontology CLI (write) flags a violation and passes a valid graph', () => {
  const bad = makeWorkspace('endpoint-violation.json');
  const badResult = runCli(bad, 'write');
  assert.ok(badResult.errors.length >= 1, JSON.stringify(badResult));
  assert.ok(badResult.errors.some((e) => e.includes('cannot Depends On Agent Node')), JSON.stringify(badResult.errors));

  const good = makeWorkspace('valid.json');
  const goodResult = runCli(good, 'write');
  assert.deepEqual(goodResult.errors, [], JSON.stringify(goodResult));
});

test('AT-ovx-5 malformed configuration is ignored (no crash)', () => {
  assert.deepEqual(resolveValidationExtensions({ ARGO_VALIDATION_EXTENSIONS: 'not json' }), []);
  assert.deepEqual(resolveValidationExtensions({ ARGO_VALIDATION_EXTENSIONS: '{"a":1}' }), []);
  assert.deepEqual(resolveValidationExtensions({ ARGO_VALIDATION_EXTENSIONS: '[]' }), []);
});

test('AT-ovx-6 write scope=delta restricts validation to the touched subgraph', () => {
  const graph = {
    name: 'delta-scope',
    description: 'two disjoint endpoint violations',
    elements: [
      { id: 'team-1', name: 'Team 1', type: 'Team Node' },
      { id: 'agent-1', name: 'Agent 1', type: 'Agent Node' },
      { id: 'svc-9', name: 'Service 9', type: 'Service Node' },
      { id: 'team-9', name: 'Team 9', type: 'Team Node' },
    ],
    relationships: [
      { id: 'r1', name: 'Team 1 depends on Agent 1', type: 'Depends On', source_id: 'team-1', target_id: 'agent-1', source_name: 'Team 1', target_name: 'Agent 1', statement: 'Team 1 --(Depends On)--> Agent 1' },
      { id: 'r2', name: 'Service 9 depends on Team 9', type: 'Depends On', source_id: 'svc-9', target_id: 'team-9', source_name: 'Service 9', target_name: 'Team 9', statement: 'Service 9 --(Depends On)--> Team 9' },
    ],
    views: [{ view_id: 'view-root', view_name: 'SystemArchitecture', included_elements: ['team-1', 'agent-1', 'svc-9', 'team-9'], included_relationships: ['r1', 'r2'] }],
  };
  const ws = makeWorkspaceWithGraph(graph);

  const whole = runCli(ws, 'write', { scope: 'whole' });
  assert.equal(whole.errors.length, 2, JSON.stringify(whole.errors));

  const delta = runCli(ws, 'write', { scope: 'delta', env: { ARGO_VALIDATION_TOUCHED_RELATIONSHIPS: JSON.stringify(['r1']) } });
  assert.equal(delta.errors.length, 1, JSON.stringify(delta.errors));
  assert.match(delta.errors[0], /Agent 1/);
});
