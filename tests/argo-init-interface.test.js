'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'argo', 'skills', 'argo-init', 'SKILL.md');
const HARNESS = path.join(ROOT, 'argo', 'scripts', 'ensureArgoHarnessEnvironment.js');
const SUMMARY = path.join(ROOT, 'argo', 'scripts', 'argoInitSummary.js');
const CLI = path.join(ROOT, 'bin', 'argo-init.js');
const SANDBOX_CALLER = path.join(ROOT, 'sandbox', 'lib', 'argo-init-cli.js');

function okReport() {
  const root = path.join(os.tmpdir(), 'archgraph');
  return {
    status: 'ok',
    workspaceRoot: root,
    mode: 'prepare-and-check',
    reportPath: '.argo/temp/argo-harness-init-report.json',
    schemaBundle: {
      kind: 'workspace', language: 'Acme + UML 2 State Machine', dialect: 'archimate-class-matrix',
      actorElementType: 'Business Actor', bundleValidation: 'passed',
    },
    workspaceBootstrap: { status: 'ok' },
    mcp: { status: 'ok', toolCount: 8 },
    systemArchitecture: { status: 'ok', elementCount: 232, relationshipCount: 103, viewCount: 58 },
    ontology: {
      status: 'ok', language: 'Acme + UML 2 State Machine',
      elementTypes: new Array(71).fill('X'), relationshipTypes: new Array(12).fill('R'),
      invariants: { statementGrammar: true, endpointMatrix: true, rootViewName: 'x', maxElementsPerView: 15 },
      axioms: { disjointClasses: [['A', 'B']], functionalProperties: ['P'] },
      endpointMatrix: { Serves: { Service: ['Business Object', 'Data Object'] } },
      missing: { structure: [], constraints: [], axioms: [] },
    },
    ontologyValidation: { status: 'passed', errors: [] },
    neo4j: { status: 'ok', database: 'archgraph', initialSync: { counts: {} }, verification: { matches: true } },
    qeaFullProjection: { status: 'ok', qea: path.join(root, 'archgraph.qea'), ms: 286 },
    subdiagramViews: { status: 'ok', driftCount: 0, fixedCount: 0 },
    semanticLifecycle: { status: 'ok', state: 'Aligned', alignment: 'aligned' },
  };
}

// External-view acceptance tests for argo-init: init moved from an MCP tool
// (slow, human/skill-triggered, caused client timeouts) to the `argo-init` CLI,
// which runs the SAME implementation (initializeWorkspaceReport) — functionally
// identical. The harness module keeps its report builder.

test('AT argo-init: skill drives deterministic init via the argo-init CLI (init removed from MCP)', () => {
  // GIVEN the argo-init skill
  const skill = fs.readFileSync(SKILL, 'utf8');
  // THEN it keeps its identity frontmatter and drives the argo-init CLI ...
  assert.match(skill, /name: argo-init/, 'frontmatter name must be argo-init');
  assert.match(skill, /`argo-init`/, 'skill must drive the argo-init CLI');
  // ... referencing the shared implementation (so the CLI and the old MCP tool match)
  assert.match(skill, /initializeWorkspaceReport/, 'skill must reference the functionally-identical implementation');
  // ... and the CLI entry exists
  assert.ok(fs.existsSync(path.join(ROOT, 'bin', 'argo-init.js')), 'bin/argo-init.js must exist');
});

test('AT argo-init: ensureArgoHarnessEnvironment exports buildHarnessReport for in-process reuse', () => {
  // GIVEN the harness module
  const mod = require(HARNESS);
  // THEN it exposes the deterministic report builder (used by the init report)
  // and keeps the CLI entry, guarded so requiring the module has no side effects
  assert.equal(typeof mod.buildHarnessReport, 'function', 'must export buildHarnessReport');
  assert.equal(typeof mod.main, 'function', 'must keep the CLI main');
});

test('AT argo-init: default output is a CONCISE summary (no full report dump)', () => {
  // GIVEN a full ok report (which carries the ~180 KB endpoint matrix)
  const { renderInitSummary } = require(SUMMARY);
  const report = okReport();
  // WHEN it is rendered for the default CLI output
  const out = renderInitSummary(report);
  // THEN it is short and surfaces the human-actionable statuses ...
  assert.match(out, /ARGO INIT\s+OK/, 'overall status');
  assert.match(out, /schema: workspace \/ Acme \+ UML 2 State Machine/, 'schema line');
  assert.match(out, /ontologyValidation: passed/, 'ontology validation status (must be visible)');
  assert.match(out, /neo4j: ok[\s\S]*repo match: yes/, 'neo4j db == repo check');
  assert.match(out, /qea: ok[\s\S]*repo match: yes/, 'qea target == repo check');
  assert.match(out, /semanticLifecycle: ok[\s\S]*state=Aligned/, 'semantic lifecycle state');
  assert.match(out, /report: \.argo\/temp\/argo-harness-init-report\.json/, 'full-report pointer');
  // ... and does NOT dump the huge detail
  assert.ok(!/endpointMatrix/.test(out), 'must not print the endpoint matrix');
  assert.ok(out.length < 4096, `summary must stay small, was ${out.length} chars`);
});

test('AT argo-init: summary surfaces failures (blocking sections)', () => {
  // GIVEN a failed report (neo4j unreachable)
  const { renderInitSummary } = require(SUMMARY);
  const report = { status: 'failed', workspaceRoot: path.join(os.tmpdir(), 'archgraph'), neo4j: { status: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:7687' } };
  // WHEN rendered
  const out = renderInitSummary(report);
  // THEN the overall status and the exact failing section are reported
  assert.match(out, /ARGO INIT\s+FAILED/);
  assert.match(out, /failures:/);
  assert.match(out, /neo4j: connect ECONNREFUSED/);
});

test('AT argo-init: full report stays available via --json (callers request it)', () => {
  // GIVEN the CLI default is now a summary
  const cli = fs.readFileSync(CLI, 'utf8');
  // THEN the CLI renders the summary by default and the FULL JSON only on --json
  assert.match(cli, /renderInitSummary/, 'CLI must render the summary');
  assert.match(cli, /--json/, 'CLI must accept --json for the full report');
  assert.match(cli, /argoInitSummary\.js/, 'CLI must load the summary renderer');
  // AND the programmatic sandbox caller explicitly requests the full report
  const caller = fs.readFileSync(SANDBOX_CALLER, 'utf8');
  assert.match(caller, /--json/, 'sandbox caller must pass --json to keep the full report');
});
