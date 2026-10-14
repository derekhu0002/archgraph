# SysML — custom modeling language (schema bundle)

This bundle replaces the default ArchiMate 3.2 (+ ARGO) schema for **one
repository only**: any workspace that has this directory at
`<workspace>/.argo/schema/`.

It is a compact **SysML** ontology: blocks, value types and ports, requirements
with derivation/traceability, verification by test cases, and allocation of
behavior to structure — so a systems-engineering model is a validated,
traceable intent graph.

## Element types

| Type | Layer | Aspect | Notes |
| --- | --- | --- | --- |
| `Block` | SysML Structure | Passive Structure | The core structural element. |
| `Actor` | SysML Structure | Active Structure | **Actor element type** — an external actor. |
| `Value Type` | SysML Structure | Passive Structure | A value type. |
| `Interface Block` | SysML Structure | Active Structure | A block that provides ports/flows. |
| `Constraint Block` | SysML Structure | Passive Structure | A parametric constraint. |
| `Requirement` | Requirement | Passive Structure | A requirement. |
| `Test Case` | Verification | Behavior | A verification test case. |
| `Activity` | SysML Behavior | Behavior | An activity. |
| `Action` | SysML Behavior | Behavior | An action. |
| `State` | SysML Behavior | Behavior | A state. |
| `Port` | SysML Structure | Passive Structure | An interaction point. |
| `Package` | SysML Structure | Passive Structure | A namespace. |

## Relationship types

| Type | Category | Legal endpoints (source → allowed targets) |
| --- | --- | --- |
| `Generalization` | Structural | same-type: `Block`, `Requirement`, `Value Type`, `Constraint Block` |
| `Association` | Structural | `Block → {Block, Value Type}`; `Actor → Block` |
| `Composition` | Structural | `Block → Block` |
| `Aggregation` | Structural | `Block → Block` |
| `Satisfy` | Verification | `Block / Interface Block → Requirement` |
| `Verify` | Verification | `Test Case → Requirement` |
| `Derive` | Requirement | `Requirement → Requirement` |
| `Refine` | Requirement | `Block / Requirement → Requirement` |
| `Trace` | Requirement | *(unconstrained)* |
| `Allocate` | Allocation | `Block → Activity`; `Activity / Action → Block` |
| `Binding Connector` | Parametric | `Constraint Block → Block`; `Block → Constraint Block` |
| `Item Flow` | Flow | `Port → Port` |

## Invariants

- `statementGrammar: true` — every relationship statement must be `<source> --(<type>)--> <target>`.
- `endpointMatrix: true` — endpoints are checked against the matrix in `schema-bundle.rules.json`.
- `rootViewName: "SystemArchitecture"` — exactly one top-level view with that name.
- `maxElementsPerView: 15` — per-view element limit.

## Axioms / logical constraints (optional)

`ontology-axioms.json` declares the **logical** layer the endpoint matrix cannot
express; it is read by the **ontology-validation engine** (ignored by the core):

- `disjointClasses` — e.g. `Block`/`Requirement`, `Requirement`/`Test Case`, `Activity`/`State` are mutually exclusive;
- `transitiveProperties: ["Generalization", "Derive"]` — generalization and requirement derivation are transitive;
- `objectPropertyDomain` / `objectPropertyRange` for `Satisfy`;
- `distinctIndividuals: true` — so a functional-property conflict is detectable.

Enable the engine with `argo-deploy -EnableOntologyValidation` (opt-in; fail-close — a configured-but-unavailable engine is a blocking error, not a silent pass).
Full reference — every layer: [docs/ontology-authoring.md](../../../docs/ontology-authoring.md).

## Example viewpoints

- **Requirement view** — a `Requirement`, its derived children (`Derive`), the `Block`s that `Satisfy` it and the `Test Case`s that `Verify` it.
- **Structure view** — a `Block`, its part `Block`s (`Composition`), value types and `Port`s (`Item Flow`).
- **Allocation view** — `Block` ↔ `Activity` / `Action` allocation.

## How to activate

```bash
# copy only the schema bundle (not .argo/temp/ runtime files)
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/sysml/.argo/schema/.  <your-repo>/.argo/schema   # Windows: New-Item -Force the dir, then Copy-Item -Recurse -Force
# then create design/KG/SystemArchitecture.json yourself using these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

Verify from the MCP: `queryNeo4jGraph { "schema": true }` reports
`schemaLanguage: "SysML"`, the enums, `actorElementType: "Actor"`,
and `bundleValidation.status: "passed"`.
