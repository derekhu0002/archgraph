# Team Graph — custom modeling language (schema bundle)

This bundle replaces the default ArchiMate 3.2 (+ ARGO) schema for
**one repository only**: any workspace that has this directory at
`<workspace>/.argo/schema/`.

## Element types

| Type | Layer | Aspect | Notes |
| --- | --- | --- | --- |
| `Agent Node` | Organization | Active Structure | **Actor element type** — the ARGO wakeup gate looks up elements of this type to identify the agent. |
| `Team Node` | Organization | Active Structure | A team of agents. |
| `Service Node` | Organization | Behavior | A capability/service a team depends on. |

## Relationship types

| Type | Category | Legal endpoints (source → allowed targets) |
| --- | --- | --- |
| `Assigned To` | Assignment | `Agent Node → Team Node`; `Team Node → Agent Node` |
| `Depends On` | Dependency | `Team Node → {Service Node, Team Node}`; `Service Node → Service Node`; `Agent Node → {Team Node, Service Node}` |

## Invariants

- `statementGrammar: true` — every relationship statement must be `<source> --(<type>)--> <target>`.
- `endpointMatrix: true` — endpoints are checked against the matrix in `schema-bundle.rules.json`.
- `rootViewName: "SystemArchitecture"` — exactly one top-level view with that name.
- `maxElementsPerView: 12` — per-view element limit.

## Axioms / logical constraints (optional)

`ontology-axioms.json` declares the **logical** layer the endpoint matrix cannot
express; it is read by the **ontology-validation engine** (ignored by the core),
which catches contradictions at write (delta) and init (whole graph). This bundle
declares:

- `disjointClasses` — `Team Node` / `Service Node` / `Agent Node` are mutually exclusive;
- `functionalProperties: ["Assigned To"]` — an `Agent Node` is assigned to at most one team;
- `transitiveProperties: ["Depends On"]` — dependency is transitive (closure is entailed);
- `objectPropertyDomain` / `objectPropertyRange` for `Assigned To`;
- `distinctIndividuals: true` — so a functional-property conflict is detectable.

Enable the engine with `argo-deploy -EnableOntologyValidation` (opt-in, fail-open).
Full reference — every layer: [docs/ontology-authoring.md](../../../docs/ontology-authoring.md).

## Example viewpoints

- **Organization view** — one view per team, containing its `Team Node`, its
  `Agent Node`s, the `Service Node`s it depends on, and the relating edges.
- **Dependency view** — a `Service Node` and its upstream `Service Node`s.

## How to activate

```bash
# copy only the schema bundle (not .argo/temp/ runtime files)
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/.argo/schema/.  <your-repo>/.argo/schema   # Windows: New-Item -Force the dir, then Copy-Item -Recurse -Force
# then create design/KG/SystemArchitecture.json yourself using these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo init will NOT create the graph)
```

Verify from the MCP: `queryNeo4jGraph { "schema": true }` reports
`schemaLanguage: "Team Graph"`, the enums, `actorElementType: "Agent Node"`,
and `bundleValidation.status: "passed"`.
