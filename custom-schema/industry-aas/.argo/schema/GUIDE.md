# Industry 4.0 AAS — custom modeling language (schema bundle)

This bundle replaces the default ArchiMate 3.2 (+ ARGO) schema for **one
repository only**: any workspace that has this directory at
`<workspace>/.argo/schema/`.

It is an Asset Administration Shell ontology **inspired by IEC 63278 / RAMI 4.0**:
an `Asset Administrator` administers the `Administration Shell` of an `Asset`,
the shell `Contains` submodels and submodel elements, and assets provide
`Capability`s that `Operation`s realize.

## Element types

| Type | Layer | Aspect | Notes |
| --- | --- | --- | --- |
| `Asset Administrator` | Technology | Active Structure | **Actor element type** — an entity that administers a shell. |
| `Administration Shell` | Technology | Active Structure | the digital shell representing an asset. |
| `Asset` | Technology | Passive Structure | a physical / logical asset. |
| `Submodel` | Technology | Passive Structure | e.g. Nameplate, TechnicalData. |
| `Submodel Element` | Technology | Passive Structure | a property / collection / operation. |
| `Capability` | Technology | Behavior | a capability an asset provides. |
| `Operation` | Technology | Behavior | an invocable operation. |

## Relationship types

| Type | Category | Legal endpoints (source → allowed targets) |
| --- | --- | --- |
| `Administers` | Assignment | `Asset Administrator → Administration Shell` |
| `Represents` | Association | `Administration Shell → Asset` |
| `Contains` | Composition | `Administration Shell → Submodel`; `Submodel → Submodel Element` |
| `Provides Capability` | Assignment | `Asset → Capability` |
| `Realizes` | Realization | `Operation → Capability` |
| `Requires` | Dependency | `Capability → Capability` |

## Invariants

- `statementGrammar: true` — every relationship statement must be `<source> --(<type>)--> <target>`.
- `endpointMatrix: true` — endpoints are checked against the matrix in `schema-bundle.rules.json`.
- `rootViewName: "SystemArchitecture"` — exactly one top-level view with that name.
- `maxElementsPerView: 15` — per-view element limit.

## Axioms / logical constraints (optional)

`ontology-axioms.json` declares the **logical** layer the endpoint matrix cannot
express; it is read by the **ontology-validation engine** (ignored by the core):

- `disjointClasses` — shell / asset / submodel / capability / operation are mutually exclusive;
- `functionalProperties: ["Represents"]` — a shell represents at most one asset;
- `transitiveProperties: ["Contains"]` — containment is transitive;
- `objectPropertyDomain` / `objectPropertyRange` for `Administers`;
- `distinctIndividuals: true` — so a functional-property conflict is detectable.

Enable the engine with `argo-deploy -EnableOntologyValidation` (opt-in; fail-close — a configured-but-unavailable engine is a blocking error, not a silent pass).
Full reference — every layer: [docs/ontology-authoring.md](../../../docs/ontology-authoring.md).

## Example viewpoints

- **Asset view** — one `Administration Shell`, the `Asset` it represents, and the
  `Submodel`s it contains.
- **Capability view** — an `Asset`, its `Capability`s, and the `Operation`s that realize them.

## How to activate

```bash
# copy only the schema bundle (not .argo/temp/ runtime files)
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/industry-aas/.argo/schema/.  <your-repo>/.argo/schema   # Windows: New-Item -Force the dir, then Copy-Item -Recurse -Force
# then create design/KG/SystemArchitecture.json yourself using these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

Verify from the MCP: `queryNeo4jGraph { "schema": true }` reports
`schemaLanguage: "Industry 4.0 AAS"`, the enums, `actorElementType: "Asset Administrator"`,
and `bundleValidation.status: "passed"`.
