!INC Local Scripts.EAConstants-JScript
!INC JSON-Parser

/*
 * Script Name: Import SystemArchitecture JSON to EA (as new elements)
 * Purpose: Reads a SystemArchitecture.json file whose full path is entered by
 *          the user at runtime and creates an EA model matching
 *          .argo/schema/SystemArchitecture.schema.json.
 *          Unlike import_system_architecture_json_to_ea.js, this variant does
 *          NOT preserve the original graph ids. Every element, relationship
 *          and diagram is imported as a brand new EA object: EA assigns new
 *          ElementID/ConnectorID/DiagramID values and no source-graph id tags
 *          are written anywhere.
 * Usage:
 *   1. Copy this file into EA local scripts with JSON-Parser.js available.
 *   2. Select the target Package in EA Project Browser.
 *   3. Run the script.
 *   4. Enter the full path to the SystemArchitecture.json file when prompted.
 *      The script requires this path and aborts if no path is provided.
 *
 * Notes:
 *   - Internal in-memory maps are still keyed by the source-graph ids so that
 *     parent/child nesting, relationship endpoints and diagram membership can
 *     be wired correctly. Those ids are never persisted to the EA model.
 *   - Current schema fields are imported into native EA fields where possible.
 *     Legacy fields from older JSON exports are preserved as tagged values.
 *   - element.subdiagram_views and view.parent_element_id are used to create
 *     diagrams under their owning elements.
 */

var SYSTEM_ARCHITECTURE_JSON_PATH = '';
var IMPORT_PACKAGE_SUFFIX = ' EA Import (New)';
var DIAGRAM_TYPE = 'Logical';
var CREATE_MISSING_SUBDIAGRAMS = true;
var ENABLE_AUTOLAYOUT = true;
var MAX_ATTRIBUTE_DEFAULT_LENGTH = 250;

var WARNED = {};

function main() {
  Repository.EnsureOutputVisible('Script');
  Repository.EnableUIUpdates(false);

  try {
    Session.Output('Starting SystemArchitecture JSON import (as new elements)...');

    var parentPkg = Repository.GetTreeSelectedPackage();
    if (parentPkg == null) {
      fail('Please select a target Package in the Project Browser before running this script.');
      return;
    }

    SYSTEM_ARCHITECTURE_JSON_PATH = promptForInputFilePath();
    if (SYSTEM_ARCHITECTURE_JSON_PATH == '') {
      fail('Import aborted: no input file path was provided.');
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

    var importPkg = createImportPackage(parentPkg, graph);

    var elementDataMap = buildElementDataMap(graph.elements);
    var elementMap = {};
    var relationshipMap = {};
    var viewMap = {};
    var subdiagramParentMap = buildSubdiagramParentMap(graph.elements);

    var elementCount = importElements(importPkg, graph.elements, elementDataMap, elementMap);
    var relationshipCount = importRelationships(importPkg, graph.relationships, elementMap, relationshipMap);
    var viewCount = importViews(importPkg, graph.views, graph.elements, elementMap, relationshipMap, viewMap, subdiagramParentMap);

    Repository.RefreshModelView(importPkg.PackageID);

    Session.Output('=======================================');
    Session.Output('SystemArchitecture import (as new elements) complete.');
    Session.Output('Elements created: ' + elementCount);
    Session.Output('Relationships created: ' + relationshipCount);
    Session.Output('Views created: ' + viewCount);
    Session.Output('Package: ' + importPkg.Name);
  } catch (e) {
    fail('Import failed: ' + errorMessage(e));
  } finally {
    Repository.EnableUIUpdates(true);
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

function promptForInputFilePath() {
  var input = '';
  try {
    input = Session.Input('Enter the full path to SystemArchitecture.json to import:');
  } catch (e) {
    warnOnce('input-prompt', 'Could not show input prompt: ' + errorMessage(e));
    return '';
  }
  return trimString(input);
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

function createImportPackage(parentPkg, graph) {
  var packageName = safeName(graph.name, 'SystemArchitecture') + IMPORT_PACKAGE_SUFFIX + ' ' + formatTimestamp(new Date());
  var pkg = parentPkg.Packages.AddNew(packageName, 'Package');
  pkg.Notes = buildPackageNotes(graph);
  pkg.Update();
  parentPkg.Packages.Refresh();
  Session.Output('Created package: ' + pkg.Name);
  return pkg;
}

function buildPackageNotes(graph) {
  var lines = [];
  lines.push(safeString(graph.description));
  lines.push('');
  lines.push('Imported from: ' + SYSTEM_ARCHITECTURE_JSON_PATH);
  lines.push('Schema: .argo/schema/SystemArchitecture.schema.json');
  lines.push('Import mode: as new elements (source ids not preserved).');

  if (graph.attributes && graph.attributes.length > 0) {
    lines.push('');
    lines.push('Root attributes:');
    appendAttributeLines(lines, graph.attributes);
  }
  return lines.join('\r\n');
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
  var count = 0;
  for (var i = 0; i < elements.length; i++) {
    var elementData = elements[i];
    if (!elementData || !isNonEmptyString(elementData.id)) {
      continue;
    }
    if (ensureElement(importPkg, elementData.id, elementDataMap, elementMap) != null) {
      count++;
    }
  }
  importPkg.Elements.Refresh();
  return count;
}

function ensureElement(importPkg, sourceId, elementDataMap, elementMap) {
  if (elementMap[sourceId]) {
    return elementMap[sourceId];
  }

  var elementData = elementDataMap[sourceId];
  if (!elementData) {
    warnOnce('missing-element-' + sourceId, 'Element data not found for id: ' + sourceId);
    return null;
  }

  var parentElement = null;
  if (isNonEmptyString(elementData.parent) && elementData.parent != '0' && elementDataMap[elementData.parent]) {
    parentElement = ensureElement(importPkg, elementData.parent, elementDataMap, elementMap);
  }

  var baseType = mapElementTypeToEa(elementData.type);
  var element = addElementToOwner(importPkg, parentElement, elementData.name, baseType);

  elementMap[sourceId] = element;

  applyElementCoreFields(element, elementData);
  // EA child collections are safest to mutate after owner field changes are persisted.
  element.Update();
  applyElementAttributes(element, elementData.attributes);
  applyElementSpecialMethods(element, elementData);
  applyProjectInfo(element, elementData.project_info);
  applyTestcases(element, elementData.testcases);

  element.Update();
  refreshElementOwner(importPkg, parentElement);
  Session.Output('Created element [' + safeString(elementData.type) + ']: ' + elementData.name);
  return element;
}

function addElementToOwner(importPkg, parentElement, name, baseType) {
  var element = null;
  if (parentElement != null) {
    try {
      element = parentElement.Elements.AddNew(safeName(name, 'Unnamed Element'), baseType);
      element.Update();
      parentElement.Elements.Refresh();
      return element;
    } catch (e) {
      warnOnce('nested-element-fallback', 'Could not create nested element under parent; using package-level element fallback. ' + errorMessage(e));
    }
  }

  element = importPkg.Elements.AddNew(safeName(name, 'Unnamed Element'), baseType);
  element.Update();
  importPkg.Elements.Refresh();
  return element;
}

function refreshElementOwner(importPkg, parentElement) {
  try {
    if (parentElement != null) {
      parentElement.Elements.Refresh();
    } else {
      importPkg.Elements.Refresh();
    }
  } catch (ignore) {
  }
}

function applyElementCoreFields(element, data) {
  warnIfUnknownSchemaElementType(data.type);

  element.Name = safeName(data.name, data.id);
  element.Notes = safeString(data.description);
  element.StereotypeEx = mapElementTypeToEaStereotype(data.type);

  if (isNonEmptyString(data.alias)) {
    element.Alias = data.alias;
  }
  if (isNonEmptyString(data.status)) {
    element.Status = data.status;
  }

  putTag(element.TaggedValues, 'archimate_type', canonicalArchimateType(data.type));
  putTag(element.TaggedValues, 'classifier', safeString(data.classifier));
  element.TaggedValues.Refresh();
}

function applyElementAttributes(element, attributes) {
  if (!attributes || attributes.length == 0) {
    return;
  }

  for (var i = 0; i < attributes.length; i++) {
    var data = attributes[i];
    if (!data || !isNonEmptyString(data.name)) {
      continue;
    }
    var attr = element.Attributes.AddNew(data.name, 'String');

    var attributeValue = safeString(data.value);
    if (isNonEmptyString(attributeValue)) {
      if (attributeValue.length <= MAX_ATTRIBUTE_DEFAULT_LENGTH) {
        attr.Default = attributeValue;
      } else {
        appendAttributeNotes(attr, attributeValue);
      }
    }

    appendAttributeNotes(attr, safeString(data.description));
    if (isNonEmptyString(data.content)) {
      appendAttributeNotes(attr, safeString(data.content));
      attr.Alias = 'content';
    }

    attr.Update();
  }
  element.Attributes.Refresh();
}

function appendAttributeNotes(attr, text) {
  if (!isNonEmptyString(text)) {
    return;
  }
  var current = safeString(attr.Notes);
  if (isNonEmptyString(current)) {
    attr.Notes = current + '\r\n\r\n' + text;
  } else {
    attr.Notes = text;
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
  var method = element.Methods.AddNew(methodName, '');
  method.Notes = notes;
  method.Update();
  element.Methods.Refresh();
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
    var resource = element.Resources.AddNew(data.owner, safeString(data.role));
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
    element.Resources.Refresh();
  } catch (e) {
    warnOnce('resource-import', 'Could not import resource for element ' + element.Name + ': ' + errorMessage(e));
  }
}

function addIssue(element, name, type, status, notes, startDate, endDate, reporter, priority, assignedTo, progress) {
  if (!isNonEmptyString(name)) {
    return;
  }
  try {
    var issue = element.Issues.AddNew(name, safeString(type));
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
    element.Issues.Refresh();
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
      var test = element.Tests.AddNew(data.name, safeString(data.type));
      test.Notes = safeString(data.description);
      test.Class = mapTestTypeToEaClass(data.type);
      test.Input = safeString(data.Input);
      test.AcceptanceCriteria = safeString(data.acceptanceCriteria);
      test.TestResults = safeString(data.TestResults);
      test.Update();
      element.Tests.Refresh();
    } catch (e) {
      warnOnce('test-import', 'Could not import testcase for element ' + element.Name + ': ' + errorMessage(e));
    }
  }
}

function importRelationships(importPkg, relationships, elementMap, relationshipMap) {
  var count = 0;
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

    var connector = source.Connectors.AddNew(relationshipName, connectorMeta.connectorType);
    connector.SupplierID = target.ElementID;
    connector.Name = relationshipName;
    connector.StereotypeEx = mapRelationshipTypeToEaStereotype(relationshipType);
    connector.Notes = safeString(data.description);
    if (isNonEmptyString(data.sequence)) {
      connector.SequenceNo = data.sequence;
    }

    if (connectorMeta.aggregationKind >= 0) {
      connector.SupplierEnd.Aggregation = connectorMeta.aggregationKind;
    }

    // Persist the connector core fields before attaching tagged values. Tagged values
    // require a saved connector (with a valid ConnectorID), otherwise EA silently drops them.
    connector.Update();
    source.Connectors.Refresh();

    putTag(connector.TaggedValues, 'archimate_relationship_type', canonicalArchimateType(relationshipType));
    putTag(connector.TaggedValues, 'statement', safeString(data.statement));
    putTag(connector.TaggedValues, 'document', safeString(data.document));

    connector.TaggedValues.Refresh();
    connector.Update();
    source.Connectors.Refresh();

    if (data.attributes && data.attributes.length > 0) {
      importRelationshipAttributes(importPkg, connector, data);
    }

    relationshipMap[data.id] = connector;
    count++;
    Session.Output('Created relationship [' + relationshipType + '] ' + relationshipName + ' (' + data.source_id + ' -> ' + data.target_id + ')');
  }
  return count;
}

function importRelationshipAttributes(importPkg, connector, relationshipData) {
  putJsonTag(connector.TaggedValues, 'relationship_attributes_json', relationshipData.attributes);

  var associationClassCreated = false;
  if (connector.Type == 'Association') {
    try {
      var assocClass = importPkg.Elements.AddNew(safeName(relationshipData.name + ' Attributes', 'Relationship Attributes'), 'Class');
      assocClass.Name = safeName(relationshipData.name + ' Attributes', 'Relationship Attributes');
      assocClass.StereotypeEx = 'SchemaRelationshipAttributes';
      assocClass.Notes = safeString(relationshipData.description);
      assocClass.Update();
      addRelationshipAttributesToClass(assocClass, relationshipData.attributes);
      assocClass.CreateAssociationClass(connector.ConnectorID);
      assocClass.Update();
      importPkg.Elements.Refresh();
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

  connector.TaggedValues.Refresh();
  connector.Update();
}

function addRelationshipAttributesToClass(assocClass, attributes) {
  for (var i = 0; i < attributes.length; i++) {
    var data = attributes[i];
    if (!data || !isNonEmptyString(data.name)) {
      continue;
    }
    var attr = assocClass.Attributes.AddNew(data.name, 'String');
    attr.Notes = safeString(data.description);
    attr.Update();
  }
  assocClass.Attributes.Refresh();
}

function importViews(importPkg, views, elements, elementMap, relationshipMap, viewMap, subdiagramParentMap) {
  var viewDataMap = buildViewDataMap(views);
  var count = 0;

  for (var i = 0; i < views.length; i++) {
    var viewData = views[i];
    if (!viewData || !isNonEmptyString(viewData.view_id)) {
      continue;
    }
    var diagram = ensureDiagram(importPkg, viewData, elementMap, viewMap, subdiagramParentMap);
    populateDiagram(diagram, viewData, elementMap, relationshipMap);
    count++;
  }

  if (CREATE_MISSING_SUBDIAGRAMS) {
    count += createMissingSubdiagrams(importPkg, elements, viewDataMap, elementMap, relationshipMap, viewMap);
  }

  return count;
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

function ensureDiagram(importPkg, viewData, elementMap, viewMap, subdiagramParentMap) {
  if (viewMap[viewData.view_id]) {
    return viewMap[viewData.view_id];
  }

  var parentElement = null;
  if (isNonEmptyString(viewData.parent_element_id) && elementMap[viewData.parent_element_id]) {
    parentElement = elementMap[viewData.parent_element_id];
  } else if (subdiagramParentMap[viewData.view_id] && elementMap[subdiagramParentMap[viewData.view_id]]) {
    parentElement = elementMap[subdiagramParentMap[viewData.view_id]];
  }

  var diagram = addDiagramToOwner(importPkg, parentElement, safeName(viewData.view_name, viewData.view_id));
  diagram.Notes = safeString(viewData.description);
  diagram.Update();
  viewMap[viewData.view_id] = diagram;
  Session.Output('Created view: ' + diagram.Name);
  return diagram;
}

function addDiagramToOwner(importPkg, parentElement, diagramName) {
  var diagram = null;
  if (parentElement != null) {
    try {
      diagram = parentElement.Diagrams.AddNew(diagramName, DIAGRAM_TYPE);
      diagram.Update();
      parentElement.Diagrams.Refresh();
      return diagram;
    } catch (e) {
      warnOnce('nested-diagram-fallback', 'Could not create diagram under element; using package-level diagram fallback. ' + errorMessage(e));
    }
  }

  diagram = importPkg.Diagrams.AddNew(diagramName, DIAGRAM_TYPE);
  diagram.Update();
  importPkg.Diagrams.Refresh();
  return diagram;
}

function populateDiagram(diagram, viewData, elementMap, relationshipMap) {
  var includedElements = viewData.included_elements || [];
  var includedRelationships = viewData.included_relationships || [];
  var placedElements = {};

  for (var i = 0; i < includedElements.length; i++) {
    var sourceId = includedElements[i];
    var element = elementMap[sourceId];
    if (element) {
      addElementToDiagram(diagram, element, i);
      placedElements[sourceId] = true;
    } else {
      warnOnce('view-missing-element-' + viewData.view_id + '-' + sourceId, 'View ' + viewData.view_id + ' references missing element ' + sourceId + '.');
    }
  }
  diagram.DiagramObjects.Refresh();

  for (var j = 0; j < includedRelationships.length; j++) {
    var relId = includedRelationships[j];
    var connector = relationshipMap[relId];
    if (connector) {
      addConnectorToDiagram(diagram, connector);
    } else {
      warnOnce('view-missing-relationship-' + viewData.view_id + '-' + relId, 'View ' + viewData.view_id + ' references missing relationship ' + relId + '.');
    }
  }
  diagram.DiagramLinks.Refresh();
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

function createMissingSubdiagrams(importPkg, elements, viewDataMap, elementMap, relationshipMap, viewMap) {
  var count = 0;
  if (!elements) {
    return count;
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
      var diagram = ensureDiagram(importPkg, syntheticView, elementMap, viewMap, {});
      populateDiagram(diagram, syntheticView, elementMap, relationshipMap);
      count++;
    }
  }

  return count;
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
    aggregationKind: -1
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
      break;
    case 'Realization':
    case 'Access':
      meta.connectorType = 'Dependency';
      break;
    case 'Serving':
    case 'Assignment':
    case 'Association':
      meta.connectorType = 'Association';
      break;
    case 'Triggering':
    case 'Flow':
    case 'Influence':
      meta.connectorType = 'ControlFlow';
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
    warnOnce('element-type-' + safeString(value), 'Element type is not in SystemArchitecture.schema.json enum: ' + safeString(value));
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
    warnOnce('relationship-type-' + safeString(value), 'Relationship type is not in schema enum: ' + safeString(value));
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

function appendAttributeLines(lines, attributes) {
  for (var i = 0; i < attributes.length; i++) {
    var attr = attributes[i];
    if (!attr) {
      continue;
    }
    var line = '- ' + safeString(attr.name);
    if (isNonEmptyString(attr.value)) {
      line += ' = ' + safeString(attr.value);
    }
    if (isNonEmptyString(attr.description)) {
      line += ' :: ' + safeString(attr.description);
    }
    if (isNonEmptyString(attr.content)) {
      line += ' :: content length ' + safeString(attr.content).length;
    }
    lines.push(line);
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

function formatTimestamp(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + '_' + pad2(date.getHours()) + '-' + pad2(date.getMinutes()) + '-' + pad2(date.getSeconds());
}

function pad2(value) {
  return value < 10 ? '0' + value : '' + value;
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
