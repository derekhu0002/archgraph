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

function loadModel(bundleDir) {
  const config = readJson(path.join(bundleDir, 'schema-bundle.config.json'), {}) || {};
  const rules = readJson(path.join(bundleDir, 'schema-bundle.rules.json'), {}) || {};
  const axioms = readJson(path.join(bundleDir, 'ontology-axioms.json'), {}) || {};

  const elementTypes = Object.keys(rules.elementTypeMetadata || {});
  const relationshipTypes = Object.keys(rules.relationshipCategoryByType || {});
  const matrix = rules.relationshipTargetMatrix || {};

  if (elementTypes.length === 0) {
    throw new Error(`bundle ${bundleDir} declares no element types`);
  }
  if (relationshipTypes.length === 0) {
    throw new Error(`bundle ${bundleDir} declares no relationship types`);
  }

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
