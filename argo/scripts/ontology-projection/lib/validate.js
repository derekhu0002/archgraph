'use strict';

// Orchestrates the read-only pipeline:
//   canonical JSON -> RDF projection + SHACL shapes (constraints) + OWL axioms
//   -> findings (SHACL violations + OWL inconsistencies).
// It NEVER mutates the canonical graph (findings are a derived read-model).

const { loadModel } = require('./model.js');
const { projectGraph, projectHash } = require('./project.js');
const { buildShapes, checkEndpoints } = require('./shapes.js');
const { buildOwlTriples, checkConsistency, entailedTransitive } = require('./owl.js');

function validateGraph(model, graph) {
  const shaclViolations = checkEndpoints(model, graph);
  const owlInconsistencies = checkConsistency(model, graph);
  return {
    status: shaclViolations.length === 0 && owlInconsistencies.length === 0 ? 'passed' : 'failed',
    language: model.language,
    projectionHash: projectHash(graph),
    shacl: { violations: shaclViolations },
    owl: { inconsistencies: owlInconsistencies },
  };
}

module.exports = {
  loadModel,
  projectGraph,
  projectHash,
  buildShapes,
  buildOwlTriples,
  entailedTransitive,
  validateGraph,
};
