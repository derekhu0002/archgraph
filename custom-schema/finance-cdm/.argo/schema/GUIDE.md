# Finance CDM — custom modeling language (schema bundle)

This bundle replaces the default ArchiMate 3.2 (+ ARGO) schema for **one
repository only**: any workspace that has this directory at
`<workspace>/.argo/schema/`.

It is a compact financial-contract ontology **inspired by the ISDA Common Domain
Model (CDM)**: parties enter into contracts, contracts are governed by legal
agreements and based on products, a contract's lifecycle events trigger
cashflows, and cashflows are observed against market data observations.

## Element types

| Type | Layer | Aspect | Notes |
| --- | --- | --- | --- |
| `Party` | Business | Active Structure | **Actor element type** — a legal entity that enters into contracts. |
| `Legal Agreement` | Business | Passive Structure | e.g. an ISDA Master Agreement. |
| `Product` | Business | Passive Structure | an economic product definition (e.g. a swap). |
| `Contract` | Business | Passive Structure | an executed agreement between parties. |
| `Lifecycle Event` | Business | Behavior | execution, novation, termination, … |
| `Cashflow` | Business | Behavior | a payment obligation produced by an event. |
| `Observation` | Technology | Passive Structure | a market data observation (e.g. a fixing). |

## Relationship types

| Type | Category | Legal endpoints (source → allowed targets) |
| --- | --- | --- |
| `Entered Into` | Association | `Party → Contract` |
| `Governed By` | Aggregation | `Contract → Legal Agreement` |
| `Based On` | Composition | `Contract → Product` |
| `Derived From` | Specialization | `Product → Product` |
| `Has Event` | Composition | `Contract → Lifecycle Event` |
| `Triggers` | Triggering | `Lifecycle Event → Cashflow` |
| `Payable To` | Flow | `Cashflow → Party` |
| `Observed By` | Access | `Cashflow → Observation` |

## Invariants

- `statementGrammar: true` — every relationship statement must be `<source> --(<type>)--> <target>`.
- `endpointMatrix: true` — endpoints are checked against the matrix in `schema-bundle.rules.json`.
- `rootViewName: "SystemArchitecture"` — exactly one top-level view with that name.
- `maxElementsPerView: 15` — per-view element limit.

## Axioms / logical constraints (optional)

`ontology-axioms.json` declares the **logical** layer the endpoint matrix cannot
express; it is read by the **ontology-validation engine** (ignored by the core):

- `disjointClasses` — the core classes are mutually exclusive;
- `functionalProperties: ["Governed By", "Based On", "Observed By"]` — a contract is governed by / based on at most one target, a cashflow is observed by at most one observation;
- `transitiveProperties: ["Derived From"]` — product lineage is transitive;
- `objectPropertyDomain` / `objectPropertyRange` for `Entered Into`;
- `distinctIndividuals: true` — so a functional-property conflict is detectable.

Enable the engine with `argo-deploy -EnableOntologyValidation` (opt-in; fail-close — a configured-but-unavailable engine is a blocking error, not a silent pass).
Full reference — every layer: [docs/ontology-authoring.md](../../../docs/ontology-authoring.md).

## Example viewpoints

- **Contract life-cycle view** — a `Contract`, the `Party`s that entered it, its
  governing `Legal Agreement`, the `Product` it is based on, its `Lifecycle Event`s
  and the `Cashflow`s they trigger.
- **Product lineage view** — a `Product` and its upstream `Product`s via `Derived From`.

## How to activate

```bash
# copy only the schema bundle (not .argo/temp/ runtime files)
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/finance-cdm/.argo/schema/.  <your-repo>/.argo/schema   # Windows: New-Item -Force the dir, then Copy-Item -Recurse -Force
# then create design/KG/SystemArchitecture.json yourself using these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

Verify from the MCP: `queryNeo4jGraph { "schema": true }` reports
`schemaLanguage: "Finance CDM"`, the enums, `actorElementType: "Party"`,
and `bundleValidation.status: "passed"`.
