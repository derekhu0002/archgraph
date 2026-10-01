# `custom-schema/` — recommended example of a repository-defined schema

This directory is a **complete, runnable example** of the ARGO schema-bundle
mechanism. A repository that ships its own modeling language puts it under
`<workspace>/.argo/schema/`; the ARGO MCP then validates that repository
against its own schema instead of the default ArchiMate 3.2 (+ ARGO).

The example is a small **Team Graph** ontology (`Agent Node` / `Team Node` /
`Service Node`; `Assigned To` / `Depends On`).

## Layout

```
custom-schema/
  README.md                              # this file
  .argo/schema/SystemArchitecture.schema.json   # graph JSON Schema + type enums
  .argo/schema/schema-bundle.config.json                # bundle descriptor
  .argo/schema/schema-bundle.rules.json                 # type metadata + endpoint matrix
  .argo/schema/GUIDE.md                         # human-readable guide
  design/KG/SystemArchitecture.json             # example graph using the types
```

## Use it in your repository

```bash
# copy the drop-in bundle into your repo
cp -r custom-schema/.argo  <your-repo>/.argo
# then write/keep design/KG/SystemArchitecture.json using the Team Graph types
```

Resolution precedence when ARGO runs in `<your-repo>`:

1. `ARGO_SCHEMA_DIR` (host env) — explicit override
2. `<your-repo>/.argo/schema/` — **this bundle** ← wins over the default
3. `<argoRoot>/schema/` — the default ArchiMate 3.2 bundle

Verify from the MCP:

```
queryNeo4jGraph { "schema": true }
# -> schemaKind: "workspace", schemaLanguage: "Team Graph",
#    archimateElementTypes: ["Agent Node","Team Node","Service Node"],
#    actorElementType: "Agent Node", bundleValidation: { status: "passed" }
```

## Bundle contract

| Field | Required | Meaning |
| --- | --- | --- |
| `SystemArchitecture.schema.json` | yes | Graph structure + type enums. |
| `language` | recommended | Display name used in validation messages / MCP guidance. |
| `actorElementType` | yes* | The element type the ARGO wakeup gate uses to identify an agent. Default `Business Actor`. Set to `null` (explicit opt-out) only if the schema genuinely has **no** actor concept. |
| `invariants` | no | `statementGrammar`, `endpointMatrix`, `rootViewName`, `maxElementsPerView`. |
| `deliveryDependencies` | no | Which relationship types express a delivery dependency (`sourceDependsOnTarget` / `targetDependsOnSource`) for `runArchitectureTests` ordering; here `Depends On`/`Assigned To`. |
| `schema-bundle.rules.json` | no | `elementTypeMetadata`, `relationshipCategoryByType`, `relationshipTargetMatrix`. |
| `<repo>/design/KG/SystemArchitecture.json` | **yes (you author it)** | With a custom schema, `argo init` does **not** copy the packaged default graph (it would not match). If the workspace has no graph, init **fails closed** — you must create it. |

**Bundle validation (fail-closed).** On load the bundle is checked; a failure
blocks validation / writes with a clear message. It fails when:

- no element/relationship types are defined;
- `actorElementType` is declared (or defaulted) but is **not** one of the
  bundle's element types — fix the name or set it to `null`;
- the endpoint matrix references unknown relationship or element types.

This is how the framework guarantees the ARGO workflow still has an Actor to
identify: every custom schema must either declare a valid `actorElementType` or
explicitly opt out with `null`.

## Where the mechanism lives

- `argo/scripts/schema-bundle.js` — bundle resolution + ontology construction + bundle validation.
- `argo/scripts/graph-semantics.js` — validation under the resolved ontology.
- `docs/schema-bundle-decoupling.md` — full design + coupling inventory.
