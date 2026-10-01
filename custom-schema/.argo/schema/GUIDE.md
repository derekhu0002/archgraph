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

## Example viewpoints

- **Organization view** — one view per team, containing its `Team Node`, its
  `Agent Node`s, the `Service Node`s it depends on, and the relating edges.
- **Dependency view** — a `Service Node` and its upstream `Service Node`s.

## How to activate

```bash
cp -r custom-schema/.argo <your-repo>/.argo     # Windows: Copy-Item -Recurse
# then edit/keep design/KG/SystemArchitecture.json using these types
```

Verify from the MCP: `queryNeo4jGraph { "schema": true }` reports
`schemaLanguage: "Team Graph"`, the enums, `actorElementType: "Agent Node"`,
and `bundleValidation.status: "passed"`.
