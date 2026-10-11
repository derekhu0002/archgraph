'use strict';

// Ontology-projection sidecar: model loader.
//
// Reads the SAME bundle contract the framework uses (schema-bundle.config.json +
// schema-bundle.rules.json under .argo/schema) for the pieces the sidecar needs
// (element/relationship types + endpoint matrix), plus a sidecar-only,
// ADDITIVE axiom file (ontology-axioms.json) that declares the logical axioms the
// current bundle format does not carry (disjointness / functional / transitive /
// domain-range-as-inference). It never writes anything.

const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readSchemaEnums(bundleDir, config) {
  const schema = readJson(path.join(bundleDir, 'SystemArchitecture.schema.json'), null);
  const defs = schema && typeof schema.$defs === 'object' ? schema.$defs : null;
  if (!defs) return { elementTypes: [], relationshipTypes: [] };
  const pick = (keys) => {
    for (const key of keys) {
      const def = defs[key];
      if (def && Array.isArray(def.enum)) return def.enum.slice();
    }
    return [];
  };
  return {
    elementTypes: pick([config.elementTypeEnumKey, 'archimateElementType', 'elementType', 'elementTypes'].filter(Boolean)),
    relationshipTypes: pick([config.relationshipTypeEnumKey, 'archimateRelationshipType', 'relationshipType', 'relationshipTypes'].filter(Boolean)),
  };
}

function loadModel(bundleDir) {
  const config = readJson(path.join(bundleDir, 'schema-bundle.config.json'), {}) || {};
  const rules = readJson(path.join(bundleDir, 'schema-bundle.rules.json'), {}) || {};
  const axioms = readJson(path.join(bundleDir, 'ontology-axioms.json'), {}) || {};

  let elementTypes = Object.keys(rules.elementTypeMetadata || {});
  let relationshipTypes = Object.keys(rules.relationshipCategoryByType || {});
  // A valid bundle may declare its vocabulary ONLY in the schema enums (no rules
  // file). Fall back to the schema enums so such a bundle is not treated as broken.
  if (elementTypes.length === 0 || relationshipTypes.length === 0) {
    const enums = readSchemaEnums(bundleDir, config);
    if (elementTypes.length === 0) elementTypes = enums.elementTypes;
    if (relationshipTypes.length === 0) relationshipTypes = enums.relationshipTypes;
  }
  const matrix = rules.relationshipTargetMatrix || {};

  return {
    bundleDir,
    language: config.language || 'Custom',
    actorElementType: config.actorElementType === undefined ? null : config.actorElementType,
    elementTypes,
    relationshipTypes,
    matrix,
    axioms: {
      disjointClasses: axioms.disjointClasses || [],
      functionalProperties: axioms.functionalProperties || [],
      transitiveProperties: axioms.transitiveProperties || [],
      irreflexiveProperties: axioms.irreflexiveProperties || [],
      asymmetricProperties: axioms.asymmetricProperties || [],
      objectPropertyDomain: axioms.objectPropertyDomain || {},
      objectPropertyRange: axioms.objectPropertyRange || {},
    },
  };
}

module.exports = { loadModel, readJson };
