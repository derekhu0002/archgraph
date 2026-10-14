# Authoring an ontology (schema bundle) — reference

A repository defines its modeling language by dropping a **schema bundle** under
`<workspace>/.argo/schema/`. Everything the framework reads about your ontology
lives there, in **four layers** (+ an optional human guide). This page is the
author's reference; the runnable examples are catalogued in [`custom-schema/README.md`](../custom-schema/README.md).

| Layer | File | Answers |
|---|---|---|
| Types | `SystemArchitecture.schema.json` | *What element / relationship types exist?* |
| Relationship structure | `schema-bundle.rules.json` | *Which types may connect to which?* |
| Axioms / logical constraints | `ontology-axioms.json` | *What is logically impossible / entailed?* |
| Descriptor | `schema-bundle.config.json` | *Language, extends, actor, invariants.* |
| Human guide | `GUIDE.md` | *Prose for humans.* |

## 1. Types — `SystemArchitecture.schema.json`
The JSON Schema of the graph document. Your vocabulary is its two enums:
`$defs.archimateElementType` (element types) and `$defs.archimateRelationshipType`
(relationship types). Copy the default and edit the two arrays.

## 2. Relationship structure — `schema-bundle.rules.json`
- `elementTypeMetadata` — per type `{ "layer", "aspect" }` (classification).
- `relationshipCategoryByType` — per relationship type a category.
- **`relationshipTargetMatrix`** — the **endpoint rules**:
  `{ "<RelType>": { "<SourceType>": ["<allowedTargetType>", ...] } }`.
  A source type with no entry is **unconstrained**. This is the constraint the
  framework enforces on every write (as SHACL when the ontology engine is on).

## 3. Axioms / logical constraints — `ontology-axioms.json` (optional)
`types + endpoint matrix` are a **closed-world structural** check. To catch
**logical contradictions** and to declare **inference**, add an
`ontology-axioms.json` next to the bundle files (read by the ontology engine;
ignored by the core):

| Key | Form | Meaning (OWL / RDFS) |
|---|---|---|
| `disjointClasses` | `[["A","B"], ...]` | A can't be both A and B (`disjointWith`) |
| `functionalProperties` | `["Rel", ...]` | at most one target per source (`FunctionalProperty`) |
| `transitiveProperties` | `["Rel", ...]` | closure is entailed (`TransitiveProperty`) |
| `irreflexiveProperties` | `["Rel", ...]` | no self-edges (`IrreflexiveProperty`) |
| `asymmetricProperties` | `["Rel", ...]` | no 2-cycles (`AsymmetricProperty`) |
| `objectPropertyDomain` | `{ "Rel": "Type" }` | source is inferred to be `Type` (rdfs `domain`) |
| `objectPropertyRange` | `{ "Rel": "Type" }` | target is inferred to be `Type` (rdfs `range`) |
| `distinctIndividuals` | `true` | individuals are pairwise different (needed to detect functional conflicts) |

Example:
```json
{
  "disjointClasses": [["Team Node", "Service Node"], ["Agent Node", "Team Node"]],
  "functionalProperties": ["Assigned To"],
  "transitiveProperties": ["Depends On"],
  "objectPropertyDomain": { "Assigned To": "Agent Node" },
  "objectPropertyRange": { "Assigned To": "Team Node" },
  "distinctIndividuals": true
}
```
> OWL 2 DL caveat: a **transitive** (non-simple) property may **not** be used in
> `irreflexiveProperties` / `asymmetricProperties` / disjoint-property axioms —
> the engine will reject such a combination (as it should).

## 4. Descriptor — `schema-bundle.config.json`
| Field | Meaning |
|---|---|
| `language` | display name used in validation messages |
| `extends` | `"default"` (inherit the built-in **ArchiMate 3.2 + ARGO extensions**) or a bundle path; omit for a standalone bundle |
| `actorElementType` | the type the wakeup gate uses to identify an agent — **required for a standalone bundle** (one of your types, or `null` if none) |
| `guide` / `rules` | paths to the human guide / rules file |
| `deliveryDependencies` | which relationship types express delivery ordering |
| `invariants` | `statementGrammar`, `endpointMatrix`, `rootViewName`, `maxElementsPerView` |

## How it is used
- **Always on (core)**: types, endpoint matrix, statement grammar, view limits, bundle validation (`bundleValidation.status`).
- **Opt-in (ontology engine)**: the axioms — checked at **write** (the change's delta) and **init** (the whole graph) by **pySHACL + owlready2/HermiT**. Enable with `argo-deploy -EnableOntologyValidation` (see [EXTENSION_PROTOCOL.md](../argo/scripts/ontology-projection/EXTENSION_PROTOCOL.md)); off by default; **fail-close** (a configured engine that is unavailable is a blocking error, not a silent pass).

## Minimal template for a new project
```
<your-repo>/.argo/schema/
  SystemArchitecture.schema.json    # types (edit the two enums)
  schema-bundle.config.json         # language + actorElementType (+ extends)
  schema-bundle.rules.json          # elementTypeMetadata + relationshipTargetMatrix
  ontology-axioms.json              # optional: disjoint / functional / transitive / domain-range
  GUIDE.md                          # optional: human-readable
<your-repo>/design/KG/SystemArchitecture.json   # you author it (a custom schema fails closed without it)
```

Runnable references: the prebuilt bundles under [`custom-schema/`](../custom-schema/README.md)
(Team Graph, Finance CDM, Industry 4.0 AAS, STIX Threat Intelligence, UML 2, SysML)
and the ontology-engine samples (Team Graph + PROV-O) under
[`sandbox/ontology-projection/samples/`](../sandbox/ontology-projection/samples/).
