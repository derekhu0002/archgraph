#!/usr/bin/env node
'use strict';

// Production ontology-validation CLI, attached to the framework through the
// generic validation extension point (argo/scripts/validation-extensions.js).
//
//   --mode   write | init(full)
//   --engine real | deterministic       (default: real; pySHACL + owlready2/HermiT)
//   --scope  delta | whole              (default: delta for write, whole otherwise)
//
// Write runs on the DELTA (the touched elements/relationships + their incident
// edges) so cost is bounded by the change, not the whole graph. Init runs the
// full engine over the whole graph (offline policy).
//
// Prints a single JSON object: { "errors": string[], "warnings": string[] }.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { loadModel, validateGraph } = require('./lib/validate.js');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function parseTouched(envKey) {
  try {
    const value = JSON.parse(process.env[envKey] || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function subgraphFor(graph, touchedElements, touchedRelationships) {
  const relationships = graph.relationships || [];
  const touchedRelIds = new Set(touchedRelationships);
  // seeds = touched elements + endpoints of touched relationships (frozen; no transitive expansion)
  const seeds = new Set(touchedElements);
  for (const rel of relationships) {
    if (touchedRelIds.has(rel.id)) {
      seeds.add(rel.source_id);
      seeds.add(rel.target_id);
    }
  }
  // include every edge incident to a seed (needed for functional/domain checks),
  // and their endpoints, so the subgraph is self-contained.
  const elementIds = new Set(seeds);
  const relationshipIds = new Set();
  for (const rel of relationships) {
    if (seeds.has(rel.source_id) || seeds.has(rel.target_id)) {
      relationshipIds.add(rel.id);
      elementIds.add(rel.source_id);
      elementIds.add(rel.target_id);
    }
  }
  return {
    ...graph,
    elements: (graph.elements || []).filter((element) => elementIds.has(element.id)),
    relationships: relationships.filter((rel) => relationshipIds.has(rel.id)),
    views: [],
  };
}

function emit(errors, warnings) {
  process.stdout.write(JSON.stringify({ errors, warnings }));
}

// The sidecar (this CLI + the Python engine) reads its bundle from a directory.
// For an `extends` bundle the effective rules live in the CHAIN-MERGED bundle,
// not the child dir: the base dir holds the endpoint matrix / type metadata, so
// reading the raw child dir would silently empty the matrix and disable endpoint
// validation. Materialize the merged rules/config (plus the sidecar-only axioms
// file and the structural schema when present) into a temp dir the engines read.
function materializeResolvedBundle(bundle) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-ontology-bundle-'));
  fs.writeFileSync(path.join(dir, 'schema-bundle.rules.json'), JSON.stringify(bundle.rules || {}));
  fs.writeFileSync(path.join(dir, 'schema-bundle.config.json'), JSON.stringify(bundle.config || {}));
  for (const name of ['ontology-axioms.json', 'SystemArchitecture.schema.json']) {
    const source = path.join(bundle.dir, name);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(dir, name));
    }
  }
  return dir;
}

function main() {
  const workspaceRoot = path.resolve(arg('workspace', process.cwd()));
  const mode = arg('mode', 'write');
  const engine = arg('engine', process.env.ARGO_ONTOLOGY_ENGINE || 'real');
  const scope = arg('scope', mode === 'write' ? 'delta' : 'whole');
  const graphPath = arg('graph', path.join('design', 'KG', 'SystemArchitecture.json'));
  // A write passes the post-mutation document via ARGO_VALIDATION_GRAPH_FILE
  // (the on-disk graph is not updated yet); otherwise read the file.
  const graphFile = (process.env.ARGO_VALIDATION_GRAPH_FILE && process.env.ARGO_VALIDATION_GRAPH_FILE.trim())
    ? process.env.ARGO_VALIDATION_GRAPH_FILE
    : path.join(workspaceRoot, graphPath);

  const errors = [];
  const warnings = [];

  let bundleDir;
  try {
    const { bundle } = require('../schema-bundle.js').loadSchemaBundleAndOntology(workspaceRoot);
    bundleDir = materializeResolvedBundle(bundle);
  } catch (error) {
    errors.push(`ontology validator failed (no resolvable schema bundle): ${error.message}`);
    emit(errors, warnings);
    return;
  }

  let model;
  let graph;
  try {
    model = loadModel(bundleDir);
    graph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
  } catch (error) {
    errors.push(`ontology validator failed: ${error.message}`);
    emit(errors, warnings);
    return;
  }

  let effective = graph;
  let scopedTo = 'whole';
  if (scope === 'delta') {
    const touchedElements = parseTouched('ARGO_VALIDATION_TOUCHED_ELEMENTS');
    const touchedRelationships = parseTouched('ARGO_VALIDATION_TOUCHED_RELATIONSHIPS');
    if (touchedElements.length || touchedRelationships.length) {
      effective = subgraphFor(graph, touchedElements, touchedRelationships);
      scopedTo = `delta(${effective.elements.length}e/${effective.relationships.length}r)`;
    }
  }

  if (engine === 'deterministic') {
    const result = validateGraph(model, effective);
    for (const violation of result.shacl.violations) errors.push(`SHACL: ${violation.message}`);
    for (const inconsistency of result.owl.inconsistencies) errors.push(`OWL: ${inconsistency.message}`);
    emit(errors, warnings);
    return;
  }

  // real engine (pySHACL + owlready2 / HermiT), over the (possibly scoped) graph
  const effectiveFile = path.join(os.tmpdir(), `argo-ontology-graph-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(effectiveFile, JSON.stringify(effective));
  const outFile = path.join(os.tmpdir(), `argo-ontology-out-${process.pid}-${Date.now()}.json`);
  const python = process.env.ARGO_ONTOLOGY_PYTHON || 'python3';
  const proc = spawnSync(
    python,
    [path.join(__dirname, 'python', 'validate_ontology.py'), '--bundle', bundleDir, '--graph', effectiveFile, '--out', outFile],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 },
  );
  if (proc.error || proc.status !== 0) {
    errors.push(
      `ontology real engine unavailable (${python}): ${
        (proc.error && proc.error.message) || String(proc.stderr || '').slice(0, 300)
      }`,
    );
    emit(errors, warnings);
    return;
  }

  let findings = {};
  try {
    findings = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (error) {
    errors.push(`ontology engine output unreadable: ${error.message}`);
    emit(errors, warnings);
    return;
  }
  const shacl = findings.shacl || {};
  const owl = findings.owl || {};
  if (shacl.error) errors.push(`SHACL engine error: ${shacl.error}`);
  for (const violation of shacl.violations || []) errors.push(`SHACL: ${violation.message || violation.focusNode}`);
  if (owl.error) errors.push(`OWL engine error: ${owl.error}`);
  if (owl.consistent === false) {
    errors.push(`OWL: graph is inconsistent (${(owl.inconsistentClasses || []).join(', ') || 'ontology-level'})`);
  }
  emit(errors, warnings);
}

main();
