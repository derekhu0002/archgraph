'use strict';

// AT-2100-OPT-01（WP2100 优化）：导入脚本固定同步根包 + 幂等对账 + 删除清单人工确认。
// 静态审查 eatool/EA-jsscript/import-from-kg.js（EA 脚本在 JScript 引擎运行，无法在 CI 真跑）：
//   ① 目标包为固定名同步根包（不存在则先建、复用不再时间戳新包）；
//   ② 幂等分支：按 schema_id 匹配已存在 → update 不重建；图谱独有 → add；
//   ③ 删除分支：对账包内图谱缺失对象收集删除清单且需人类确认后才执行；
//   ④ UI 刷新只在最后/收口（无逐对象/逐集合 Refresh 刷屏）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'eatool', 'EA-jsscript', 'import-from-kg.js');

function readScript() {
  assert.ok(existsSync(SCRIPT), `script should exist: ${SCRIPT}`);
  // 归一化行尾，保证跨 CRLF/LF 检出的字面量匹配稳定。
  return readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sectionBetween(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  assert.ok(start >= 0, `section start marker not found: ${startMarker}`);
  const end = endMarker === null ? content.length : content.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `section end marker not found after ${startMarker}: ${endMarker}`);
  return content.slice(start, end);
}

test('ea-import-reconcile: 固定名同步根包——建/复用，不再时间戳新包', () => {
  // GIVEN import-from-kg.js 的导入包创建逻辑
  // WHEN 解析其命名与创建/复用分支
  // THEN 使用固定名 IMPORT_PACKAGE_NAME = "ArchGraph Sync"：findChildPackageByName 复用既有，
  //       reconcileSyncPackage 仅在其缺失时新建；全文件不再出现时间戳命名/EA Import 后缀新包
  const content = readScript();

  assert.match(content, /var\s+IMPORT_PACKAGE_NAME\s*=\s*['"]ArchGraph Sync['"]/, '应声明固定同步根包名常量');
  assert.match(content, /function\s+findChildPackageByName\s*\(/, '应定义按名查找子包的函数');
  assert.match(content, /function\s+reconcileSyncPackage\s*\(/, '应定义建/复用同步根包的函数');

  // 复用优先：已存在则直接返回，不再新建时间戳包
  assert.match(content, /Reusing existing sync package/, '存在时应对账复用并输出提示');
  assert.match(content, /safeString\(candidate\.Name\)\s*==\s*packageName/, 'findChildPackageByName 应按名匹配');

  // 时间戳新包语义已移除：无 IMPORT_PACKAGE_SUFFIX、无 formatTimestamp 时间戳包名拼接、无 " EA Import" 后缀
  assert.doesNotMatch(content, /IMPORT_PACKAGE_SUFFIX/, '不应再保留时间戳包后缀常量');
  assert.doesNotMatch(content, /formatTimestamp\s*\(/, '不应再在包名中使用时间戳');
  assert.doesNotMatch(content, /['"]\s*EA Import\b/, '不应再新建 "<graph> EA Import <ts>" 时间戳包');
});

test('ea-import-reconcile: 幂等分支——按 schema_id 先查后建（update 不重建，绝无删建）', () => {
  // GIVEN 元素/关系/图的导入入口
  // WHEN 解析其对象查找逻辑
  // THEN 每个对象先按 schema_id 锚 tag 在同步根包内查找已存在项并走 update 分支，
  //       图谱独有才 add；确保 ensureElement 分支内不含删除-重建
  const content = readScript();

  // 元素：既有元素索引 + 更新写入函数
  assert.match(content, /function\s+indexExistingElementsBySchemaId\s*\(/, '应定义既有元素按 schema_id 索引');
  assert.match(content, /function\s+updateElementFields\s*\(/, '应定义字段更新写入函数（不重建）');
  assert.match(content, /schemaIdOfElement\s*\(/, '应读取元素 schema_id 锚 tag');
  const ensureElementBody = sectionBetween(content, 'function ensureElement(', 'function addElementToOwner');
  assert.match(ensureElementBody, /existingBySchemaId\[schemaId\]/, 'ensureElement 应先查既有映射');
  assert.match(ensureElementBody, /updateElementFields\s*\(existing/, '已存在元素应走 updateElementFields（仅字段）');
  assert.match(ensureElementBody, /return\s+'updated'/, '已存在元素应返回 updated');
  assert.match(ensureElementBody, /return\s+'added'/, '新建元素应返回 added');
  assert.doesNotMatch(ensureElementBody, /\.Delete\s*\(/, 'ensureElement 内绝不允许删除重建');

  // 关系：既有 connector 索引 + 字段更新；importRelationships 内无删建
  assert.match(content, /function\s+indexExistingConnectorsBySchemaId\s*\(/, '应定义既有关系按 schema_id 索引');
  assert.match(content, /function\s+applyRelationshipFields\s*\(/, '应定义关系字段更新（新建/更新共用）');
  const relationshipBody = sectionBetween(content, 'function importRelationships(', 'function applyRelationshipFields');
  assert.match(relationshipBody, /existingBySchemaId\[data\.id\]/, '关系导入应先查既有');
  assert.doesNotMatch(relationshipBody, /\.Delete\s*\(/, 'importRelationships 内绝不允许删除重建');

  // 图（视图）：按 schema_view_id 索引既有图，复用分支仅字段/标记更新
  assert.match(content, /function\s+indexExistingDiagramsByViewId\s*\(/, '应定义既有图按 schema_view_id 索引');
  assert.match(content, /function\s+getStyleToken\s*\(/, '应能读取 StyleEx 中的 schema_view_id');
  const diagramBody = sectionBetween(content, 'function ensureDiagram(', 'function storeDiagramViewIdFallback');
  assert.match(diagramBody, /existingByViewId\[viewData\.view_id\]/, '视图应先查既有图');
  assert.match(diagramBody, /return\s+'updated'/, '既有图应返回 updated');
  assert.doesNotMatch(diagramBody, /\.Delete\s*\(/, 'ensureDiagram 内绝不允许删除重建');

  // 图成员填充为增补式（不整图清空重画）→ 不产生重复对象
  const populateBody = sectionBetween(content, 'function populateDiagram(', 'function addElementToDiagram');
  assert.match(populateBody, /placedElementIds\[obj\.ElementID\]/, '应扫描既有 DiagramObject 防重复');
  assert.match(populateBody, /placedConnectorIds\[link\.ConnectorID\]/, '应扫描既有 DiagramLink 防重复');
  assert.match(populateBody, /if\s*\(\s*!placedElementIds\[element\.ElementID\]\)/, '仅补缺失成员');
});

test('ea-import-reconcile: 删除分支——先收集清单并人工确认后才执行删除', () => {
  // GIVEN 同步根包内存在但图谱没有的对象
  // WHEN 解析删除流程
  // THEN collectDeleteCandidates 收集（元素/关系，含无 schema_id 手绘），Session.Output 先列清单，
  //       askDeletionConfirmation（键入确认词）通过后才执行 .Delete()；未确认则跳过
  const content = readScript();

  assert.match(content, /function\s+collectDeleteCandidates\s*\(/, '应定义删除候选收集函数');
  assert.match(content, /function\s+askDeletionConfirmation\s*\(/, '应定义人工确认函数');
  assert.match(content, /function\s+reconcileDeletions\s*\(/, '应定义删除对账入口');
  assert.match(content, /var\s+DELETE_CONFIRMATION_KEYWORD\s*=\s*['"]delete['"]/, '应声明删除确认词');

  const reconcileBody = sectionBetween(content, 'function reconcileDeletions(', 'function mapElementTypeToEaStereotype');
  // 先列清单（Session.Output 候选清单）再确认
  assert.match(reconcileBody, /Session\.Output\s*\([^)]*删除候选清单|Session\.Output\s*\([^)]*candidates?/, '应先在输出中列出删除候选清单');
  // 实际删除调用必须出现在确认之后
  const confirmIndex = reconcileBody.indexOf('askDeletionConfirmation(');
  const deleteIndex = reconcileBody.indexOf('.Delete(');
  assert.ok(confirmIndex >= 0, 'reconcileDeletions 应调用确认函数');
  assert.ok(deleteIndex > confirmIndex, '只有通过人工确认后才允许出现 .Delete()');
  // 未确认路径存在
  assert.match(reconcileBody, /未确认，跳过删除|Deletion skipped|用户未确认/, '用户未确认时应跳过删除');

  // 删除候选应包含无 schema_id 的对象（手绘）与关系
  assert.match(content, /schema_id='\s*\+\s*\(schemaIdOfConnector\(connector\)\s*\|\|\s*'\(none\)'\)/, '关系清单应标注缺失 schema_id');
  assert.match(content, /used_in_diagrams/, '元素清单应列出其在哪些图使用');
});

test('ea-import-reconcile: 只写库不刷 UI——无逐对象/逐集合 Refresh 刷屏', () => {
  // GIVEN 导入主体的热循环（元素/关系导入入口）
  // WHEN 统计 .Refresh() 调用位置
  // THEN 刷新统一收口（refreshCollection 辅助），热循环函数体不含直接 .Refresh()；
  //       全文件 .Refresh() 调用数保持在很小常量级（另有单次 Repository.RefreshModelView）
  const content = readScript();

  assert.match(content, /function\s+refreshCollection\s*\(/, '应定义集合刷新收口辅助函数');
  const directRefreshCount = (content.match(/\.Refresh\s*\(/g) || []).length;
  assert.ok(directRefreshCount <= 4, `全文件直接 .Refresh() 调用应 ≤4（实际 ${directRefreshCount}）`);

  // 元素导入热路径（ensureElement/addElementToOwner/updateElementFields）不含 .Refresh
  const elementHot = sectionBetween(content, 'function ensureElement(', 'function findChildByName');
  assert.doesNotMatch(elementHot, /\.Refresh\s*\(/, '元素热路径不应含直接集合刷新');

  // 关系导入热路径（importRelationships 及其单关系处理）不含 .Refresh
  const relHot = sectionBetween(content, 'function importRelationships(', 'function applyRelationshipFields');
  assert.doesNotMatch(relHot, /\.Refresh\s*\(/, '关系热路径不应含直接集合刷新');

  // 视图热路径（ensureDiagram/populateDiagram/addDiagramToOwner）不含 .Refresh
  const viewHot = sectionBetween(content, 'function ensureDiagram(', 'function storeDiagramViewIdFallback');
  assert.doesNotMatch(viewHot, /\.Refresh\s*\(/, '视图热路径不应含直接集合刷新');

  // 结束仍单次刷新浏览器树（EnableUIUpdates(true) 之后）
  const reEnableIndex = content.indexOf('Repository.EnableUIUpdates(true)');
  const treeRefreshIndex = content.indexOf('Repository.RefreshModelView');
  assert.ok(reEnableIndex >= 0 && treeRefreshIndex > reEnableIndex, '树刷新应发生在 UI 恢复之后（仅最后单次）');
});
