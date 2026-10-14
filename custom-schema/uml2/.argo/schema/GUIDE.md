# UML 2 — custom modeling language (schema bundle)

This bundle replaces the default ArchiMate 3.2 (+ ARGO) schema for **one
repository only**: any workspace that has this directory at
`<workspace>/.argo/schema/`.

It is a compact **UML 2 core** ontology: structural classifiers and their
relationships, use cases, and a state machine — so a software model can be kept
as a validated, traceable intent graph rather than a set of diagrams.

## Element types

| Type | Layer | Aspect | Notes |
| --- | --- | --- | --- |
| `Class` | UML Structure | Passive Structure | A classifier. |
| `Interface` | UML Structure | Passive Structure | A provided/required interface. |
| `Enumeration` | UML Structure | Passive Structure | An enumeration. |
| `Data Type` | UML Structure | Passive Structure | A data type. |
| `Package` | UML Structure | Passive Structure | A namespace. |
| `Component` | UML Structure | Active Structure | A modular unit. |
| `Actor` | UML Structure | Active Structure | **Actor element type** — an external actor. |
| `Use Case` | UML Behavior | Behavior | A unit of functionality. |
| `State` | UML Behavior | Behavior | A state. |
| `Initial State` | UML Behavior | Behavior | Initial pseudostate. |
| `Final State` | UML Behavior | Behavior | Final state. |
| `Composite State` | UML Behavior | Behavior | A state containing sub-states. |
| `Choice` | UML Behavior | Behavior | Choice pseudostate. |
| `Activity` | UML Behavior | Behavior | An activity. |
| `Action` | UML Behavior | Behavior | An action within an activity. |

## Relationship types

| Type | Category | Legal endpoints (source → allowed targets) |
| --- | --- | --- |
| `Generalization` | Structural | same-type classifier → same-type classifier (`Class`, `Interface`, `Enumeration`, `Data Type`, `Component`, `Use Case`, `Actor`, `Package`) |
| `Realization` | Structural | `Class → Interface`; `Component → Interface` |
| `Association` | Structural | `Class → Class`; `Actor ↔ Use Case`; `Component → Component`; `Package → Package` |
| `Aggregation` | Structural | `Class → Class` |
| `Composition` | Structural | `Class → Class`; `Composite State → {State, Composite State, Initial State, Final State}` |
| `Dependency` | Dependency | `Class → {Class, Interface}`; `Interface → Class`; `Package → Package`; `Component → {Component, Interface}`; `Use Case → Use Case` |
| `Transition` | Dynamic | between `State` / `Initial State` / `Choice` / `Composite State` / `Final State` |
| `Include` | Behavioral | `Use Case → Use Case` |
| `Extend` | Behavioral | `Use Case → Use Case` |
| `Control Flow` | Dynamic | `Action → Action` |

## Invariants

- `statementGrammar: true` — every relationship statement must be `<source> --(<type>)--> <target>`.
- `endpointMatrix: true` — endpoints are checked against the matrix in `schema-bundle.rules.json`.
- `rootViewName: "SystemArchitecture"` — exactly one top-level view with that name.
- `maxElementsPerView: 15` — per-view element limit.

## Axioms / logical constraints (optional)

`ontology-axioms.json` declares the **logical** layer the endpoint matrix cannot
express; it is read by the **ontology-validation engine** (ignored by the core):

- `disjointClasses` — e.g. `Class`/`Interface`, `State`/`Activity`, `Actor`/`Use Case` are mutually exclusive;
- `transitiveProperties: ["Generalization"]` — generalization is transitive;
- `objectPropertyDomain` / `objectPropertyRange` for `Realization`;
- `distinctIndividuals: true` — so a functional-property conflict is detectable.

Enable the engine with `argo-deploy -EnableOntologyValidation` (opt-in; fail-close — a configured-but-unavailable engine is a blocking error, not a silent pass).
Full reference — every layer: [docs/ontology-authoring.md](../../../docs/ontology-authoring.md).

## Example viewpoints

- **Use-case view** — an `Actor`, the `Use Case`s it participates in, and their `Include`/`Extend` relations.
- **Class view** — `Class`es, their `Association`/`Aggregation`/`Composition`, and `Realization` of an `Interface`.
- **State-machine view** — `Initial State` → `State` → … → `Final State` via `Transition`.

## How to activate

```bash
# copy only the schema bundle (not .argo/temp/ runtime files)
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/uml2/.argo/schema/.  <your-repo>/.argo/schema   # Windows: New-Item -Force the dir, then Copy-Item -Recurse -Force
# then create design/KG/SystemArchitecture.json yourself using these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

Verify from the MCP: `queryNeo4jGraph { "schema": true }` reports
`schemaLanguage: "UML 2"`, the enums, `actorElementType: "Actor"`,
and `bundleValidation.status: "passed"`.
