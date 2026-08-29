'use strict';
// Functional behavior acceptance tests for ARGO MCP interfaces that were only
// "advertised" (registered in tools/list) but lacked a real behavior guard:
//   - getIntentElementContext : real in-process semantic subgraph resolution
//
// These are GIVEN-WHEN-THEN functional tests (external view), not static-file
// existence checks. They are registered in tests/acceptance-guardian.test.js as
// the guardianship entry for this interface.

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const systemArchitectureMcp = require(path.join(ROOT, 'argo', 'scripts', 'systemarchitecture-mcp-server.js'));

const STABLE_FOCUS_ELEMENT = 'overseer-vision-001';

test('AT getIntentElementContext: resolves a stable element into a semantic subgraph', async () => {
  // GIVEN a stable intent-graph element id (the project-vision Goal)
  // WHEN the getIntentElementContext tool resolves it in-process
  const result = await systemArchitectureMcp.callTool('getIntentElementContext', {
    elementId: STABLE_FOCUS_ELEMENT,
  });
  const payload = JSON.parse(result.content[0].text);
  // THEN the tool returns a passed subgraph focused on that element
  assert.equal(payload.status, 'passed');
  assert.equal(payload.focusElementId, STABLE_FOCUS_ELEMENT);
  assert.ok(payload.subgraph && Array.isArray(payload.subgraph.elements), 'subgraph.elements must be an array');
  assert.ok(
    payload.subgraph.elements.some(el => el && el.id === STABLE_FOCUS_ELEMENT),
    'focus element must be present in the resolved subgraph',
  );
  // AND dependency/dependent/association traversal fills the boundary
  assert.ok(payload.boundary && Array.isArray(payload.boundary.truncatedDependencies), 'boundary must be present');
});

test('AT getIntentElementContext: unknown element fails with a clear category', async () => {
  // GIVEN an element id that does not exist in the intent graph
  const result = await systemArchitectureMcp.callTool('getIntentElementContext', {
    elementId: 'definitely-not-an-element-xyz',
  });
  const payload = JSON.parse(result.content[0].text);
  // THEN the tool reports a failed resolution instead of a silent empty result
  assert.equal(payload.status, 'failed');
  assert.ok(typeof payload.error === 'string' && payload.error.length > 0, 'error message must be present');
});
