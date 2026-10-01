'use strict';

// Acceptance tests for the schema-bundle decoupling (WP: separate schema/ontology).
//
// The toolchain is decoupled from a single hard-wired modeling language:
//   - default   : the built-in ArchiMate 3.2 (+ ARGO) bundle
//   - workspace : a repository's own bundle under <workspace>/.argo/schema
//   - override  : ARGO_SCHEMA_DIR
//
// Every test is written GIVEN-WHEN-THEN and exercised from an external view:
// the resolver, the graph-semantics validator, and the live MCP surface.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveSchemaBundle,
  resolveTypeEnums,
  loadSchemaBundleAndOntology,
  buildOntology,
} = require('../argo/scripts/schema-bundle.js');
const argoMcp = require('../argo/scripts/argo-mcp-server.js');
const qeaLib = require('../argo/scripts/ea-qea-sync-lib.js');
const {
  validateGraphSemantics,
  validateArchiMateEndpointMatrix,
  validateViewElementLimits,
} = require('../argo/scripts/graph-semantics.js');

function validateAll(graph, ontology) {
  const errors = [];
  validateGraphSemantics(graph, errors, ontology);
  validateArchiMateEndpointMatrix(graph, errors, { ontology });
  validateViewElementLimits(graph, errors, { ontology });
  return errors;
}

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js');
const DEFAULT_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'argo', 'schema', 'SystemArchitecture.schema.json'), 'utf8'),
);

const CUSTOM_ELEMENT_TYPES = ['Team Node', 'Service Node'];
const CUSTOM_RELATIONSHIP_TYPES = ['Depends On'];

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'schema-bundle-'));
}

function writeCustomBundle(workspaceRoot, options = {}) {
  const schemaDir = path.join(workspaceRoot, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });

  const schema = JSON.parse(JSON.stringify(DEFAULT_SCHEMA));
  schema.$defs.archimateElementType.enum = CUSTOM_ELEMENT_TYPES.slice();
  schema.$defs.archimateRelationshipType.enum = CUSTOM_RELATIONSHIP_TYPES.slice();
  fs.writeFileSync(path.join(schemaDir, 'SystemArchitecture.schema.json'), JSON.stringify(schema, null, 2));

  const config = {
    language: 'TeamA Ontology',
    invariants: {
      statementGrammar: true,
      endpointMatrix: options.endpointMatrix === true,
      rootViewName: 'SystemArchitecture',
      maxElementsPerView: 2,
    },
    ...(options.config || {}),
  };
  if (options.omitActorElementType !== true) {
    config.actorElementType = options.actorElementType === undefined ? 'Team Node' : options.actorElementType;
  }
  fs.writeFileSync(path.join(schemaDir, 'schema-bundle.config.json'), JSON.stringify(config, null, 2));

  if (options.rules) {
    fs.writeFileSync(path.join(schemaDir, 'schema-bundle.rules.json'), JSON.stringify(options.rules, null, 2));
  }
  return schemaDir;
}

function writeGraph(workspaceRoot, graph) {
  const graphPath = path.join(workspaceRoot, 'design', 'KG', 'SystemArchitecture.json');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  return graphPath;
}

function customGraph(overrides = {}) {
  return {
    name: 'TeamA',
    description: 'TeamA custom-schema graph',
    elements: [
      { id: 'team-a', name: 'Team A', type: 'Team Node' },
      { id: 'svc-a', name: 'Service A', type: 'Service Node' },
    ],
    relationships: [
      {
        id: 'rel-a',
        name: 'Team A depends on Service A',
        type: 'Depends On',
        source_id: 'team-a',
        target_id: 'svc-a',
        source_name: 'Team A',
        target_name: 'Service A',
        statement: 'Team A --(Depends On)--> Service A',
      },
    ],
    views: [
      {
        view_id: 'view-root',
        view_name: 'SystemArchitecture',
        included_elements: ['team-a', 'svc-a'],
        included_relationships: ['rel-a'],
      },
    ],
    ...overrides,
  };
}

function runServerTool(name, args, env) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'schema-bundle-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
  ].map(r => JSON.stringify(r)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [SERVER], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `server exited ${result.status}: ${String(result.stderr || '').slice(0, 800)}`);
  const responses = String(result.stdout || '').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const call = responses.find(r => r && r.id === 2);
  assert.ok(call && call.result, 'tools/call must respond');
  return JSON.parse(call.result.content[0].text);
}

test('AT schema-bundle: a workspace without .argo/schema resolves to the default ArchiMate 3.2 bundle', () => {
  // GIVEN a workspace that does not define its own schema
  const workspace = makeTempWorkspace();
  // WHEN the schema bundle is resolved
  const bundle = resolveSchemaBundle(workspace);
  const enums = resolveTypeEnums(bundle);
  // THEN the default bundle (ArchiMate 3.2) is used with the full default enums
  assert.equal(bundle.kind, 'default');
  assert.equal(bundle.config.language, 'ArchiMate 3.2');
  assert.equal(enums.elementTypes.length, 64);
  assert.equal(enums.relationshipTypes.length, 11);
  assert.ok(enums.elementTypes.includes('Business Actor'));
});

test('AT schema-bundle: a workspace with .argo/schema overrides the default bundle', () => {
  // GIVEN a workspace that ships its own schema under .argo/schema
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace);
  // WHEN the schema bundle is resolved
  const { bundle, ontology } = loadSchemaBundleAndOntology(workspace);
  // THEN the workspace bundle wins and exposes the custom language + types
  assert.equal(bundle.kind, 'workspace');
  assert.equal(ontology.language, 'TeamA Ontology');
  assert.deepEqual(ontology.elementTypes.sort(), CUSTOM_ELEMENT_TYPES.slice().sort());
  assert.deepEqual(ontology.relationshipTypes, CUSTOM_RELATIONSHIP_TYPES);
});

test('AT schema-bundle: ARGO_SCHEMA_DIR overrides even a workspace bundle', () => {
  // GIVEN a workspace bundle AND an explicit ARGO_SCHEMA_DIR pointing elsewhere
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace);
  const overrideDir = path.join(makeTempWorkspace(), 'explicit');
  fs.mkdirSync(overrideDir, { recursive: true });
  const schema = JSON.parse(JSON.stringify(DEFAULT_SCHEMA));
  schema.$defs.archimateElementType.enum = ['Only Node'];
  schema.$defs.archimateRelationshipType.enum = ['Links'];
  fs.writeFileSync(path.join(overrideDir, 'SystemArchitecture.schema.json'), JSON.stringify(schema));
  fs.writeFileSync(path.join(overrideDir, 'schema-bundle.config.json'), JSON.stringify({ language: 'Explicit', invariants: { endpointMatrix: false } }));
  // WHEN the bundle is resolved with the override
  const bundle = resolveSchemaBundle(workspace, { schemaDir: overrideDir });
  // THEN the explicit override is used
  assert.equal(bundle.kind, 'override');
  assert.deepEqual(resolveTypeEnums(bundle).elementTypes, ['Only Node']);
});

test('AT schema-bundle: graph-semantics accepts a workspace schema\'s custom types', () => {
  // GIVEN a workspace schema with custom element/relationship types
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace);
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // WHEN a graph using those types is validated
  const errors = validateAll(customGraph(), ontology);
  // THEN it is accepted
  assert.deepEqual(errors, []);
});

test('AT schema-bundle: graph-semantics rejects a default-only type under a custom schema', () => {
  // GIVEN a workspace schema that does NOT define ArchiMate types
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace);
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // WHEN a graph uses the default type 'Business Actor'
  const graph = customGraph();
  graph.elements[0].type = 'Business Actor';
  const errors = validateAll(graph, ontology);
  // THEN it is rejected naming the custom language
  assert.ok(errors.some(e => e.includes("unsupported TeamA Ontology element type 'Business Actor'")), JSON.stringify(errors));
});

test('AT schema-bundle: endpointMatrix off makes the endpoint invariant permissive', () => {
  // GIVEN a custom schema with the endpoint matrix disabled
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace, { endpointMatrix: false });
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // WHEN any custom relationship endpoint pairing is validated
  const errors = validateAll(customGraph(), ontology);
  // THEN no endpoint-matrix error is produced
  assert.equal(ontology.invariants.endpointMatrix, false);
  assert.deepEqual(errors, []);
});

test('AT schema-bundle: a custom rules matrix enforces its own endpoint legality', () => {
  // GIVEN a custom schema whose rules forbid Team Node --Depends On--> Service Node
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace, {
    endpointMatrix: true,
    rules: {
      relationshipTargetMatrix: { 'Depends On': { 'Team Node': [] } },
    },
  });
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // WHEN such a relationship is validated
  const errors = validateAll(customGraph(), ontology);
  // THEN it is rejected with the custom language's matrix label
  assert.equal(ontology.invariants.endpointMatrix, true);
  assert.ok(errors.some(e => e.includes('violates TeamA Ontology relationship matrix')), JSON.stringify(errors));
});

test('AT schema-bundle: per-view element limit comes from the resolved ontology', () => {
  // GIVEN a custom schema that allows at most 2 elements per view
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace, { endpointMatrix: false });
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // WHEN a graph puts 3 elements into one view
  const graph = customGraph();
  graph.elements.push({ id: 'svc-b', name: 'Service B', type: 'Service Node' });
  graph.views[0].included_elements = ['team-a', 'svc-a', 'svc-b'];
  const errors = validateAll(graph, ontology);
  // THEN the limit is enforced from the custom ontology (2), not the default 15
  assert.ok(errors.some(e => e.includes('at most 2 elements; found 3')), JSON.stringify(errors));
});

test('AT schema-bundle: MCP queryNeo4jGraph {schema:true} reports the workspace schema enums', () => {
  // GIVEN a workspace with a custom bundle
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace);
  writeGraph(workspace, customGraph());
  // WHEN the MCP schema projection is requested for that workspace
  const payload = runServerTool('queryNeo4jGraph', { schema: true, workspaceRoot: workspace }, { ARGO_REPO_ROOT: workspace });
  // THEN it returns the custom enums and language, not the default ones
  assert.equal(payload.status, 'passed');
  assert.equal(payload.schema.schemaKind, 'workspace');
  assert.deepEqual(payload.schema.archimateElementTypes.sort(), CUSTOM_ELEMENT_TYPES.slice().sort());
  assert.deepEqual(payload.schema.archimateRelationshipTypes, CUSTOM_RELATIONSHIP_TYPES);
  assert.equal(payload.schema.schemaLanguage, 'TeamA Ontology');
  assert.equal(payload.schema.actorElementType, 'Team Node');
  assert.equal(payload.schema.bundleValidation.status, 'passed');
});

test('AT schema-bundle: MCP validateSystemArchitecture passes for a custom-schema graph', () => {
  // GIVEN a valid graph written against a workspace's own schema
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace);
  writeGraph(workspace, customGraph());
  // WHEN validation is requested through the MCP server for that workspace
  const payload = runServerTool('validateSystemArchitecture', { workspaceRoot: workspace }, { ARGO_REPO_ROOT: workspace });
  // THEN it passes
  assert.equal(payload.status, 'passed');
});

test('AT schema-bundle: MCP validateSystemArchitecture fails when a graph uses a foreign type', () => {
  // GIVEN a graph that uses a default ArchiMate type the custom schema does not define
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace);
  const graph = customGraph();
  graph.elements[0].type = 'Business Actor';
  writeGraph(workspace, graph);
  // WHEN validation is requested through the MCP server
  const payload = runServerTool('validateSystemArchitecture', { workspaceRoot: workspace }, { ARGO_REPO_ROOT: workspace });
  // THEN it fails and names the custom language
  assert.equal(payload.status, 'failed');
  assert.ok(String(payload.stderr || '').includes('unsupported TeamA Ontology element type'), String(payload.stderr || '').slice(0, 500));
});

test('AT schema-bundle: the shipped default bundle is data-driven (schema-bundle.rules.json)', () => {
  // GIVEN the default bundle
  // WHEN its ontology is resolved
  const { bundle, ontology } = loadSchemaBundleAndOntology(ROOT);
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'argo', 'schema', 'schema-bundle.rules.json'), 'utf8'));
  // THEN the rule data ships as JSON (class matrix dialect), not code, so the
  // default can be replaced file-for-file like any custom bundle
  assert.equal(rules.dialect, 'archimate-class-matrix');
  assert.equal(Object.keys(rules.elementTypeMetadata).length, 64);
  assert.equal(bundle.kind, 'default');
  assert.equal(ontology.dialect, 'archimate-class-matrix');
  assert.equal(ontology.elementTypes.length, 64);
  assert.equal(ontology.relationshipTypes.length, 11);
});

test('AT schema-bundle: a default bundle carrying its own type-matrix rules is used as-is (replaceable default)', () => {
  // GIVEN a default-located bundle whose rules use the type-matrix dialect
  const synthetic = {
    kind: 'default',
    config: { language: 'My Default Ontology' },
    schemaDocument: {},
    rules: {
      dialect: 'type-matrix',
      elementTypeMetadata: { 'Thing': { layer: 'X' } },
      relationshipCategoryByType: { 'Links': 'C' },
      relationshipTargetMatrix: { Links: { Thing: ['Thing'] } },
    },
  };
  // WHEN the ontology is built
  const ontology = buildOntology(synthetic);
  // THEN it follows the bundle's own data (not the built-in ArchiMate code)
  assert.equal(ontology.kind, 'default');
  assert.equal(ontology.dialect, 'type-matrix');
  assert.equal(ontology.language, 'My Default Ontology');
  assert.deepEqual(ontology.elementTypes, ['Thing']);
  assert.deepEqual(ontology.relationshipTypes, ['Links']);
});

test('AT schema-bundle: the .qea projection maps custom types generically (never skipped)', () => {
  // GIVEN a custom ontology whose types/relationships are unknown to the ArchiMate mapper
  // WHEN the .qea projection mapping is applied
  // THEN it degrades to a generic EA shape (Class + stereotype = type name; Association)
  //      instead of failing or being skipped, so projection runs for any schema
  assert.equal(qeaLib.elementObjectType('Team Node'), 'Class');
  assert.equal(qeaLib.elementStereotype('Team Node'), 'TeamNode');
  assert.equal(qeaLib.elementObjectType('Business Actor'), 'Class');
  assert.equal(qeaLib.elementStereotype('Business Actor'), 'BusinessActor');
  assert.equal(qeaLib.relationshipMap('Depends On').connectorType, 'Association');
  assert.equal(qeaLib.relationshipMap('Assignment').connectorType, 'Association');
  assert.equal(qeaLib.relationshipMap('Triggering').connectorType, 'ControlFlow');
});

test('AT schema-bundle: the default ontology declares the ArchiMate delivery dependencies', () => {
  // GIVEN the default bundle (ArchiMate class matrix)
  const { ontology } = loadSchemaBundleAndOntology(ROOT);
  // THEN it declares the ArchiMate dependency mapping (preserves prior behaviour)
  assert.deepEqual(ontology.deliveryDependencies.sourceDependsOnTarget, ['Access', 'Assignment', 'Specialization', 'Composition', 'Aggregation']);
  assert.deepEqual(ontology.deliveryDependencies.targetDependsOnSource, ['Serving', 'Realization', 'Flow', 'Triggering', 'Influence']);
});

test('AT schema-bundle: a custom bundle declares its OWN delivery dependencies', () => {
  // GIVEN the shipped custom example (Team Graph)
  const { ontology } = loadSchemaBundleAndOntology(path.join(ROOT, 'custom-schema'));
  // THEN runArchitectureTests / semantic edges use the schema's own relationship types
  assert.deepEqual(ontology.deliveryDependencies.sourceDependsOnTarget, ['Depends On', 'Assigned To']);
  assert.deepEqual(ontology.deliveryDependencies.targetDependsOnSource, []);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT schema-bundle: deliveryDependencies referencing unknown relationship types fails validation', () => {
  // GIVEN a custom bundle whose deliveryDependencies names a relationship it does not define
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace, { config: { deliveryDependencies: { sourceDependsOnTarget: ['Depends On', 'Nonexistent'] } } });
  // WHEN the ontology is built
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // THEN bundle validation fails closed
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(ontology.bundleValidation.errors.some(e => e.includes("deliveryDependencies.sourceDependsOnTarget references unknown relationship type 'Nonexistent'")), JSON.stringify(ontology.bundleValidation));
});

test('AT schema-bundle: initializeWorkspace reports the resolved schema (kind + language)', async () => {
  // GIVEN a workspace with its own schema bundle (and a user-authored graph)
  const custom = makeTempWorkspace();
  writeCustomBundle(custom);
  writeGraph(custom, customGraph());
  // WHEN the workspace is initialized
  const customResult = await argoMcp.initializeWorkspace(custom);
  // THEN the result names the active schema
  assert.equal(customResult.schema.kind, 'workspace');
  assert.equal(customResult.schema.language, 'TeamA Ontology');
  assert.equal(customResult.schema.dialect, 'type-matrix');
  assert.equal(customResult.schema.actorElementType, 'Team Node');

  // GIVEN a workspace without its own schema
  const plain = makeTempWorkspace();
  const plainResult = await argoMcp.initializeWorkspace(plain);
  // THEN it reports the default ArchiMate 3.2 schema
  assert.equal(plainResult.schema.kind, 'default');
  assert.equal(plainResult.schema.language, 'ArchiMate 3.2');
  assert.equal(plainResult.schema.dialect, 'archimate-class-matrix');
  assert.equal(plainResult.schema.actorElementType, 'Business Actor');
});

test('AT schema-bundle: the built-in default schema auto-provides the packaged graph on a fresh workspace', async () => {
  // GIVEN a workspace with no schema override and no graph
  const ws = makeTempWorkspace();
  // WHEN initialized
  const result = await argoMcp.initializeWorkspace(ws);
  // THEN the built-in ArchiMate 3.2 default graph is copied
  assert.equal(result.schema.kind, 'default');
  assert.ok(result.createdFiles.includes('design/KG/SystemArchitecture.json'));
  const graph = JSON.parse(fs.readFileSync(path.join(ws, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
  assert.ok(graph.elements.some(e => e.type === 'Business Actor'));
});

test('AT schema-bundle: a custom schema with a user-authored graph initializes; the packaged graph is never copied', async () => {
  // GIVEN a custom schema and a user-authored graph
  const ws = makeTempWorkspace();
  writeCustomBundle(ws);
  writeGraph(ws, customGraph());
  // WHEN initialized
  const result = await argoMcp.initializeWorkspace(ws);
  // THEN it uses the user's graph and copies nothing
  assert.equal(result.schema.kind, 'workspace');
  assert.ok(!result.createdFiles.includes('design/KG/SystemArchitecture.json'), 'must not copy the packaged default graph');
  const graph = JSON.parse(fs.readFileSync(path.join(ws, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
  assert.deepEqual(graph.elements.map(e => e.type).sort(), ['Service Node', 'Team Node']);
});

test('AT schema-bundle: a custom schema without a graph fails closed (no packaged-graph copy)', async () => {
  // GIVEN a custom schema and a workspace with no graph
  const ws = makeTempWorkspace();
  writeCustomBundle(ws);
  // WHEN initialized
  // THEN it fails closed instead of injecting the mismatched packaged graph
  await assert.rejects(argoMcp.initializeWorkspace(ws), /No default graph for the custom schema/);
  assert.ok(!fs.existsSync(path.join(ws, 'design', 'KG', 'SystemArchitecture.json')));
});

test('AT schema-bundle: the repository default graph still validates against the default bundle', () => {
  // GIVEN the repository's canonical default graph
  const workspace = ROOT;
  // WHEN validation runs
  const result = spawnSync(process.execPath, [path.join(ROOT, 'argo', 'scripts', 'validateSystemArchitecture.js')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ARGO_REPO_ROOT: ROOT },
  });
  // THEN it passes (no regression to the default ArchiMate 3.2 path)
  assert.equal(result.status, 0, String(result.stderr || '').slice(0, 500));
});

test('AT schema-bundle: a valid actorElementType makes the bundle pass validation', () => {
  // GIVEN a custom bundle that declares its actor type among its element types
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace, { actorElementType: 'Team Node' });
  // WHEN the ontology is built
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // THEN the actor contract is satisfied (the wakeup gate can identify an Actor)
  assert.equal(ontology.actorElementType, 'Team Node');
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT schema-bundle: a bundle whose actorElementType is not a declared type fails validation', () => {
  // GIVEN a custom bundle whose actorElementType is not one of its element types
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace, { actorElementType: 'Business Actor' });
  // WHEN the ontology is built
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // THEN bundle validation fails, naming the actor type
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(ontology.bundleValidation.errors.some(e => e.includes("actorElementType 'Business Actor'")), JSON.stringify(ontology.bundleValidation));
});

test('AT schema-bundle: a custom bundle with no actor type declared fails validation (must declare or opt out)', () => {
  // GIVEN a custom bundle with no actorElementType and no 'Business Actor' in its enum
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace, { omitActorElementType: true });
  // WHEN the ontology is built
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // THEN it fails closed with a fix instruction (declare a type or set null)
  assert.equal(ontology.actorElementType, 'Business Actor');
  assert.equal(ontology.bundleValidation.status, 'failed');
  assert.ok(ontology.bundleValidation.errors.some(e => e.includes('actorElementType')), JSON.stringify(ontology.bundleValidation));
});

test('AT schema-bundle: actorElementType null is the explicit "no actor concept" opt-out', () => {
  // GIVEN a custom bundle that explicitly declares it has no actor concept
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace, { actorElementType: null });
  // WHEN the ontology is built
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  // THEN validation passes and actorElementType is null
  assert.equal(ontology.actorElementType, null);
  assert.equal(ontology.bundleValidation.status, 'passed');
});

test('AT schema-bundle: MCP validateSystemArchitecture fails closed on an invalid bundle', () => {
  // GIVEN a workspace whose bundle omits the actor type
  const workspace = makeTempWorkspace();
  writeCustomBundle(workspace, { omitActorElementType: true });
  writeGraph(workspace, customGraph());
  // WHEN validation is requested through the MCP server
  const payload = runServerTool('validateSystemArchitecture', { workspaceRoot: workspace }, { ARGO_REPO_ROOT: workspace });
  // THEN it fails with the bundle-validation error (writes cannot proceed on a misconfigured bundle)
  assert.equal(payload.status, 'failed');
  assert.ok(String(payload.stderr || '').includes('schema bundle:'), String(payload.stderr || '').slice(0, 500));
});

test('AT schema-bundle: the shipped custom-schema example bundle loads and validates end-to-end', () => {
  // GIVEN the recommended example bundle checked into custom-schema/
  const workspace = path.join(ROOT, 'custom-schema');
  // WHEN its ontology is resolved and its example graph is validated through the MCP
  const { ontology } = loadSchemaBundleAndOntology(workspace);
  assert.equal(ontology.language, 'Team Graph');
  assert.equal(ontology.actorElementType, 'Agent Node');
  assert.equal(ontology.bundleValidation.status, 'passed');
  const payload = runServerTool('validateSystemArchitecture', { workspaceRoot: workspace }, { ARGO_REPO_ROOT: workspace });
  // THEN both pass (the documented example is executable, not just descriptive)
  assert.equal(payload.status, 'passed', JSON.stringify(payload).slice(0, 500));
});
