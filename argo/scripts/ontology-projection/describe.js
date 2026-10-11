'use strict';

// Describe the workspace ontology for the init report: the full definition
// (types, relationship structure, endpoint matrix, constraints/invariants,
// axioms) AND what is missing (absent constraints / axiom categories). Read-only.

const { loadSchemaBundleAndOntology } = require('../schema-bundle.js');

// The logical-axiom categories the ontology layer understands (ontology-axioms.json).
const AXIOM_KEYS = Object.freeze([
  'disjointClasses',
  'functionalProperties',
  'transitiveProperties',
  'irreflexiveProperties',
  'asymmetricProperties',
  'objectPropertyDomain',
  'objectPropertyRange',
]);

function isEmptyAxiom(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function describeOntology({ workspaceRoot } = {}) {
  let bundle;
  let ontology;
  try {
    ({ bundle, ontology } = loadSchemaBundleAndOntology(workspaceRoot));
  } catch (error) {
    return { status: 'failed', error: String(error && error.message ? error.message : error) };
  }

  // Use the RESOLVED, chain-merged rules/config from the bundle (this follows the
  // `extends` chain). Reading the raw child bundle dir would miss the base
  // bundle's endpoint matrix / type metadata / relationship categories.
  const rules = bundle.rules || {};
  const config = bundle.config || {};
  // Chain-merged logical axioms (follows `extends`), like the endpoint matrix: a
  // base bundle's axioms are honoured, not just the child dir's file.
  const axiomsRaw = bundle.axioms || {};
  const hasAxiomsFile = bundle.hasAxiomsFile === true;

  const elementTypes = Array.isArray(ontology.elementTypes) ? ontology.elementTypes.slice() : [];
  const relationshipTypes = Array.isArray(ontology.relationshipTypes) ? ontology.relationshipTypes.slice() : [];
  const elementTypeMetadata = rules.elementTypeMetadata || {};
  const relationshipCategoryByType = rules.relationshipCategoryByType || {};
  const endpointMatrix = rules.relationshipTargetMatrix || {};
  const invariants = ontology.invariants || {};

  const axioms = {};
  for (const key of AXIOM_KEYS) {
    axioms[key] = axiomsRaw[key] !== undefined ? axiomsRaw[key] : (key.startsWith('objectProperty') ? {} : []);
  }
  axioms.distinctIndividuals = axiomsRaw.distinctIndividuals === true;

  const missing = { structure: [], constraints: [], axioms: [] };
  if (elementTypes.length === 0) missing.structure.push('element types (none declared)');
  if (relationshipTypes.length === 0) missing.structure.push('relationship types (none declared)');
  if (Object.keys(elementTypeMetadata).length === 0) missing.structure.push('element type metadata (layer/aspect)');
  if (Object.keys(relationshipCategoryByType).length === 0) missing.structure.push('relationship categories');
  if (Object.keys(endpointMatrix).length === 0) missing.constraints.push('endpoint matrix (no schema-bundle.rules.json / empty relationshipTargetMatrix)');
  if (invariants.endpointMatrix === false) missing.constraints.push('endpointMatrix invariant disabled');
  // Class-matrix types without a class mapping cannot be referenced by the
  // (class-token) endpoint matrix, so they silently carry no endpoint constraints.
  if (ontology.dialect === 'archimate-class-matrix' && Object.keys(endpointMatrix).length > 0) {
    const classByType = rules.archimateClassByElementType || {};
    const unmapped = elementTypes.filter((t) => !(t in classByType));
    if (unmapped.length > 0) {
      missing.constraints.push(`element types without a class mapping (endpoint constraints cannot reference them): ${unmapped.join(', ')}`);
    }
  }
  if (invariants.statementGrammar === false) missing.constraints.push('statementGrammar invariant disabled');
  if (!hasAxiomsFile) missing.axioms.push('ontology-axioms.json (no logical axioms declared)');
  for (const key of AXIOM_KEYS) {
    if (isEmptyAxiom(axioms[key])) missing.axioms.push(key);
  }
  if (axioms.distinctIndividuals !== true) missing.axioms.push('distinctIndividuals');

  return {
    status: 'ok',
    language: ontology.language || null,
    dialect: ontology.dialect || null,
    actorElementType: ontology.actorElementType === undefined ? null : ontology.actorElementType,
    bundleKind: bundle.kind,
    bundleDir: bundle.relativeDir,
    guide: bundle.guidePath ? bundle.guidePath.relativePath : null,
    invariants,
    // 1. element / relationship structure definition
    elementTypes,
    relationshipTypes,
    elementTypeMetadata,
    relationshipCategoryByType,
    // 2. endpoint matrix (constraint: who may connect to whom)
    endpointMatrix,
    // 3. constraints / invariants are `invariants` above + endpointMatrix
    // 4. axioms
    axioms,
    missing,
  };
}

module.exports = { describeOntology, AXIOM_KEYS };
