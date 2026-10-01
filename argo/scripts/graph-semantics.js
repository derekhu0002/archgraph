// Shared graph-semantics validation for SystemArchitecture.
// Used by both validateSystemArchitecture.js (full validation) and
// systemarchitecture-mcp-server.js (mutation-path validation).
//
// This module eliminates the duplicate validateGraphSemantics implementations.
// All callers get identical core checks; the modeling language (element types,
// relationship types, endpoint matrix, statement grammar, root-view name and
// view element limit) is supplied by an *ontology* so a repository that ships
// its own schema under .argo/schema is validated against its own language.
//
// The ontology argument is optional: when omitted, the default ArchiMate 3.2
// (ArchiMate 3.2 + ARGO) ontology is used, preserving historical behaviour.

const { loadSchemaBundleAndOntology } = require('./schema-bundle.js');

let defaultOntology = null;

function resolveOntology(ontology) {
  if (ontology) {
    return ontology;
  }
  if (!defaultOntology) {
    defaultOntology = loadSchemaBundleAndOntology(process.cwd()).ontology;
  }
  return defaultOntology;
}

/**
 * Core graph-semantics checks that are always identical for all callers.
 *
 * @param {object} document - parsed SystemArchitecture JSON
 * @param {string[]} errors - error accumulator
 * @param {object} [ontology] - resolved modeling language (defaults to ArchiMate 3.2)
 */
function validateGraphSemantics(document, errors, ontology) {
  if (!document || typeof document !== 'object') {
    return;
  }
  const language = resolveOntology(ontology);
  const invariants = language.invariants || {};
  const elementTypeLabel = language.elementTypeErrorLabel || language.language || 'the';
  const relationshipTypeLabel = language.relationshipTypeErrorLabel || language.language || 'the';
  const rootViewName = invariants.rootViewName === undefined ? 'SystemArchitecture' : invariants.rootViewName;

  const elements = Array.isArray(document.elements) ? document.elements : [];
  const relationships = Array.isArray(document.relationships) ? document.relationships : [];
  const views = Array.isArray(document.views) ? document.views : [];
  const elementById = new Map();
  const relationshipById = new Map();

  // --- elements: identity, type, parent ---
  for (const element of elements) {
    if (!element || typeof element !== 'object') {
      continue;
    }
    if (elementById.has(element.id)) {
      errors.push(`elements contains duplicate id '${element.id}'`);
      continue;
    }
    elementById.set(element.id, element);
    if (!language.isSupportedElementType(element.type)) {
      errors.push(`elements '${element.id}' uses unsupported ${elementTypeLabel} element type '${element.type}'`);
    }
  }

  for (const element of elements) {
    if (!element || typeof element !== 'object' || !element.parent) {
      continue;
    }
    if (!elementById.has(element.parent)) {
      errors.push(`elements '${element.id}' references missing parent '${element.parent}'`);
    }
  }

  // --- relationships: identity, type, endpoints, statement ---
  for (const relationship of relationships) {
    if (!relationship || typeof relationship !== 'object') {
      continue;
    }
    if (relationshipById.has(relationship.id)) {
      errors.push(`relationships contains duplicate id '${relationship.id}'`);
      continue;
    }
    relationshipById.set(relationship.id, relationship);
    if (!language.isSupportedRelationshipType(relationship.type)) {
      errors.push(`relationships '${relationship.id}' uses unsupported ${relationshipTypeLabel} relationship type '${relationship.type}'`);
    }

    const source = elementById.get(relationship.source_id);
    if (!source) {
      errors.push(`relationships '${relationship.id}' references missing source_id '${relationship.source_id}'`);
    } else if (relationship.source_name !== source.name) {
      errors.push(`relationships '${relationship.id}' source_name '${relationship.source_name}' does not match element '${relationship.source_id}' name '${source.name}'`);
    }

    const target = elementById.get(relationship.target_id);
    if (!target) {
      errors.push(`relationships '${relationship.id}' references missing target_id '${relationship.target_id}'`);
    } else if (relationship.target_name !== target.name) {
      errors.push(`relationships '${relationship.id}' target_name '${relationship.target_name}' does not match element '${relationship.target_id}' name '${target.name}'`);
    }

    if (invariants.statementGrammar === false) {
      continue;
    }
    const expectedStatement = source && target
      ? `${source.name} --(${relationship.type})--> ${target.name}`
      : undefined;
    if (expectedStatement && relationship.statement !== expectedStatement) {
      errors.push(`relationships '${relationship.id}' statement must be '${expectedStatement}'`);
    }
  }

  // --- views: topology, membership, endpoint co-occurrence ---
  const topLevelViews = views.filter(view => view && typeof view === 'object' && !view.parent_element_id);
  if (topLevelViews.length !== 1) {
    errors.push(
      rootViewName
        ? `views must contain exactly one top-level view named '${rootViewName}'; found ${topLevelViews.length}`
        : `views must contain exactly one top-level view; found ${topLevelViews.length}`,
    );
  } else if (rootViewName && topLevelViews[0].view_name !== rootViewName) {
    errors.push(`top-level view '${topLevelViews[0].view_id}' view_name must be '${rootViewName}'`);
  }

  const elementIdsIncludedInViews = new Set();
  const relationshipIdsIncludedInViews = new Set();
  for (const view of views) {
    if (!view || typeof view !== 'object') {
      continue;
    }
    if (!view.parent_element_id && rootViewName && view.view_name !== rootViewName) {
      errors.push(`views '${view.view_id}' must declare parent_element_id unless it is the top-level ${rootViewName} view`);
    }
    if (view.parent_element_id) {
      const parent = elementById.get(view.parent_element_id);
      if (!parent) {
        errors.push(`views '${view.view_id}' references missing parent_element_id '${view.parent_element_id}'`);
      } else if (view.parent_element_name && view.parent_element_name !== parent.name) {
        errors.push(`views '${view.view_id}' parent_element_name '${view.parent_element_name}' does not match element '${view.parent_element_id}' name '${parent.name}'`);
      }
    }
    const includedElementIds = new Set(view.included_elements || []);
    if (includedElementIds.size !== (view.included_elements || []).length) {
      errors.push(`views '${view.view_id}' must not contain duplicate included_elements`);
    }
    for (const elementId of view.included_elements || []) {
      elementIdsIncludedInViews.add(elementId);
      if (!elementById.has(elementId)) {
        errors.push(`views '${view.view_id}' references missing included element '${elementId}'`);
      }
    }
    const includedRelationshipIds = new Set(view.included_relationships || []);
    if (includedRelationshipIds.size !== (view.included_relationships || []).length) {
      errors.push(`views '${view.view_id}' must not contain duplicate included_relationships`);
    }
    for (const relationshipId of view.included_relationships || []) {
      relationshipIdsIncludedInViews.add(relationshipId);
      const rel = relationshipById.get(relationshipId);
      if (!rel) {
        errors.push(`views '${view.view_id}' references missing included relationship '${relationshipId}'`);
        continue;
      }
      if (!includedElementIds.has(rel.source_id)) {
        errors.push(`views '${view.view_id}' includes relationship '${relationshipId}' but not source element '${rel.source_id}'`);
      }
      if (!includedElementIds.has(rel.target_id)) {
        errors.push(`views '${view.view_id}' includes relationship '${relationshipId}' but not target element '${rel.target_id}'`);
      }
    }
  }

  for (const element of elements) {
    if (element && typeof element === 'object' && !elementIdsIncludedInViews.has(element.id)) {
      errors.push(`elements '${element.id}' must be included in at least one view`);
    }
  }

  for (const relationship of relationships) {
    if (relationship && typeof relationship === 'object' && !relationshipIdsIncludedInViews.has(relationship.id)) {
      errors.push(`relationships '${relationship.id}' must be included in at least one view`);
    }
  }
}

/**
 * Validate the modeling language's endpoint-type matrix for relationships.
 * No-op when the ontology disables the endpoint matrix invariant.
 *
 * @param {object} document - parsed SystemArchitecture JSON
 * @param {string[]} errors - error accumulator
 * @param {object} [options]
 * @param {string[]} [options.touchedRelationshipIds] - if provided, only these
 *   relationships are checked; if omitted/empty, ALL relationships are checked
 * @param {object} [options.ontology] - resolved modeling language
 */
function validateArchiMateEndpointMatrix(document, errors, options = {}) {
  const ontology = resolveOntology(options.ontology);
  if (ontology.invariants && ontology.invariants.endpointMatrix === false) {
    return;
  }
  const elementById = new Map(
    (document.elements || []).map(element => [element.id, element]),
  );
  const relationshipIdSet =
    Array.isArray(options.touchedRelationshipIds) && options.touchedRelationshipIds.length > 0
      ? new Set(options.touchedRelationshipIds)
      : undefined;

  for (const relationship of document.relationships || []) {
    if (relationshipIdSet && !relationshipIdSet.has(relationship.id)) {
      continue;
    }
    const source = elementById.get(relationship.source_id);
    const target = elementById.get(relationship.target_id);
    errors.push(...ontology.validateRelationshipEndpointTypes(relationship, source, target));
  }
}

/**
 * Validate the ontology's per-view element limit (default 15).
 * `maxElementsPerView: null` disables the limit. included_relationships do not
 * consume the quota.
 *
 * @param {object} document - parsed SystemArchitecture JSON
 * @param {string[]} errors - error accumulator
 * @param {object} [options]
 * @param {string[]} [options.touchedViewIds] - if provided, only these views
 *   are checked; if omitted/empty, ALL views are checked
 * @param {object} [options.ontology] - resolved modeling language
 */
function validateViewElementLimits(document, errors, options = {}) {
  const ontology = resolveOntology(options.ontology);
  const maxIncludedElements = ontology.invariants && ontology.invariants.maxElementsPerView !== undefined
    ? ontology.invariants.maxElementsPerView
    : 15;
  if (maxIncludedElements === null) {
    return;
  }
  const touchedViewIdSet =
    Array.isArray(options.touchedViewIds) && options.touchedViewIds.length > 0
      ? new Set(options.touchedViewIds)
      : undefined;

  for (const view of document.views || []) {
    if (!view) {
      continue;
    }
    if (touchedViewIdSet && !touchedViewIdSet.has(view.view_id)) {
      continue;
    }
    const elementCount = Array.isArray(view.included_elements) ? view.included_elements.length : 0;
    if (elementCount > maxIncludedElements) {
      errors.push(
        `views '${view.view_id}' must contain at most ${maxIncludedElements} elements; found ${elementCount}. ` +
        'Split the content into layered sub-views before adding more elements.',
      );
    }
  }
}

module.exports = {
  validateGraphSemantics,
  validateArchiMateEndpointMatrix,
  validateViewElementLimits,
};
