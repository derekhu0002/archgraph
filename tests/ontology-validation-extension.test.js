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

const { resolveValidationExtensions, runValidationExtensions, validationExtensionsReport } = require('../argo/scripts/validation-extensions.js');
const { describeOntology } = require('../argo/scripts/ontology-projection/describe.js');
const { resolveBundleAxioms, loadSchemaBundleAndOntology } = require('../argo/scripts/schema-bundle.js');

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

function makeLeanWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ovx-lean-'));
  const dir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, '.argo', 'schema', 'SystemArchitecture.schema.json'), path.join(dir, 'SystemArchitecture.schema.json'));
  fs.writeFileSync(path.join(dir, 'schema-bundle.config.json'), JSON.stringify({ language: 'Lean', actorElementType: 'Agent Node' }));
  // deliberately NO schema-bundle.rules.json and NO ontology-axioms.json
  const g = path.join(ws, 'design', 'KG');
  fs.mkdirSync(g, { recursive: true });
  fs.writeFileSync(path.join(g, 'SystemArchitecture.json'), JSON.stringify({
    name: 'Lean', description: 'd',
    elements: [{ id: 'agent-1', name: 'A', type: 'Agent Node' }],
    relationships: [{ id: 'r', name: 'r', type: 'Depends On', source_id: 'agent-1', target_id: 'agent-1', source_name: 'A', target_name: 'A', statement: 'A --(Depends On)--> A' }],
    views: [{ view_id: 'v', view_name: 'SystemArchitecture', included_elements: ['agent-1'], included_relationships: ['r'] }],
  }));
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

test('AT-ovx-7 validationExtensionsReport surfaces the ontology result (disabled / passed / failed)', () => {
  const disabled = validationExtensionsReport({ workspaceRoot: '/x', graphPath: 'g.json', env: {} });
  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.configured, false);
  assert.deepEqual(disabled.errors, []);

  const passEnv = {
    ARGO_VALIDATION_EXTENSIONS: JSON.stringify([{ name: 'ontology', timings: ['init'], command: nodeEval('process.stdout.write(JSON.stringify({errors:[]}))') }]),
  };
  const pass = validationExtensionsReport({ workspaceRoot: '/x', graphPath: 'g.json', env: passEnv });
  assert.equal(pass.status, 'passed');
  assert.equal(pass.configured, true);
  assert.deepEqual(pass.extensions, ['ontology']);
  assert.deepEqual(pass.errors, []);

  const failEnv = {
    ARGO_VALIDATION_EXTENSIONS: JSON.stringify([{ name: 'ontology', timings: ['init'], command: nodeEval('process.stdout.write(JSON.stringify({errors:["OWL: inconsistent"]}))') }]),
  };
  const fail = validationExtensionsReport({ workspaceRoot: '/x', graphPath: 'g.json', env: failEnv });
  assert.equal(fail.status, 'failed');
  assert.ok(fail.errors.some((e) => /OWL/.test(e)), JSON.stringify(fail.errors));
});

test('AT-ovx-8 describeOntology reports the full definition (types, matrix, constraints, axioms) + the gaps', () => {
  // rich bundle (rules + axioms) -> definition present, no structural/constraint/axiom-file gaps
  const rich = describeOntology({ workspaceRoot: FIXTURE });
  assert.equal(rich.status, 'ok');
  assert.ok(rich.elementTypes.includes('Team Node') && rich.elementTypes.includes('Service Node'), JSON.stringify(rich.elementTypes));
  assert.ok(rich.endpointMatrix['Depends On'], 'endpoint matrix present');
  assert.ok(Object.keys(rich.invariants).length > 0, 'invariants present');
  assert.ok(rich.axioms.disjointClasses.length >= 1, 'axioms present');
  assert.ok(!rich.missing.axioms.includes('ontology-axioms.json'), 'rich bundle has an axioms file');
  assert.ok(!rich.missing.constraints.some((m) => /endpoint matrix/.test(m)), 'rich bundle has an endpoint matrix');

  // lean bundle (no rules, no axioms) -> the gaps are named
  const lean = describeOntology({ workspaceRoot: makeLeanWorkspace() });
  assert.equal(lean.status, 'ok');
  assert.ok(lean.missing.constraints.some((m) => /endpoint matrix/.test(m)), JSON.stringify(lean.missing.constraints));
  assert.ok(lean.missing.axioms.some((m) => /ontology-axioms\.json/.test(m)), JSON.stringify(lean.missing.axioms));
  assert.ok(lean.missing.axioms.includes('functionalProperties'), JSON.stringify(lean.missing.axioms));
});

test('AT-ovx-9 describeOntology follows the extends chain (base endpoint matrix is not reported missing)', () => {
  // GIVEN this repo's own bundle (schema-bundle.config.json with "extends": "default")
  const o = describeOntology({ workspaceRoot: REPO });
  assert.equal(o.status, 'ok');
  // THEN the base bundle's endpoint matrix / metadata / categories are present
  assert.ok(Object.keys(o.endpointMatrix).length > 0, 'base endpoint matrix must be present via extends');
  assert.ok(Object.keys(o.elementTypeMetadata).length > 0, 'base type metadata must be present via extends');
  assert.ok(Object.keys(o.relationshipCategoryByType).length > 0, 'base relationship categories must be present via extends');
  // AND the endpoint matrix is NOT wrongly reported as missing
  assert.ok(!o.missing.constraints.some((m) => /endpoint matrix/.test(m)), JSON.stringify(o.missing.constraints));
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

// GitHub issue #10: the sidecar must read the SAME type vocabulary the core does.
// The endpoint matrix/axioms use CLASS tokens ("BusinessObject") while the graph
// stores DISPLAY names ("Business Object"); archimateClassByElementType is the
// bridge. Without it a legal edge is a false positive and every multi-word SOURCE
// type silently escapes its endpoint constraints.
const DEFAULT_BUNDLE = path.join(REPO, 'argo', 'schema');

function makeDefaultWorkspace(graph) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ovx-def-'));
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of ['SystemArchitecture.schema.json', 'schema-bundle.config.json', 'schema-bundle.rules.json']) {
    fs.copyFileSync(path.join(DEFAULT_BUNDLE, name), path.join(schemaDir, name));
  }
  const graphDir = path.join(ws, 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.writeFileSync(path.join(graphDir, 'SystemArchitecture.json'), JSON.stringify(graph));
  return ws;
}

test('AT-ovx-10 default bundle: class vocabulary aligned (no false positive; multi-word source enforced)', () => {
  // (a) LEGAL Requirement --Association--> Business Object must NOT be flagged
  //     (before: instance class Business_Object vs shape BusinessObject ->误报).
  const legal = makeDefaultWorkspace({
    name: 'vocab-legal', description: 'legal multi-word-target edge',
    elements: [
      { id: 'req-1', name: 'Req', type: 'Requirement' },
      { id: 'obj-1', name: 'Obj', type: 'Business Object' },
    ],
    relationships: [
      { id: 'r1', name: 'Req assoc Obj', type: 'Association', source_id: 'req-1', target_id: 'obj-1', source_name: 'Req', target_name: 'Obj', statement: 'Req --(Association)--> Obj' },
    ],
    views: [{ view_id: 'v', view_name: 'SystemArchitecture', included_elements: ['req-1', 'obj-1'], included_relationships: ['r1'] }],
  });
  const legalResult = runCli(legal, 'write');
  assert.deepEqual(legalResult.errors, [], JSON.stringify(legalResult));

  // (b) a violating edge whose SOURCE is a multi-word type (Application Interface)
  //     was previously SILENTLY SKIPPED (display name never matched the token);
  //     Application Interface --Assignment--> Business Object is outside the matrix.
  const violating = makeDefaultWorkspace({
    name: 'vocab-violating', description: 'multi-word source violation',
    elements: [
      { id: 'if-1', name: 'IF', type: 'Application Interface' },
      { id: 'obj-1', name: 'Obj', type: 'Business Object' },
    ],
    relationships: [
      { id: 'r1', name: 'IF assigns Obj', type: 'Assignment', source_id: 'if-1', target_id: 'obj-1', source_name: 'IF', target_name: 'Obj', statement: 'IF --(Assignment)--> Obj' },
    ],
    views: [{ view_id: 'v', view_name: 'SystemArchitecture', included_elements: ['if-1', 'obj-1'], included_relationships: ['r1'] }],
  });
  const violatingResult = runCli(violating, 'write');
  assert.ok(violatingResult.errors.length >= 1, JSON.stringify(violatingResult));
  assert.ok(
    violatingResult.errors.some((e) => e.includes('Application Interface') && e.includes('Assignment')),
    JSON.stringify(violatingResult.errors),
  );
});

test('AT-ovx-11 default bundle: instance classes and shapes share one class vocabulary', () => {
  const { loadModel } = require('../argo/scripts/ontology-projection/lib/model.js');
  const { projectGraph } = require('../argo/scripts/ontology-projection/lib/project.js');
  const { buildShapes } = require('../argo/scripts/ontology-projection/lib/shapes.js');
  const model = loadModel(DEFAULT_BUNDLE);

  const projected = projectGraph({ elements: [{ id: 'o', name: 'O', type: 'Business Object' }], relationships: [] }, model.typeClass);
  assert.match(projected, /<https:\/\/archgraph\.local\/class\/BusinessObject>/);
  assert.ok(!/class\/Business_Object/.test(projected), projected);

  const shapes = buildShapes(model);
  assert.match(shapes, /ex:BusinessObject/);
  assert.ok(!/ex:Business_Object/.test(shapes), 'shapes must not use the display-name underscore form');
});

// Follow-up to issue #10: an `extends` bundle keeps its endpoint matrix in the
// BASE dir. The CLI must validate against the CHAIN-MERGED rules, not the raw
// child dir — otherwise the matrix is silently empty and endpoints go unchecked
// (the same "silently no-op" failure mode, one level up).
function makeExtendsWorkspace(graph) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ovx-ext-'));
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, 'schema-bundle.config.json'), JSON.stringify({
    language: 'ExtendsTest', actorElementType: 'Business Actor', extends: 'default',
  }));
  const graphDir = path.join(ws, 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.writeFileSync(path.join(graphDir, 'SystemArchitecture.json'), JSON.stringify(graph));
  return ws;
}

test('AT-ovx-12 extends bundle: CLI validates against the merged base matrix (not the empty child dir)', () => {
  const elements = [
    { id: 'x-1', name: 'X', type: 'Application Interface' },
    { id: 'o-1', name: 'O', type: 'Business Object' },
  ];
  const views = [{ view_id: 'v', view_name: 'SystemArchitecture', included_elements: ['x-1', 'o-1'], included_relationships: ['r1'] }];
  // no ARGO_SCHEMA_DIR override, so the workspace `.argo/schema` (extends: default) resolves
  const env = { ARGO_SCHEMA_DIR: '' };

  // a legal edge under the inherited ArchiMate matrix must NOT be flagged
  const legal = makeExtendsWorkspace({
    name: 'extends-legal', description: 'legal edge through the extends bundle',
    elements: [{ id: 'req-1', name: 'Req', type: 'Requirement' }, { id: 'o-1', name: 'O', type: 'Business Object' }],
    relationships: [{ id: 'r1', name: 'Req assoc O', type: 'Association', source_id: 'req-1', target_id: 'o-1', source_name: 'Req', target_name: 'O', statement: 'Req --(Association)--> O' }],
    views: [{ view_id: 'v', view_name: 'SystemArchitecture', included_elements: ['req-1', 'o-1'], included_relationships: ['r1'] }],
  });
  assert.deepEqual(runCli(legal, 'write', { env }).errors, []);

  // a violating edge (Application Interface --Assignment--> Business Object) proves the
  // inherited matrix is actually enforced — it was silently skipped before this fix
  const violating = makeExtendsWorkspace({
    name: 'extends-violating', description: 'endpoint violation through the extends bundle',
    elements,
    relationships: [{ id: 'r1', name: 'X assigns O', type: 'Assignment', source_id: 'x-1', target_id: 'o-1', source_name: 'X', target_name: 'O', statement: 'X --(Assignment)--> O' }],
    views,
  });
  const violatingResult = runCli(violating, 'write', { env });
  assert.ok(violatingResult.errors.length >= 1, JSON.stringify(violatingResult));
  assert.ok(
    violatingResult.errors.some((e) => e.includes('Application Interface') && e.includes('Assignment')),
    JSON.stringify(violatingResult.errors),
  );
});

// AT-ovx-13: ontology axioms follow the `extends` chain (base axioms are not lost
// just because the child dir has no ontology-axioms.json).
test('AT-ovx-13 extends bundle: ontology axioms are chain-merged from the base', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ax-base-'));
  const child = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ax-child-'));
  fs.writeFileSync(path.join(base, 'ontology-axioms.json'), JSON.stringify({
    disjointClasses: [['Team Node', 'Service Node']],
    functionalProperties: ['Assigned To'],
    objectPropertyDomain: { 'Assigned To': 'Agent Node' },
    distinctIndividuals: true,
  }));
  fs.writeFileSync(path.join(child, 'ontology-axioms.json'), JSON.stringify({
    transitiveProperties: ['Depends On'],
    objectPropertyRange: { 'Assigned To': 'Team Node' },
  }));

  const merged = resolveBundleAxioms({ dir: child, chainDirsOriginal: [base, child] });
  assert.equal(merged.hasAxiomsFile, true);
  assert.deepEqual(merged.axioms.disjointClasses, [['Team Node', 'Service Node']]);
  assert.deepEqual(merged.axioms.functionalProperties, ['Assigned To']);
  assert.deepEqual(merged.axioms.transitiveProperties, ['Depends On']);
  assert.equal(merged.axioms.objectPropertyDomain['Assigned To'], 'Agent Node');
  assert.equal(merged.axioms.objectPropertyRange['Assigned To'], 'Team Node');
  assert.equal(merged.axioms.distinctIndividuals, true);

  // the defect: a CHILD with NO axioms file still inherits the base's
  const childNoAxioms = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ax-child2-'));
  const inherited = resolveBundleAxioms({ dir: childNoAxioms, chainDirsOriginal: [base, childNoAxioms] });
  assert.equal(inherited.hasAxiomsFile, true);
  assert.deepEqual(inherited.axioms.disjointClasses, [['Team Node', 'Service Node']]);

  // end-to-end: describeOntology surfaces the base axioms through the extends chain
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ax-ws-'));
  const schemaDir = path.join(ws, '.argo', 'schema');
  const baseDir = path.join(schemaDir, 'baseline');
  fs.mkdirSync(baseDir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, '.argo', 'schema', 'SystemArchitecture.schema.json'), path.join(schemaDir, 'SystemArchitecture.schema.json'));
  fs.writeFileSync(path.join(schemaDir, 'schema-bundle.config.json'), JSON.stringify({ id: 'child', language: 'Child', actorElementType: null, extends: 'baseline' }));
  fs.copyFileSync(path.join(FIXTURE, '.argo', 'schema', 'SystemArchitecture.schema.json'), path.join(baseDir, 'SystemArchitecture.schema.json'));
  fs.writeFileSync(path.join(baseDir, 'schema-bundle.config.json'), JSON.stringify({ id: 'baseline', language: 'Baseline' }));
  fs.writeFileSync(path.join(baseDir, 'schema-bundle.rules.json'), JSON.stringify({
    dialect: 'type-matrix',
    elementTypeMetadata: { Node: { layer: 'l', aspect: 'a' } },
    relationshipCategoryByType: { Link: 'Custom' },
    relationshipTargetMatrix: { Link: { Node: ['Node'] } },
  }));
  fs.writeFileSync(path.join(baseDir, 'ontology-axioms.json'), JSON.stringify({ disjointClasses: [['Node', 'Other']] }));
  const o = describeOntology({ workspaceRoot: ws });
  assert.equal(o.status, 'ok', JSON.stringify(o));
  assert.deepEqual(o.axioms.disjointClasses, [['Node', 'Other']]);
  assert.ok(!o.missing.axioms.includes('disjointClasses'), 'base disjointClasses must be seen as present');
});

// AT-ovx-14: for the archimate-class-matrix dialect the endpoint matrix is keyed by
// CLASS token, so bundle self-validation must check tokens against the class vocabulary
// (it previously skipped class-matrix bundles entirely).
function makeClassMatrixWorkspace(matrix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-cmx-'));
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, '.argo', 'schema', 'SystemArchitecture.schema.json'), path.join(schemaDir, 'SystemArchitecture.schema.json'));
  fs.writeFileSync(path.join(schemaDir, 'schema-bundle.config.json'), JSON.stringify({
    language: 'CMX',
    actorElementType: null,
    deliveryDependencies: { sourceDependsOnTarget: [], targetDependsOnSource: [] },
  }));
  fs.writeFileSync(path.join(schemaDir, 'schema-bundle.rules.json'), JSON.stringify({
    dialect: 'archimate-class-matrix',
    elementTypeMetadata: { Foo: { layer: 'l', aspect: 'a' }, Bar: { layer: 'l', aspect: 'a' } },
    archimateClassByElementType: { Foo: 'Foo', Bar: 'Bar' },
    relationshipCategoryByType: { Link: 'Dependency' },
    relationshipTargetMatrix: matrix,
  }));
  return ws;
}

test('AT-ovx-14 class-matrix bundle: matrix tokens are validated against the class vocabulary', () => {
  const good = loadSchemaBundleAndOntology(makeClassMatrixWorkspace({ Link: { Foo: ['Bar'] } }));
  assert.equal(good.ontology.bundleValidation.status, 'passed', JSON.stringify(good.ontology.bundleValidation));

  const bad = loadSchemaBundleAndOntology(makeClassMatrixWorkspace({ Link: { Foo: ['Baz'] } }));
  assert.equal(bad.ontology.bundleValidation.status, 'failed');
  assert.ok(
    bad.ontology.bundleValidation.errors.some((e) => /unknown element type token 'Baz'/.test(e)),
    JSON.stringify(bad.ontology.bundleValidation.errors),
  );
});

// AT-ovx-15: describeOntology flags class-matrix types that have no class mapping
// (they cannot be referenced by the endpoint matrix, so they are unconstrained).
test('AT-ovx-15 describeOntology flags class-matrix types with no class mapping', () => {
  const o = describeOntology({ workspaceRoot: REPO });
  assert.equal(o.status, 'ok');
  assert.ok(o.missing.constraints.some((m) => /without a class mapping/.test(m)), JSON.stringify(o.missing.constraints));
  assert.ok(o.missing.constraints.some((m) => /State/.test(m)), JSON.stringify(o.missing.constraints));
});

// Issue #11: a `*` target means "any target" (unconstrained). The pySHACL projection
// compiled it as a bogus `ex:_` class -> one false violation per edge; the JS engine
// honored it. Both must treat `*` as unconstrained.
function makeTypeMatrixWorkspace(matrix, graph) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-tmx-'));
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, '.argo', 'schema', 'SystemArchitecture.schema.json'), path.join(schemaDir, 'SystemArchitecture.schema.json'));
  fs.writeFileSync(path.join(schemaDir, 'schema-bundle.config.json'), JSON.stringify({
    language: 'TMX', actorElementType: null,
    deliveryDependencies: { sourceDependsOnTarget: [], targetDependsOnSource: [] },
  }));
  fs.writeFileSync(path.join(schemaDir, 'schema-bundle.rules.json'), JSON.stringify({
    dialect: 'type-matrix',
    elementTypeMetadata: { Grouping: { layer: 'l', aspect: 'a' }, Item: { layer: 'l', aspect: 'a' } },
    relationshipCategoryByType: { Composition: 'Structural' },
    relationshipTargetMatrix: matrix,
  }));
  const graphDir = path.join(ws, 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.writeFileSync(path.join(graphDir, 'SystemArchitecture.json'), JSON.stringify(graph));
  return ws;
}

const WILDCARD_GRAPH = {
  name: 'wildcard', description: 'Grouping --Composition--> Grouping taxonomy',
  elements: [{ id: 'g1', name: 'G1', type: 'Grouping' }, { id: 'g2', name: 'G2', type: 'Grouping' }],
  relationships: [{ id: 'c1', name: 'G1 comp G2', type: 'Composition', source_id: 'g1', target_id: 'g2', source_name: 'G1', target_name: 'G2', statement: 'G1 --(Composition)--> G2' }],
  views: [{ view_id: 'v', view_name: 'SystemArchitecture', included_elements: ['g1', 'g2'], included_relationships: ['c1'] }],
};

test('AT-ovx-16 wildcard `*` target is unconstrained in every engine', () => {
  // GIVEN a bundle whose matrix allows any target (`*`)
  const ws = makeTypeMatrixWorkspace({ Composition: { Grouping: ['*'] } }, WILDCARD_GRAPH);
  // WHEN validated THEN no false violation (deterministic engine)
  const res = runCli(ws, 'write');
  assert.deepEqual(res.errors, [], JSON.stringify(res));

  // AND the compiled SHACL artifact must NOT emit a bogus `ex:_` class for '*'
  const { loadModel } = require('../argo/scripts/ontology-projection/lib/model.js');
  const { buildShapes } = require('../argo/scripts/ontology-projection/lib/shapes.js');
  const shapes = buildShapes(loadModel(path.join(ws, '.argo', 'schema')));
  assert.ok(!/ex:_/.test(shapes), `wildcard must not compile to ex:_ :\n${shapes}`);

  // AND a genuine (non-wildcard) disallowed target is STILL enforced
  const strict = makeTypeMatrixWorkspace({ Composition: { Grouping: ['Item'] } }, WILDCARD_GRAPH);
  const strictRes = runCli(strict, 'write');
  assert.ok(strictRes.errors.length >= 1, JSON.stringify(strictRes));
});

// Issue #14: `ModelConcept` is the SIBLING wildcard token — the core class-matrix
// validator (`schema-bundle.js`) treats BOTH `*` and `ModelConcept` as "any
// target". Issue #11 fixed only `*`; this locks `ModelConcept` for both engines.
test('AT-ovx-18 ModelConcept wildcard target is unconstrained in every engine', () => {
  // GIVEN a bundle whose matrix allows any target via the ModelConcept token
  const ws = makeTypeMatrixWorkspace({ Composition: { Grouping: ['ModelConcept'] } }, WILDCARD_GRAPH);
  // WHEN validated THEN no false violation (deterministic engine)
  const res = runCli(ws, 'write');
  assert.deepEqual(res.errors, [], JSON.stringify(res));

  // AND the compiled SHACL artifact must NOT emit a bogus ModelConcept class
  const { loadModel } = require('../argo/scripts/ontology-projection/lib/model.js');
  const { buildShapes } = require('../argo/scripts/ontology-projection/lib/shapes.js');
  const shapes = buildShapes(loadModel(path.join(ws, '.argo', 'schema')));
  assert.ok(!/ModelConcept/.test(shapes), `wildcard must not compile to a ModelConcept class :\n${shapes}`);

  // AND a genuine (non-wildcard) disallowed target is STILL enforced
  const strict = makeTypeMatrixWorkspace({ Composition: { Grouping: ['Item'] } }, WILDCARD_GRAPH);
  const strictRes = runCli(strict, 'write');
  assert.ok(strictRes.errors.length >= 1, JSON.stringify(strictRes));
});

// Issue #12: `Assigned To` is functional WITHOUT `distinctIndividuals`. Under pure OWL
// open-world semantics two distinct targets are merely entailed EQUAL (NOT an
// inconsistency), so the real engine silently passed the write. A functional property
// is an "at most one" constraint, so BOTH engines must report the conflict with the
// same closed-world rule (deterministic here; the real engine via the sandbox
// `functional-open` sample + run-real.js in the container acceptance). This locks the
// cross-engine contract on the deterministic side.
const FUNCTIONAL_FIXTURE = path.join(REPO, 'sandbox', 'ontology-projection', 'samples', 'functional-open');

function makeFunctionalWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ovx-fn-'));
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of fs.readdirSync(path.join(FUNCTIONAL_FIXTURE, '.argo', 'schema'))) {
    fs.copyFileSync(path.join(FUNCTIONAL_FIXTURE, '.argo', 'schema', name), path.join(schemaDir, name));
  }
  const graphDir = path.join(ws, 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.copyFileSync(path.join(FUNCTIONAL_FIXTURE, 'graphs', 'functional-open.json'), path.join(graphDir, 'SystemArchitecture.json'));
  return ws;
}

test('AT-ovx-17 functional conflict is enforced WITHOUT distinctIndividuals (engine-consistency contract)', () => {
  const ws = makeFunctionalWorkspace();
  // `distinctIndividuals` is deliberately absent
  const axioms = JSON.parse(fs.readFileSync(path.join(ws, '.argo', 'schema', 'ontology-axioms.json'), 'utf8'));
  assert.notEqual(axioms.distinctIndividuals, true, 'the sample must NOT declare distinctIndividuals');

  const res = runCli(ws, 'write');
  assert.ok(
    res.errors.some((e) => /functional 'Assigned To' of 'agent-1' has 2 distinct values/.test(e)),
    JSON.stringify(res),
  );
});
