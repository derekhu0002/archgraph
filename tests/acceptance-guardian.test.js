'use strict';
// Functional Acceptance Guardianship registry (验收看护).
//
// From ARCHGRAPH HARNESS usage scenarios, every ARGO MCP interface and every core
// framework deliverable (RULE / SKILL / schema / Neo4j projection / semantic
// lifecycle / eval harness / project deliverables) must be guarded by an
// EXECUTABLE functional acceptance test (external view), not a static-file check.
//
// This file is the registry driver + continuous guardian:
//   1. coverage completeness  — every ARGO MCP interface / deliverable maps to a
//      real functional test file (regression fails if an interface loses coverage);
//   2. mount executability     — the acceptance-guardian element mounted in the
//      intent graph must carry bare executable acceptanceCriteria (so
//      runArchitectureTests can run them, not the legacy descriptive/invalid ones);
//   3. pipeline guard          — the runArchitectureTests executor must keep
//      handling bare test paths (guards against the "invalid-criteria" regression).
//
// All registry entries below are the single source of truth for guardianship.
// When adding an interface or deliverable, add a guard entry AND mount an
// executable AT on the corresponding graph element.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_PATH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const GUARDIAN_ELEMENT_ID = 'acceptance-guardian-001';

// ---- Functional acceptance registry (single source of truth) ----------------
// [interfaceName, testFile] — each ARGO MCP interface guard.
const MCP_INTERFACE_GUARDS = [
  ['initializeWorkspace', 'tests/argo-workspace-bootstrap.test.js'],
  ['initializeWorkspace', 'tests/argo-init-interface.test.js'],
  ['getSystemArchitecture', 'tests/argo-mcp-tools.test.js'],
  ['getSystemArchitecture', 'tests/argo-global-install.test.js'],
  ['getSystemArchitecture', 'tests/argo-semantic-scope.test.js'],
  ['getIntentElementContext', 'tests/mcp-interface-behavior.test.js'],
  ['getArchitectureViewContext', 'tests/architecture-view-context.test.js'],
  ['queryNeo4jGraph', 'tests/neo4j-cypher-query.test.js'],
  ['memory_search', 'tests/semantic-memory-search.test.js'],
  ['addArchitectureElement', 'tests/architecture-element-mutation.test.js'],
  ['updateArchitectureElement', 'tests/architecture-element-mutation.test.js'],
  ['removeArchitectureElement', 'tests/architecture-element-mutation.test.js'],
  ['addArchitectureRelationship', 'tests/architecture-element-mutation.test.js'],
  ['updateArchitectureRelationship', 'tests/architecture-element-mutation.test.js'],
  ['removeArchitectureRelationship', 'tests/architecture-element-mutation.test.js'],
  ['addArchitectureView', 'tests/architecture-view-mutation.test.js'],
  ['updateArchitectureView', 'tests/architecture-view-mutation.test.js'],
  ['removeArchitectureView', 'tests/architecture-view-mutation.test.js'],
  ['previewSystemArchitectureMutation', 'tests/ea-web-service-impl.test.js'],
  ['applySystemArchitectureMutation', 'tests/ea-web-service-impl.test.js'],
  ['validateSystemArchitecture', 'tests/argo-global-install.test.js'],
  ['runArchitectureTests', 'tests/acceptance-guardian.test.js'],
];

// [deliverableLabel, testFile] — core framework deliverable guards.
const DELIVERABLE_GUARDS = [
  ['RULE: KG-first / semantic-first retrieval', 'tests/argo-rules-query.test.js'],
  ['RULE: change-tier gate', 'tests/argo-rules-change-tier.test.js'],
  ['RULE: capability delegation', 'tests/argo-rules-capability-delegation.test.js'],
  ['RULE: content storage (docs into KG)', 'tests/argo-rules-content-storage.test.js'],
  ['SKILL: argo-init drives initializeWorkspace (functional, no external script)', 'tests/argo-init-interface.test.js'],
  ['Schema / ArchiMate 3.2 constraint', 'tests/aml-standard.test.js'],
  ['Neo4j structural projection & sync', 'tests/neo4j-sync-staleness.test.js'],
  ['Semantic lifecycle (ACL / threshold / backfill)', 'tests/semantic-acl-posix.test.js'],
  ['Semantic backfill reconcile', 'tests/semantic-backfill-reconcile.test.js'],
  ['Eval harness deliverable (eval-seed)', 'tests/eval-seed.test.js'],
  ['Web project deliverable', 'tests/website.test.js'],
  ['WeChat publishing deliverable', 'tests/wechat-article.test.js'],
  ['EA tooling deliverable (web-service + import)', 'tests/ea-web-service-impl.test.js'],
];

const ALL_GUARDS = [...MCP_INTERFACE_GUARDS.map(([name, file]) => ({ kind: 'mcp-interface', name, file })), ...DELIVERABLE_GUARDS.map(([name, file]) => ({ kind: 'deliverable', name, file }))];

test('AT acceptance-guardian: every registry entry maps to an existing, non-empty functional test', () => {
  // GIVEN the functional registry is the single source of truth
  // THEN every entry points to a real, non-trivial test file (functional, not static)
  for (const entry of ALL_GUARDS) {
    const file = path.join(ROOT, entry.file);
    assert.ok(fs.existsSync(file), `${entry.kind}:${entry.name} -> missing test file ${entry.file}`);
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(src.length > 200, `${entry.kind}:${entry.name} -> ${entry.file} looks empty (functional test expected)`);
  }
});

test('AT acceptance-guardian: every ARGO MCP interface has a functional guard', () => {
  // GIVEN the canonical ARGO MCP interface set exposed to agents
  const interfaces = [
    'initializeWorkspace',
    'getSystemArchitecture',
    'getIntentElementContext',
    'getArchitectureViewContext',
    'queryNeo4jGraph',
    'memory_search',
    'addArchitectureElement',
    'updateArchitectureElement',
    'removeArchitectureElement',
    'addArchitectureRelationship',
    'updateArchitectureRelationship',
    'removeArchitectureRelationship',
    'addArchitectureView',
    'updateArchitectureView',
    'removeArchitectureView',
    'previewSystemArchitectureMutation',
    'applySystemArchitectureMutation',
    'validateSystemArchitecture',
    'runArchitectureTests',
  ];
  const covered = new Set(MCP_INTERFACE_GUARDS.map(([name]) => name));
  // THEN every interface appears in the registry (coverage cannot silently regress)
  for (const iface of interfaces) {
    assert.ok(covered.has(iface), `ARGO MCP interface ${iface} lacks a functional guard in the registry`);
  }
});

test('AT acceptance-guardian: every graph-mounted AT is an executable bare path', () => {
  // GIVEN the intent graph carries mounted acceptance testcases (user-view, merged per control point)
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
  const mounted = (graph.elements || []).filter(el => Array.isArray(el.testcases) && el.testcases.length > 0);
  assert.ok(mounted.length > 0, 'intent graph must carry mounted AT testcases');
  // THEN the acceptance-guardian element is mounted and every mounted AT has a bare
  //     workspace-relative acceptanceCriteria that resolves to an existing file
  const guardian = (graph.elements || []).find(el => el.id === GUARDIAN_ELEMENT_ID);
  assert.ok(guardian && Array.isArray(guardian.testcases) && guardian.testcases.length > 0,
    `guardian element ${GUARDIAN_ELEMENT_ID} must be mounted with executable ATs`);
  for (const el of mounted) {
    for (const tc of el.testcases) {
      assert.ok(typeof tc.acceptanceCriteria === 'string' && tc.acceptanceCriteria.trim() !== '',
        `${el.id} ${tc.name}: acceptanceCriteria must be a bare test path`);
      const resolved = path.join(ROOT, ...tc.acceptanceCriteria.split('/'));
      assert.ok(fs.existsSync(resolved), `${el.id} ${tc.name}: mounted criteria ${tc.acceptanceCriteria} must exist`);
    }
  }
});

test('AT acceptance-guardian: runArchitectureTests executor keeps handling bare test paths', () => {
  // GIVEN the runArchitectureTests executor (the guardianship pipeline)
  const defaultExecutor = require(path.join(ROOT, 'argo', 'scripts', 'test-executors', 'default.js'));
  // THEN a bare workspace-relative test path is executable ...
  assert.equal(defaultExecutor.canHandle('tests/acceptance-guardian.test.js', ROOT), true,
    'bare test path must be handled by the default executor');
  assert.equal(defaultExecutor.canHandle('tests/website.test.js', ROOT), true);
  // AND a descriptive/human sentence (the legacy invalid-criteria format) is rejected,
  // so the "invalid-criteria" regression cannot silently return.
  assert.equal(defaultExecutor.canHandle('执行 node --test tests/website.test.js：断言首页存在。通过。', ROOT), false,
    'descriptive acceptanceCriteria must be rejected (keeps mounted ATs executable)');
});
