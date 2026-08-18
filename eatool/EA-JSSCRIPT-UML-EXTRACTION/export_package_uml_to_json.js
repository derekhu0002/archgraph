!INC Local Scripts.EAConstants-JScript
!INC JSON-Parser

/*
 * Script Name: Export Package UML to JSON
 * Purpose: Recursively exports the selected EA Package into a UML-oriented JSON file.
 * Output: <projectRoot>\design\KG\<package-name>_uml_export.json
 * Notes:
 *   - Keeps the ArchiMate exporter top-level shape: name/description/elements/relationships/views.
 *   - Adds packages/export metadata plus UML type-specific payload under each view.
 *   - Preserves key UML view/object/link details needed for downstream JSON consumption.
 */

var OUTPUT_SUBFOLDER = 'design\\KG';
var OUTPUT_SUFFIX = '_uml_export.json';
var INCLUDE_CONNECTORS_TOUCHING_SCOPE = true;

function main() {
	Repository.EnsureOutputVisible('Script');
	Repository.EnableUIUpdates(false);

	try {
		Session.Output('Starting UML package export...');

		var rootPackage = Repository.GetTreeSelectedPackage();
		if (rootPackage == null) {
			fail('Please select a Package in the Project Browser before running this script.');
			return;
		}

		var projectPath = resolveProjectPathFromCurrentModel();
		if (projectPath == '') {
			fail('Could not resolve the project root folder from the current EA model path.');
			return;
		}

		var state = createExportState(rootPackage, projectPath);
		collectPackage(rootPackage, null, 0, state);
		collectRemainingConnectors(state);

		var exportGraph = buildExportGraph(state);
		exportGraph = pruneEmptyValues(exportGraph);
		var outputPath = buildOutputFilePath(projectPath, rootPackage.Name);
		writeUtf8WithoutBom(outputPath, stringifyJson(exportGraph, 0));

		Session.Output('=======================================');
		Session.Output('UML package export complete.');
		Session.Output('Output: ' + outputPath);
		Session.Output('Packages: ' + state.packageOrder.length);
		Session.Output('Elements: ' + state.elementOrder.length);
		Session.Output('Relationships: ' + state.connectorOrder.length);
		Session.Output('Views: ' + state.diagramOrder.length);
	} catch (e) {
		fail('Export failed: ' + errorMessage(e));
	} finally {
		Repository.EnableUIUpdates(true);
	}
}

function createExportState(rootPackage, projectPath) {
	return {
		rootPackageId: '' + rootPackage.PackageID,
		rootPackageGuid: safeString(rootPackage.PackageGUID),
		projectPath: projectPath,
		packageRefs: {},
		packageOrder: [],
		elementRefs: {},
		elementOrder: [],
		connectorRefs: {},
		connectorOrder: [],
		diagramRefs: {},
		diagramOrder: [],
		externalReferenceCount: 0,
		containsExternalReferences: false
	};
}

function collectPackage(pkg, parentPackageId, depth, state) {
	if (pkg == null) {
		return;
	}

	var packageId = registerPackageRef(pkg, parentPackageId, depth, state);
	collectPackageDiagrams(pkg, packageId, state);
	collectPackageElements(pkg, packageId, null, depth, state);

	var childPackages = tryGetCollection(pkg, 'Packages');
	forEachCollection(childPackages, function(childPkg) {
		collectPackage(childPkg, packageId, depth + 1, state);
	});
}

function collectPackageDiagrams(pkg, packageId, state) {
	var diagrams = tryGetCollection(pkg, 'Diagrams');
	forEachCollection(diagrams, function(diagram) {
		collectDiagram(diagram, packageId, null, state);
	});
}

function collectPackageElements(pkg, packageId, parentElementId, depth, state) {
	var elements = tryGetCollection(pkg, 'Elements');
	forEachCollection(elements, function(ele) {
		collectElement(ele, packageId, parentElementId, depth, 'owned', state);
	});
}

function collectElement(ele, packageId, parentElementId, depth, scope, state) {
	if (ele == null) {
		return;
	}

	var elementId = registerElementRef(ele, scope, packageId, parentElementId, depth, state);

	var subDiagrams = tryGetCollection(ele, 'Diagrams');
	forEachCollection(subDiagrams, function(diagram) {
		collectDiagram(diagram, packageId, elementId, state);
	});

	var embeddedElements = tryGetCollection(ele, 'Elements');
	forEachCollection(embeddedElements, function(childElement) {
		collectElement(childElement, packageId, elementId, depth + 1, 'owned', state);
	});
}

function collectDiagram(diagram, packageId, ownerElementId, state) {
	if (diagram == null) {
		return;
	}

	var diagramId = registerDiagramRef(diagram, packageId, ownerElementId, state);
	var diagramInfo = state.diagramRefs[diagramId];

	var diagramObjects = tryGetCollection(diagram, 'DiagramObjects');
	forEachCollection(diagramObjects, function(diagramObject) {
		var elementId = safeString(diagramObject.ElementID);
		if (elementId == '') {
			return;
		}

		diagramInfo.includedElementIds[elementId] = true;
		diagramInfo.diagramObjects.push({
			diagramObject: diagramObject,
			elementId: elementId
		});

		var element = safeRepositoryGetElementById(diagramObject.ElementID);
		if (element != null) {
			registerElementRef(element, 'diagram_reference', safeString(element.PackageID), safeString(element.ParentID), null, state);
		}
	});

	var diagramLinks = tryGetCollection(diagram, 'DiagramLinks');
	forEachCollection(diagramLinks, function(diagramLink) {
		if (safeBoolean(diagramLink.IsHidden, false)) {
			return;
		}

		var connector = safeRepositoryGetConnectorById(diagramLink.ConnectorID);
		if (connector == null) {
			return;
		}

		var connectorId = registerConnectorRef(connector, 'diagram', diagramId, state);
		var connectorInfo = state.connectorRefs[connectorId];
		connectorInfo.diagramLinks.push({
			diagramId: diagramId,
			diagramLink: diagramLink
		});
		diagramInfo.includedConnectorIds[connectorId] = true;

		ensureConnectorEndpoints(connector, 'diagram_reference', state);
	});
}

function collectRemainingConnectors(state) {
	if (!INCLUDE_CONNECTORS_TOUCHING_SCOPE) {
		return;
	}

	for (var i = 0; i < state.elementOrder.length; i++) {
		var elementId = state.elementOrder[i];
		var elementInfo = state.elementRefs[elementId];
		if (elementInfo == null || elementInfo.scope != 'owned') {
			continue;
		}

		var connectors = tryGetCollection(elementInfo.element, 'Connectors');
		forEachCollection(connectors, function(connector) {
			registerConnectorRef(connector, 'owned', null, state);
			ensureConnectorEndpoints(connector, 'external_reference', state);
		});
	}
}

function registerPackageRef(pkg, parentPackageId, depth, state) {
	var packageId = safeString(pkg.PackageID);
	if (packageId == '') {
		return '';
	}

	var existing = state.packageRefs[packageId];
	if (existing == null) {
		existing = {
			pkg: pkg,
			parentPackageId: parentPackageId,
			depth: depth
		};
		state.packageRefs[packageId] = existing;
		state.packageOrder.push(packageId);
	} else {
		if (existing.parentPackageId == null && parentPackageId != null) {
			existing.parentPackageId = parentPackageId;
		}
		if (existing.depth == null && depth != null) {
			existing.depth = depth;
		}
	}

	return packageId;
}

function registerElementRef(ele, scope, packageId, parentElementId, depth, state) {
	var elementId = safeString(ele.ElementID);
	if (elementId == '') {
		return '';
	}

	var existing = state.elementRefs[elementId];
	if (existing == null) {
		existing = {
			element: ele,
			scope: scope,
			packageId: packageId,
			parentElementId: parentElementId,
			depth: depth,
			seenInDiagrams: {},
			seenAsConnectorEndpoint: false
		};
		state.elementRefs[elementId] = existing;
		state.elementOrder.push(elementId);
	} else {
		existing.scope = mergeScope(existing.scope, scope);
		if (existing.packageId == null && packageId != null) {
			existing.packageId = packageId;
		}
		if (existing.parentElementId == null && parentElementId != null) {
			existing.parentElementId = parentElementId;
		}
		if (existing.depth == null && depth != null) {
			existing.depth = depth;
		}
	}

	if (scope == 'external_reference') {
		state.containsExternalReferences = true;
	}

	return elementId;
}

function registerDiagramRef(diagram, packageId, ownerElementId, state) {
	var diagramId = safeString(diagram.DiagramID);
	if (diagramId == '') {
		return '';
	}

	var existing = state.diagramRefs[diagramId];
	if (existing == null) {
		existing = {
			diagram: diagram,
			packageId: packageId,
			ownerElementId: ownerElementId,
			includedElementIds: {},
			includedConnectorIds: {},
			diagramObjects: [],
			diagramLinks: []
		};
		state.diagramRefs[diagramId] = existing;
		state.diagramOrder.push(diagramId);
	} else {
		if (existing.packageId == null && packageId != null) {
			existing.packageId = packageId;
		}
		if (existing.ownerElementId == null && ownerElementId != null) {
			existing.ownerElementId = ownerElementId;
		}
	}

	return diagramId;
}

function registerConnectorRef(connector, reason, diagramId, state) {
	var connectorId = safeString(connector.ConnectorID);
	if (connectorId == '') {
		return '';
	}

	var existing = state.connectorRefs[connectorId];
	if (existing == null) {
		existing = {
			connector: connector,
			reasons: {},
			shownInViews: {},
			diagramLinks: []
		};
		state.connectorRefs[connectorId] = existing;
		state.connectorOrder.push(connectorId);
	}

	existing.reasons[reason] = true;
	if (diagramId != null && diagramId != '') {
		existing.shownInViews[diagramId] = true;
	}

	return connectorId;
}

function ensureConnectorEndpoints(connector, scope, state) {
	var source = safeRepositoryGetElementById(connector.ClientID);
	var target = safeRepositoryGetElementById(connector.SupplierID);

	if (source != null) {
		registerElementRef(source, scope, safeString(source.PackageID), safeString(source.ParentID), null, state);
		state.elementRefs[safeString(source.ElementID)].seenAsConnectorEndpoint = true;
	}
	if (target != null) {
		registerElementRef(target, scope, safeString(target.PackageID), safeString(target.ParentID), null, state);
		state.elementRefs[safeString(target.ElementID)].seenAsConnectorEndpoint = true;
	}
}

function mergeScope(currentScope, nextScope) {
	if (currentScope == nextScope) {
		return currentScope;
	}
	if (currentScope == 'owned' || nextScope == 'owned') {
		return 'owned';
	}
	if (currentScope == 'diagram_reference' || nextScope == 'diagram_reference') {
		return 'diagram_reference';
	}
	return nextScope != null ? nextScope : currentScope;
}

function buildExportGraph(state) {
	var rootPackageInfo = state.packageRefs[state.rootPackageId];
	var rootPackage = rootPackageInfo != null ? rootPackageInfo.pkg : null;
	var rootElement = null;
	try {
		rootElement = rootPackage != null ? rootPackage.Element : null;
	} catch (ignore) {
		rootElement = null;
	}

	var graph = {
		name: rootPackage != null ? safeString(rootPackage.Name) : 'UML Export',
		description: rootPackage != null && safeString(rootPackage.Notes) != ''
			? safeString(rootPackage.Notes)
			: 'Exported from EA UML package ' + (rootPackage != null ? safeString(rootPackage.Name) : ''),
		root_package: serializePackage(rootPackageInfo, state),
		packages: [],
		elements: [],
		relationships: [],
		views: []
	};

	if (rootElement != null) {
		graph.root_package_element = {
			id: safeString(rootElement.ElementID),
			guid: safeString(rootElement.ElementGUID),
			name: safeString(rootElement.Name)
		};
	}

	for (var i = 0; i < state.packageOrder.length; i++) {
		graph.packages.push(serializePackage(state.packageRefs[state.packageOrder[i]], state));
	}

	for (var j = 0; j < state.elementOrder.length; j++) {
		graph.elements.push(serializeElement(state.elementRefs[state.elementOrder[j]], state));
	}

	for (var k = 0; k < state.connectorOrder.length; k++) {
		graph.relationships.push(serializeConnector(state.connectorRefs[state.connectorOrder[k]], state));
	}

	for (var m = 0; m < state.diagramOrder.length; m++) {
		graph.views.push(serializeDiagram(state.diagramRefs[state.diagramOrder[m]], state));
	}

	return graph;
}

function serializePackage(packageInfo, state) {
	if (packageInfo == null || packageInfo.pkg == null) {
		return null;
	}

	var pkg = packageInfo.pkg;
	var pkgElement = null;
	try {
		pkgElement = pkg.Element;
	} catch (ignore) {
		pkgElement = null;
	}

	return {
		id: safeString(pkg.PackageID),
		guid: safeString(pkg.PackageGUID),
		name: safeString(pkg.Name),
		description: safeString(pkg.Notes),
		parent_package_id: packageInfo.parentPackageId,
		depth: packageInfo.depth,
		package_path: buildPackagePath(safeString(pkg.PackageID), state),
		element_id: pkgElement != null ? safeString(pkgElement.ElementID) : ''
	};
}

function serializeElement(elementInfo, state) {
	var ele = elementInfo != null ? elementInfo.element : null;
	if (ele == null) {
		return null;
	}

	return resolveElementSerializer(ele)(ele, elementInfo, state);
}

function resolveElementSerializer(ele) {
	var category = normalizeElementCategory(ele);
	if (category == 'class') {
		return serializeClassElement;
	}
	if (category == 'use_case') {
		return serializeUseCaseElement;
	}
	if (category == 'activity') {
		return serializeActivityElement;
	}
	if (category == 'state_machine') {
		return serializeStateElement;
	}
	if (category == 'component') {
		return serializeComponentElement;
	}
	if (category == 'deployment') {
		return serializeDeploymentElement;
	}
	if (category == 'interaction') {
		return serializeInteractionElement;
	}
	return serializeGenericElement;
}

function serializeClassElement(ele, elementInfo, state) {
	return buildBaseElementExport(ele, elementInfo, state);
}

function serializeUseCaseElement(ele, elementInfo, state) {
	return buildBaseElementExport(ele, elementInfo, state);
}

function serializeActivityElement(ele, elementInfo, state) {
	return buildBaseElementExport(ele, elementInfo, state);
}

function serializeStateElement(ele, elementInfo, state) {
	return buildBaseElementExport(ele, elementInfo, state);
}

function serializeComponentElement(ele, elementInfo, state) {
	return buildBaseElementExport(ele, elementInfo, state);
}

function serializeDeploymentElement(ele, elementInfo, state) {
	return buildBaseElementExport(ele, elementInfo, state);
}

function serializeInteractionElement(ele, elementInfo, state) {
	return buildBaseElementExport(ele, elementInfo, state);
}

function serializeGenericElement(ele, elementInfo, state) {
	return buildBaseElementExport(ele, elementInfo, state);
}

function buildBaseElementExport(ele, elementInfo, state) {

	var elementId = safeString(ele.ElementID);
	var classifierId = safeString(safeProperty(ele, 'ClassifierID', ''));
	var classifierName = safeString(safeProperty(ele, 'ClassifierName', ''));
	var packageId = elementInfo.packageId != null ? elementInfo.packageId : safeString(ele.PackageID);

	return {
		id: elementId,
		guid: safeString(ele.ElementGUID),
		name: safeString(ele.Name),
		alias: safeString(ele.Alias),
		type: safeString(ele.Type),
		stereotype: pickFirstNonEmpty([safeString(ele.StereotypeEx), safeString(ele.Stereotype)]),
		description: safeString(ele.Notes),
		package_id: packageId,
		package_name: resolvePackageName(packageId, state),
		classifier_id: classifierId,
		classifier_name: classifierName,
		subdiagram_views: collectSubdiagramRefs(ele),
		attributes: collectElementAttributes(ele),
		operations: collectElementOperations(ele),
		constraints: collectConstraints(tryGetCollection(ele, 'Constraints')),
		tests: collectTests(ele),
		tagged_values: collectTaggedValues(tryGetCollection(ele, 'TaggedValues')),
		metadata: {
			element_path: buildElementPath(elementId, state),
			scope: elementInfo.scope,
			depth: elementInfo.depth,
			status: safeString(ele.Status),
			version: safeString(ele.Version),
			phase: safeString(ele.Phase),
			complexity: safeString(ele.Complexity),
			persistence: safeString(safeProperty(ele, 'Persistence', '')),
			is_abstract: safeBoolean(safeProperty(ele, 'Abstract', false), false),
			is_active: safeBoolean(safeProperty(ele, 'IsActive', false), false),
			is_composite: safeBoolean(safeProperty(ele, 'IsComposite', false), false),
			is_leaf: safeBoolean(safeProperty(ele, 'IsLeaf', false), false),
			is_root: safeBoolean(safeProperty(ele, 'IsRoot', false), false),
			is_specification: safeBoolean(safeProperty(ele, 'IsSpec', false), false),
			is_external_reference: elementInfo.scope == 'external_reference'
		}
	};
}

function serializeConnector(connectorInfo, state) {
	var conn = connectorInfo != null ? connectorInfo.connector : null;
	if (conn == null) {
		return null;
	}

	return resolveConnectorSerializer(conn)(conn, connectorInfo, state);
}

function resolveConnectorSerializer(conn) {
	var category = normalizeConnectorCategory(conn);
	if (category == 'association') {
		return serializeAssociationConnector;
	}
	if (category == 'generalization') {
		return serializeGeneralizationConnector;
	}
	if (category == 'use_case') {
		return serializeUseCaseConnector;
	}
	if (category == 'activity') {
		return serializeActivityConnector;
	}
	if (category == 'state_machine') {
		return serializeStateConnector;
	}
	if (category == 'deployment') {
		return serializeDeploymentConnector;
	}
	if (category == 'interaction') {
		return serializeInteractionConnector;
	}
	return serializeGenericConnector;
}

function serializeAssociationConnector(conn, connectorInfo, state) {
	return buildBaseConnectorExport(conn, connectorInfo, state);
}

function serializeGeneralizationConnector(conn, connectorInfo, state) {
	return buildBaseConnectorExport(conn, connectorInfo, state);
}

function serializeUseCaseConnector(conn, connectorInfo, state) {
	return buildBaseConnectorExport(conn, connectorInfo, state);
}

function serializeActivityConnector(conn, connectorInfo, state) {
	return buildBaseConnectorExport(conn, connectorInfo, state);
}

function serializeStateConnector(conn, connectorInfo, state) {
	return buildBaseConnectorExport(conn, connectorInfo, state);
}

function serializeDeploymentConnector(conn, connectorInfo, state) {
	return buildBaseConnectorExport(conn, connectorInfo, state);
}

function serializeInteractionConnector(conn, connectorInfo, state) {
	var result = buildBaseConnectorExport(conn, connectorInfo, state);
	result.sequence = resolveInteractionSequenceDisplay(conn, connectorInfo);
	result.message_label = buildInteractionMessageLabel(conn, connectorInfo);
	return result;
}

function serializeGenericConnector(conn, connectorInfo, state) {
	return buildBaseConnectorExport(conn, connectorInfo, state);
}

function buildBaseConnectorExport(conn, connectorInfo, state) {

	var source = safeRepositoryGetElementById(conn.ClientID);
	var target = safeRepositoryGetElementById(conn.SupplierID);
	var associationClass = null;
	try {
		associationClass = conn.AssociationClass;
	} catch (ignore) {
		associationClass = null;
	}

	return {
		id: safeString(conn.ConnectorID),
		guid: safeString(safeProperty(conn, 'ConnectorGUID', '')),
		name: safeString(conn.Name),
		type: safeString(conn.Type),
		stereotype: pickFirstNonEmpty([safeString(conn.StereotypeEx), safeString(conn.Stereotype)]),
		description: safeString(conn.Notes),
		source_id: safeString(conn.ClientID),
		source_name: source != null ? safeString(source.Name) : '',
		target_id: safeString(conn.SupplierID),
		target_name: target != null ? safeString(target.Name) : '',
		sequence: safeString(safeProperty(conn, 'SequenceNo', '')),
		tagged_values: collectTaggedValues(tryGetCollection(conn, 'TaggedValues')),
		constraints: collectConstraints(tryGetCollection(conn, 'Constraints')),
		source_role: {
			role: safeString(safeProperty(conn, 'ClientEnd.Role', '')),
			alias: safeString(safeProperty(conn, 'ClientEnd.Alias', '')),
			stereotype: safeString(safeProperty(conn, 'ClientEnd.Stereotype', '')),
			cardinality: safeString(safeProperty(conn, 'ClientEnd.Cardinality', '')),
			aggregation: safeString(safeProperty(conn, 'ClientEnd.Aggregation', '')),
			notes: safeString(safeProperty(conn, 'ClientEnd.Note', ''))
		},
		target_role: {
			role: safeString(safeProperty(conn, 'SupplierEnd.Role', '')),
			alias: safeString(safeProperty(conn, 'SupplierEnd.Alias', '')),
			stereotype: safeString(safeProperty(conn, 'SupplierEnd.Stereotype', '')),
			cardinality: safeString(safeProperty(conn, 'SupplierEnd.Cardinality', '')),
			aggregation: safeString(safeProperty(conn, 'SupplierEnd.Aggregation', '')),
			notes: safeString(safeProperty(conn, 'SupplierEnd.Note', ''))
		},
		association_class: associationClass != null ? {
			id: safeString(associationClass.ElementID),
			guid: safeString(associationClass.ElementGUID),
			name: safeString(associationClass.Name)
		} : null,
		metadata: {
			shown_in_views: sortedKeys(connectorInfo.shownInViews)
		}
	};
}

function resolveInteractionSequenceDisplay(conn, connectorInfo) {
	var diagramLinkSequence = extractSequenceFromDiagramLinks(connectorInfo);
	if (diagramLinkSequence != '') {
		return diagramLinkSequence;
	}

	var rawSequence = safeString(safeProperty(conn, 'SequenceNo', ''));
	if (rawSequence != '') {
		return rawSequence;
	}

	var nameSequence = extractLeadingSequenceToken(safeString(conn.Name));
	if (nameSequence != '') {
		return nameSequence;
	}

	return '';
}

function buildInteractionMessageLabel(conn, connectorInfo) {
	var name = safeString(conn.Name);
	if (name == '') {
		return '';
	}

	var existingLabelSequence = extractLeadingSequenceToken(name);
	if (existingLabelSequence != '') {
		return name;
	}

	var displaySequence = resolveInteractionSequenceDisplay(conn, connectorInfo);
	if (displaySequence == '') {
		return name;
	}

	return displaySequence + ': ' + name;
}

function extractSequenceFromDiagramLinks(connectorInfo) {
	if (connectorInfo == null || connectorInfo.diagramLinks == null) {
		return '';
	}

	for (var i = 0; i < connectorInfo.diagramLinks.length; i++) {
		var entry = connectorInfo.diagramLinks[i];
		if (entry == null || entry.diagramLink == null) {
			continue;
		}

		var diagramLink = entry.diagramLink;
		var candidates = [
			safeString(safeProperty(diagramLink, 'Geometry', '')),
			safeString(safeProperty(diagramLink, 'Path', '')),
			safeString(safeProperty(diagramLink, 'Style', ''))
		];

		for (var j = 0; j < candidates.length; j++) {
			var sequence = extractLeadingSequenceToken(candidates[j]);
			if (sequence != '') {
				return sequence;
			}

			sequence = extractTaggedSequenceToken(candidates[j]);
			if (sequence != '') {
				return sequence;
			}
		}
	}

	return '';
}

function extractLeadingSequenceToken(text) {
	var value = safeString(text);
	if (value == '') {
		return '';
	}

	var matches = value.match(/(?:^|[^0-9])([0-9]+(?:\.[0-9]+)*)(?=\s*:)/);
	if (matches != null && matches.length > 1) {
		return safeString(matches[1]);
	}

	return '';
}

function extractTaggedSequenceToken(text) {
	var value = safeString(text);
	if (value == '') {
		return '';
	}

	var matches = value.match(/(?:SEQ|SEQN|LABEL|LTXT)\s*=\s*([0-9]+(?:\.[0-9]+)*)/i);
	if (matches != null && matches.length > 1) {
		return safeString(matches[1]);
	}

	return '';
}

function serializeDiagram(diagramInfo, state) {
	var diagram = diagramInfo != null ? diagramInfo.diagram : null;
	if (diagram == null) {
		return null;
	}

	return resolveDiagramSerializer(diagram)(diagramInfo, state);
}

function resolveDiagramSerializer(diagram) {
	var category = normalizeDiagramCategory(diagram);
	if (category == 'interaction') {
		return serializeInteractionDiagram;
	}
	if (category == 'activity') {
		return serializeActivityDiagram;
	}
	if (category == 'state_machine') {
		return serializeStateMachineDiagram;
	}
	if (category == 'use_case') {
		return serializeUseCaseDiagram;
	}
	if (category == 'class') {
		return serializeClassDiagram;
	}
	if (category == 'component') {
		return serializeComponentDiagram;
	}
	if (category == 'deployment') {
		return serializeDeploymentDiagram;
	}
	if (category == 'package') {
		return serializePackageDiagram;
	}
	if (category == 'object') {
		return serializeObjectDiagram;
	}
	return serializeGenericDiagram;
}

function serializeInteractionDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildInteractionDiagramData(diagramInfo, state));
}

function serializeActivityDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildActivityDiagramData(diagramInfo, state));
}

function serializeStateMachineDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildStateMachineDiagramData(diagramInfo, state));
}

function serializeUseCaseDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildUseCaseDiagramData(diagramInfo, state));
}

function serializeClassDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildClassDiagramData(diagramInfo, state));
}

function serializeComponentDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildComponentDiagramData(diagramInfo, state));
}

function serializeDeploymentDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildDeploymentDiagramData(diagramInfo, state));
}

function serializePackageDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildPackageDiagramData(diagramInfo, state));
}

function serializeObjectDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildObjectDiagramData(diagramInfo, state));
}

function serializeGenericDiagram(diagramInfo, state) {
	return buildBaseDiagramExport(diagramInfo, state, buildGenericDiagramData(diagramInfo, state));
}

function buildBaseDiagramExport(diagramInfo, state, typeSpecificData) {
	var diagram = diagramInfo.diagram;

	var diagramId = safeString(diagram.DiagramID);
	var ownerElement = diagramInfo.ownerElementId != null && diagramInfo.ownerElementId != ''
		? state.elementRefs[diagramInfo.ownerElementId]
		: null;

	var includedElementIds = sortedKeys(diagramInfo.includedElementIds);
	var includedConnectorIds = sortedKeys(diagramInfo.includedConnectorIds);

	return {
		view_id: diagramId,
		view_guid: safeString(safeProperty(diagram, 'DiagramGUID', '')),
		view_name: safeString(diagram.Name),
		diagram_type: safeString(diagram.Type),
		parent_element_id: diagramInfo.ownerElementId != null ? diagramInfo.ownerElementId : '',
		parent_element_name: ownerElement != null ? safeString(ownerElement.element.Name) : '',
		package_id: diagramInfo.packageId,
		package_name: resolvePackageName(diagramInfo.packageId, state),
		description: safeString(diagram.Notes),
		included_elements: includedElementIds,
		included_relationships: includedConnectorIds,
		links: collectDiagramLinks(diagramInfo),
		swimlanes: collectSwimlanes(diagram),
		type_specific: typeSpecificData,
		metadata: {
			diagram_path: buildDiagramPath(diagramInfo, state)
		}
	};
}

function collectDiagramObjects(diagramInfo) {
	var result = [];
	for (var i = 0; i < diagramInfo.diagramObjects.length; i++) {
		var entry = diagramInfo.diagramObjects[i];
		var diagramObject = entry.diagramObject;
		result.push({
			element_id: entry.elementId,
			instance_id: safeString(safeProperty(diagramObject, 'InstanceID', '')),
			left: safeNumber(safeProperty(diagramObject, 'left', 0), 0),
			right: safeNumber(safeProperty(diagramObject, 'right', 0), 0),
			top: safeNumber(safeProperty(diagramObject, 'top', 0), 0),
			bottom: safeNumber(safeProperty(diagramObject, 'bottom', 0), 0),
			sequence: safeString(safeProperty(diagramObject, 'Sequence', '')),
			style: safeString(safeProperty(diagramObject, 'Style', ''))
		});
	}
	return result;
}

function collectDiagramLinks(diagramInfo) {
	var result = [];
	for (var i = 0; i < diagramInfo.diagramLinks.length; i++) {
		var entry = diagramInfo.diagramLinks[i];
		var diagramLink = entry.diagramLink;
		result.push({
			relationship_id: safeString(diagramLink.ConnectorID),
			geometry: safeString(safeProperty(diagramLink, 'Geometry', '')),
			path: safeString(safeProperty(diagramLink, 'Path', '')),
			style: safeString(safeProperty(diagramLink, 'Style', '')),
			line_style: safeString(safeProperty(diagramLink, 'LineStyle', '')),
			is_hidden: safeBoolean(safeProperty(diagramLink, 'IsHidden', false), false)
		});
	}
	return result;
}

function buildTypeSpecificDiagramData(diagramInfo, state) {
	var diagram = diagramInfo.diagram;
	var category = normalizeDiagramCategory(diagram);
	if (category == 'interaction') {
		return buildInteractionDiagramData(diagramInfo, state);
	}
	if (category == 'activity') {
		return buildActivityDiagramData(diagramInfo, state);
	}
	if (category == 'state_machine') {
		return buildStateMachineDiagramData(diagramInfo, state);
	}
	if (category == 'use_case') {
		return buildUseCaseDiagramData(diagramInfo, state);
	}
	if (category == 'class') {
		return buildClassDiagramData(diagramInfo, state);
	}
	if (category == 'component') {
		return buildComponentDiagramData(diagramInfo, state);
	}
	if (category == 'deployment') {
		return buildDeploymentDiagramData(diagramInfo, state);
	}
	if (category == 'package') {
		return buildPackageDiagramData(diagramInfo, state);
	}
	if (category == 'object') {
		return buildObjectDiagramData(diagramInfo, state);
	}
	return buildGenericDiagramData(diagramInfo, state);
}

function createBaseDiagramTypeData(diagramInfo, state, category) {
	var elementIds = sortedKeys(diagramInfo.includedElementIds);
	var connectorIds = sortedKeys(diagramInfo.includedConnectorIds);
	return {
		category: category,
		element_type_buckets: bucketElementIdsByType(elementIds, state),
		relationship_type_buckets: bucketConnectorIdsByType(connectorIds, state)
	};
}

function buildInteractionDiagramData(diagramInfo, state) {
	var elementIds = sortedKeys(diagramInfo.includedElementIds);
	var connectorIds = sortedKeys(diagramInfo.includedConnectorIds);
	var result = createBaseDiagramTypeData(diagramInfo, state, 'interaction');
	result.participant_ids = filterElementIdsByMatchers(elementIds, state, ['actor', 'object', 'lifeline', 'boundary', 'control', 'entity']);
	result.message_ids = sortConnectorIdsBySequence(connectorIds, state);
	result.activation_ids = filterElementIdsByMatchers(elementIds, state, ['activation']);
	return result;
}

function buildActivityDiagramData(diagramInfo, state) {
	var diagram = diagramInfo.diagram;
	var elementIds = sortedKeys(diagramInfo.includedElementIds);
	var connectorIds = sortedKeys(diagramInfo.includedConnectorIds);
	var result = createBaseDiagramTypeData(diagramInfo, state, 'activity');
	result.partition_ids = filterElementIdsByMatchers(elementIds, state, ['partition', 'activitypartition']);
	result.action_ids = filterElementIdsByMatchers(elementIds, state, ['action', 'activity', 'callbehavioraction', 'send', 'accept']);
	result.control_flow_ids = filterConnectorIdsByMatchers(connectorIds, state, ['controlflow', 'objectflow']);
	result.swimlane_count = collectSwimlanes(diagram).length;
	return result;
}

function buildStateMachineDiagramData(diagramInfo, state) {
	var elementIds = sortedKeys(diagramInfo.includedElementIds);
	var connectorIds = sortedKeys(diagramInfo.includedConnectorIds);
	var result = createBaseDiagramTypeData(diagramInfo, state, 'state_machine');
	result.state_ids = filterElementIdsByMatchers(elementIds, state, ['state', 'pseudostate', 'final']);
	result.transition_ids = filterConnectorIdsByMatchers(connectorIds, state, ['transition']);
	return result;
}

function buildUseCaseDiagramData(diagramInfo, state) {
	var elementIds = sortedKeys(diagramInfo.includedElementIds);
	var connectorIds = sortedKeys(diagramInfo.includedConnectorIds);
	var result = createBaseDiagramTypeData(diagramInfo, state, 'use_case');
	result.actor_ids = filterElementIdsByMatchers(elementIds, state, ['actor']);
	result.use_case_ids = filterElementIdsByMatchers(elementIds, state, ['usecase']);
	result.include_ids = filterConnectorIdsByMatchers(connectorIds, state, ['include']);
	result.extend_ids = filterConnectorIdsByMatchers(connectorIds, state, ['extend']);
	return result;
}

function buildClassDiagramData(diagramInfo, state) {
	var elementIds = sortedKeys(diagramInfo.includedElementIds);
	var connectorIds = sortedKeys(diagramInfo.includedConnectorIds);
	var result = createBaseDiagramTypeData(diagramInfo, state, 'class');
	result.classifier_ids = filterElementIdsByMatchers(elementIds, state, ['class', 'interface', 'enumeration', 'datatype', 'signal']);
	result.generalization_ids = filterConnectorIdsByMatchers(connectorIds, state, ['generalization']);
	result.association_ids = filterConnectorIdsByMatchers(connectorIds, state, ['association', 'aggregation', 'composition']);
	return result;
}

function buildComponentDiagramData(diagramInfo, state) {
	var elementIds = sortedKeys(diagramInfo.includedElementIds);
	var result = createBaseDiagramTypeData(diagramInfo, state, 'component');
	result.component_ids = filterElementIdsByMatchers(elementIds, state, ['component']);
	result.interface_ids = filterElementIdsByMatchers(elementIds, state, ['interface', 'providedinterface', 'requiredinterface']);
	return result;
}

function buildDeploymentDiagramData(diagramInfo, state) {
	var elementIds = sortedKeys(diagramInfo.includedElementIds);
	var connectorIds = sortedKeys(diagramInfo.includedConnectorIds);
	var result = createBaseDiagramTypeData(diagramInfo, state, 'deployment');
	result.node_ids = filterElementIdsByMatchers(elementIds, state, ['node', 'device', 'executionenvironment']);
	result.artifact_ids = filterElementIdsByMatchers(elementIds, state, ['artifact']);
	result.deployment_ids = filterConnectorIdsByMatchers(connectorIds, state, ['deployment']);
	return result;
}

function buildPackageDiagramData(diagramInfo, state) {
	return createBaseDiagramTypeData(diagramInfo, state, 'package');
}

function buildObjectDiagramData(diagramInfo, state) {
	return createBaseDiagramTypeData(diagramInfo, state, 'object');
}

function buildGenericDiagramData(diagramInfo, state) {
	var diagram = diagramInfo.diagram;
	return createBaseDiagramTypeData(diagramInfo, state, normalizeDiagramCategory(diagram));
}

function normalizeElementCategory(ele) {
	var combined = elementTypeKey(ele);
	if (textMatchesAny(combined, ['class', 'interface', 'enumeration', 'datatype', 'signal'])) {
		return 'class';
	}
	if (textMatchesAny(combined, ['usecase', 'use case', 'actor'])) {
		return 'use_case';
	}
	if (textMatchesAny(combined, ['activity', 'action', 'partition', 'activitypartition'])) {
		return 'activity';
	}
	if (textMatchesAny(combined, ['state', 'pseudostate', 'final'])) {
		return 'state_machine';
	}
	if (textMatchesAny(combined, ['component'])) {
		return 'component';
	}
	if (textMatchesAny(combined, ['node', 'device', 'executionenvironment', 'artifact'])) {
		return 'deployment';
	}
	if (textMatchesAny(combined, ['lifeline', 'boundary', 'control', 'entity', 'object', 'activation'])) {
		return 'interaction';
	}
	return 'generic';
}

function normalizeConnectorCategory(connector) {
	var combined = connectorTypeKey(connector);
	if (textMatchesAny(combined, ['association', 'aggregation', 'composition'])) {
		return 'association';
	}
	if (textMatchesAny(combined, ['generalization'])) {
		return 'generalization';
	}
	if (textMatchesAny(combined, ['include', 'extend'])) {
		return 'use_case';
	}
	if (textMatchesAny(combined, ['controlflow', 'objectflow'])) {
		return 'activity';
	}
	if (textMatchesAny(combined, ['transition'])) {
		return 'state_machine';
	}
	if (textMatchesAny(combined, ['deployment'])) {
		return 'deployment';
	}
	if (textMatchesAny(combined, ['sequence', 'message', 'communication'])) {
		return 'interaction';
	}
	return 'generic';
}

function normalizeDiagramCategory(diagram) {
	var metaType = (safeString(safeProperty(diagram, 'MetaType', '')) + '').toLowerCase();
	var typeName = (safeString(diagram.Type) + '').toLowerCase();
	var combined = metaType + ' ' + typeName;

	if (combined.indexOf('sequence') >= 0 || combined.indexOf('communication') >= 0 || combined.indexOf('interaction') >= 0) {
		return 'interaction';
	}
	if (combined.indexOf('activity') >= 0) {
		return 'activity';
	}
	if (combined.indexOf('state') >= 0) {
		return 'state_machine';
	}
	if (combined.indexOf('use case') >= 0 || combined.indexOf('usecase') >= 0) {
		return 'use_case';
	}
	if (combined.indexOf('class') >= 0 || combined.indexOf('logical') >= 0) {
		return 'class';
	}
	if (combined.indexOf('component') >= 0) {
		return 'component';
	}
	if (combined.indexOf('deployment') >= 0) {
		return 'deployment';
	}
	if (combined.indexOf('package') >= 0) {
		return 'package';
	}
	if (combined.indexOf('object') >= 0) {
		return 'object';
	}
	return combined != ' ' ? trimString(combined) : 'uml';
}

function collectSwimlanes(diagram) {
	var result = [];
	var swimlanes = tryGetCollection(diagram, 'Swimlanes');
	forEachCollection(swimlanes, function(swimlane) {
		result.push({
			title: safeString(safeProperty(swimlane, 'Title', '')),
			width: safeNumber(safeProperty(swimlane, 'Width', 0), 0),
			classifier_guid: safeString(safeProperty(swimlane, 'ClassifierGuid', '')),
			orientation: safeString(safeProperty(swimlane, 'Orientation', ''))
		});
	});
	return result;
}

function collectSubdiagramRefs(ele) {
	var result = [];
	var diagrams = tryGetCollection(ele, 'Diagrams');
	forEachCollection(diagrams, function(diagram) {
		result.push({
			view_id: safeString(diagram.DiagramID),
			view_guid: safeString(safeProperty(diagram, 'DiagramGUID', '')),
			view_name: safeString(diagram.Name),
			diagram_type: safeString(diagram.Type)
		});
	});
	return result;
}

function collectElementAttributes(ele) {
	var result = [];
	var attrs = tryGetCollection(ele, 'AttributesEx');
	if (attrs == null) {
		attrs = tryGetCollection(ele, 'Attributes');
	}
	forEachCollection(attrs, function(attr) {
		result.push({
			name: safeString(attr.Name),
			type: safeString(attr.Type),
			stereotype: pickFirstNonEmpty([safeString(attr.StereotypeEx), safeString(attr.Stereotype)]),
			"default": safeString(attr.Default),
			multiplicity: safeString(safeProperty(attr, 'Multiplicity', '')),
			description: safeString(attr.Notes),
			is_static: safeBoolean(safeProperty(attr, 'IsStatic', false), false),
			is_const: safeBoolean(safeProperty(attr, 'IsConst', false), false),
			is_derived: safeBoolean(safeProperty(attr, 'IsDerived', false), false),
			tagged_values: collectTaggedValues(tryGetCollection(attr, 'TaggedValues'))
		});
	});
	return result;
}

function collectElementOperations(ele) {
	var result = [];
	var methods = tryGetCollection(ele, 'MethodsEx');
	if (methods == null) {
		methods = tryGetCollection(ele, 'Methods');
	}
	forEachCollection(methods, function(method) {
		result.push({
			name: safeString(method.Name),
			return_type: safeString(safeProperty(method, 'ReturnType', '')),
			stereotype: pickFirstNonEmpty([safeString(method.StereotypeEx), safeString(method.Stereotype)]),
			description: safeString(method.Notes),
			is_static: safeBoolean(safeProperty(method, 'IsStatic', false), false),
			is_abstract: safeBoolean(safeProperty(method, 'IsAbstract', false), false),
			parameters: collectMethodParameters(method),
			tagged_values: collectTaggedValues(tryGetCollection(method, 'TaggedValues'))
		});
	});
	return result;
}

function collectMethodParameters(method) {
	var result = [];
	var parameters = tryGetCollection(method, 'Parameters');
	forEachCollection(parameters, function(parameter) {
		result.push({
			name: safeString(parameter.Name),
			type: safeString(parameter.Type),
			kind: safeString(safeProperty(parameter, 'Kind', '')),
			"default": safeString(safeProperty(parameter, 'Default', '')),
			notes: safeString(parameter.Notes)
		});
	});
	return result;
}

function collectTests(ele) {
	var result = [];
	var tests = tryGetCollection(ele, 'Tests');
	forEachCollection(tests, function(testCase) {
		result.push({
			name: safeString(testCase.Name),
			"class": safeString(safeProperty(testCase, 'Class', '')),
			type: safeString(safeProperty(testCase, 'Type', '')),
			status: safeString(testCase.Status),
			description: safeString(testCase.Notes),
			input: safeString(safeProperty(testCase, 'Input', '')),
			acceptance_criteria: safeString(safeProperty(testCase, 'AcceptanceCriteria', '')),
			results: safeString(safeProperty(testCase, 'TestResults', ''))
		});
	});
	return result;
}

function collectConstraints(collection) {
	var result = [];
	forEachCollection(collection, function(constraint) {
		result.push({
			name: safeString(constraint.Name),
			type: safeString(safeProperty(constraint, 'Type', '')),
			status: safeString(constraint.Status),
			weight: safeString(safeProperty(constraint, 'Weight', '')),
			notes: safeString(constraint.Notes)
		});
	});
	return result;
}

function collectTaggedValues(collection) {
	var result = [];
	forEachCollection(collection, function(tag) {
		var value = safeString(tag.Value);
		if (value == '<memo>') {
			value = safeString(tag.Notes);
		}
		result.push({
			name: safeString(tag.Name),
			value: value,
			notes: safeString(tag.Notes)
		});
	});
	return result;
}

function bucketElementIdsByType(elementIds, state) {
	var buckets = {};
	for (var i = 0; i < elementIds.length; i++) {
		var elementInfo = state.elementRefs[elementIds[i]];
		if (elementInfo == null || elementInfo.element == null) {
			continue;
		}
		var bucketKey = pickFirstNonEmpty([
			safeString(safeProperty(elementInfo.element, 'MetaType', '')),
			safeString(elementInfo.element.Type),
			'Unknown'
		]);
		pushBucketValue(buckets, bucketKey, elementIds[i]);
	}
	return buckets;
}

function bucketConnectorIdsByType(connectorIds, state) {
	var buckets = {};
	for (var i = 0; i < connectorIds.length; i++) {
		var connectorInfo = state.connectorRefs[connectorIds[i]];
		if (connectorInfo == null || connectorInfo.connector == null) {
			continue;
		}
		var bucketKey = pickFirstNonEmpty([
			safeString(safeProperty(connectorInfo.connector, 'MetaType', '')),
			safeString(connectorInfo.connector.Type),
			'Unknown'
		]);
		pushBucketValue(buckets, bucketKey, connectorIds[i]);
	}
	return buckets;
}

function filterElementIdsByMatchers(elementIds, state, matchers) {
	var result = [];
	for (var i = 0; i < elementIds.length; i++) {
		var elementInfo = state.elementRefs[elementIds[i]];
		if (elementInfo == null || !textMatchesAny(elementTypeKey(elementInfo.element), matchers)) {
			continue;
		}
		result.push(elementIds[i]);
	}
	return result;
}

function filterConnectorIdsByMatchers(connectorIds, state, matchers) {
	var result = [];
	for (var i = 0; i < connectorIds.length; i++) {
		var connectorInfo = state.connectorRefs[connectorIds[i]];
		if (connectorInfo == null || !textMatchesAny(connectorTypeKey(connectorInfo.connector), matchers)) {
			continue;
		}
		result.push(connectorIds[i]);
	}
	return result;
}

function sortConnectorIdsBySequence(connectorIds, state) {
	var sortable = [];
	for (var i = 0; i < connectorIds.length; i++) {
		var connectorInfo = state.connectorRefs[connectorIds[i]];
		if (connectorInfo == null || connectorInfo.connector == null) {
			continue;
		}
		sortable.push({
			id: connectorIds[i],
			sequence: safeString(safeProperty(connectorInfo.connector, 'SequenceNo', '')),
			name: safeString(connectorInfo.connector.Name)
		});
	}

	sortable.sort(function(a, b) {
		var aKey = a.sequence != '' ? a.sequence : a.name;
		var bKey = b.sequence != '' ? b.sequence : b.name;
		if (aKey < bKey) {
			return -1;
		}
		if (aKey > bKey) {
			return 1;
		}
		return 0;
	});

	var result = [];
	for (var j = 0; j < sortable.length; j++) {
		result.push(sortable[j].id);
	}
	return result;
}

function elementTypeKey(ele) {
	return (
		safeString(safeProperty(ele, 'MetaType', '')) + ' ' +
		safeString(ele.Type) + ' ' +
		safeString(ele.StereotypeEx) + ' ' +
		safeString(ele.Stereotype)
	).toLowerCase();
}

function connectorTypeKey(connector) {
	return (
		safeString(safeProperty(connector, 'MetaType', '')) + ' ' +
		safeString(connector.Type) + ' ' +
		safeString(connector.StereotypeEx) + ' ' +
		safeString(connector.Stereotype)
	).toLowerCase();
}

function textMatchesAny(text, matchers) {
	if (text == null) {
		return false;
	}
	var normalized = ('' + text).toLowerCase();
	for (var i = 0; i < matchers.length; i++) {
		if (normalized.indexOf(matchers[i].toLowerCase()) >= 0) {
			return true;
		}
	}
	return false;
}

function pushBucketValue(buckets, key, value) {
	if (buckets[key] == null) {
		buckets[key] = [];
	}
	buckets[key].push(value);
}

function countElementsByScope(state, scope) {
	var count = 0;
	for (var i = 0; i < state.elementOrder.length; i++) {
		var elementInfo = state.elementRefs[state.elementOrder[i]];
		if (elementInfo != null && elementInfo.scope == scope) {
			count++;
		}
	}
	return count;
}

function resolvePackageName(packageId, state) {
	if (packageId == null || packageId == '') {
		return '';
	}
	var packageInfo = state.packageRefs[packageId];
	if (packageInfo == null || packageInfo.pkg == null) {
		var pkg = safeRepositoryGetPackageById(packageId);
		return pkg != null ? safeString(pkg.Name) : '';
	}
	return safeString(packageInfo.pkg.Name);
}

function buildPackagePath(packageId, state) {
	if (packageId == null || packageId == '') {
		return '';
	}
	var parts = [];
	var currentId = packageId;
	while (currentId != null && currentId != '') {
		var packageInfo = state.packageRefs[currentId];
		if (packageInfo == null || packageInfo.pkg == null) {
			var externalPkg = safeRepositoryGetPackageById(currentId);
			if (externalPkg == null) {
				break;
			}
			parts.unshift(safeString(externalPkg.Name));
			break;
		}
		parts.unshift(safeString(packageInfo.pkg.Name));
		currentId = packageInfo.parentPackageId;
	}
	return parts.join('/');
}

function buildElementPath(elementId, state) {
	if (elementId == null || elementId == '') {
		return '';
	}
	var parts = [];
	var currentId = elementId;
	while (currentId != null && currentId != '') {
		var elementInfo = state.elementRefs[currentId];
		if (elementInfo == null || elementInfo.element == null) {
			var externalElement = safeRepositoryGetElementById(currentId);
			if (externalElement == null) {
				break;
			}
			parts.unshift(safeString(externalElement.Name));
			break;
		}
		parts.unshift(safeString(elementInfo.element.Name));
		currentId = safeString(elementInfo.element.ParentID);
	}

	var elementInfo = state.elementRefs[elementId];
	if (elementInfo != null && elementInfo.packageId != null && elementInfo.packageId != '') {
		var packagePath = buildPackagePath(elementInfo.packageId, state);
		if (packagePath != '') {
			parts.unshift(packagePath);
		}
	}
	return parts.join('/');
}

function buildDiagramPath(diagramInfo, state) {
	var parts = [];
	if (diagramInfo.ownerElementId == null || diagramInfo.ownerElementId == '') {
		if (diagramInfo.packageId != null && diagramInfo.packageId != '') {
			var packagePath = buildPackagePath(diagramInfo.packageId, state);
			if (packagePath != '') {
				parts.push(packagePath);
			}
		}
	}
	if (diagramInfo.ownerElementId != null && diagramInfo.ownerElementId != '') {
		var elementPath = buildElementPath(diagramInfo.ownerElementId, state);
		if (elementPath != '') {
			parts.push(elementPath);
		}
	}
	parts.push(safeString(diagramInfo.diagram.Name));
	return parts.join('/');
}

function buildOutputFilePath(projectPath, packageName) {
	var fso = new ActiveXObject('Scripting.FileSystemObject');
	var folderPath = fso.BuildPath(projectPath, OUTPUT_SUBFOLDER);
	ensureFolderExists(folderPath);
	return fso.BuildPath(folderPath, sanitizeFileName(packageName) + OUTPUT_SUFFIX);
}

function ensureFolderExists(folderPath) {
	var fso = new ActiveXObject('Scripting.FileSystemObject');
	if (fso.FolderExists(folderPath)) {
		return;
	}
	var parentFolder = fso.GetParentFolderName(folderPath);
	if (parentFolder != '' && !fso.FolderExists(parentFolder)) {
		ensureFolderExists(parentFolder);
	}
	fso.CreateFolder(folderPath);
}

function writeUtf8WithoutBom(filePath, text) {
	var textStream = null;
	var binaryStream = null;
	try {
		textStream = new ActiveXObject('ADODB.Stream');
		textStream.Type = 2;
		textStream.Charset = 'utf-8';
		textStream.Open();
		textStream.WriteText(text);
		textStream.Position = 3;

		binaryStream = new ActiveXObject('ADODB.Stream');
		binaryStream.Type = 1;
		binaryStream.Open();
		textStream.CopyTo(binaryStream);
		binaryStream.SaveToFile(filePath, 2);
	} finally {
		if (textStream != null) {
			try {
				textStream.Close();
			} catch (ignore1) {
			}
		}
		if (binaryStream != null) {
			try {
				binaryStream.Close();
			} catch (ignore2) {
			}
		}
	}
}

function pruneEmptyValues(value) {
	if (value == null || value === '') {
		return undefined;
	}

	var valueType = typeof value;
	if (valueType == 'string' || valueType == 'number' || valueType == 'boolean') {
		return value;
	}

	if (isArray(value)) {
		var cleanedArray = [];
		for (var i = 0; i < value.length; i++) {
			var cleanedItem = pruneEmptyValues(value[i]);
			if (typeof cleanedItem != 'undefined') {
				cleanedArray.push(cleanedItem);
			}
		}
		return cleanedArray.length > 0 ? cleanedArray : undefined;
	}

	var cleanedObject = {};
	for (var key in value) {
		if (!value.hasOwnProperty(key)) {
			continue;
		}
		var cleanedValue = pruneEmptyValues(value[key]);
		if (typeof cleanedValue != 'undefined') {
			cleanedObject[key] = cleanedValue;
		}
	}

	return hasOwnKeys(cleanedObject) ? cleanedObject : undefined;
}

function stringifyJson(value, indentLevel) {
	if (value == null) {
		return 'null';
	}

	var valueType = typeof value;
	if (valueType == 'string') {
		return '"' + jsonEscape(value) + '"';
	}
	if (valueType == 'number') {
		return isFinite(value) ? '' + value : 'null';
	}
	if (valueType == 'boolean') {
		return value ? 'true' : 'false';
	}
	if (isArray(value)) {
		if (value.length === 0) {
			return '[]';
		}
		var arrayItems = [];
		for (var i = 0; i < value.length; i++) {
			arrayItems.push(indent(indentLevel + 1) + stringifyJson(value[i], indentLevel + 1));
		}
		return '[\n' + arrayItems.join(',\n') + '\n' + indent(indentLevel) + ']';
	}

	var objectItems = [];
	for (var key in value) {
		if (!value.hasOwnProperty(key)) {
			continue;
		}
		if (value[key] === undefined) {
			continue;
		}
		objectItems.push(indent(indentLevel + 1) + '"' + jsonEscape(key) + '": ' + stringifyJson(value[key], indentLevel + 1));
	}
	if (objectItems.length === 0) {
		return '{}';
	}
	return '{\n' + objectItems.join(',\n') + '\n' + indent(indentLevel) + '}';
}

function indent(level) {
	var result = '';
	for (var i = 0; i < level; i++) {
		result += '  ';
	}
	return result;
}

function jsonEscape(text) {
	var s = safeString(text);
	s = s.replace(/\\/g, '\\\\');
	s = s.replace(/\"/g, '\\\"');
	s = s.replace(/\r/g, '\\r');
	s = s.replace(/\n/g, '\\n');
	s = s.replace(/\t/g, '\\t');
	s = s.replace(/\f/g, '\\f');
	s = s.replace(/\u0008/g, '\\b');
	return s;
}

function isArray(value) {
	return Object.prototype.toString.call(value) == '[object Array]';
}

function hasOwnKeys(value) {
	for (var key in value) {
		if (value.hasOwnProperty(key)) {
			return true;
		}
	}
	return false;
}

function forEachCollection(collection, callback) {
	if (collection == null || callback == null) {
		return;
	}
	var count = safeNumber(safeProperty(collection, 'Count', 0), 0);
	for (var i = 0; i < count; i++) {
		callback(collection.GetAt(i), i);
	}
}

function sortedKeys(map) {
	var keys = [];
	for (var key in map) {
		if (map.hasOwnProperty(key) && map[key]) {
			keys.push(key);
		}
	}
	keys.sort();
	return keys;
}

function tryGetCollection(owner, propertyName) {
	if (owner == null || propertyName == null || propertyName == '') {
		return null;
	}
	try {
		return owner[propertyName];
	} catch (e) {
		return null;
	}
}

function safeProperty(owner, propertyPath, fallbackValue) {
	if (owner == null || propertyPath == null || propertyPath == '') {
		return fallbackValue;
	}

	try {
		var current = owner;
		var parts = propertyPath.split('.');
		for (var i = 0; i < parts.length; i++) {
			if (current == null) {
				return fallbackValue;
			}
			current = current[parts[i]];
		}
		return current == null ? fallbackValue : current;
	} catch (e) {
		return fallbackValue;
	}
}

function safeRepositoryGetElementById(elementId) {
	try {
		return Repository.GetElementByID(elementId);
	} catch (e) {
		return null;
	}
}

function safeRepositoryGetConnectorById(connectorId) {
	try {
		return Repository.GetConnectorByID(connectorId);
	} catch (e) {
		return null;
	}
}

function safeRepositoryGetPackageById(packageId) {
	try {
		return Repository.GetPackageByID(packageId);
	} catch (e) {
		return null;
	}
}

function safeString(value) {
	if (value == null || typeof value == 'undefined') {
		return '';
	}
	return '' + value;
}

function safeNumber(value, fallbackValue) {
	var parsed = parseInt(value, 10);
	return isNaN(parsed) ? fallbackValue : parsed;
}

function safeBoolean(value, fallbackValue) {
	if (value == null || typeof value == 'undefined' || value === '') {
		return fallbackValue;
	}
	if (value === true || value === false) {
		return value;
	}
	var normalized = ('' + value).toLowerCase();
	if (normalized == '1' || normalized == 'true' || normalized == '-1') {
		return true;
	}
	if (normalized == '0' || normalized == 'false') {
		return false;
	}
	return fallbackValue;
}

function trimString(text) {
	return safeString(text).replace(/^\s+|\s+$/g, '');
}

function pickFirstNonEmpty(values) {
	for (var i = 0; i < values.length; i++) {
		if (safeString(values[i]) != '') {
			return safeString(values[i]);
		}
	}
	return '';
}

function sanitizeFileName(name) {
	var value = safeString(name);
	value = value.replace(/[\\\/\:\*\?\"<>\|]/g, '_');
	if (value == '') {
		value = 'uml_package';
	}
	return value;
}

function formatTimestamp(date) {
	return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
		'T' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
}

function pad2(value) {
	return value < 10 ? '0' + value : '' + value;
}

function getConnectionProperty(connectionString, keyName) {
	if (connectionString == null || connectionString == '') {
		return '';
	}
	var pattern = new RegExp('(?:^|;)\\s*' + keyName + '\\s*=\\s*([^;]+)', 'i');
	var matches = ('' + connectionString).match(pattern);
	if (matches && matches.length > 1) {
		return trimString(matches[1]);
	}
	return '';
}

function stripWrappedQuotes(text) {
	var value = trimString(text);
	if (value.length >= 2) {
		var first = value.charAt(0);
		var last = value.charAt(value.length - 1);
		if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
			return value.substring(1, value.length - 1);
		}
	}
	return value;
}

function resolveModelFilePathFromConnectionString() {
	var conn = '';
	try {
		conn = '' + Repository.ConnectionString;
	} catch (e) {
		return '';
	}

	if (conn == '') {
		return '';
	}

	var dataSource = getConnectionProperty(conn, 'Data Source');
	if (dataSource == '') {
		dataSource = getConnectionProperty(conn, 'DataSource');
	}
	if (dataSource == '') {
		dataSource = getConnectionProperty(conn, 'DBQ');
	}
	if (dataSource != '') {
		return stripWrappedQuotes(dataSource);
	}

	var directPath = stripWrappedQuotes(conn);
	if (/^[A-Za-z]:\\/.test(directPath) || /^\\\\/.test(directPath)) {
		return directPath;
	}
	return '';
}

function resolveProjectPathFromCurrentModel() {
	var modelFilePath = resolveModelFilePathFromConnectionString();
	if (modelFilePath == '') {
		return '';
	}
	try {
		var fso = new ActiveXObject('Scripting.FileSystemObject');
		return fso.GetParentFolderName(modelFilePath);
	} catch (e) {
		return '';
	}
}

function errorMessage(error) {
	if (error == null) {
		return 'Unknown error';
	}
	if (safeString(error.message) != '') {
		return safeString(error.message);
	}
	return safeString(error);
}

function fail(message) {
	Session.Output('ERROR: ' + message);
}

main();