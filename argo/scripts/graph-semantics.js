// Shared graph-semantics validation for SystemArchitecture.
// Used by both validateSystemArchitecture.js (full validation) and
// systemarchitecture-mcp-server.js (mutation-path validation).
//
// This module eliminates the duplicate validateGraphSemantics implementations.
// All callers get identical core checks; ArchiMate endpoint matrix and view
// element limits are parameterized so the full validator can check everything
// while the mutation path only checks what changed.

const {
  elementTypeMetadata,
  relationshipCategoryByType,
  validateRelationshipEndpointTypes,
} = require('./archimate32-rules');

/**
 * Core graph-semantics checks that are always identical for all callers.
 * 
 * @param {object} document - parsed SystemArchitecture JSON
 * @param {string[]} errors - error accumulator
 */
function validateGraphSemantics(document, errors) {
  if (!document || typeof document !== 'object') {
    return;
  }

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
    if (!elementTypeMetadata.has(element.type)) {
      errors.push(`elements '${element.id}' uses unsupported ArchiMate element type '${element.type}'`);
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
    if (!relationshipCategoryByType.has(relationship.type)) {
      errors.push(`relationships '${relationship.id}' uses unsupported ArchiMate relationship type '${relationship.type}'`);
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
    errors.push(`views must contain exactly one top-level view named 'SystemArchitecture'; found ${topLevelViews.length}`);
  } else if (topLevelViews[0].view_name !== 'SystemArchitecture') {
    errors.push(`top-level view '${topLevelViews[0].view_id}' view_name must be 'SystemArchitecture'`);
  }

  const elementIdsIncludedInViews = new Set();
  const relationshipIdsIncludedInViews = new Set();
  for (const view of views) {
    if (!view || typeof view !== 'object') {
      continue;
    }
    if (!view.parent_element_id && view.view_name !== 'SystemArchitecture') {
      errors.push(`views '${view.view_id}' must declare parent_element_id unless it is the top-level SystemArchitecture view`);
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
    for (const elementId of view.included_elements || []) {
      elementIdsIncludedInViews.add(elementId);
      if (!elementById.has(elementId)) {
        errors.push(`views '${view.view_id}' references missing included element '${elementId}'`);
      }
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
 * Validate ArchiMate 3.2 endpoint type matrix for relationships.
 *
 * @param {object} document - parsed SystemArchitecture JSON
 * @param {string[]} errors - error accumulator
 * @param {object} [options]
 * @param {string[]} [options.touchedRelationshipIds] - if provided, only these
 *   relationships are checked; if omitted/empty, ALL relationships are checked
 */
function validateArchiMateEndpointMatrix(document, errors, options = {}) {
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
    errors.push(...validateRelationshipEndpointTypes(relationship, source, target));
  }
}

/**
 * Validate that each view contains at most 15 included_elements.
 * included_relationships do not consume this quota.
 *
 * @param {object} document - parsed SystemArchitecture JSON
 * @param {string[]} errors - error accumulator
 * @param {object} [options]
 * @param {string[]} [options.touchedViewIds] - if provided, only these views
 *   are checked; if omitted/empty, ALL views are checked
 */
function validateViewElementLimits(document, errors, options = {}) {
  const touchedViewIdSet =
    Array.isArray(options.touchedViewIds) && options.touchedViewIds.length > 0
      ? new Set(options.touchedViewIds)
      : undefined;
  const MAX_INCLUDED_ELEMENTS = 15;

  for (const view of document.views || []) {
    if (!view) {
      continue;
    }
    if (touchedViewIdSet && !touchedViewIdSet.has(view.view_id)) {
      continue;
    }
    const elementCount = Array.isArray(view.included_elements) ? view.included_elements.length : 0;
    if (elementCount > MAX_INCLUDED_ELEMENTS) {
      errors.push(
        `views '${view.view_id}' must contain at most ${MAX_INCLUDED_ELEMENTS} elements; found ${elementCount}. ` +
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
