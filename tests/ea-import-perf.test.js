'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// WP2100 EA 导入脚本：import-from-external-package.js 已于仓库清理（6971c3b）移除，仅剩 import-from-kg.js。
const SCRIPTS = [
  path.join(ROOT, 'eatool', 'EA-jsscript', 'import-from-kg.js'),
];
// WP2100 优化断言的目标脚本：import-from-kg.js（EA 导入脚本）。
const KG_SCRIPT = path.join(ROOT, 'eatool', 'EA-jsscript', 'import-from-kg.js');

function readScript(file) {
  assert.ok(existsSync(file), `script should exist: ${file}`);
  return readFileSync(file, 'utf8');
}

function sectionBetween(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  assert.ok(start >= 0, `section start marker not found: ${startMarker}`);
  const end = content.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `section end marker not found after ${startMarker}`);
  return content.slice(start, end);
}

test('ea-import-perf: UI updates are disabled during import and re-enabled after', () => {
  // GIVEN the EA import script
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
  // GIVEN the EA import script
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
  // GIVEN the EA import script
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
  // GIVEN the EA import script
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

test('ea-import-perf (AT-2100-OPT-02): import-from-kg avoids the per-object update-then-full-collection-Refresh slow pattern', () => {
  // GIVEN the WP2100 speed-optimised import-from-kg.js
  // WHEN scanning its hot loops (element / relationship / view import paths)
  // THEN collection refresh is centralized in the refreshCollection helper and the per-object
  //      import loops contain no direct .Refresh() call; total direct .Refresh() stays tiny
  const content = readScript(KG_SCRIPT).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const label = path.basename(KG_SCRIPT);

  assert.match(content, /function\s+refreshCollection\s*\(/, `${label} should centralize collection refresh`);
  const directRefreshCount = (content.match(/\.Refresh\s*\(/g) || []).length;
  assert.ok(directRefreshCount <= 4, `${label} should keep direct .Refresh() calls ≤4 (actual ${directRefreshCount})`);

  // 元素导入热路径（ensureElement 到 findChildByName 区间）：无直接集合刷新
  const elementHot = sectionBetween(content, 'function ensureElement(', 'function findChildByName');
  assert.doesNotMatch(elementHot, /\.Refresh\s*\(/, `${label} element hot path must not refresh collections per object`);

  // 关系导入热路径（importRelationships 到 applyRelationshipFields 区间）：无直接集合刷新
  const relHot = sectionBetween(content, 'function importRelationships(', 'function applyRelationshipFields');
  assert.doesNotMatch(relHot, /\.Refresh\s*\(/, `${label} relationship hot path must not refresh collections per object`);
});

test('ea-import-perf (AT-2100-OPT-02): import-from-kg is structurally idempotent (update-in-place by schema_id, no duplicate on re-import)', () => {
  // GIVEN importing the same knowledge graph twice
  // WHEN inspecting the import key paths of import-from-kg.js
  // THEN objects are looked up by schema_id (elements / relationships / views) before creation and
  //      updated in place; child collections are find-or-add by name; no recreate/delete-anywhere
  const content = readScript(KG_SCRIPT).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const label = path.basename(KG_SCRIPT);

  // 元素：先查（existingBySchemaId）后建（addElementToOwner），已有元素仅 updateElementFields
  const elementHot = sectionBetween(content, 'function ensureElement(', 'function findChildByName');
  assert.match(elementHot, /existingBySchemaId\[schemaId\]/, `${label} elements must be looked up by schema_id first`);
  assert.match(elementHot, /updateElementFields\s*\(existing/, `${label} existing elements must be updated in place`);
  assert.doesNotMatch(elementHot, /\.Delete\s*\(/, `${label} element path must never delete-then-recreate`);

  // 关系：按 schema_id 查既有 connector，更新走 applyRelationshipFields
  const relHot = sectionBetween(content, 'function importRelationships(', 'function applyRelationshipFields');
  assert.match(relHot, /existingBySchemaId\[data\.id\]/, `${label} relationships must be looked up by schema_id first`);
  assert.doesNotMatch(relHot, /\.Delete\s*\(/, `${label} relationship path must never delete-then-recreate`);

  // 视图：按 schema_view_id 查既有图，复用分支更新字段
  const viewHot = sectionBetween(content, 'function ensureDiagram(', 'function storeDiagramViewIdFallback');
  assert.match(viewHot, /existingByViewId\[viewData\.view_id\]/, `${label} views must be looked up by schema_view_id first`);
  assert.match(viewHot, /return\s+'updated'/, `${label} reused diagrams must return updated`);
  assert.doesNotMatch(viewHot, /\.Delete\s*\(/, `${label} view path must never delete-then-recreate`);

  // 子集合（属性/方法/测试/资源/Issue）按名先查后建，避免重复导入产生重复子对象
  assert.match(content, /function\s+findChildByName\s*\(/, `${label} should define a find-or-add-by-name child helper`);
});
