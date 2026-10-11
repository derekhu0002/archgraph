'use strict';

// AT-1..AT-8 — executable acceptance tests for the ontology-projection sidecar.
// Run: node --test sandbox/ontology-projection/tests/at.test.js   (repo root)
//
// These are intentionally NOT wired into the repo's `npm test` (tests/*.test.js)
// so the sidecar stays isolated from the current project.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  loadModel,
  projectGraph,
  projectHash,
  buildShapes,
  buildOwlTriples,
  entailedTransitive,
  validateGraph,
} = require('../lib/validate.js');

const ROOT = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const REPO = path.resolve(ROOT, '..', '..');
const TG = path.join(SAMPLES, 'team-graph');
const PO = path.join(SAMPLES, 'prov-o');

function model(dir) {
  return loadModel(path.join(dir, '.argo', 'schema'));
}

function graph(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'graphs', name), 'utf8'));
}

function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function dirManifest(dir) {
  const manifest = {};
  for (const p of walk(dir).sort()) manifest[path.relative(dir, p)] = hashFile(p);
  return manifest;
}

test('AT-1 GIVEN the valid samples (Team Graph + PROV-O) WHEN validated THEN zero SHACL violations', () => {
  for (const [dir, name] of [[TG, 'valid.json'], [PO, 'valid.json']]) {
    const result = validateGraph(model(dir), graph(dir, name));
    assert.equal(result.shacl.violations.length, 0, JSON.stringify(result.shacl.violations));
  }
});

test('AT-2 GIVEN an endpoint violation WHEN validated THEN the exact relationship is reported', () => {
  const tg = validateGraph(model(TG), graph(TG, 'endpoint-violation.json'));
  assert.ok(tg.shacl.violations.length >= 1, 'expected a Team Graph endpoint violation');
  assert.ok(
    tg.shacl.violations.some((v) => v.relationshipId === 'rel-3' && v.code === 'SHACL_ENDPOINT'),
    JSON.stringify(tg.shacl.violations),
  );

  const po = validateGraph(model(PO), graph(PO, 'endpoint-violation.json'));
  assert.ok(
    po.shacl.violations.some((v) => v.relationshipId === 'rel-4' && v.code === 'SHACL_ENDPOINT'),
    JSON.stringify(po.shacl.violations),
  );
});

test('AT-3 GIVEN a standard ontology (PROV-O) + Team Graph consistent samples WHEN validated THEN zero inconsistencies', () => {
  for (const [dir, name] of [[TG, 'valid.json'], [PO, 'valid.json']]) {
    const result = validateGraph(model(dir), graph(dir, name));
    assert.equal(result.owl.inconsistencies.length, 0, JSON.stringify(result.owl.inconsistencies));
  }
});

test('AT-4 GIVEN an axiom contradiction WHEN validated THEN functional + disjoint inconsistencies, still no SHACL violation', () => {
  const result = validateGraph(model(TG), graph(TG, 'axiom-contradiction.json'));
  const codes = result.owl.inconsistencies.map((i) => i.code);
  assert.ok(codes.includes('OWL_FUNCTIONAL'), JSON.stringify(codes));
  assert.ok(codes.includes('OWL_DISJOINT'), JSON.stringify(codes));
  assert.equal(result.shacl.violations.length, 0, 'this sample passes the endpoint matrix');
});

test('AT-5 GIVEN a 2-hop Depends On chain WHEN reasoned THEN the transitive edge is entailed (multi-hop implied knowledge)', () => {
  const result = validateGraph(model(TG), graph(TG, 'multihop-entailment.json'));
  assert.equal(result.shacl.violations.length, 0, 'the chain is consistent');
  assert.equal(result.owl.inconsistencies.length, 0, 'the chain is consistent');
  const entailed = entailedTransitive(model(TG), graph(TG, 'multihop-entailment.json'));
  assert.ok(
    entailed.some((e) => e.property === 'Depends On' && e.source === 'team-a' && e.target === 'team-c'),
    JSON.stringify(entailed),
  );
});

test('AT-6 GIVEN validation runs WHEN they finish THEN the canonical JSON bytes are unchanged (derived, not written back)', () => {
  const cases = [[TG, 'valid.json'], [TG, 'axiom-contradiction.json'], [PO, 'valid.json']];
  for (const [dir, name] of cases) {
    const file = path.join(dir, 'graphs', name);
    const before = hashFile(file);
    validateGraph(model(dir), graph(dir, name));
    assert.equal(hashFile(file), before, `${file} must be byte-identical after validation`);
  }
});

test('AT-7 GIVEN the projector WHEN it runs twice THEN output is identical (idempotent)', () => {
  for (const [dir, name] of [[TG, 'valid.json'], [PO, 'valid.json']]) {
    const g = graph(dir, name);
    assert.equal(projectGraph(g), projectGraph(g));
    assert.equal(projectHash(g), projectHash(g));
  }
});

test('AT-8 GIVEN all samples are validated WHEN runs complete THEN archgraph graph + sample files are untouched (isolation)', () => {
  const archgraphGraph = path.join(REPO, 'design', 'KG', 'SystemArchitecture.json');
  const beforeArchgraph = fs.existsSync(archgraphGraph) ? hashFile(archgraphGraph) : null;
  const beforeSamples = dirManifest(SAMPLES);

  for (const dir of [TG, PO]) {
    for (const name of fs.readdirSync(path.join(dir, 'graphs'))) {
      validateGraph(model(dir), graph(dir, name));
    }
  }

  if (beforeArchgraph !== null) {
    assert.equal(hashFile(archgraphGraph), beforeArchgraph, 'archgraph graph must be untouched');
  }
  assert.deepEqual(dirManifest(SAMPLES), beforeSamples, 'sample files must be untouched');
});

test('AT-0 sanity: SHACL shapes + OWL axioms are generated as artifacts', () => {
  const shapes = buildShapes(model(TG));
  assert.match(shapes, /sh:NodeShape/);
  assert.match(shapes, /sh:targetClass/);
  const owl = buildOwlTriples(model(TG));
  assert.match(owl, /owl#disjointWith/);
  assert.match(owl, /FunctionalProperty/);
});
