!INC Local Scripts.EAConstants-JScript
!INC JSON-Parser

/*
 * Script Name: Import SystemArchitecture JSON to EA
 * Purpose: Reads design\KG\SystemArchitecture.json and creates an EA model
 *          matching .argo/schema/SystemArchitecture.schema.json.
 * Usage:
 *   1. Copy this file into EA local scripts with JSON-Parser.js available.
 *   2. Select the target Package in EA Project Browser.
 *   3. Run the script.
 *
 * Notes:
 *   - EA assigns new ElementID/ConnectorID/DiagramID values. Original schema ids
 *     are preserved in aliases and tagged values.
 *   - Current schema fields are imported into native EA fields where possible.
 *     Legacy fields from older JSON exports are preserved as tagged values.
 *   - element.subdiagram_views and view.parent_element_id are used to create
 *     diagrams under their owning elements.
 */

var SYSTEM_ARCHITECTURE_JSON_RELATIVE_PATH = 'design\\KG\\SystemArchitecture.json';
var SYSTEM_ARCHITECTURE_JSON_PATH = '';
// WP2100 优化：固定名同步根包。树选中父包下存在则复用（幂等对账），不存在则先创建；
// 不再每轮新建"时间戳新包"全量导入。
var IMPORT_PACKAGE_NAME = 'ArchGraph Sync';
// 删除对账分支要求人工键入的确认词（大小写不敏感）；留空/取消 = 跳过删除。
var DELETE_CONFIRMATION_KEYWORD = 'delete';
var DIAGRAM_TYPE = 'Logical';
var CREATE_MISSING_SUBDIAGRAMS = true;
// Auto-layout invokes LayoutDiagramEx for every diagram, which opens each view one
// by one in the EA UI (slow) and conflicts with "do not auto-open views". Elements
// already receive deterministic grid positions in addElementToDiagram, so keep it off.
var ENABLE_AUTOLAYOUT = false;
var MAX_ATTRIBUTE_DEFAULT_LENGTH = 250;

// WP2100 SQL 直写通道（AT-2100-OPT-03，决策 ea-projection-sql-direct）：
//   写侧核心行 Repository.Execute + 读侧对账 Repository.SQLQuery。列名按 EA Firebird(.feap) 实测 schema 修正
//   （OBJECT_TYPE/ea_guid/STEREOTYPE/NOTE/...；连接 tag 表为 t_connectortag(ElementID/VALUE)；标签 Value 列大小写见 sqlTagSchema）。
//   默认启用 SQL 直写：交互与无头 Repository.Execute 均可用（此前无头直插 t_object 曾挂起，根因系非法 Type 列名被 ODBC 阻塞）。
//   交互默认 SQL；无头默认对象模型（SQL 全图耗时 165s~500s+ 随 EA 状态波动，300s 门控预算下不稳）；可注入 EA_SQL_DIRECT=0|1 覆盖。
var SQL_DIRECT = true;
var OBJECT_MODEL_FALLBACK = false;

// 默认 SQL 直写（交互 EA 实测 Execute 返回真实 ODBC 错误而非挂起；Firebird 列修正后无头 INSERT 亦成功）。
// 运行期可注入全局 EA_SQL_DIRECT=0|false|no 强制回退对象模型路径（无头/异常环境切换）。
function sqlDirectEnabled() {

  var headless = typeof EA_HEADLESS != 'undefined';
  if (OBJECT_MODEL_FALLBACK) { return false; }
  if (typeof EA_SQL_DIRECT != 'undefined') {
    var v = ('' + EA_SQL_DIRECT).toLowerCase();
    if (v == '0' || v == 'false' || v == 'no') { return false; }
    return true;
  }
  // 交互 EA 默认 SQL 直写（Execute 可用且列名已按 Firebird 修正）；无头默认对象模型：SQL 全图耗时随 EA 状态 165s~500s+ 波动，300s 门控预算下不稳。
  return (!headless) && SQL_DIRECT;
}

var WARNED = {};
var TIMINGS = [];

function markTiming(label) {
  TIMINGS.push({ label: label, atMs: new Date().getTime() });
}

function reportTimings() {
  var prev = null;
  for (var i = 0; i < TIMINGS.length; i++) {
    var entry = TIMINGS[i];
    if (prev != null) {
      Session.Output('  ' + prev.label + ' -> ' + entry.label + ': ' + (entry.atMs - prev.atMs) + ' ms');
    }
    prev = entry;
  }
}

// 通道分发：默认 SQL 直写；OBJECT_MODEL_FALLBACK=true 时走 518c2b0 对象模型全量路径。
function main() {
  if (sqlDirectEnabled()) {
    sqlImportMain();
    return;
  }
  objectModelImportMain();
}
// 518c2b0 对象模型全量导入路径（OBJECT_MODEL_FALLBACK=true 时经 main() 分发改走本函数）。

// 无头覆盖：EA_HEADLESS_GRAPH（EA 脚本运行在 cscript+EA.Repository COM 时，由
// headless/run-headless.ps1 注入），优先于按当前模型路径推断。
function resolveImportGraphPath() {
  try {
    if (typeof EA_HEADLESS_GRAPH != 'undefined' && EA_HEADLESS_GRAPH != '') {
      return '' + EA_HEADLESS_GRAPH;
    }
  } catch (e) { /* fallthrough */ }
  return resolveKnowledgeGraphPathFromCurrentModel();
}

// 无头覆盖：EA_HEADLESS_PARENT_PKG 存在时（注入即视为无头）选同名根模型，否则首个根模型；
// 未注入（真实 EA 交互运行）保持 GetTreeSelectedPackage 原语义。
function resolveHeadlessParentPackage() {
  var overrideSet = false;
  var parentOverride = '';
  try {
    if (typeof EA_HEADLESS_PARENT_PKG != 'undefined') {
      parentOverride = '' + EA_HEADLESS_PARENT_PKG;
      overrideSet = true;
    }
  } catch (e) { overrideSet = false; }
  if (!overrideSet) {
    return Repository.GetTreeSelectedPackage();
  }
  try {
    var models = Repository.Models;
    for (var i = 0; i < models.Count; i++) {
      var model = models.GetAt(i);
      if (model != null && safeString(model.Name) == parentOverride) {
        return model;
      }
    }
    if (models.Count > 0) {
      return models.GetAt(0);
    }
  } catch (e) {
    /* fallthrough */
  }
  return null;
}

function objectModelImportMain() {
  Repository.EnsureOutputVisible('Script');
  Repository.EnableUIUpdates(false);

  var importPkg = null;

  try {
    Session.Output('Starting SystemArchitecture JSON import...');

    var parentPkg = resolveHeadlessParentPackage();
    if (parentPkg == null) {
      fail('Please select a target Package in the Project Browser before running this script.');
      return;
    }

    SYSTEM_ARCHITECTURE_JSON_PATH = resolveImportGraphPath();
    if (SYSTEM_ARCHITECTURE_JSON_PATH == '') {
      fail('Could not resolve design\\KG\\SystemArchitecture.json from the current EA model path.');
      return;
    }

    Session.Output('Reading: ' + SYSTEM_ARCHITECTURE_JSON_PATH);
    var jsonString = readUtf8File(SYSTEM_ARCHITECTURE_JSON_PATH);
    if (jsonString == '') {
      fail('Input file is empty or could not be read.');
      return;
    }

    var graph = parseJson(jsonString);
    validateGraph(graph);

    importPkg = reconcileSyncPackage(parentPkg, graph);
    applyRootMetadata(importPkg, graph);

    var elementDataMap = buildElementDataMap(graph.elements);
    var elementMap = {};
    var relationshipMap = {};
    var viewMap = {};
    var subdiagramParentMap = buildSubdiagramParentMap(graph.elements);

    var elementCounts = importElements(importPkg, graph.elements, elementDataMap, elementMap);
    var relationshipCounts = importRelationships(importPkg, graph.relationships, elementMap, relationshipMap);
    var viewCounts = importViews(importPkg, graph.views, graph.elements, elementMap, relationshipMap, viewMap, subdiagramParentMap);

    Session.Output('=======================================');
    Session.Output('SystemArchitecture import complete.');
    Session.Output('Elements added: ' + elementCounts.added + ', updated: ' + elementCounts.updated);
    Session.Output('Relationships added: ' + relationshipCounts.added + ', updated: ' + relationshipCounts.updated);
    Session.Output('Views added: ' + viewCounts.added + ', updated: ' + viewCounts.updated);
    Session.Output('Sync package: ' + importPkg.Name);

    // WP2100 幂等对账：删除分支（同步根包内图谱没有的对象）→ 先列清单、人工确认后才执行。
    reconcileDeletions(importPkg, elementMap, graph);
  } catch (e) {
    fail('Import failed: ' + errorMessage(e));
  } finally {
    Repository.EnableUIUpdates(true);
  }

  // Single Project Browser tree refresh after import completes. Do not auto-open any diagram/view.
  refreshProjectBrowser(importPkg == null ? null : importPkg.PackageID);
}

// 单次树刷新收口：对象模型与 SQL 两通道共用（全文件仅此一处 Repository.RefreshModelView）。
function refreshProjectBrowser(packageId) {
  if (packageId == null) {
    return;
  }
  try {
    Repository.RefreshModelView(packageId);
  } catch (e) {
    warnOnce('refresh-tree', 'Could not refresh the Project Browser tree: ' + errorMessage(e));
  }
}

function readUtf8File(filePath) {
  var stream = null;
  try {
    stream = new ActiveXObject('ADODB.Stream');
    stream.Type = 2;
    stream.Charset = 'UTF-8';
    stream.Open();
    stream.LoadFromFile(filePath);
    return stream.ReadText();
  } catch (e) {
    fail('Could not read UTF-8 file: ' + filePath + ' :: ' + errorMessage(e));
    return '';
  } finally {
    if (stream != null) {
      try {
        stream.Close();
      } catch (ignore) {
      }
    }
  }
}

function parseJson(jsonString) {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    throw new Error('Invalid JSON: ' + errorMessage(e));
  }
}

function validateGraph(graph) {
  if (graph == null || typeof graph !== 'object') {
    throw new Error('The JSON root must be an object.');
  }
  requireString(graph, 'name', 'root');
  if (!isNonEmptyString(graph.description)) {
    warnOnce('root-description-empty', 'root.description is empty. The schema requires a non-empty string, but import will continue.');
  }
  requireArray(graph.elements, 'root.elements');
  requireArray(graph.relationships, 'root.relationships');
  requireArray(graph.views, 'root.views');
}

function requireString(obj, key, where) {
  if (!obj || !isNonEmptyString(obj[key])) {
    throw new Error('Missing required field: ' + where + '.' + key);
  }
}

function requireArray(value, where) {
  if (!isArray(value)) {
    throw new Error('Missing required array: ' + where);
  }
}

// 集合刷新统一收口（WP2100 速度优化：避免热循环里逐对象逐集合 Refresh 刷屏）。
// 仅在两轮结构扫描/批次结束时按需调用，绝不放在逐对象创建的循环体内。
function refreshCollection(collection, label) {
  try {
    collection.Refresh();
  } catch (e) {
    warnOnce('refresh-' + label, 'Could not refresh ' + label + ': ' + errorMessage(e));
  }
}

function findChildPackageByName(parentPkg, packageName) {
  if (parentPkg == null || parentPkg.Packages == null) {
    return null;
  }
  refreshCollection(parentPkg.Packages, 'packages-of-' + safeName(parentPkg.Name, 'parent'));
  for (var i = 0; i < parentPkg.Packages.Count; i++) {
    var candidate = null;
    try {
      candidate = parentPkg.Packages.GetAt(i);
    } catch (e) {
      candidate = null;
    }
    if (candidate != null && safeString(candidate.Name) == packageName) {
      return candidate;
    }
  }
  return null;
}

// WP2100：固定名同步根包——已存在则复用（对账），不存在则新建。绝不生成时间戳新包。
function reconcileSyncPackage(parentPkg, graph) {
  var pkg = findChildPackageByName(parentPkg, IMPORT_PACKAGE_NAME);
  if (pkg != null) {
    Session.Output('Reusing existing sync package: ' + pkg.Name + ' (PackageID ' + pkg.PackageID + ')');
    return pkg;
  }
  pkg = parentPkg.Packages.AddNew(IMPORT_PACKAGE_NAME, 'Package');
  pkg.Update();
  Session.Output('Created sync package: ' + pkg.Name);
  return pkg;
}

function applyRootMetadata(pkg, graph) {
  try {
    var pkgElement = pkg.Element;
    if (pkgElement != null) {
      putTag(pkgElement.TaggedValues, 'schema_root_name', graph.name);
      putTag(pkgElement.TaggedValues, 'schema_root_description', safeString(graph.description));
      putJsonTag(pkgElement.TaggedValues, 'schema_root_attributes_json', graph.attributes || []);
      putJsonTag(pkgElement.TaggedValues, 'schema_relationships_json', graph.relationships || []);
      putJsonTag(pkgElement.TaggedValues, 'schema_views_json', graph.views || []);
      pkgElement.Update();
      pkgElement.TaggedValues.Refresh();
    }
  } catch (e) {
    warnOnce('root-tags', 'Could not write package element tags: ' + errorMessage(e));
  }
}

function buildElementDataMap(elements) {
  var map = {};
  for (var i = 0; i < elements.length; i++) {
    var elementData = elements[i];
    if (elementData && isNonEmptyString(elementData.id)) {
      map[elementData.id] = elementData;
    }
  }
  return map;
}

function buildSubdiagramParentMap(elements) {
  var map = {};
  if (!elements) {
    return map;
  }
  for (var i = 0; i < elements.length; i++) {
    var elementData = elements[i];
    if (!elementData || !isNonEmptyString(elementData.id) || !elementData.subdiagram_views) {
      continue;
    }
    for (var j = 0; j < elementData.subdiagram_views.length; j++) {
      var sub = elementData.subdiagram_views[j];
      if (sub && isNonEmptyString(sub.view_id)) {
        map[sub.view_id] = elementData.id;
      }
    }
  }
  return map;
}

function importElements(importPkg, elements, elementDataMap, elementMap) {
  var counts = { added: 0, updated: 0 };
  // WP2100 幂等对账：先一次性扫描同步根包内全部既有元素（按 schema_id 锚 tag 建索引），
  // 之后的循环只查内存映射，不再逐对象扫集合。
  var existingBySchemaId = indexExistingElementsBySchemaId(importPkg);
  for (var i = 0; i < elements.length; i++) {
    var elementData = elements[i];
    if (!elementData || !isNonEmptyString(elementData.id)) {
      continue;
    }
    var outcome = ensureElement(importPkg, elementData.id, elementDataMap, elementMap, existingBySchemaId);
    if (outcome == 'added') {
      counts.added++;
    } else if (outcome == 'updated') {
      counts.updated++;
    }
  }
  return counts;
}

// 递归收集同步根包整棵子树上的既有 EA 元素（含嵌套在父元素下的）。
function collectElementsUnderPackage(pkg) {
  var out = [];
  if (pkg == null || pkg.Elements == null) {
    return out;
  }
  refreshCollection(pkg.Elements, 'elements-of-' + safeName(pkg.Name, 'pkg'));
  function visitPackageElementContainer(container) {
    for (var i = 0; i < container.Count; i++) {
      var element = null;
      try {
        element = container.GetAt(i);
      } catch (e) {
        element = null;
      }
      if (element == null) {
        continue;
      }
      out.push(element);
      try {
        refreshCollection(element.Elements, 'children-of-' + element.ElementID);
      } catch (e) {
        continue;
      }
      visitElementChildren(element.Elements);
    }
  }
  function visitElementChildren(children) {
    for (var j = 0; j < children.Count; j++) {
      var child = null;
      try {
        child = children.GetAt(j);
      } catch (e) {
        child = null;
      }
      if (child == null) {
        continue;
      }
      out.push(child);
      try {
        refreshCollection(child.Elements, 'children-of-' + child.ElementID);
      } catch (e) {
        continue;
      }
      visitElementChildren(child.Elements);
    }
  }
  visitPackageElementContainer(pkg.Elements);
  return out;
}

// 读取既有元素的 schema_id 锚 tag；无则返回 ''（用于判定是否为图谱派生对象）。
function schemaIdOfElement(element) {
  if (element == null || element.TaggedValues == null) {
    return '';
  }
  try {
    var tag = element.TaggedValues.GetByName('schema_id');
    if (tag != null) {
      var value = trimString(tag.Value);
      if (value != '' && value != '<memo>') {
        return value;
      }
    }
  } catch (e) {
    return '';
  }
  return '';
}

function indexExistingElementsBySchemaId(importPkg) {
  var index = {};
  var all = collectElementsUnderPackage(importPkg);
  for (var i = 0; i < all.length; i++) {
    var schemaId = schemaIdOfElement(all[i]);
    if (schemaId != '') {
      index[schemaId] = all[i];
    }
  }
  return index;
}

function ensureElement(importPkg, schemaId, elementDataMap, elementMap, existingBySchemaId) {
  if (elementMap[schemaId]) {
    return 'already-mapped';
  }

  var elementData = elementDataMap[schemaId];
  if (!elementData) {
    warnOnce('missing-element-' + schemaId, 'Element data not found for id: ' + schemaId);
    return 'skipped';
  }

  var parentElement = null;
  if (isNonEmptyString(elementData.parent) && elementData.parent != '0' && elementDataMap[elementData.parent]) {
    ensureElement(importPkg, elementData.parent, elementDataMap, elementMap, existingBySchemaId);
    parentElement = elementMap[elementData.parent] || null;
  }

  // 幂等分支①：按 schema_id 已存在 → 原地仅字段更新，绝不删除重建
  // （删除重建会重置该元素的 DiagramObject 与用户布局）。
  var existing = existingBySchemaId[schemaId] || null;
  if (existing != null) {
    elementMap[schemaId] = existing;
    updateElementFields(existing, elementData);
    Session.Output('Updated element [' + safeString(elementData.type) + ']: ' + elementData.name + ' (' + schemaId + ')');
    return 'updated';
  }

  // 幂等分支②：图谱独有 → 新建（含全部锚 tag）。
  var baseType = mapElementTypeToEa(elementData.type);
  var element = addElementToOwner(importPkg, parentElement, elementData.name, baseType);

  elementMap[schemaId] = element;

  // 字段/锚 tag 写入（新建与更新共用同一写入函数）。
  updateElementFields(element, elementData);
  // EA child collections are safest to mutate after owner field changes are persisted.
  applyElementAttributes(element, elementData.attributes);
  applyElementSpecialMethods(element, elementData);
  applyProjectInfo(element, elementData.project_info);
  applyTestcases(element, elementData.testcases);
  applySubdiagramViewTags(element, elementData.subdiagram_views);

  element.Update();
  Session.Output('Created element [' + safeString(elementData.type) + ']: ' + elementData.name + ' (' + schemaId + ')');
  return 'added';
}

function addElementToOwner(importPkg, parentElement, name, baseType) {
  var element = null;
  if (parentElement != null) {
    try {
      element = parentElement.Elements.AddNew(safeName(name, 'Unnamed Element'), baseType);
      element.Update();
      return element;
    } catch (e) {
      warnOnce('nested-element-fallback', 'Could not create nested element under parent; using package-level element fallback. ' + errorMessage(e));
    }
  }

  element = importPkg.Elements.AddNew(safeName(name, 'Unnamed Element'), baseType);
  element.Update();
  return element;
}

// 幂等更新：仅写字段与锚 tag；绝不触碰元素在本体的 DiagramObject 几何。
function updateElementFields(element, data) {
  warnIfUnknownSchemaElementType(data.type);

  element.Name = safeName(data.name, data.id);
  element.Notes = safeString(data.description);
  element.StereotypeEx = mapElementTypeToEaStereotype(data.type);

  if (isNonEmptyString(data.alias)) {
    element.Alias = data.alias;
  } else {
    element.Alias = data.id;
  }
  if (isNonEmptyString(data.status)) {
    element.Status = data.status;
  }

  putTag(element.TaggedValues, 'schema_id', data.id);
  putTag(element.TaggedValues, 'schema_parent', safeString(data.parent));
  putTag(element.TaggedValues, 'archimate_type', canonicalArchimateType(data.type));
  putTag(element.TaggedValues, 'schema_alias', safeString(data.alias));
  putTag(element.TaggedValues, 'schema_classifier', safeString(data.classifier));
  putJsonTag(element.TaggedValues, 'schema_element_json', data);
  element.Update();
}

// 在子集合中按名称查找既有对象（幂等对账：存在则更新，不存在才 AddNew，避免重复导入产生重复子对象）。
function findChildByName(collection, childName) {
  if (collection == null) {
    return null;
  }
  var target = safeName(childName, '');
  for (var i = 0; i < collection.Count; i++) {
    var candidate = null;
    try {
      candidate = collection.GetAt(i);
    } catch (e) {
      candidate = null;
    }
    if (candidate != null && safeString(candidate.Name) == target) {
      return candidate;
    }
  }
  return null;
}

function applyElementAttributes(element, attributes) {
  if (!attributes || attributes.length == 0) {
    return;
  }
  refreshCollection(element.Attributes, 'attributes-of-' + element.ElementID);
  // Ledger/repeated-name attributes (e.g. multiple 'commit' entries): EA allows
  // duplicate same-name Attributes. To preserve roundtrip content, for each graph
  // attribute update the first same-name EA attribute not yet used this round,
  // otherwise append a new one (keeps re-import idempotent).
  var used = {};
  for (var i = 0; i < attributes.length; i++) {
    var data = attributes[i];
    if (!data || !isNonEmptyString(data.name)) {
      continue;
    }
    var attr = null;
    if (!used[data.name]) {
      attr = findChildByName(element.Attributes, data.name);
    }
    if (attr == null) {
      attr = element.Attributes.AddNew(data.name, 'String');
    }
    used[data.name] = true;
    var notesParts = [];
    var attributeValue = safeString(data.value);
    if (isNonEmptyString(attributeValue)) {
      if (attributeValue.length <= MAX_ATTRIBUTE_DEFAULT_LENGTH) {
        attr.Default = attributeValue;
      } else {
        notesParts.push(attributeValue);
      }
    }
    if (isNonEmptyString(safeString(data.description))) {
      notesParts.push(safeString(data.description));
    }
    if (isNonEmptyString(data.content)) {
      notesParts.push(safeString(data.content));
      attr.Alias = 'content';
    }
    attr.Notes = notesParts.join('\r\n\r\n');
    attr.Update();
  }
}

function applyElementSpecialMethods(element, data) {
  addMethodIfPresent(element, 'mainbehavior', data.code_file);
  addMethodIfPresent(element, 'decision_condition', data.condition_file);
  addMethodIfPresent(element, 'prompts', data.prompts_file);
}

function addMethodIfPresent(element, methodName, notes) {
  if (!isNonEmptyString(notes)) {
    return;
  }
  var method = findChildByName(element.Methods, methodName);
  if (method == null) {
    method = element.Methods.AddNew(methodName, '');
  }
  method.Notes = notes;
  method.Update();
}

function applyProjectInfo(element, projectInfo) {
  if (!projectInfo) {
    return;
  }

  putJsonTag(element.TaggedValues, 'project_info_json', projectInfo);

  if (projectInfo.summary) {
    addIssue(element, 'summury', '', '', projectInfo.summary.notes, projectInfo.summary.started, projectInfo.summary.deadline, '', projectInfo.summary.priority, projectInfo.summary.assigned_to, projectInfo.summary.progress);
  }

  if (projectInfo.resources) {
    for (var i = 0; i < projectInfo.resources.length; i++) {
      addResource(element, projectInfo.resources[i]);
    }
  }

  if (projectInfo.tasks) {
    for (var j = 0; j < projectInfo.tasks.length; j++) {
      var task = projectInfo.tasks[j];
      if (!task) {
        continue;
      }
      addIssue(element, task.name, task.type, task.status, task.description, task.start_date, firstNonEmpty(task.completion_date, task.due_date), task.reporter, task.priority, task.assigned_to, task.progress);
    }
  }
}

function addResource(element, data) {
  if (!data || !isNonEmptyString(data.owner)) {
    return;
  }
  try {
    var resource = findChildByName(element.Resources, data.owner);
    if (resource == null) {
      resource = element.Resources.AddNew(data.owner, safeString(data.role));
    }
    resource.Role = safeString(data.role);
    resource.Notes = safeString(data.description);
    assignIfPresent(resource, 'DateStart', data.start_date);
    assignIfPresent(resource, 'DateEnd', data.end_date);
    if (typeof data.percent_complete != 'undefined') {
      resource.PercentComplete = data.percent_complete;
    }
    if (typeof data.expected_hours != 'undefined') {
      resource.ExpectedHours = data.expected_hours;
    }
    resource.History = safeString(data.history);
    resource.Update();
  } catch (e) {
    warnOnce('resource-import', 'Could not import resource for element ' + element.Name + ': ' + errorMessage(e));
  }
}

function addIssue(element, name, type, status, notes, startDate, endDate, reporter, priority, assignedTo, progress) {
  if (!isNonEmptyString(name)) {
    return;
  }
  try {
    var issue = findChildByName(element.Issues, name);
    if (issue == null) {
      issue = element.Issues.AddNew(name, safeString(type));
    }
    issue.Type = safeString(type);
    issue.Status = safeString(status);
    issue.Notes = safeString(notes);
    assignIfPresent(issue, 'DateReported', startDate);
    assignIfPresent(issue, 'DateResolved', endDate);
    issue.Reporter = safeString(reporter);
    issue.Priority = safeString(priority);
    issue.Resolver = safeString(assignedTo);
    issue.ResolverNotes = safeString(progress);
    issue.Update();
  } catch (e) {
    warnOnce('issue-import', 'Could not import issue/task for element ' + element.Name + ': ' + errorMessage(e));
  }
}

function applyTestcases(element, testcases) {
  if (!testcases || testcases.length == 0) {
    return;
  }

  putJsonTag(element.TaggedValues, 'testcases_json', testcases);

  for (var i = 0; i < testcases.length; i++) {
    var data = testcases[i];
    if (!data || !isNonEmptyString(data.name)) {
      continue;
    }
    try {
      var test = findChildByName(element.Tests, data.name);
      if (test == null) {
        test = element.Tests.AddNew(data.name, safeString(data.type));
      }
      test.Notes = safeString(data.description);
      test.Class = mapTestTypeToEaClass(data.type);
      test.Input = safeString(data.Input);
      test.AcceptanceCriteria = safeString(data.acceptanceCriteria);
      test.TestResults = safeString(data.TestResults);
      test.Update();
    } catch (e) {
      warnOnce('test-import', 'Could not import testcase for element ' + element.Name + ': ' + errorMessage(e));
    }
  }
}

function applySubdiagramViewTags(element, subdiagramViews) {
  if (!subdiagramViews || subdiagramViews.length == 0) {
    return;
  }
  putJsonTag(element.TaggedValues, 'subdiagram_views_json', subdiagramViews);
}

function schemaIdOfConnector(connector) {
  if (connector == null || connector.TaggedValues == null) {
    return '';
  }
  try {
    var tag = connector.TaggedValues.GetByName('schema_id');
    if (tag != null) {
      var value = trimString(tag.Value);
      if (value != '' && value != '<memo>') {
        return value;
      }
    }
  } catch (e) {
    return '';
  }
  return '';
}

// 对同步根包既有元素逐一扫描其 Connectors 集合，建立 schema_id → connector 索引
// （connector 归属在源元素下；索引仅在导入前扫描一次，热循环内不再逐关系刷集合）。
function indexExistingConnectorsBySchemaId(importPkg) {
  var index = {};
  var all = collectElementsUnderPackage(importPkg);
  for (var i = 0; i < all.length; i++) {
    var element = all[i];
    try {
      refreshCollection(element.Connectors, 'connectors-of-' + element.ElementID);
    } catch (e) {
      continue;
    }
    for (var j = 0; j < element.Connectors.Count; j++) {
      var connector = null;
      try {
        connector = element.Connectors.GetAt(j);
      } catch (e2) {
        connector = null;
      }
      if (connector == null) {
        continue;
      }
      var schemaId = schemaIdOfConnector(connector);
      if (schemaId != '' && !index[schemaId]) {
        index[schemaId] = connector;
      }
    }
  }
  return index;
}

function importRelationships(importPkg, relationships, elementMap, relationshipMap) {
  var counts = { added: 0, updated: 0 };
  var existingBySchemaId = indexExistingConnectorsBySchemaId(importPkg);
  for (var i = 0; i < relationships.length; i++) {
    var data = relationships[i];
    if (!data || !isNonEmptyString(data.id)) {
      continue;
    }

    var source = elementMap[data.source_id];
    var target = elementMap[data.target_id];
    if (!source || !target) {
      warnOnce('missing-rel-end-' + data.id, 'Skipping relationship ' + data.id + ' because source or target element is missing.');
      continue;
    }

    var relationshipType = data.type;
    var relationshipName = safeString(data.name);
    var connectorMeta = mapRelationshipTypeToEa(relationshipType);
    warnIfUnknownSchemaRelationshipType(relationshipType);

    // 幂等分支①：按 schema_id 已存在 → 原地字段更新（不重建，保留既有 DiagramLink）。
    var existing = existingBySchemaId[data.id] || null;
    if (existing != null) {
      relationshipMap[data.id] = existing;
      applyRelationshipFields(existing, data, source, target, connectorMeta);
      reconcileRelationshipAttributes(importPkg, existing, data);
      counts.updated++;
      Session.Output('Updated relationship [' + relationshipType + '] ' + relationshipName + ': ' + data.id);
      continue;
    }

    // 幂等分支②：图谱独有 → 新建（含全部锚 tag）。
    var connector = source.Connectors.AddNew(relationshipName, connectorMeta.connectorType);
    connector.SupplierID = target.ElementID;
    applyRelationshipFields(connector, data, source, target, connectorMeta);

    // Persist the connector core fields before attaching tagged values. Tagged values
    // require a saved connector (with a valid ConnectorID), otherwise EA silently drops
    // them and the original schema id would be lost on the next export.
    connector.Update();

    if (data.attributes && data.attributes.length > 0) {
      reconcileRelationshipAttributes(importPkg, connector, data);
    }

    relationshipMap[data.id] = connector;
    counts.added++;
    Session.Output('Created relationship [' + relationshipType + '] ' + relationshipName + ': ' + data.id + ' (' + data.source_id + ' -> ' + data.target_id + ')');
  }
  return counts;
}

// 关系字段写入（新建与更新共用；更新时绝不删建，仅在原 connector 上写字段与锚 tag）。
function applyRelationshipFields(connector, data, source, target, connectorMeta) {
  connector.SupplierID = target.ElementID;
  connector.Name = safeString(data.name);
  connector.Alias = data.id;
  connector.StereotypeEx = mapRelationshipTypeToEaStereotype(data.type);
  connector.Notes = safeString(data.description);
  if (isNonEmptyString(data.sequence)) {
    connector.SequenceNo = data.sequence;
  }

  if (connectorMeta.aggregationKind >= 0) {
    try {
      connector.SupplierEnd.Aggregation = connectorMeta.aggregationKind;
    } catch (e) {
      // SupplierEnd 不可达时忽略，字段级尽力而为
    }
  }

  // EA only draws an arrowhead at the target (supplier) end when the connector carries an
  // explicit direction. Directed ArchiMate relationships are therefore stored with
  // Direction = "Source -> Destination" so the generated views show the relationship
  // direction (source -> target); undirected Association and structural
  // Composition/Aggregation keep Direction = Unspecified on purpose.
  if (connectorMeta.directed) {
    connector.Direction = 'Source -> Destination';
  }

  connector.Update();

  putTag(connector.TaggedValues, 'schema_id', data.id);
  putTag(connector.TaggedValues, 'schema_name', safeString(data.name));
  putTag(connector.TaggedValues, 'schema_statement', safeString(data.statement));
  putTag(connector.TaggedValues, 'archimate_relationship_type', canonicalArchimateType(data.type));
  putTag(connector.TaggedValues, 'document', safeString(data.document));
  putTag(connector.TaggedValues, 'source_schema_id', safeString(data.source_id));
  putTag(connector.TaggedValues, 'target_schema_id', safeString(data.target_id));
  putTag(connector.TaggedValues, 'source_name', safeString(data.source_name));
  putTag(connector.TaggedValues, 'target_name', safeString(data.target_name));
  putJsonTag(connector.TaggedValues, 'schema_relationship_json', data);
  connector.Update();
}

function reconcileRelationshipAttributes(importPkg, connector, relationshipData) {
  if (!relationshipData.attributes || relationshipData.attributes.length == 0) {
    return; // 无属性关系：与新建分支守卫一致，跳过（否则更新分支 fallback 读 null.length 崩溃）
  }
  putJsonTag(connector.TaggedValues, 'relationship_attributes_json', relationshipData.attributes);

  var associationClassCreated = false;
  if (connector.Type == 'Association') {
    try {
      // 幂等：优先复用既有关联类（按 Alias = <id>_attributes 找），不存在才新建。
      var assocClass = findElementByAliasInPackage(importPkg, relationshipData.id + '_attributes');
      if (assocClass == null) {
        assocClass = importPkg.Elements.AddNew(safeName(relationshipData.name + ' Attributes', 'Relationship Attributes'), 'Class');
        assocClass.Name = safeName(relationshipData.name + ' Attributes', 'Relationship Attributes');
        assocClass.Alias = relationshipData.id + '_attributes';
        assocClass.StereotypeEx = 'SchemaRelationshipAttributes';
        assocClass.Notes = safeString(relationshipData.description);
        assocClass.Update();
        assocClass.CreateAssociationClass(connector.ConnectorID);
        assocClass.Update();
      }
      addRelationshipAttributesToClass(assocClass, relationshipData.attributes);
      putTag(connector.TaggedValues, 'relationship_attributes_element', assocClass.Name);
      associationClassCreated = true;
    } catch (e) {
      warnOnce('association-class-fallback', 'Could not create an association class for relationship attributes. Using tagged values fallback. ' + errorMessage(e));
    }
  }

  if (!associationClassCreated) {
    for (var i = 0; i < relationshipData.attributes.length; i++) {
      var attr = relationshipData.attributes[i];
      if (!attr) {
        continue;
      }
      putTag(connector.TaggedValues, 'relattr_' + sanitizeTagName(attr.name), safeString(attr.description));
    }
  }

  connector.Update();
}
function findElementByAliasInPackage(pkg, alias) {
  if (pkg == null || pkg.Elements == null) {
    return null;
  }
  refreshCollection(pkg.Elements, 'elements-of-' + safeName(pkg.Name, 'pkg'));
  for (var i = 0; i < pkg.Elements.Count; i++) {
    var candidate = null;
    try {
      candidate = pkg.Elements.GetAt(i);
    } catch (e) {
      candidate = null;
    }
    if (candidate != null && safeString(candidate.Alias) == alias) {
      return candidate;
    }
  }
  return null;
}

function addRelationshipAttributesToClass(assocClass, attributes) {
  if (assocClass == null || !attributes) {
    return;
  }
  refreshCollection(assocClass.Attributes, 'attributes-of-assoc-' + assocClass.ElementID);
  for (var i = 0; i < attributes.length; i++) {
    var data = attributes[i];
    if (!data || !isNonEmptyString(data.name)) {
      continue;
    }
    var attr = findChildByName(assocClass.Attributes, data.name);
    if (attr == null) {
      attr = assocClass.Attributes.AddNew(data.name, 'String');
    }
    attr.Notes = safeString(data.description);
    attr.Update();
  }
}

function importViews(importPkg, views, elements, elementMap, relationshipMap, viewMap, subdiagramParentMap) {
  var viewDataMap = buildViewDataMap(views);
  var counts = { added: 0, updated: 0 };
  // WP2100 幂等：先按 schema_view_id 索引既有图（含包级与元素子图），循环内不再逐图扫集合。
  var existingByViewId = indexExistingDiagramsByViewId(importPkg);

  for (var i = 0; i < views.length; i++) {
    var viewData = views[i];
    if (!viewData || !isNonEmptyString(viewData.view_id)) {
      continue;
    }
    var outcome = ensureDiagram(importPkg, viewData, elementMap, viewMap, subdiagramParentMap, existingByViewId);
    populateDiagram(viewMap[viewData.view_id], viewData, elementMap, relationshipMap);
    if (outcome == 'added') {
      counts.added++;
    } else if (outcome == 'updated') {
      counts.updated++;
    }
  }

  if (CREATE_MISSING_SUBDIAGRAMS) {
    var extra = createMissingSubdiagrams(importPkg, elements, viewDataMap, elementMap, relationshipMap, viewMap, existingByViewId);
    counts.added += extra.added;
    counts.updated += extra.updated;
  }

  return counts;
}

function buildViewDataMap(views) {
  var map = {};
  for (var i = 0; i < views.length; i++) {
    var viewData = views[i];
    if (viewData && isNonEmptyString(viewData.view_id)) {
      map[viewData.view_id] = viewData;
    }
  }
  return map;
}

function getStyleToken(styleText, key) {
  var source = safeString(styleText);
  var pattern = new RegExp('(?:^|;)' + escapeRegExp(key) + '=([^;]*)', 'i');
  var match = source.match(pattern);
  if (match && match.length > 1) {
    return match[1];
  }
  return '';
}

// 索引同步根包整棵子树上的既有图（包级图 + 元素子图），键 = StyleEx 的 schema_view_id。
function indexExistingDiagramsByViewId(importPkg) {
  var index = {};
  function addFromCollection(collection, ownerLabel) {
    if (collection == null) {
      return;
    }
    try {
      refreshCollection(collection, 'diagrams-of-' + ownerLabel);
    } catch (e) {
      return;
    }
    for (var i = 0; i < collection.Count; i++) {
      var diagram = null;
      try {
        diagram = collection.GetAt(i);
      } catch (e2) {
        diagram = null;
      }
      if (diagram == null) {
        continue;
      }
      var viewId = getStyleToken(safeString(diagram.StyleEx), 'schema_view_id');
      if (viewId != '' && !index[viewId]) {
        index[viewId] = diagram;
      }
    }
  }
  addFromCollection(importPkg.Diagrams, 'pkg');
  var all = collectElementsUnderPackage(importPkg);
  for (var j = 0; j < all.length; j++) {
    addFromCollection(all[j].Diagrams, 'element-' + all[j].ElementID);
  }
  return index;
}

function ensureDiagram(importPkg, viewData, elementMap, viewMap, subdiagramParentMap, existingByViewId) {
  if (viewMap[viewData.view_id]) {
    return 'already-mapped';
  }

  var parentElement = null;
  if (isNonEmptyString(viewData.parent_element_id) && elementMap[viewData.parent_element_id]) {
    parentElement = elementMap[viewData.parent_element_id];
  } else if (subdiagramParentMap[viewData.view_id] && elementMap[subdiagramParentMap[viewData.view_id]]) {
    parentElement = elementMap[subdiagramParentMap[viewData.view_id]];
  }

  // 幂等分支①：按 schema_view_id 已存在 → 仅字段/标记更新（图本体与用户布局不动）。
  var existing = existingByViewId ? existingByViewId[viewData.view_id] : null;
  if (existing != null) {
    try {
      existing.Name = safeName(viewData.view_name, viewData.view_id);
    } catch (e) {
      // 图名只读场景下忽略
    }
    existing.Notes = safeString(viewData.description);
    putDiagramTags(existing, viewData);
    existing.Update();
    viewMap[viewData.view_id] = existing;
    Session.Output('Updated view: ' + existing.Name + ' (' + viewData.view_id + ')');
    return 'updated';
  }

  // 幂等分支②：图谱独有 → 新建。
  var diagram = addDiagramToOwner(importPkg, parentElement, safeName(viewData.view_name, viewData.view_id));
  diagram.Notes = safeString(viewData.description);
  putDiagramTags(diagram, viewData);
  storeDiagramViewIdFallback(parentElement, viewData.view_id, viewData.view_name);
  diagram.Update();
  viewMap[viewData.view_id] = diagram;
  Session.Output('Created view: ' + diagram.Name + ' (' + viewData.view_id + ')');
  return 'added';
}

function storeDiagramViewIdFallback(parentElement, viewId, viewName) {
  if (parentElement == null) {
    return;
  }
  try {
    var tags = parentElement.TaggedValues;
    var existingJson = '';
    // Read existing schema_sub_view_map tag (equivalent to getElementTag)
    try {
      var existingTag = tags.GetByName('schema_sub_view_map');
      if (existingTag != null) {
        if (existingTag.Value == '<memo>' && existingTag.Notes != '') {
          existingJson = '' + existingTag.Notes;
        } else if (existingTag.Value != '') {
          existingJson = '' + existingTag.Value;
        } else {
          existingJson = '' + existingTag.Notes;
        }
      }
    } catch (ignore) {
    }
    var map = {};
    if (existingJson != '') {
      try { map = JSON.parse(existingJson); } catch (e) { map = {}; }
    }
    map[safeString(viewName)] = viewId;
    putJsonTag(tags, 'schema_sub_view_map', map);
    parentElement.Update();
    parentElement.TaggedValues.Refresh();
  } catch (e) {
    // Non-critical fallback; StyleEx-based lookup remains primary.
  }
}

function addDiagramToOwner(importPkg, parentElement, diagramName) {
  var diagram = null;
  if (parentElement != null) {
    try {
      diagram = parentElement.Diagrams.AddNew(diagramName, DIAGRAM_TYPE);
      diagram.Update();
      return diagram;
    } catch (e) {
      warnOnce('nested-diagram-fallback', 'Could not create diagram under element; using package-level diagram fallback. ' + errorMessage(e));
    }
  }

  diagram = importPkg.Diagrams.AddNew(diagramName, DIAGRAM_TYPE);
  diagram.Update();
  return diagram;
}

function putDiagramTags(diagram, viewData) {
  try {
    diagram.StyleEx = setStyleToken(diagram.StyleEx, 'schema_view_id', viewData.view_id);
    diagram.StyleEx = setStyleToken(diagram.StyleEx, 'schema_parent_element_id', safeString(viewData.parent_element_id));
    diagram.StyleEx = setStyleToken(diagram.StyleEx, 'schema_parent_element_name', safeString(viewData.parent_element_name));
    diagram.StyleEx = setStyleJsonToken(diagram.StyleEx, 'schema_included_elements_json', viewData.included_elements || []);
    diagram.StyleEx = setStyleJsonToken(diagram.StyleEx, 'schema_included_relationships_json', viewData.included_relationships || []);
  } catch (ignore) {
  }
}

function populateDiagram(diagram, viewData, elementMap, relationshipMap) {
  if (diagram == null) {
    return;
  }
  var includedElements = viewData.included_elements || [];
  var includedRelationships = viewData.included_relationships || [];

  // 幂等：仅补缺失成员（保留用户手动加入的 DiagramObject/布局；绝不整图清空重画）。
  var placedElementIds = {};
  refreshCollection(diagram.DiagramObjects, 'diagram-objects-of-' + diagram.DiagramID);
  var nextObjectIndex = diagram.DiagramObjects.Count;
  for (var i = 0; i < diagram.DiagramObjects.Count; i++) {
    var obj = null;
    try {
      obj = diagram.DiagramObjects.GetAt(i);
    } catch (e) {
      obj = null;
    }
    if (obj != null) {
      placedElementIds[obj.ElementID] = true;
    }
  }
  for (var k = 0; k < includedElements.length; k++) {
    var schemaId = includedElements[k];
    var element = elementMap[schemaId];
    if (element) {
      if (!placedElementIds[element.ElementID]) {
        addElementToDiagram(diagram, element, nextObjectIndex);
        nextObjectIndex++;
      }
    } else {
      warnOnce('view-missing-element-' + viewData.view_id + '-' + schemaId, 'View ' + viewData.view_id + ' references missing element ' + schemaId + '.');
    }
  }

  var placedConnectorIds = {};
  refreshCollection(diagram.DiagramLinks, 'diagram-links-of-' + diagram.DiagramID);
  for (var l = 0; l < diagram.DiagramLinks.Count; l++) {
    var link = null;
    try {
      link = diagram.DiagramLinks.GetAt(l);
    } catch (e) {
      link = null;
    }
    if (link != null) {
      placedConnectorIds[link.ConnectorID] = true;
    }
  }
  for (var m = 0; m < includedRelationships.length; m++) {
    var relId = includedRelationships[m];
    var connector = relationshipMap[relId];
    if (connector) {
      if (!placedConnectorIds[connector.ConnectorID]) {
        addConnectorToDiagram(diagram, connector);
      }
    } else {
      warnOnce('view-missing-relationship-' + viewData.view_id + '-' + relId, 'View ' + viewData.view_id + ' references missing relationship ' + relId + '.');
    }
  }
  diagram.Update();

  if (ENABLE_AUTOLAYOUT) {
    autoLayoutDiagram(diagram);
  }
}

function addElementToDiagram(diagram, element, index) {
  try {
    var col = index % 5;
    var row = Math.floor(index / 5);
    var left = 40 + (col * 260);
    var top = 40 + (row * 150);
    var right = left + 180;
    var bottom = top + 80;
    var geometry = 'l=' + left + ';r=' + right + ';t=' + top + ';b=' + bottom + ';';
    var diagramObject = diagram.DiagramObjects.AddNew(geometry, '');
    diagramObject.ElementID = element.ElementID;
    diagramObject.Style = setStyleToken(diagramObject.Style, 'UCRect', '0');
    diagramObject.Update();
  } catch (e) {
    warnOnce('diagram-object-' + diagram.DiagramID + '-' + element.ElementID, 'Could not add element to diagram: ' + errorMessage(e));
  }
}

function addConnectorToDiagram(diagram, connector) {
  try {
    var link = diagram.DiagramLinks.AddNew('', '');
    link.ConnectorID = connector.ConnectorID;
    link.Update();
  } catch (e) {
    warnOnce('diagram-link-' + diagram.DiagramID + '-' + connector.ConnectorID, 'Could not add connector to diagram: ' + errorMessage(e));
  }
}

function createMissingSubdiagrams(importPkg, elements, viewDataMap, elementMap, relationshipMap, viewMap, existingByViewId) {
  var counts = { added: 0, updated: 0 };
  if (!elements) {
    return counts;
  }

  for (var i = 0; i < elements.length; i++) {
    var elementData = elements[i];
    if (!elementData || !elementData.subdiagram_views || !elementMap[elementData.id]) {
      continue;
    }
    for (var j = 0; j < elementData.subdiagram_views.length; j++) {
      var sub = elementData.subdiagram_views[j];
      if (!sub || !isNonEmptyString(sub.view_id) || viewMap[sub.view_id]) {
        continue;
      }
      var syntheticView = {
        view_id: sub.view_id,
        view_name: sub.view_name,
        parent_element_id: elementData.id,
        parent_element_name: elementData.name,
        description: 'Subdiagram declared on element ' + elementData.id + ' but not present in root views.',
        included_elements: [],
        included_relationships: []
      };
      var outcome = ensureDiagram(importPkg, syntheticView, elementMap, viewMap, {}, existingByViewId);
      if (viewMap[syntheticView.view_id]) {
        populateDiagram(viewMap[syntheticView.view_id], syntheticView, elementMap, relationshipMap);
      }
      if (outcome == 'added') {
        counts.added++;
      } else if (outcome == 'updated') {
        counts.updated++;
      }
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// WP2100 删除对账分支：同步根包内存在但图谱没有的对象 → 先列清单、人工明确确认后才删除。
// 删除范围：包内元素与关系（含无 schema_id 的人工手绘）；绝不删除图本体（DiagramObject 布局
// 由 populateDiagram 增补式维护，人工加入的成员与布局原样保留）。
// ---------------------------------------------------------------------------

function isManagedAssociationClass(element) {
  return element != null && safeString(element.StereotypeEx) == 'SchemaRelationshipAttributes';
}

function collectDeleteCandidates(importPkg, graph) {
  var expectedElements = {};
  var expectedRelationships = {};
  var i;
  for (i = 0; i < graph.elements.length; i++) {
    if (graph.elements[i] && isNonEmptyString(graph.elements[i].id)) {
      expectedElements[graph.elements[i].id] = true;
    }
  }
  for (i = 0; i < graph.relationships.length; i++) {
    if (graph.relationships[i] && isNonEmptyString(graph.relationships[i].id)) {
      expectedRelationships[graph.relationships[i].id] = true;
    }
  }

  var elementCandidates = [];
  var connectorCandidates = [];
  var all = collectElementsUnderPackage(importPkg);
  for (var k = 0; k < all.length; k++) {
    var element = all[k];
    if (isManagedAssociationClass(element)) {
      continue; // 关系属性关联类是脚本管理产物，随关系导入对账，不列入删除
    }
    var schemaId = schemaIdOfElement(element);
    if (schemaId != '' && expectedElements[schemaId]) {
      continue; // 图谱仍有 → 保留
    }
    elementCandidates.push(element);

    // 收集该元素下图谱已没有的关系（无 schema_id 或 id 不在图谱）
    try {
      refreshCollection(element.Connectors, 'connectors-of-' + element.ElementID);
    } catch (e) {
      continue;
    }
    for (var c = 0; c < element.Connectors.Count; c++) {
      var connector = null;
      try {
        connector = element.Connectors.GetAt(c);
      } catch (e2) {
        connector = null;
      }
      if (connector == null) {
        continue;
      }
      var connectorSchemaId = schemaIdOfConnector(connector);
      if (connectorSchemaId != '' && expectedRelationships[connectorSchemaId]) {
        continue;
      }
      connectorCandidates.push(connector);
    }
  }
  return { elements: elementCandidates, connectors: connectorCandidates };
}

function collectAllDiagramsUnderPackage(importPkg) {
  var out = [];
  function addFrom(collection) {
    if (collection == null) {
      return;
    }
    for (var i = 0; i < collection.Count; i++) {
      try {
        out.push(collection.GetAt(i));
      } catch (e) {
        // 忽略单个不可读图
      }
    }
  }
  addFrom(importPkg.Diagrams);
  var all = collectElementsUnderPackage(importPkg);
  for (var j = 0; j < all.length; j++) {
    try {
      addFrom(all[j].Diagrams);
    } catch (e) {
      // 忽略
    }
  }
  return out;
}

function diagramNamesUsingElement(importPkg, elementID) {
  var names = [];
  var diagrams = collectAllDiagramsUnderPackage(importPkg);
  for (var i = 0; i < diagrams.length; i++) {
    var diagram = diagrams[i];
    try {
      refreshCollection(diagram.DiagramObjects, 'diagram-objects-of-' + diagram.DiagramID);
    } catch (e) {
      continue;
    }
    for (var j = 0; j < diagram.DiagramObjects.Count; j++) {
      var obj = null;
      try {
        obj = diagram.DiagramObjects.GetAt(j);
      } catch (e2) {
        obj = null;
      }
      if (obj != null && obj.ElementID == elementID) {
        names.push(safeString(diagram.Name));
        break;
      }
    }
  }
  return names;
}

function askDeletionConfirmation(totalCount) {
  var promptText = '同步根包 "' + IMPORT_PACKAGE_NAME + '" 中存在 ' + totalCount
    + ' 个图谱里已没有的对象（详见上方输出）。删除后不可撤销。\r\n'
    + '如确认删除请输入 "' + DELETE_CONFIRMATION_KEYWORD + '" 并回车；留空或取消则跳过删除。';
  var answer = '';
  try {
    answer = Session.Input(promptText, '');
  } catch (e) {
    answer = '';
  }
  return trimString(answer).toLowerCase() == DELETE_CONFIRMATION_KEYWORD;
}

function elementNestingDepth(element) {
  var depth = 0;
  var guard = 0;
  var parentId = 0;
  try {
    parentId = element.ParentID;
  } catch (e) {
    parentId = 0;
  }
  while (parentId != 0 && guard < 200) {
    depth++;
    guard++;
    try {
      var parent = Repository.GetElementByID(parentId);
      if (parent == null) {
        break;
      }
      parentId = parent.ParentID;
    } catch (e) {
      break;
    }
  }
  return depth;
}

function reconcileDeletions(importPkg, elementMap, graph) {
  if (importPkg == null) {
    return;
  }
  var candidates = collectDeleteCandidates(importPkg, graph);
  var connectorsToDelete = candidates.connectors;
  var elementsToDelete = candidates.elements;
  var total = connectorsToDelete.length + elementsToDelete.length;
  if (total == 0) {
    Session.Output('Reconcile: 同步根包与图谱完全一致，无删除候选。');
    return;
  }

  // 1) 先输出删除清单（名称/类型/schema_id/在哪些图使用），供人类审阅。
  Session.Output('Reconcile: 以下对象在同步根包 "' + IMPORT_PACKAGE_NAME + '" 中存在但图谱已没有 —— 删除候选清单：');
  for (var i = 0; i < connectorsToDelete.length; i++) {
    var connector = connectorsToDelete[i];
    Session.Output('  [Connector] name=' + safeString(connector.Name) + ' schema_id=' + (schemaIdOfConnector(connector) || '(none)'));
  }
  for (var j = 0; j < elementsToDelete.length; j++) {
    var element = elementsToDelete[j];
    var schemaId = schemaIdOfElement(element);
    var usage = diagramNamesUsingElement(importPkg, element.ElementID);
    Session.Output('  [Element] name=' + safeString(element.Name) + ' type=' + safeString(element.Type)
      + ' schema_id=' + (schemaId || '(none)') + ' used_in_diagrams=' + (usage.join(', ') || '(none)'));
  }

  // 2) 仅当人类明确确认后才执行删除。
  if (!askDeletionConfirmation(total)) {
    Session.Output('Reconcile: 用户未确认，跳过删除。');
    return;
  }

  // 3) 执行：先删关系，再按嵌套深度从深到浅删元素（避免父先删导致子引用失效）。
  var deleted = 0;
  for (var c = 0; c < connectorsToDelete.length; c++) {
    var con = connectorsToDelete[c];
    try {
      con.Delete();
      con.Update();
      deleted++;
    } catch (e) {
      warnOnce('delete-connector-' + safeString(con.Name), 'Could not delete connector ' + safeString(con.Name) + ': ' + errorMessage(e));
    }
  }
  elementsToDelete.sort(function (a, b) {
    return elementNestingDepth(b) - elementNestingDepth(a);
  });
  for (var e = 0; e < elementsToDelete.length; e++) {
    var el = elementsToDelete[e];
    try {
      el.Delete();
      el.Update();
      deleted++;
    } catch (err) {
      warnOnce('delete-element-' + el.ElementID, 'Could not delete element ' + safeString(el.Name) + ': ' + errorMessage(err));
    }
  }
  Session.Output('Reconcile: 已删除 ' + deleted + ' 个对象（共 ' + total + ' 个候选）。');
}

// ---------------------------------------------------------------------------
// SQL 直写通道模块（AT-2100-OPT-03）。读侧对账/写侧核心行全部经 SQL；
// 位置红线：update-in-place 绝不 DELETE 重建；绝不对既有图上几何
// (t_diagramobjects/t_diagramlinks 既有行) 做 UPDATE/DELETE。
// ---------------------------------------------------------------------------

function sqlImportMain() {
  Repository.EnsureOutputVisible('Script');
  Repository.EnableUIUpdates(false);
  markTiming('start');

  var syncPackage = null;
  try {
    Session.Output('Starting SystemArchitecture JSON import (SQL-direct)...');

    var parentPkg = resolveHeadlessParentPackage();
    if (parentPkg == null) {
      fail('Please select a target Package in the Project Browser before running this script.');
      return;
    }

    SYSTEM_ARCHITECTURE_JSON_PATH = resolveImportGraphPath();
    if (SYSTEM_ARCHITECTURE_JSON_PATH == '') {
      fail('Could not resolve design\\KG\\SystemArchitecture.json from the current EA model path.');
      return;
    }

    Session.Output('Reading: ' + SYSTEM_ARCHITECTURE_JSON_PATH);
    var jsonString = readUtf8File(SYSTEM_ARCHITECTURE_JSON_PATH);
    if (jsonString == '') {
      fail('Input file is empty or could not be read.');
      return;
    }

    var graph = parseJson(jsonString);
    validateGraph(graph);
    markTiming('graph loaded');

    syncPackage = sqlEnsureSyncPackage(parentPkg, graph);
    markTiming('sync package reconciled');

    var elementDataMap = buildElementDataMap(graph.elements);
    var elementMap = {};        // schemaId -> Object_ID
    var relationshipMap = {};   // schemaId -> Connector_ID
    var viewMap = {};           // schemaId -> Diagram_ID
    var subdiagramParentMap = buildSubdiagramParentMap(graph.elements);

    var elementCounts = sqlImportElements(syncPackage, graph.elements, elementDataMap, elementMap);
    markTiming('elements reconciled');
    var relationshipCounts = sqlImportRelationships(syncPackage, graph.relationships, elementMap, relationshipMap);
    markTiming('relationships reconciled');
    var viewCounts = sqlImportViews(syncPackage, graph.views, graph.elements, elementMap, relationshipMap, viewMap, subdiagramParentMap);
    markTiming('views reconciled');

    Session.Output('=======================================');
    Session.Output('SystemArchitecture import complete.');
    Session.Output('Elements added: ' + elementCounts.added + ', updated: ' + elementCounts.updated);
    Session.Output('Relationships added: ' + relationshipCounts.added + ', updated: ' + relationshipCounts.updated);
    Session.Output('Views added: ' + viewCounts.added + ', updated: ' + viewCounts.updated);
    Session.Output('Sync package: ' + syncPackage.Name + ' (PackageID ' + syncPackage.PackageID + ')');

    sqlReconcileDeletions(syncPackage, graph);
    markTiming('deletion reconcile done');
    reportTimings();
  } catch (e) {
    fail('Import failed: ' + errorMessage(e));
    reportTimings();
  } finally {
    Repository.EnableUIUpdates(true);
  }

  refreshProjectBrowser(syncPackage == null ? null : syncPackage.PackageID);
}

function sqlEscape(value) {
  return ('' + value).replace(/'/g, "''");
}

function newEaGuid() {
  var s = '';
  var i;
  for (i = 0; i < 32; i++) {
    var r = Math.floor(Math.random() * 16);
    var c = r < 10 ? String.fromCharCode(48 + r) : String.fromCharCode(97 + r - 10);
    s += c;
  }
  return '{' + s.substring(0, 8) + '-' + s.substring(8, 12) + '-' + s.substring(12, 16) + '-' + s.substring(16, 20) + '-' + s.substring(20) + '}';
}

// Repository.SQLQuery 返回 XML 字符串；用 MSXML 解析为行数组 [{列名: 文本}]。
function sqlRows(sqlText) {
  var xml = '';
  try {
    xml = '' + Repository.SQLQuery(sqlText);
  } catch (e) {
    warnOnce('sqlquery', 'SQLQuery failed: ' + errorMessage(e) + ' :: ' + sqlText.slice(0, 200));
    return [];
  }
  if (xml == '' || xml.indexOf('<EADATA') < 0) {
    return [];
  }
  var doc = null;
  try {
    doc = new ActiveXObject('MSXML2.DOMDocument');
    doc.async = false;
  } catch (e) {
    warnOnce('msxml', 'MSXML2.DOMDocument unavailable: ' + errorMessage(e));
    return [];
  }
  if (!doc.loadXML(xml)) {
    warnOnce('sqlxml', 'Could not parse SQLQuery XML result.');
    return [];
  }
  var out = [];
  var rows = null;
  try { rows = doc.selectNodes('/EADATA/Dataset_0/Data/Row'); } catch (e) { rows = null; }
  if (rows == null) { return out; }
  for (var i = 0; i < rows.length; i++) {
    var rowNode = rows.item(i);
    var record = {};
    var children = rowNode.childNodes;
    for (var j = 0; j < children.length; j++) {
      var child = children.item(j);
      if (child != null && child.nodeName != null && child.nodeName != '#text') {
        // EA 返回的列名是大写（PACKAGE_ID/EA_GUID/NAME/…）；统一按小写键存取，并补齐
        // 脚本内使用的混合大小写别名（Object_ID/Package_ID/Connector_ID/Diagram_ID/…）。
        var rawName = '' + child.nodeName;
        record[rawName.toLowerCase()] = child.text;
        record[rawName] = child.text;
      }
    }
    applyColumnAliases(record);
    out.push(record);
  }
  return out;
}

var COLUMN_ALIASES = {
  object_id: 'Object_ID',
  package_id: 'Package_ID',
  connector_id: 'Connector_ID',
  diagram_id: 'Diagram_ID',
  propertyid: 'PropertyID',
  start_object_id: 'Start_Object_ID',
  end_object_id: 'End_Object_ID',
  connectorid: 'ConnectorID',
  parentid: 'ParentID',
  ea_guid: 'ea_guid',
  name: 'Name',
  alias: 'Alias',
  type: 'Type',
  stereotype: 'Stereotype',
  styleex: 'StyleEx',
  note: 'Note',
  notes: 'Notes',
  status: 'Status',
  sequence: 'Sequence',
  direction: 'Direction',
  diagram_type: 'Diagram_Type',
  object_type: 'Object_Type',
  connection: 'Connection'
};

function applyColumnAliases(record) {
  for (var k in COLUMN_ALIASES) {
    if (COLUMN_ALIASES.hasOwnProperty(k) && record.hasOwnProperty(k)) {
      var alias = COLUMN_ALIASES[k];
      if (!record.hasOwnProperty(alias)) {
        record[alias] = record[k];
      }
    }
  }
}

// 大小写不敏感取列（兼容 EA 返回大写列名与 SQL 别名大小写差异）。
function col(row, name) {
  if (row == null) { return undefined; }
  var lower = ('' + name).toLowerCase();
  if (row.hasOwnProperty(lower)) { return row[lower]; }
  for (var k in row) {
    if (row.hasOwnProperty(k) && ('' + k).toLowerCase() == lower) { return row[k]; }
  }
  return undefined;
}

// 批量 INSERT 可行性结论（probe13/probe14，EA Trial 15.2 .feap/Firebird 嵌入式）：
//   * 多行 VALUES 单语句（VALUES (...),(...)）→ Repository.Execute 无头挂起（Firebird<2.0 不支持多行 VALUES，
//     错误被 EA 吞成阻塞）；交互侧应返回真实 ODBC 错误。
//   * ';' 拼接多语句单次 Execute → RPC 调用失败（EA 进程终止）。
//   → SQL 写路径必须逐条单语句 Execute（本文件现有形态）；批大小/提速实验不适用本环境，
//     逐条 Execute 与对象模型总耗时相当（全图约 165s，见 sqlDirectEnabled 注释）。
function sqlExec(sqlText, label) {
  try {
    var ok = Repository.Execute(sqlText);
    // 实测：本环境（EA Trial 15.2 .feap/Firebird）成功执行返回 undefined/null；
    // 仅当明确返回 false 才视为失败（异常路径另按失败处理）。
    if (ok === false) {
      warnOnce('sqlexec-' + (label || 'sql'), 'Execute returned false: ' + sqlText.slice(0, 200));
    }
    return ok !== false;
  } catch (e) {
    warnOnce('sqlexec-' + (label || 'sql'), 'Execute failed: ' + errorMessage(e) + ' :: ' + sqlText.slice(0, 200));
    return false;
  }
}

function sqlFindPackage(parentPackageId, name) {
  var rows = sqlRows('SELECT Package_ID FROM t_package WHERE Parent_ID=' + Number(parentPackageId)
    + " AND Name='" + sqlEscape(name) + "'");
  return rows.length > 0 ? Number(rows[0].Package_ID) : null;
}

function sqlEnsureSyncPackage(parentPkg, graph) {
  var parentPackageId = Number(parentPkg.PackageID);
  var existingId = sqlFindPackage(parentPackageId, IMPORT_PACKAGE_NAME);
  if (existingId != null) {
    Session.Output('Reusing existing sync package: ' + IMPORT_PACKAGE_NAME + ' (PackageID ' + existingId + ')');
    return { PackageID: existingId, Name: IMPORT_PACKAGE_NAME };
  }
  var guid = newEaGuid();
  sqlExec("INSERT INTO t_package (Name, Parent_ID, ea_guid, Notes) VALUES ('"
    + sqlEscape(IMPORT_PACKAGE_NAME) + "', " + Number(parentPackageId) + ", '" + sqlEscape(guid) + "', '"
    + sqlEscape(safeString(graph.description)) + "')", 'insert-sync-package');
  var readback = sqlRows("SELECT Package_ID FROM t_package WHERE ea_guid='" + sqlEscape(guid) + "'");
  if (readback.length == 0) {
    throw new Error('Sync package insert failed; could not read back Package_ID by ea_guid.');
  }
  var newId = Number(readback[0].Package_ID);
  Session.Output('Created sync package: ' + IMPORT_PACKAGE_NAME + ' (PackageID ' + newId + ')');
  return { PackageID: newId, Name: IMPORT_PACKAGE_NAME };
}

function sqlObjectByAlias(syncPackageId, schemaId) {
  var rows = sqlRows('SELECT Object_ID FROM t_object WHERE Package_ID=' + Number(syncPackageId)
    + " AND Alias='" + sqlEscape(schemaId) + "'");
  return rows.length > 0 ? Number(rows[0].Object_ID) : null;
}

function sqlConnectorByAlias(syncPackageId, schemaId) {
  var rows = sqlRows('SELECT c.Connector_ID FROM t_connector c INNER JOIN t_object o ON c.Start_Object_ID=o.Object_ID'
    + ' WHERE o.Package_ID=' + Number(syncPackageId) + " AND c.Alias='" + sqlEscape(schemaId) + "'");
  return rows.length > 0 ? Number(rows[0].Connector_ID) : null;
}

function sqlDiagramByViewId(syncPackageId, viewId) {
  var rows = sqlRows('SELECT Diagram_ID, StyleEx FROM t_diagram WHERE Package_ID=' + Number(syncPackageId));
  for (var i = 0; i < rows.length; i++) {
    if (getStyleToken(safeString(rows[i].StyleEx), 'schema_view_id') == viewId) {
      return Number(rows[i].Diagram_ID);
    }
  }
  return null;
}

function sqlImportElements(syncPackage, elements, elementDataMap, elementMap) {
  var counts = { added: 0, updated: 0 };
  var syncPackageId = Number(syncPackage.PackageID);
  for (var i = 0; i < elements.length; i++) {
    var elementData = elements[i];
    if (!elementData || !isNonEmptyString(elementData.id)) { continue; }
    var outcome = sqlEnsureElement(syncPackageId, elementData.id, elementDataMap, elementMap);
    if (outcome == 'added') { counts.added++; }
    else if (outcome == 'updated') { counts.updated++; }
  }
  return counts;
}

function sqlEnsureElement(syncPackageId, schemaId, elementDataMap, elementMap) {
  if (elementMap[schemaId]) { return 'already-mapped'; }
  var elementData = elementDataMap[schemaId];
  if (!elementData) {
    warnOnce('missing-element-' + schemaId, 'Element data not found for id: ' + schemaId);
    return 'skipped';
  }
  var parentObjectId = 0;
  if (isNonEmptyString(elementData.parent) && elementData.parent != '0' && elementDataMap[elementData.parent]) {
    sqlEnsureElement(syncPackageId, elementData.parent, elementDataMap, elementMap);
    if (elementMap[elementData.parent]) { parentObjectId = Number(elementMap[elementData.parent]); }
  }

  var existingObjectId = sqlObjectByAlias(syncPackageId, schemaId);
  if (existingObjectId != null) {
    elementMap[schemaId] = existingObjectId;
    sqlUpdateElementRow(existingObjectId, elementData);
    sqlWriteElementTags(existingObjectId, elementData);
    sqlApplyElementChildren(existingObjectId, elementData);
    Session.Output('Updated element [' + safeString(elementData.type) + ']: ' + elementData.name + ' (' + schemaId + ')');
    return 'updated';
  }

  var guid = newEaGuid();
  var baseType = mapElementTypeToEa(elementData.type);
  var alias = isNonEmptyString(elementData.alias) ? elementData.alias : schemaId;
  sqlExec("INSERT INTO t_object (Object_Type, ea_guid, Name, Stereotype, Note, Alias, Package_ID, ParentID, Status) VALUES ('"
    + sqlEscape(baseType) + "', '" + sqlEscape(guid) + "', '" + sqlEscape(safeName(elementData.name, schemaId)) + "', '"
    + sqlEscape(mapElementTypeToEaStereotype(elementData.type)) + "', '" + sqlEscape(safeString(elementData.description)) + "', '"
    + sqlEscape(alias) + "', " + Number(syncPackageId) + ', ' + Number(parentObjectId || 0) + ", '"
    + sqlEscape(safeString(elementData.status)) + "')", 'insert-element');

  var readback = sqlRows("SELECT Object_ID FROM t_object WHERE ea_guid='" + sqlEscape(guid) + "'");
  if (readback.length == 0) {
    warnOnce('element-readback-' + schemaId, 'Could not read back Object_ID for element ' + schemaId);
    return 'skipped';
  }
  var newObjectId = Number(readback[0].Object_ID);
  elementMap[schemaId] = newObjectId;
  sqlWriteElementTags(newObjectId, elementData);
  sqlApplyElementChildren(newObjectId, elementData);
  Session.Output('Created element [' + safeString(elementData.type) + ']: ' + elementData.name + ' (' + schemaId + ')');
  return 'added';
}

// 仅 UPDATE 内容列；Type 对既有元素不可变。
function sqlUpdateElementRow(objectId, data) {
  var alias = isNonEmptyString(data.alias) ? data.alias : data.id;
  sqlExec("UPDATE t_object SET Name='" + sqlEscape(safeName(data.name, data.id)) + "', Note='"
    + sqlEscape(safeString(data.description)) + "', Alias='" + sqlEscape(alias) + "', Stereotype='"
    + sqlEscape(mapElementTypeToEaStereotype(data.type)) + "', Status='" + sqlEscape(safeString(data.status))
    + "' WHERE Object_ID=" + Number(objectId), 'update-element');
}

function sqlUpsertTag(tableName, ownerColumn, ownerId, name, value) {
  var sch = sqlTagSchema(tableName);
  var text = safeString(value);
  var shortValue = text;
  var memoNotes = '';
  if (text.length > 250) { shortValue = '<memo>'; memoNotes = text; }
  var found = sqlRows('SELECT ' + sch.idColumn + ' FROM ' + tableName + ' WHERE ' + sch.ownerColumn + '=' + Number(ownerId)
    + " AND Property='" + sqlEscape(name) + "'");
  if (found.length > 0) {
    sqlExec('UPDATE ' + tableName + ' SET ' + sch.valueColumn + "='" + sqlEscape(shortValue) + "', " + sch.notesColumn + "='" + sqlEscape(memoNotes)
      + "' WHERE " + sch.idColumn + '=' + Number(found[0].PropertyID), 'update-tag-' + name);
  } else {
    sqlExec('INSERT INTO ' + tableName + ' (' + sch.ownerColumn + ", Property, " + sch.valueColumn + ', ' + sch.notesColumn + ') VALUES (' + Number(ownerId)
      + ", '" + sqlEscape(name) + "', '" + sqlEscape(shortValue) + "', '" + sqlEscape(memoNotes) + "')", 'insert-tag-' + name);
  }
}

function sqlTagSchema(tableName) {
  // Firebird .feap tag 表与 Jet 不同：t_objectproperties(元素) 的 Value 列混合大小写需双引号；
  // 连接 tag 表为 t_connectortag（owner ElementID, VALUE 大写）；Jet 的 t_connectorproperties 不存在。
  var sch = SQL_TAG_SCHEMAS[tableName];
  if (sch) { return sch; }
  return { ownerColumn: 'ElementID', valueColumn: 'VALUE', notesColumn: 'NOTES', idColumn: 'PropertyID' };
}

var SQL_TAG_SCHEMAS = {
  t_objectproperties: { ownerColumn: 'Object_ID', valueColumn: '"Value"', notesColumn: 'NOTES', idColumn: 'PropertyID' },
  t_connectortag: { ownerColumn: 'ElementID', valueColumn: 'VALUE', notesColumn: 'NOTES', idColumn: 'PropertyID' }
};
function sqlWriteElementTags(objectId, data) {
  sqlUpsertTag('t_objectproperties', 'Object_ID', objectId, 'schema_id', data.id);
  sqlUpsertTag('t_objectproperties', 'Object_ID', objectId, 'schema_parent', safeString(data.parent));
  sqlUpsertTag('t_objectproperties', 'Object_ID', objectId, 'archimate_type', canonicalArchimateType(data.type));
  sqlUpsertTag('t_objectproperties', 'Object_ID', objectId, 'schema_alias', safeString(data.alias));
  sqlUpsertTag('t_objectproperties', 'Object_ID', objectId, 'schema_classifier', safeString(data.classifier));
  sqlUpsertTag('t_objectproperties', 'Object_ID', objectId, 'schema_element_json', jsonOr(data));
  sqlUpsertTag('t_objectproperties', 'Object_ID', objectId, 'testcases_json', jsonOr(data.testcases || []));
  sqlUpsertTag('t_objectproperties', 'Object_ID', objectId, 'project_info_json', jsonOr(data.project_info || {}));
  sqlUpsertTag('t_objectproperties', 'Object_ID', objectId, 'subdiagram_views_json', jsonOr(data.subdiagram_views || []));
}

function jsonOr(value) {
  try { return JSON.stringify(value); } catch (e) { return safeString(value); }
}

// 元素内容子集合窄对象模型例外（EA 内部维护 t_attribute/t_operation/t_test/t_objectresource 等子表）。
function sqlApplyElementChildren(objectId, data) {
  var needsObject = (data.attributes && data.attributes.length > 0)
    || isNonEmptyString(data.code_file) || isNonEmptyString(data.condition_file) || isNonEmptyString(data.prompts_file)
    || (data.project_info && (data.project_info.summary || data.project_info.resources || data.project_info.tasks))
    || (data.testcases && data.testcases.length > 0)
    || (data.subdiagram_views && data.subdiagram_views.length > 0);
  if (!needsObject) { return; }
  var element = null;
  try { element = Repository.GetElementByID(Number(objectId)); } catch (e) { element = null; }
  if (element == null) { return; }
  try { element.Update(); } catch (e) { }
  applyElementAttributes(element, data.attributes);
  applyElementSpecialMethods(element, data);
  applyProjectInfo(element, data.project_info);
  applyTestcases(element, data.testcases);
  if (data.subdiagram_views && data.subdiagram_views.length > 0) {
    applySubdiagramViewTags(element, data.subdiagram_views);
  }
  try { element.Update(); } catch (e) { }
}

function sqlImportRelationships(syncPackage, relationships, elementMap, relationshipMap) {
  var counts = { added: 0, updated: 0 };
  var syncPackageId = Number(syncPackage.PackageID);
  for (var i = 0; i < relationships.length; i++) {
    var data = relationships[i];
    if (!data || !isNonEmptyString(data.id)) { continue; }
    var sourceObjectId = elementMap[data.source_id] ? Number(elementMap[data.source_id]) : null;
    var targetObjectId = elementMap[data.target_id] ? Number(elementMap[data.target_id]) : null;
    if (sourceObjectId == null || targetObjectId == null) {
      warnOnce('missing-rel-end-' + data.id, 'Skipping relationship ' + data.id + ' because source or target element is missing.');
      continue;
    }
    var connectorMeta = mapRelationshipTypeToEa(data.type);
    warnIfUnknownSchemaRelationshipType(data.type);

    var existingConnectorId = sqlConnectorByAlias(syncPackageId, data.id);
    if (existingConnectorId != null) {
      relationshipMap[data.id] = existingConnectorId;
      sqlUpdateConnectorRow(existingConnectorId, data, sourceObjectId, targetObjectId, connectorMeta);
      sqlWriteConnectorTags(existingConnectorId, data);
      sqlApplyAggregationDiamond(existingConnectorId, connectorMeta);
      counts.updated++;
      Session.Output('Updated relationship [' + safeString(data.type) + '] ' + safeString(data.name) + ': ' + data.id);
      continue;
    }

    var guid = newEaGuid();
    var direction = connectorMeta.directed ? 'Source -> Destination' : '';
    sqlExec("INSERT INTO t_connector (Name, Connector_Type, Start_Object_ID, End_Object_ID, Stereotype, Notes, Direction, Alias, ea_guid) VALUES ('"
      + sqlEscape(safeString(data.name)) + "', '" + sqlEscape(connectorMeta.connectorType) + "', " + Number(sourceObjectId)
      + ', ' + Number(targetObjectId) + ", '" + sqlEscape(mapRelationshipTypeToEaStereotype(data.type)) + "', '"
      + sqlEscape(safeString(data.description)) + "', '" + sqlEscape(direction) + "', '" + sqlEscape(data.id) + "', '"
      + sqlEscape(guid) + "')", 'insert-connector');

    var readback = sqlRows("SELECT Connector_ID FROM t_connector WHERE ea_guid='" + sqlEscape(guid) + "'");
    if (readback.length == 0) {
      warnOnce('connector-readback-' + data.id, 'Could not read back Connector_ID for relationship ' + data.id);
      continue;
    }
    var newConnectorId = Number(readback[0].Connector_ID);
    relationshipMap[data.id] = newConnectorId;
    sqlWriteConnectorTags(newConnectorId, data);
    sqlApplyAggregationDiamond(newConnectorId, connectorMeta);
    counts.added++;
    Session.Output('Created relationship [' + safeString(data.type) + '] ' + safeString(data.name) + ': ' + data.id);
  }
  return counts;
}

// update-in-place：只写关系内容列与两端/方向；绝不 DELETE 重建。
function sqlUpdateConnectorRow(connectorId, data, sourceObjectId, targetObjectId, connectorMeta) {
  var direction = connectorMeta.directed ? 'Source -> Destination' : '';
  sqlExec("UPDATE t_connector SET Name='" + sqlEscape(safeString(data.name)) + "', Start_Object_ID=" + Number(sourceObjectId)
    + ', End_Object_ID=' + Number(targetObjectId) + ", Stereotype='" + sqlEscape(mapRelationshipTypeToEaStereotype(data.type))
    + "', Notes='" + sqlEscape(safeString(data.description)) + "', Direction='" + sqlEscape(direction) + "', Alias='"
    + sqlEscape(data.id) + "' WHERE Connector_ID=" + Number(connectorId), 'update-connector');
}

function sqlWriteConnectorTags(connectorId, data) {
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'schema_id', data.id);
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'schema_name', safeString(data.name));
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'schema_statement', safeString(data.statement));
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'archimate_relationship_type', canonicalArchimateType(data.type));
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'document', safeString(data.document));
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'source_schema_id', safeString(data.source_id));
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'target_schema_id', safeString(data.target_id));
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'source_name', safeString(data.source_name));
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'target_name', safeString(data.target_name));
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'schema_relationship_json', jsonOr(data));
  sqlUpsertTag('t_connectortag', 'ElementID', connectorId, 'relationship_attributes_json',
    jsonOr(data.attributes || []));
  if (data.attributes) {
    for (var i = 0; i < data.attributes.length; i++) {
      var attr = data.attributes[i];
      if (!attr) { continue; }
      sqlUpsertTag('t_connectortag', 'ElementID', connectorId,
        'relattr_' + sanitizeTagName(attr.name), safeString(attr.description));
    }
  }
}

// Composition/Aggregation 钻石（SupplierEnd.Aggregation）由 EA 对象模型维护 → 窄例外。
function sqlApplyAggregationDiamond(connectorId, connectorMeta) {
  if (!connectorMeta || connectorMeta.aggregationKind < 0) { return; }
  var connector = null;
  try { connector = Repository.GetConnectorByID(Number(connectorId)); } catch (e) { connector = null; }
  if (connector == null) { return; }
  try {
    connector.SupplierEnd.Aggregation = connectorMeta.aggregationKind;
    connector.Update();
  } catch (e) {
    warnOnce('aggregation-' + connectorId, 'Could not apply aggregation kind: ' + errorMessage(e));
  }
}

function sqlImportViews(syncPackage, views, elements, elementMap, relationshipMap, viewMap, subdiagramParentMap) {
  var counts = { added: 0, updated: 0 };
  var syncPackageId = Number(syncPackage.PackageID);
  for (var i = 0; i < views.length; i++) {
    var viewData = views[i];
    if (!viewData || !isNonEmptyString(viewData.view_id)) { continue; }
    var outcome = sqlEnsureDiagram(syncPackageId, viewData, elementMap, viewMap, subdiagramParentMap);
    if (viewMap[viewData.view_id]) {
      sqlPopulateDiagram(syncPackageId, viewMap[viewData.view_id], viewData, elementMap, relationshipMap);
    }
    if (outcome == 'added') { counts.added++; }
    else if (outcome == 'updated') { counts.updated++; }
  }
  return counts;
}

function sqlStyleExFor(viewData) {
  var styleEx = '';
  styleEx = setStyleToken(styleEx, 'schema_view_id', viewData.view_id);
  styleEx = setStyleToken(styleEx, 'schema_parent_element_id', safeString(viewData.parent_element_id));
  styleEx = setStyleToken(styleEx, 'schema_parent_element_name', safeString(viewData.parent_element_name));
  styleEx = setStyleJsonToken(styleEx, 'schema_included_elements_json', viewData.included_elements || []);
  styleEx = setStyleJsonToken(styleEx, 'schema_included_relationships_json', viewData.included_relationships || []);
  return styleEx;
}

function sqlEnsureDiagram(syncPackageId, viewData, elementMap, viewMap, subdiagramParentMap) {
  if (viewMap[viewData.view_id]) { return 'already-mapped'; }
  var parentElementId = 0;
  if (isNonEmptyString(viewData.parent_element_id) && elementMap[viewData.parent_element_id]) {
    parentElementId = Number(elementMap[viewData.parent_element_id]);
  } else if (subdiagramParentMap[viewData.view_id] && elementMap[subdiagramParentMap[viewData.view_id]]) {
    parentElementId = Number(elementMap[subdiagramParentMap[viewData.view_id]]);
  }

  var existingDiagramId = sqlDiagramByViewId(syncPackageId, viewData.view_id);
  if (existingDiagramId != null) {
    viewMap[viewData.view_id] = existingDiagramId;
    sqlExec("UPDATE t_diagram SET Name='" + sqlEscape(safeName(viewData.view_name, viewData.view_id)) + "', Notes='"
      + sqlEscape(safeString(viewData.description)) + "', StyleEx='" + sqlEscape(sqlStyleExFor(viewData)) + "' WHERE Diagram_ID="
      + Number(existingDiagramId), 'update-diagram');
    Session.Output('Updated view: ' + safeName(viewData.view_name, viewData.view_id) + ' (' + viewData.view_id + ')');
    return 'updated';
  }

  var guid = newEaGuid();
  sqlExec("INSERT INTO t_diagram (Name, Diagram_Type, Package_ID, ParentID, ea_guid, StyleEx, Notes) VALUES ('"
    + sqlEscape(safeName(viewData.view_name, viewData.view_id)) + "', '" + sqlEscape(DIAGRAM_TYPE) + "', " + Number(syncPackageId)
    + ', ' + Number(parentElementId || 0) + ", '" + sqlEscape(guid) + "', '" + sqlEscape(sqlStyleExFor(viewData)) + "', '"
    + sqlEscape(safeString(viewData.description)) + "')", 'insert-diagram');
  var readback = sqlRows("SELECT Diagram_ID FROM t_diagram WHERE ea_guid='" + sqlEscape(guid) + "'");
  if (readback.length == 0) {
    warnOnce('diagram-readback-' + viewData.view_id, 'Could not read back Diagram_ID for view ' + viewData.view_id);
    return 'skipped';
  }
  var diagramId = Number(readback[0].Diagram_ID);
  viewMap[viewData.view_id] = diagramId;
  Session.Output('Created view: ' + safeName(viewData.view_name, viewData.view_id) + ' (' + viewData.view_id + ')');
  return 'added';
}

// 成员增补：只补缺失（既有 t_diagramobjects/t_diagramlinks 行与几何绝不动）；新增成员几何由对象模型窄例外写入。
function sqlPopulateDiagram(syncPackageId, diagramId, viewData, elementMap, relationshipMap) {
  if (diagramId == null) { return; }
  var placedElementIds = {};
  var existingObjects = sqlRows('SELECT Object_ID FROM t_diagramobjects WHERE Diagram_ID=' + Number(diagramId));
  for (var i = 0; i < existingObjects.length; i++) {
    placedElementIds[Number(existingObjects[i].Object_ID)] = true;
  }
  var placedConnectorIds = {};
  var existingLinks = sqlRows('SELECT ConnectorID FROM t_diagramlinks WHERE Diagram_ID=' + Number(diagramId));
  for (var l = 0; l < existingLinks.length; l++) {
    placedConnectorIds[Number(existingLinks[l].ConnectorID)] = true;
  }

  var diagram = null;
  try { diagram = Repository.GetDiagramByID(Number(diagramId)); } catch (e) { diagram = null; }

  var nextObjectIndex = existingObjects.length;
  var includedElements = viewData.included_elements || [];
  for (var k = 0; k < includedElements.length; k++) {
    var schemaId = includedElements[k];
    var objectId = elementMap[schemaId] ? Number(elementMap[schemaId]) : null;
    if (objectId == null) {
      warnOnce('view-missing-element-' + viewData.view_id + '-' + schemaId, 'View ' + viewData.view_id + ' references missing element ' + schemaId + '.');
      continue;
    }
    if (!placedElementIds[objectId]) {
      if (diagram != null) {
        addObjectToDiagramByID(diagram, objectId, nextObjectIndex);
        placedElementIds[objectId] = true;
        nextObjectIndex++;
      } else {
        warnOnce('diagram-object-add-' + viewData.view_id + '-' + schemaId, 'Could not obtain diagram object to add missing member ' + schemaId + '.');
      }
    }
  }
  var includedRelationships = viewData.included_relationships || [];
  for (var m = 0; m < includedRelationships.length; m++) {
    var relId = includedRelationships[m];
    var connectorId = relationshipMap[relId] ? Number(relationshipMap[relId]) : null;
    if (connectorId == null) {
      warnOnce('view-missing-relationship-' + viewData.view_id + '-' + relId, 'View ' + viewData.view_id + ' references missing relationship ' + relId + '.');
      continue;
    }
    if (!placedConnectorIds[connectorId]) {
      if (diagram != null) {
        addConnectorToDiagramByID(diagram, connectorId);
        placedConnectorIds[connectorId] = true;
      } else {
        warnOnce('diagram-link-add-' + viewData.view_id + '-' + relId, 'Could not obtain diagram object to add missing link ' + relId + '.');
      }
    }
  }
  if (diagram != null) {
    try { diagram.Update(); } catch (e) { }
  }
}

function addObjectToDiagramByID(diagram, objectId, index) {
  try {
    var col = index % 5;
    var row = Math.floor(index / 5);
    var left = 40 + (col * 260);
    var top = 40 + (row * 150);
    var right = left + 180;
    var bottom = top + 80;
    var geometry = 'l=' + left + ';r=' + right + ';t=' + top + ';b=' + bottom + ';';
    var diagramObject = diagram.DiagramObjects.AddNew(geometry, '');
    diagramObject.ElementID = Number(objectId);
    try { diagramObject.Style = setStyleToken(diagramObject.Style, 'UCRect', '0'); } catch (e) { }
    diagramObject.Update();
  } catch (e) {
    warnOnce('diagram-object-' + diagram.DiagramID + '-' + objectId, 'Could not add element to diagram: ' + errorMessage(e));
  }
}

function addConnectorToDiagramByID(diagram, connectorId) {
  try {
    var link = diagram.DiagramLinks.AddNew('', '');
    link.ConnectorID = Number(connectorId);
    link.Update();
  } catch (e) {
    warnOnce('diagram-link-' + diagram.DiagramID + '-' + connectorId, 'Could not add connector to diagram: ' + errorMessage(e));
  }
}

// 删除对账（SQL DELETE）：先列清单（元素/关系 + 所在图）→ 人工键入 delete 确认 → 先关系后元素。
function sqlReconcileDeletions(syncPackage, graph) {
  if (syncPackage == null) { return; }
  var syncPackageId = Number(syncPackage.PackageID);
  var expectedElements = {};
  var expectedRelationships = {};
  var i;
  for (i = 0; i < graph.elements.length; i++) {
    if (graph.elements[i] && isNonEmptyString(graph.elements[i].id)) { expectedElements[graph.elements[i].id] = true; }
  }
  for (i = 0; i < graph.relationships.length; i++) {
    if (graph.relationships[i] && isNonEmptyString(graph.relationships[i].id)) { expectedRelationships[graph.relationships[i].id] = true; }
  }

  var elements = sqlRows('SELECT Object_ID, Name, Alias, ParentID, Object_Type FROM t_object WHERE Package_ID=' + Number(syncPackageId)
    + " 1=1");
  var elementCandidates = [];
  var connectorCandidates = [];
  var objectIds = [];
  for (i = 0; i < elements.length; i++) {
    var alias = safeString(elements[i].Alias);
    objectIds.push(Number(elements[i].Object_ID));
    if (/_attributes$/.test(alias)) { continue; } // 关系属性关联类托管对象除外
    if (alias != '' && expectedElements[alias]) { continue; }
    elementCandidates.push(elements[i]);
  }
  var whereIds = objectIds.length > 0 ? objectIds.join(',') : '0';
  var connectors = sqlRows('SELECT Connector_ID, Name, Alias FROM t_connector WHERE Start_Object_ID IN (' + whereIds + ')');
  for (i = 0; i < connectors.length; i++) {
    var cAlias = safeString(connectors[i].Alias);
    if (cAlias != '' && expectedRelationships[cAlias]) { continue; }
    connectorCandidates.push(connectors[i]);
  }

  var total = connectorCandidates.length + elementCandidates.length;
  if (total == 0) {
    Session.Output('Reconcile: 同步根包与图谱完全一致，无删除候选。');
    return;
  }
  Session.Output('Reconcile: 以下对象在同步根包 "' + IMPORT_PACKAGE_NAME + '" 中存在但图谱已没有 —— 删除候选清单：');
  for (i = 0; i < connectorCandidates.length; i++) {
    Session.Output('  [Connector] name=' + safeString(connectorCandidates[i].Name) + ' schema_id=' + (safeString(connectorCandidates[i].Alias) || '(none)'));
  }
  for (i = 0; i < elementCandidates.length; i++) {
    var el = elementCandidates[i];
    var usage = sqlDiagramNamesUsingElement(syncPackageId, Number(el.Object_ID));
    Session.Output('  [Element] name=' + safeString(el.Name) + ' ea_type=' + safeString(el.Object_Type)
      + ' schema_id=' + (safeString(el.Alias) || '(none)') + ' used_in_diagrams=' + (usage.join(', ') || '(none)'));
  }

  if (!askDeletionConfirmation(total)) {
    Session.Output('Reconcile: 用户未确认，跳过删除。');
    return;
  }
  var deleted = 0;
  for (i = 0; i < connectorCandidates.length; i++) {
    if (sqlExec('DELETE FROM t_connector WHERE Connector_ID=' + Number(connectorCandidates[i].Connector_ID), 'delete-connector')) { deleted++; }
  }
  elementCandidates.sort(function (a, b) {
    return sqlElementDepth(Number(b.Object_ID)) - sqlElementDepth(Number(a.Object_ID));
  });
  for (i = 0; i < elementCandidates.length; i++) {
    if (sqlExec('DELETE FROM t_object WHERE Object_ID=' + Number(elementCandidates[i].Object_ID), 'delete-element')) { deleted++; }
  }
  Session.Output('Reconcile: 已删除 ' + deleted + ' 个对象（共 ' + total + ' 个候选）。');
}

function sqlDiagramNamesUsingElement(syncPackageId, elementId) {
  var names = [];
  var rows = sqlRows('SELECT d.Name FROM t_diagram d INNER JOIN t_diagramobjects o ON d.Diagram_ID=o.Diagram_ID'
    + ' WHERE d.Package_ID=' + Number(syncPackageId) + ' AND o.Object_ID=' + Number(elementId));
  for (var i = 0; i < rows.length; i++) { names.push(safeString(rows[i].Name)); }
  return names;
}

function sqlElementDepth(objectId) {
  var depth = 0;
  var guard = 0;
  var currentId = Number(objectId);
  while (currentId != 0 && guard < 200) {
    depth++;
    guard++;
    var parents = sqlRows('SELECT ParentID FROM t_object WHERE Object_ID=' + Number(currentId));
    if (parents.length == 0) { break; }
    currentId = Number(parents[0].ParentID || 0);
  }
  return depth;
}

function mapElementTypeToEaStereotype(archimateType) {
  var normalized = normalizeArchimateName(archimateType);
  if (normalized == '') {
    return '';
  }
  switch (normalized) {
    case 'SystemSoftware':
      return 'ArchiMate_SystemSoftware';
    case 'Constraint':
      return 'ArchiMate_Constraint';
  }
  return normalized;
}

function mapRelationshipTypeToEaStereotype(relationshipType) {
  var normalized = normalizeArchimateName(relationshipType);
  if (normalized == '') {
    return '';
  }
  return normalized;
}

function mapElementTypeToEa(archimateType) {
  switch (normalizeArchimateName(archimateType)) {
    case 'ApplicationComponent':
      return 'Component';
    case 'BusinessEvent':
    case 'BusinessProcess':
    case 'BusinessFunction':
    case 'BusinessInteraction':
    case 'BusinessService':
    case 'ApplicationEvent':
    case 'ApplicationProcess':
    case 'ApplicationFunction':
    case 'ApplicationInteraction':
    case 'ApplicationService':
    case 'TechnologyEvent':
    case 'TechnologyProcess':
    case 'TechnologyFunction':
    case 'TechnologyInteraction':
    case 'TechnologyService':
    case 'ValueStream':
      return 'Activity';
    case 'Junction':
    case 'AndJunction':
    case 'OrJunction':
      return 'StateNode';
    default:
      return 'Class';
  }
}

function mapRelationshipTypeToEa(relationshipType) {
  var normalized = normalizeArchimateName(relationshipType);
  var meta = {
    connectorType: 'Association',
    aggregationKind: -1,
    // Whether the ArchiMate relationship is directed. Directed relations must store an
    // explicit EA Direction ("Source -> Destination") or Association-mapped connectors
    // (Serving, Assignment) render as plain lines with no arrowhead on the generated views.
    // Undirected Association and the structural Composition/Aggregation (whose whole/part
    // diamond already marks the direction) stay directed:false with Direction = Unspecified.
    directed: false
  };

  switch (normalized) {
    case 'Composition':
      meta.connectorType = 'Association';
      meta.aggregationKind = 2;
      break;
    case 'Aggregation':
      meta.connectorType = 'Association';
      meta.aggregationKind = 1;
      break;
    case 'Specialization':
      meta.connectorType = 'Generalization';
      meta.directed = true;
      break;
    case 'Realization':
    case 'Access':
      meta.connectorType = 'Dependency';
      meta.directed = true;
      break;
    case 'Serving':
    case 'Assignment':
      meta.connectorType = 'Association';
      meta.directed = true;
      break;
    case 'Association':
      meta.connectorType = 'Association';
      break;
    case 'Triggering':
    case 'Flow':
    case 'Influence':
      meta.connectorType = 'ControlFlow';
      meta.directed = true;
      break;
    default:
      meta.connectorType = 'Association';
      warnOnce('unknown-relationship-type-' + normalized, 'Unknown relationship type mapping: ' + safeString(relationshipType) + '. Using Association.');
      break;
  }

  return meta;
}

function normalizeArchimateName(value) {
  var text = safeString(value);
  text = text.replace(/^ArchiMate[_\s-]*/i, '');
  text = text.replace(/&/g, '');
  text = text.replace(/[^A-Za-z0-9]/g, '');
  return text;
}

function canonicalArchimateType(value) {
  var normalized = normalizeArchimateName(value);
  var display = displayArchimateName(normalized);
  return display != '' ? display : safeString(value);
}

function displayArchimateName(normalized) {
  switch (safeString(normalized)) {
    case 'Class': return 'Grouping';
    case 'ValueStream': return 'Value Stream';
    case 'CourseOfAction': return 'Course of Action';
    case 'BusinessActor': return 'Business Actor';
    case 'BusinessRole': return 'Business Role';
    case 'BusinessCollaboration': return 'Business Collaboration';
    case 'BusinessInterface': return 'Business Interface';
    case 'BusinessProcess': return 'Business Process';
    case 'BusinessFunction': return 'Business Function';
    case 'BusinessInteraction': return 'Business Interaction';
    case 'BusinessEvent': return 'Business Event';
    case 'BusinessService': return 'Business Service';
    case 'BusinessObject': return 'Business Object';
    case 'ApplicationComponent': return 'Application Component';
    case 'ApplicationCollaboration': return 'Application Collaboration';
    case 'ApplicationInterface': return 'Application Interface';
    case 'ApplicationProcess': return 'Application Process';
    case 'ApplicationFunction': return 'Application Function';
    case 'ApplicationInteraction': return 'Application Interaction';
    case 'ApplicationEvent': return 'Application Event';
    case 'ApplicationService': return 'Application Service';
    case 'DataObject': return 'Data Object';
    case 'SystemSoftware': return 'System Software';
    case 'TechnologyCollaboration': return 'Technology Collaboration';
    case 'TechnologyInterface': return 'Technology Interface';
    case 'CommunicationNetwork': return 'Communication Network';
    case 'TechnologyProcess': return 'Technology Process';
    case 'TechnologyFunction': return 'Technology Function';
    case 'TechnologyInteraction': return 'Technology Interaction';
    case 'TechnologyEvent': return 'Technology Event';
    case 'TechnologyService': return 'Technology Service';
    case 'DistributionNetwork': return 'Distribution Network';
    case 'WorkPackage': return 'Work Package';
    case 'ImplementationEvent': return 'Implementation Event';
    case 'AndJunction': return 'And Junction';
    case 'OrJunction': return 'Or Junction';
    case 'Resource':
    case 'Capability':
    case 'Contract':
    case 'Representation':
    case 'Product':
    case 'Node':
    case 'Device':
    case 'Path':
    case 'Artifact':
    case 'Equipment':
    case 'Facility':
    case 'Material':
    case 'Stakeholder':
    case 'Driver':
    case 'Assessment':
    case 'Goal':
    case 'Outcome':
    case 'Principle':
    case 'Requirement':
    case 'Constraint':
    case 'Meaning':
    case 'Value':
    case 'Deliverable':
    case 'Plateau':
    case 'Gap':
    case 'Grouping':
    case 'Skill':
    case 'Rule':
    case 'Location':
    case 'Association':
    case 'Composition':
    case 'Aggregation':
    case 'Assignment':
    case 'Realization':
    case 'Serving':
    case 'Access':
    case 'Influence':
    case 'Triggering':
    case 'Flow':
    case 'Specialization':
      return normalized;
    default:
      return '';
  }
}

function warnIfUnknownSchemaElementType(value) {
  if (!isSchemaElementType(value)) {
    warnOnce('schema-element-type-' + safeString(value), 'Element type is not in SystemArchitecture.schema.json enum: ' + safeString(value));
  }
}

function isSchemaElementType(value) {
  switch (canonicalArchimateType(value)) {
    case 'Resource':
    case 'Capability':
    case 'Value Stream':
    case 'Course of Action':
    case 'Business Actor':
    case 'Business Role':
    case 'Business Collaboration':
    case 'Business Interface':
    case 'Business Process':
    case 'Business Function':
    case 'Business Interaction':
    case 'Business Event':
    case 'Business Service':
    case 'Business Object':
    case 'Contract':
    case 'Representation':
    case 'Product':
    case 'Application Component':
    case 'Application Collaboration':
    case 'Application Interface':
    case 'Application Process':
    case 'Application Function':
    case 'Application Interaction':
    case 'Application Event':
    case 'Application Service':
    case 'Data Object':
    case 'Node':
    case 'Device':
    case 'System Software':
    case 'Technology Collaboration':
    case 'Technology Interface':
    case 'Path':
    case 'Communication Network':
    case 'Technology Process':
    case 'Technology Function':
    case 'Technology Interaction':
    case 'Technology Event':
    case 'Technology Service':
    case 'Artifact':
    case 'Equipment':
    case 'Facility':
    case 'Distribution Network':
    case 'Material':
    case 'Stakeholder':
    case 'Driver':
    case 'Assessment':
    case 'Goal':
    case 'Outcome':
    case 'Principle':
    case 'Requirement':
    case 'Constraint':
    case 'Meaning':
    case 'Value':
    case 'Work Package':
    case 'Deliverable':
    case 'Implementation Event':
    case 'Plateau':
    case 'Gap':
    case 'Grouping':
    case 'Skill':
    case 'Rule':
    case 'Location':
    case 'And Junction':
    case 'Or Junction':
      return true;
    default:
      return false;
  }
}

function warnIfUnknownSchemaRelationshipType(value) {
  if (!isSchemaRelationshipType(value)) {
    warnOnce('schema-relationship-type-' + safeString(value), 'Relationship type is not in schema enum: ' + safeString(value));
  }
}

function isSchemaRelationshipType(value) {
  switch (canonicalArchimateType(value)) {
    case 'Association':
    case 'Composition':
    case 'Aggregation':
    case 'Assignment':
    case 'Realization':
    case 'Serving':
    case 'Access':
    case 'Influence':
    case 'Triggering':
    case 'Flow':
    case 'Specialization':
      return true;
    default:
      return false;
  }
}

function mapTestTypeToEaClass(testType) {
  switch (safeString(testType)) {
    case 'Acceptance Test':
      return '4';
    default:
      warnOnce('test-type-' + safeString(testType), 'Schema only allows testcase.type = "Acceptance Test"; importing legacy type as Acceptance Test: ' + safeString(testType));
      return '4';
  }
}

function putTag(tags, key, value) {
  if (tags == null || !isNonEmptyString(key)) {
    return;
  }
  var text = safeString(value);
  try {
    var tag = tags.GetByName(key);
    if (tag == null) {
      tag = tags.AddNew(key, 'String');
    }
    if (text.length > 250) {
      tag.Value = '<memo>';
      tag.Notes = text;
    } else {
      tag.Value = text;
      tag.Notes = '';
    }
    tag.Update();
  } catch (e) {
    warnOnce('tag-' + key, 'Could not write tag "' + key + '": ' + errorMessage(e));
  }
}

function putJsonTag(tags, key, value) {
  try {
    putTag(tags, key, JSON.stringify(value));
  } catch (e) {
    putTag(tags, key, safeString(value));
  }
}

function sanitizeTagName(name) {
  var text = safeString(name);
  text = text.replace(/^\s+|\s+$/g, '');
  text = text.replace(/[^A-Za-z0-9_]/g, '_');
  if (text == '') {
    text = 'unnamed';
  }
  if (text.length > 80) {
    text = text.substring(0, 80);
  }
  return text;
}

function setStyleToken(styleText, key, value) {
  var source = safeString(styleText);
  var escapedKey = escapeRegExp(key);
  var pattern = new RegExp('(^|;)' + escapedKey + '=[^;]*', 'i');
  var replaced = source.replace(pattern, '$1' + key + '=' + value);
  if (replaced != source) {
    return replaced;
  }
  if (source != '' && source.charAt(source.length - 1) != ';') {
    source += ';';
  }
  return source + key + '=' + value + ';';
}

function setStyleJsonToken(styleText, key, value) {
  return setStyleToken(styleText, key, encodeURIComponent(JSON.stringify(value)));
}

function escapeRegExp(text) {
  return safeString(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function autoLayoutDiagram(diagram) {
  try {
    Repository.GetProjectInterface().LayoutDiagramEx(diagram.DiagramGUID, 4, 4, 20, 20, false);
    diagram.Update();
  } catch (e) {
    warnOnce('layout-' + diagram.DiagramID, 'Could not auto-layout diagram ' + diagram.Name + ': ' + errorMessage(e));
  }
}

function resolveKnowledgeGraphPathFromCurrentModel() {
  var modelFilePath = resolveModelFilePathFromConnectionString();
  if (modelFilePath == '') {
    return '';
  }

  try {
    var fso = new ActiveXObject('Scripting.FileSystemObject');
    var rootPath = fso.GetParentFolderName(modelFilePath);
    return fso.BuildPath(rootPath, SYSTEM_ARCHITECTURE_JSON_RELATIVE_PATH);
  } catch (e) {
    fail('Could not build knowledge graph path: ' + errorMessage(e));
    return '';
  }
}

function resolveModelFilePathFromConnectionString() {
  var connectionString = '';
  try {
    connectionString = '' + Repository.ConnectionString;
  } catch (e) {
    return '';
  }
  if (connectionString == '') {
    return '';
  }

  var dataSource = getConnectionProperty(connectionString, 'Data Source');
  if (dataSource == '') {
    dataSource = getConnectionProperty(connectionString, 'DataSource');
  }
  if (dataSource == '') {
    dataSource = getConnectionProperty(connectionString, 'DBQ');
  }
  if (dataSource != '') {
    return stripWrappedQuotes(dataSource);
  }

  var direct = stripWrappedQuotes(connectionString);
  if (/^[A-Za-z]:\\/.test(direct) || /^\\\\/.test(direct)) {
    return direct;
  }
  return '';
}

function getConnectionProperty(connectionString, keyName) {
  if (connectionString == null || connectionString == '') {
    return '';
  }
  var pattern = new RegExp('(?:^|;)\\s*' + keyName + '\\s*=\\s*([^;]+)', 'i');
  var match = ('' + connectionString).match(pattern);
  if (match && match.length > 1) {
    return trimString(match[1]);
  }
  return '';
}

function stripWrappedQuotes(s) {
  var value = trimString(s);
  if (value.length >= 2) {
    var first = value.charAt(0);
    var last = value.charAt(value.length - 1);
    if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
      return value.substring(1, value.length - 1);
    }
  }
  return value;
}

function assignIfPresent(obj, key, value) {
  if (!isNonEmptyString(value)) {
    return;
  }
  try {
    obj[key] = value;
  } catch (ignore) {
  }
}

function firstNonEmpty(a, b) {
  if (isNonEmptyString(a)) {
    return a;
  }
  return safeString(b);
}

function safeName(value, fallback) {
  var text = safeString(value);
  if (text == '') {
    text = safeString(fallback);
  }
  if (text == '') {
    text = 'Unnamed';
  }
  if (text.length > 250) {
    text = text.substring(0, 250);
  }
  return text;
}

function safeString(value) {
  if (value == null || typeof value == 'undefined') {
    return '';
  }
  return '' + value;
}

function trimString(value) {
  return safeString(value).replace(/^\s+|\s+$/g, '');
}

function isNonEmptyString(value) {
  return trimString(value) != '';
}

function isArray(value) {
  return Object.prototype.toString.apply(value) == '[object Array]';
}

function warnOnce(key, message) {
  if (WARNED[key]) {
    return;
  }
  WARNED[key] = true;
  Session.Output('WARNING: ' + message);
}

function errorMessage(e) {
  if (e == null) {
    return '';
  }
  if (typeof e.message != 'undefined') {
    return e.message;
  }
  return '' + e;
}

function fail(message) {
  Session.Output('ERROR: ' + message);
}

main();
