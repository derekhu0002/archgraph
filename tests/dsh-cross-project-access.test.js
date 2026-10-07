'use strict';

// Acceptance tests for the LOCAL cross-project access boundary under DeepSeek Harness (dsh).
//
// External view: what a caller of the dsh-hosted ARGO MCP surface can and cannot do with
// ANOTHER local project's graph, plus the executable counterpart of the README section
// "Cross-project read/write".
//
// Why these assertions: the dsh bridge replaces the per-call `workspaceRoot` with the session
// workspace AFTER spreading the model's arguments, so a model-supplied value can never win. That
// single line is what makes local cross-project read/write impossible on dsh, and it is what makes
// the server-side WRITE guard take its allow branch instead of its deny branch. Nothing else in the
// suite pins that ordering, so a regression to `{...args, workspaceRoot}` order (or to an
// overwrite-able injection) would silently re-open cross-project access.
//
// Scope note: the guard's deny branch and the absolute-path cross-project READ are server
// behaviours; they belong to tests/workspace-write-guard.test.js (direct MCP spawn) and are NOT
// re-asserted here. The ARGO MCP tool surface is covered by the acceptance guardianship registry.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE_PATH = path.join(ROOT, 'dsh-argo-workspace', 'index.js');
const README_PATH = path.join(ROOT, 'README.md');

const BRIDGE = fs.readFileSync(BRIDGE_PATH, 'utf8');
const README = fs.readFileSync(README_PATH, 'utf8');

const HARNESSES = ['OpenCode', 'Codex', 'DeepSeek Harness', 'GitHub Copilot', 'Cursor', 'OpenClaw'];

function sectionAfter(md, heading) {
  const re = new RegExp('## ' + heading + '[\\s\\S]*?(?=\\n## |$)');
  const match = md.match(re);
  return match ? match[0] : '';
}

test('AT dsh-cross-project-access-01: the dsh bridge cannot be overridden by a model-supplied workspaceRoot', () => {
  // GIVEN the dsh workspace bridge, which registers every ARGO tool as mcp__argo__* and injects the
  //       per-call workspace from the durable session header (SessionHeader.cwd)
  assert.match(BRIDGE, /export const name = 'dsh-argo-workspace'/, 'bridge must export its name');
  assert.match(BRIDGE, /mcp__' \+ id \+ '__/, 'bridge must register the mcp__<id>__ tool family');
  assert.match(BRIDGE, /header\?\.cwd/, 'bridge must take the session workspace from SessionHeader.cwd');

  // WHEN the injection runs for a call
  // THEN it spreads the model's arguments FIRST and then overwrites workspaceRoot and the
  //      broker-only sessionWorkspaceRoot, so a model-supplied value can never win
  assert.match(
    BRIDGE,
    /const injected = \{ \.\.\.\(args[^)]*\) \}[\s\S]{0,400}?injected\.workspaceRoot = sessionCwd/,
    'workspaceRoot must be injected AFTER spreading the model arguments (model value must not win)',
  );
  assert.match(
    BRIDGE,
    /injected\.sessionWorkspaceRoot = sessionCwd/,
    'the broker-only trusted channel must be injected next to workspaceRoot',
  );
  assert.ok(
    BRIDGE.indexOf('injected.workspaceRoot = sessionCwd') > BRIDGE.indexOf('const injected = {'),
    'the overwrite must come after the spread, never before',
  );

  // AND injection is gated per server, and a missing session workspace never forwards the field
  assert.match(BRIDGE, /injectWorkspaceRoot/, 'injection must be switchable per configured server');
  assert.match(
    BRIDGE,
    /delete injected\.sessionWorkspaceRoot/,
    'a missing session workspace must drop the trusted field rather than forward a model value',
  );
});

test('AT dsh-cross-project-access-02: the local cross-project boundary is documented per harness', () => {
  // GIVEN local cross-project access depends on the harness bridging behaviour
  // WHEN a reader opens the README cross-project section
  // THEN every supported harness is listed, the dsh local limitation is stated, and the two
  //      independent channels (local path vs federated projectId) are not conflated
  const section = sectionAfter(README, 'Cross-project read/write');
  assert.ok(section, 'README must carry the Cross-project read/write section');

  for (const harness of HARNESSES) {
    assert.match(section, new RegExp(harness), `README must list ${harness} in the per-harness table`);
  }
  assert.match(section, /待测|not yet tested/i, 'README must mark the not-yet-tested harnesses');
  assert.match(section, /不涉及|not applicable/i, 'README must mark harnesses the scenario does not apply to');

  // the dsh limitation must be stated in the reader's own words, not only in code identifiers
  assert.match(section, /DeepSeek Harness/, 'README must name DeepSeek Harness');
  assert.match(
    section,
    /cannot[^.\n]*local cross-project/i,
    'README must state plainly that DeepSeek Harness cannot do local cross-project access',
  );

  // both channels named, plus the read-only contract and the guard branch that never fires on dsh
  assert.match(section, /workspaceRoot/, 'README must name the per-call local workspaceRoot channel');
  assert.match(section, /projectId/, 'README must name the federated projectId channel');
  assert.match(section, /WORKSPACE_WRITE_DENIED/, 'README must name the server-side write guard branch');
  assert.match(section, /read-only/i, 'README must state the cross-project read-only contract');
  assert.match(section, /federation center/i, 'README must point at the federated read path that does work');
});
