!INC Local Scripts.EAConstants-JScript

/*
 * Script Name: Generate Dependency View from Selection
 * Purpose: From a selected element in the current diagram, traverse its full
 *          dependency graph (upstream + downstream) and create a new view
 *          containing all reachable elements and their relationships.
 *
 * Dependency rules mirror resolveSemanticEdges from ARGO's
 * systemarchitecture-mcp-server.js:
 *
 *   - Access, Assignment, Specialization, Composition, Aggregation: source depends on target
 *   - Serving, Realization, Flow, Triggering, Influence: target depends on source
 *   - Association: NOT a dependency (excluded from traversal)
 *
 * Usage:
 *   1. Open a diagram in EA.
 *   2. Click to select ONE element.
 *   3. Run this script.
 *   4. A new diagram named "<ElementName> Dependency View" will be created
 *      in the same package, containing all reachable elements.
 */

var DIAGRAM_TYPE = 'Logical';

// Traversal depth limits. Depth counts from the focus element:
//   0 = focus element itself
//   1 = direct neighbours (one hop)
//   2 = neighbours of neighbours (two hops)
// Defaults mirror getIntentElementContext defaults (dependencyDepth=2, dependentDepth=1).
var MAX_UPSTREAM_DEPTH = 1000;
var MAX_DOWNSTREAM_DEPTH = 1;

// --- Dependency direction constants (mirrors ARGO resolveSemanticEdges) ---

var DEPENDENCY_TYPES_SOURCE_DEPENDS_ON_TARGET = ['Access', 'Assignment', 'Specialization', 'Composition', 'Aggregation'];
var DEPENDENCY_TYPES_TARGET_DEPENDS_ON_SOURCE = ['Serving', 'Realization', 'Flow', 'Triggering', 'Influence'];

/**
 * Returns true if the given ArchiMate stereotype represents a dependency-bearing
 * relationship (i.e. not Association, NoteLink, or other non-dependency types).
 */
function isDependencyConnectorType(stereotype) {
  if (stereotype === 'Association') return false;
  if (stereotype === 'NoteLink') return false;
  if (stereotype === 'Package') return false;
  if (stereotype === '') return false;
  // All ArchiMate relationship stereotypes are potentially dependency-bearing.
  // The direction logic in resolveUpstream / resolveDownstream filters further.
  return true;
}

/**
 * Returns an array of upstream element IDs that the given element depends on.
 * "Upstream" = elements this element needs to be delivered first.
 */
function resolveUpstream(elementId, connectorCache) {
  var upstreamIds = [];
  var connectors = connectorCache[elementId] || [];

  for (var i = 0; i < connectors.length; i++) {
    var conn = connectors[i];
    var isSource = (conn.ClientID === elementId);
    var neighborId = isSource ? conn.SupplierID : conn.ClientID;
    var relType = String(conn.StereotypeEx || '');

    if (!isDependencyConnectorType(relType)) continue;
    if (elementId === neighborId) continue;

    if (contains(DEPENDENCY_TYPES_SOURCE_DEPENDS_ON_TARGET, relType) && isSource) {
      // Source depends on target → target is upstream
      upstreamIds.push(neighborId);
      continue;
    }

    if (contains(DEPENDENCY_TYPES_TARGET_DEPENDS_ON_SOURCE, relType) && !isSource) {
      // Target depends on source → source is upstream
      upstreamIds.push(neighborId);
    }
  }

  return upstreamIds;
}

/**
 * Returns an array of downstream element IDs that depend on the given element.
 * "Downstream" = elements that need this element delivered first.
 */
function resolveDownstream(elementId, connectorCache) {
  var downstreamIds = [];
  var connectors = connectorCache[elementId] || [];

  for (var i = 0; i < connectors.length; i++) {
    var conn = connectors[i];
    var isSource = (conn.ClientID === elementId);
    var neighborId = isSource ? conn.SupplierID : conn.ClientID;
    var relType = String(conn.StereotypeEx || '');

    if (!isDependencyConnectorType(relType)) continue;
    if (elementId === neighborId) continue;

    if (contains(DEPENDENCY_TYPES_TARGET_DEPENDS_ON_SOURCE, relType) && isSource) {
      // Target depends on source → target is downstream
      downstreamIds.push(neighborId);
      continue;
    }

    if (contains(DEPENDENCY_TYPES_SOURCE_DEPENDS_ON_TARGET, relType) && !isSource) {
      // Source depends on target → source is downstream
      downstreamIds.push(neighborId);
    }
  }

  return downstreamIds;
}

// --- Utility ---

function contains(array, value) {
  for (var i = 0; i < array.length; i++) {
    if (array[i] === value) return true;
  }
  return false;
}

function arrayUnique(array) {
  var result = [];
  for (var i = 0; i < array.length; i++) {
    if (!contains(result, array[i])) {
      result.push(array[i]);
    }
  }
  return result;
}

/**
 * Build a cache of all connectors keyed by element ID for efficient lookup.
 * Returns an object: { elementId: [connector, ...], ... }
 */
function buildConnectorCache(elements) {
  var cache = {};
  for (var i = 0; i < elements.length; i++) {
    cache[elements[i].ElementID] = [];
  }

  var processed = {};
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var connectors = el.Connectors;
    for (var j = 0; j < connectors.Count; j++) {
      var conn = connectors.GetAt(j);
      var connId = conn.ConnectorID;

      // Deduplicate: some connectors appear on both endpoints
      if (processed[connId]) continue;
      processed[connId] = true;

      var clientId = conn.ClientID;
      var supplierId = conn.SupplierID;

      if (cache[clientId] !== undefined) {
        cache[clientId].push(conn);
      }
      if (cache[supplierId] !== undefined && supplierId !== clientId) {
        cache[supplierId].push(conn);
      }
    }
  }

  return cache;
}

/**
 * BFS traversal from startId with real depth counting.
 * Depth 0 = startId, depth 1 = direct neighbours, depth 2 = second-hop, etc.
 * Stops when depth reaches maxDepth (no further exploration from that node).
 *
 * @param {number} startId
 * @param {object} connectorCache
 * @param {function} directionFn - resolveUpstream or resolveDownstream
 * @param {number} maxDepth - 0 = only startId, 1 = direct, 2 = direct+indirect, ...
 * @returns {{ ids: number[], depths: object }} - ids and per-element depth map
 */
function traverseDependencyGraph(startId, connectorCache, directionFn, maxDepth) {
  var visited = {};
  var resultIds = [];
  var depths = {};

  // Queue entries: { id, depth }
  var queue = [{ id: startId, depth: 0 }];
  visited[startId] = true;
  depths[startId] = 0;

  while (queue.length > 0) {
    var current = queue.shift();
    var currentId = current.id;
    var currentDepth = current.depth;

    resultIds.push(currentId);

    // Stop expanding from this node if we've reached the max depth
    if (currentDepth >= maxDepth) continue;

    var neighbors = directionFn(currentId, connectorCache);
    for (var i = 0; i < neighbors.length; i++) {
      var nid = neighbors[i];
      if (!visited[nid]) {
        visited[nid] = true;
        depths[nid] = currentDepth + 1;
        queue.push({ id: nid, depth: currentDepth + 1 });
      }
    }
  }

  return { ids: resultIds, depths: depths };
}

/**
 * Collect all relationship IDs that connect any pair of the given element IDs.
 */
function collectConnectingRelationships(elementIdSet, connectorCache) {
  var relationshipIds = [];
  var seen = {};

  for (var eid in elementIdSet) {
    if (!elementIdSet.hasOwnProperty(eid)) continue;
    var connectors = connectorCache[eid] || [];
    for (var i = 0; i < connectors.length; i++) {
      var conn = connectors[i];
      var otherId = (conn.ClientID === parseInt(eid, 10)) ? conn.SupplierID : conn.ClientID;
      if (elementIdSet[otherId] && !seen[conn.ConnectorID]) {
        seen[conn.ConnectorID] = true;
        relationshipIds.push(conn.ConnectorID);
      }
    }
  }

  return relationshipIds;
}

// --- Main ---

function main() {
  Repository.EnsureOutputVisible('Script');
  Repository.EnableUIUpdates(false);

  try {
    // 1. Get the current diagram and selection
    var currentDiagram = Repository.GetCurrentDiagram();
    if (currentDiagram == null) {
      Session.Output('ERROR: No diagram is currently open.');
      return;
    }

    var selectedIds = [];
    for (var i = 0; i < currentDiagram.SelectedObjects.Count; i++) {
      var dobj = currentDiagram.SelectedObjects.GetAt(i);
      selectedIds.push(dobj.ElementID);
    }

    if (selectedIds.length === 0) {
      Session.Output('ERROR: No element selected in the current diagram.');
      return;
    }

    if (selectedIds.length > 1) {
      Session.Output('WARNING: Multiple elements selected. Using the first one only.');
    }

    var focusElementId = selectedIds[0];
    var focusElement = Repository.GetElementByID(focusElementId);
    if (focusElement == null) {
      Session.Output('ERROR: Could not retrieve selected element by ID ' + focusElementId);
      return;
    }

    Session.Output('Focus element: ' + focusElement.Name + ' [' + focusElement.ElementID + ']');

    // 2. Build connector cache from all elements in the owning package
    var ownerPackage = Repository.GetPackageByID(focusElement.PackageID);
    var allElements = [];
    collectElementsRecursive(ownerPackage, allElements);
    Session.Output('Scanned ' + allElements.length + ' elements for connectors.');

    var connectorCache = buildConnectorCache(allElements);

    // 3. Traverse upstream + downstream from the focus element
    var upstreamResult = traverseDependencyGraph(focusElementId, connectorCache, resolveUpstream, MAX_UPSTREAM_DEPTH);
    var downstreamResult = traverseDependencyGraph(focusElementId, connectorCache, resolveDownstream, MAX_DOWNSTREAM_DEPTH);

    // Merge unique IDs (upstream + downstream, deduplicated)
    var allReachableIds = arrayUnique(upstreamResult.ids.concat(downstreamResult.ids));
    Session.Output('Reachable elements: ' + allReachableIds.length +
                   ' (upstream depth <= ' + MAX_UPSTREAM_DEPTH + ': ' + upstreamResult.ids.length +
                   ', downstream depth <= ' + MAX_DOWNSTREAM_DEPTH + ': ' + downstreamResult.ids.length + ')');

    // Build lookup set
    var reachableSet = {};
    for (var r = 0; r < allReachableIds.length; r++) {
      reachableSet[allReachableIds[r]] = true;
    }

    // 4. Collect connecting relationships
    var connectingRelIds = collectConnectingRelationships(reachableSet, connectorCache);
    Session.Output('Connecting relationships: ' + connectingRelIds.length);

    // 5. Create the new diagram
    var diagramName = focusElement.Name + ' Dependency View';
    var diagram = ownerPackage.Diagrams.AddNew(diagramName, DIAGRAM_TYPE);
    diagram.Update();

    if (diagram == null) {
      Session.Output('ERROR: Could not create new diagram.');
      return;
    }

    Session.Output('Created diagram: ' + diagramName + ' (ID: ' + diagram.DiagramID + ')');

    // 6. Add elements to the diagram with a simple grid layout
    var cols = Math.ceil(Math.sqrt(allReachableIds.length));
    for (var e = 0; e < allReachableIds.length; e++) {
      var elId = allReachableIds[e];
      var el = Repository.GetElementByID(elId);
      if (el == null) continue;

      var diagObj = diagram.DiagramObjects.AddNew('l=' + (100 + (e % cols) * 200) +
                                                   ';r=' + (260 + (e % cols) * 200) +
                                                   ';t=' + (-100 - Math.floor(e / cols) * 100) +
                                                   ';b=' + (-260 - Math.floor(e / cols) * 100),
                                                   '');
      diagObj.ElementID = elId;
      diagObj.Update();
    }

    // 7. Add relationships to the diagram
    // EA automatically shows connectors when both endpoints are on the diagram,
    // but we explicitly add them for completeness.
    for (var c = 0; c < connectingRelIds.length; c++) {
      var connId = connectingRelIds[c];
      try {
        var conn = Repository.GetConnectorByID(connId);
        if (conn != null) {
          diagram.DiagramLinks.AddNew('', '');
          // The link will connect automatically if both endpoints are on the diagram
        }
      } catch (ex) {
        // Silently skip connectors that can't be added
      }
    }

    diagram.Update();
    Repository.RefreshOpenDiagrams(true);

    // 8. Open the new diagram
    Repository.OpenDiagram(diagram.DiagramID);

    Session.Output('=======================================');
    Session.Output('Done. New view "' + diagramName + '" created with ' +
                   allReachableIds.length + ' elements and ' +
                   connectingRelIds.length + ' connecting relationships.');

  } catch (e) {
    Session.Output('ERROR: ' + (e.message || e.description || String(e)));
  } finally {
    Repository.EnableUIUpdates(true);
  }
}

/**
 * Recursively collect all elements from a package and its sub-packages.
 */
function collectElementsRecursive(pkg, result) {
  if (pkg == null) return;

  var elements = pkg.Elements;
  for (var i = 0; i < elements.Count; i++) {
    result.push(elements.GetAt(i));
  }

  var subPkgs = pkg.Packages;
  for (var j = 0; j < subPkgs.Count; j++) {
    collectElementsRecursive(subPkgs.GetAt(j), result);
  }
}

main();
