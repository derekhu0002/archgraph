'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = [
  path.join(ROOT, 'eatool', 'EA-jsscript', 'import-from-kg.js'),
  path.join(ROOT, 'eatool', 'EA-jsscript', 'import-from-external-package.js'),
];

function readScript(file) {
  assert.ok(existsSync(file), `script should exist: ${file}`);
  return readFileSync(file, 'utf8');
}

test('ea-import-perf: UI updates are disabled during import and re-enabled after', () => {
  // GIVEN both EA import scripts
  // WHEN each script's main flow is inspected
  // THEN UI updates are disabled at import start and re-enabled when import finishes
  for (const file of SCRIPTS) {
    const content = readScript(file);
    const label = path.basename(file);
    assert.match(content, /Repository\.EnableUIUpdates\s*\(\s*false\s*\)/, `${label} should disable UI updates during import`);
    assert.match(content, /Repository\.EnableUIUpdates\s*\(\s*true\s*\)/, `${label} should re-enable UI updates after import`);
  }
});

test('ea-import-perf: a single Project Browser refresh happens only after import completes', () => {
  // GIVEN both EA import scripts
  // WHEN the tree-refresh call is located relative to the UI re-enable call
  // THEN the tree is refreshed exactly once, only after import finishes (not during import)
  for (const file of SCRIPTS) {
    const content = readScript(file);
    const label = path.basename(file);

    const refreshMatches = content.match(/Repository\.RefreshModelView\s*\(/g) || [];
    assert.equal(refreshMatches.length, 1, `${label} should refresh the Project Browser tree exactly once`);

    const reEnableIndex = content.indexOf('Repository.EnableUIUpdates(true)');
    const refreshIndex = content.indexOf('Repository.RefreshModelView');
    assert.ok(reEnableIndex >= 0, `${label} should re-enable UI updates`);
    assert.ok(
      refreshIndex > reEnableIndex,
      `${label} should refresh the tree only after re-enabling UI updates (i.e., after import completes)`
    );
  }
});

test('ea-import-perf: import does not auto-open any diagram/view', () => {
  // GIVEN both EA import scripts
  // WHEN the view-handling flow is inspected
  // THEN no diagram/view is opened automatically after import
  for (const file of SCRIPTS) {
    const content = readScript(file);
    const label = path.basename(file);
    assert.doesNotMatch(
      content,
      /Repository\.OpenDiagram|\.OpenDiagram\s*\(|Repository\.ShowInProjectView|\.ShowInProjectView\s*\(/,
      `${label} should not auto-open any diagram/view`
    );
  }
});

test('ea-import-perf: auto-layout is disabled so diagrams are not opened one by one', () => {
  // GIVEN both EA import scripts
  // WHEN the layout flag is inspected
  // THEN auto-layout is off, so LayoutDiagramEx is not invoked per diagram during import
  for (const file of SCRIPTS) {
    const content = readScript(file);
    const label = path.basename(file);
    assert.match(
      content,
      /ENABLE_AUTOLAYOUT\s*=\s*false/,
      `${label} should keep auto-layout off (LayoutDiagramEx opens diagrams one by one)`
    );
  }
});
