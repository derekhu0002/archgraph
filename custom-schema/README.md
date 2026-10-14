# `custom-schema/` — prebuilt ontology bundles (schema-bundle catalog)

This directory is the **catalog of prebuilt ontologies** shipped with ArchGraph.
Each subdirectory is a complete, runnable **schema bundle**: a repository that
drops it under `<workspace>/.argo/schema/` gets validated against that ontology
instead of the default ArchiMate 3.2 (+ ARGO).

Pick one and use it as a starting point, or copy it and edit the two type enums
(`archimateElementType` / `archimateRelationshipType`) for your own domain. The
mechanism and every layer are documented in
[`docs/ontology-authoring.md`](../docs/ontology-authoring.md).

## Catalog

| Bundle | Language | Actor element type | Domain | Inspired by |
| --- | --- | --- | --- | --- |
| [`team-graph/`](team-graph/README.md) | Team Graph | `Agent Node` | Agents, teams and the services they depend on | — (canonical worked example) |
| [`finance-cdm/`](finance-cdm/README.md) | Finance CDM | `Party` | Financial contracts, their lifecycle events and cashflows | ISDA Common Domain Model (CDM) |
| [`industry-aas/`](industry-aas/README.md) | Industry 4.0 AAS | `Asset Administrator` | Assets, their administration shells and submodels | IEC 63278 Asset Administration Shell / RAMI 4.0 |
| [`threat-intel-stix/`](threat-intel-stix/README.md) | STIX Threat Intelligence | `Threat Actor` | Threat actors, campaigns, TTPs, indicators and mitigations | OASIS STIX 2.1 |
| [`uml2/`](uml2/README.md) | UML 2 | `Actor` | Software structure, use cases and state machines | OMG UML 2 |
| [`sysml/`](sysml/README.md) | SysML | `Actor` | Blocks, requirements, verification and allocation | OMG SysML |
| [`ipd/`](ipd/README.md) | IPD | `Role` | R&D IPD phases, gates, deliverables and the standards that govern them | PACE / Stage-Gate; ISO 15288 / 29148 / 26262 / APQP |
| [`math/`](math/README.md) | Mathematics | `Mathematician` | Mathematical knowledge, research and problem solving (concepts/theorems/proofs; problems/steps/skills; formal libraries/benchmarks) | OntoMathPRO / MaRDI; Mathlib + Lean |

Each bundle is self-contained:

```
custom-schema/<bundle>/
  README.md                                     # what the ontology models
  .argo/schema/SystemArchitecture.schema.json   # graph JSON Schema + type enums
  .argo/schema/schema-bundle.config.json        # bundle descriptor (language, actor)
  .argo/schema/schema-bundle.rules.json         # type metadata + endpoint matrix
  .argo/schema/ontology-axioms.json             # optional OWL/RDFS axioms
  .argo/schema/GUIDE.md                         # human-readable guide
  design/KG/SystemArchitecture.json             # example graph using the types
```

## Use a bundle in your repository

```bash
# copy only the schema bundle (never the whole .argo — it may carry temp/ runtime files)
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/<bundle>/.argo/schema/.  <your-repo>/.argo/schema
# Windows (PowerShell):
#   New-Item -ItemType Directory -Force <your-repo>/.argo/schema | Out-Null
#   Copy-Item -Recurse -Force custom-schema/<bundle>/.argo/schema/* <your-repo>/.argo/schema
# then author <your-repo>/design/KG/SystemArchitecture.json yourself
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

Verify from the MCP:

```
queryNeo4jGraph { "schema": true }
# -> schemaKind: "workspace", schemaLanguage: "<Language>",
#    actorElementType: "<Actor type>", bundleValidation: { status: "passed" }
```

## Bundle contract (recap)

| Field | Required | Meaning |
| --- | --- | --- |
| `SystemArchitecture.schema.json` | yes | Graph structure + the two type enums. |
| `schema-bundle.config.json` | yes | `language`, `actorElementType`, `rules`, `invariants`, `deliveryDependencies`. |
| `schema-bundle.rules.json` | no | `elementTypeMetadata`, `relationshipCategoryByType`, `relationshipTargetMatrix` (endpoint legality). |
| `ontology-axioms.json` | no | Axioms for the opt-in ontology engine (disjoint / functional / transitive / domain-range). |
| `GUIDE.md` | no | Prose for humans. |
| `<repo>/design/KG/SystemArchitecture.json` | **yes (you author it)** | A custom schema never inherits the packaged default graph. |

**Fail-closed bundle validation.** A standalone bundle must declare an
`actorElementType` that is one of its own element types (or explicitly `null`),
and its endpoint matrix may only reference known types; otherwise the bundle is
rejected and writes are blocked. This is how the ARGO wakeup gate always has an
Actor to identify under any ontology.

See [`team-graph/README.md`](team-graph/README.md) for the full worked contract
and [`docs/schema-bundle-decoupling.md`](../docs/schema-bundle-decoupling.md) for
the design and coupling inventory.
