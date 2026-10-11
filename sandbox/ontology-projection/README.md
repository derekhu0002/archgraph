# `sandbox/ontology-projection/` — ontology axiom/constraint validation (extension-only)

An **isolated, additive** sidecar that projects a canonical ArchGraph graph
(`design/KG/SystemArchitecture.json`) to RDF and validates it with two engines:

- **SHACL** — closed-world **constraints** (the bundle's endpoint matrix, 1:1).
- **OWL** — logical **axioms** the current bundle format does not carry
  (disjointness, functional / transitive / irreflexive properties, rdfs
  domain/range-as-inference), plus a minimal consistency check.

It never modifies the framework, the existing bundles, the archgraph graph, or
the existing tests. Everything here is new files.

## Why two engines (do not conflate)

- The bundle endpoint matrix is a **constraint** (closed world) → **SHACL**.
- OWL `domain/range` is an **inference rule** (open world), *not* a constraint.
  Projecting the matrix as OWL domain/range would produce inference, not
  validation. Hence: matrix → SHACL; new axioms → OWL.

## Layout

```
sandbox/ontology-projection/
  lib/            model.js  project.js  rdf.js  shapes.js  owl.js  validate.js
  samples/
    team-graph/   .argo/schema/{schema-bundle.config, schema-bundle.rules, ontology-axioms}.json
                  graphs/{valid, endpoint-violation, axiom-contradiction, multihop-contradiction}.json
    prov-o/       .argo/schema/{schema-bundle.config, schema-bundle.rules, ontology-axioms}.json
                  graphs/{valid, endpoint-violation}.json
  tests/at.test.js   AT-1..AT-8
  run.js             Docker entrypoint (creates /test-project, validates, report)
  Dockerfile         FROM opencode-sandbox
```

- `ontology-axioms.json` is **sidecar-only and additive**: the framework bundle is
  read as-is; the new axiom declarations live in this extra file.
- The sidecar is **read-only** w.r.t. canonical JSON: findings are a derived
  read-model; nothing is written back.
- This whole directory is **excluded from the repo's `npm test`** (only
  `tests/*.test.js` at the repo root run) so it stays isolated from the project.

## Run

```bash
# unit ATs (repo root)
node --test sandbox/ontology-projection/tests/at.test.js

# sidecar entry (creates an isolated test project + report)
TEST_PROJECT=/tmp/op-test RESULTS_DIR=/tmp/op-results node sandbox/ontology-projection/run.js

# isolated Docker verification (base = opencode-sandbox)
docker build -t archgraph-ontology-projection sandbox/ontology-projection
docker run --rm -v "<repo>:/repo:ro" -v "<repo>/results:/results" archgraph-ontology-projection
```

## Acceptance tests

| AT | What it proves |
|---|---|
| AT-1 | valid samples (Team Graph + PROV-O) → zero SHACL violations |
| AT-2 | endpoint violations reported precisely, with relationship id |
| AT-3 | a W3C standard ontology (PROV-O) stays consistent |
| AT-4 | functional + disjoint inconsistencies (invisible to SHACL) |
| AT-5 | a 2-hop cycle → irreflexive inconsistency derived via transitive closure (multi-hop) |
| AT-6 | canonical JSON bytes unchanged (derived, never written back) |
| AT-7 | projection is idempotent |
| AT-8 | archgraph graph + sample files untouched (isolation) |

## Status / swap-in point

`lib/owl.js` `checkConsistency` and `lib/shapes.js` `checkEndpoints` are a
dependency-free **skeleton engine** for the deterministic subset. The generated
SHACL (`buildShapes`) and OWL (`buildOwlTriples`) are real artifacts; a full
engine (pySHACL / Jena for SHACL, ELK / HermiT for OWL) can replace the two
check functions behind the same interface without changing samples or ATs.
