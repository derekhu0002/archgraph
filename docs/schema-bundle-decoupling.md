# Schema / Ontology Decoupling — Schema Bundles

Status: implemented on branch `develop-separate-schema`.

## 1. Goal

The ARGO toolchain used to be hard-wired to one modeling language (ArchiMate 3.2 +
ARGO extensions), duplicated across scripts, the MCP server, prompts and skills.
This change decouples the schema so that:

1. By default every graph uses the built-in **ArgoBument** schema (unchanged
   ArchiMate 3.2 + ARGO behaviour).
2. A repository that ships its **own schema bundle** under
   `<workspace>/.argo/schema/` uses that schema instead — for that repository
   only.

## 2. The schema bundle

A schema bundle is a directory holding the graph contract:

| File | Required | Purpose |
| --- | --- | --- |
| `SystemArchitecture.schema.json` | yes | JSON Schema of the graph document (structure + type enums). |
| `argob.config.json` | no | Bundle descriptor (see below). May also be embedded in the schema under the `x-argob` key. |
| `argob-rules.json` | no | Ontology rules: element type metadata, relationship categories, endpoint legality matrix. |
| `ARGOB.md` (or `guide`) | no | Human-readable guide / viewpoints; replaces `archimate3.2.md` for that repo. |

### Resolution precedence

First bundle whose directory contains `SystemArchitecture.schema.json` wins:

1. `ARGO_SCHEMA_DIR` (host env, explicit override — used by tests / deployments)
2. `<workspaceRoot>/.argo/schema/` (the repository's own schema)
3. `<argoRoot>/schema/` (the default ArgoBument bundle)

Implementation: `argo/scripts/argob-schema.js` → `resolveSchemaBundle`,
`resolveTypeEnums`, `loadSchemaBundleAndOntology`.

### `argob.config.json`

```json
{
  "language": "TeamA Ontology",
  "elementTypeEnumPath": ["$defs", "elementType", "enum"],
  "relationshipTypeEnumPath": ["$defs", "relationshipType", "enum"],
  "rules": "argob-rules.json",
  "guide": "ARGOB.md",
  "invariants": {
    "statementGrammar": true,
    "endpointMatrix": false,
    "rootViewName": "SystemArchitecture",
    "maxElementsPerView": 20
  }
}
```

- `language` — display name used in validation messages and MCP guidance.
- `elementTypes` / `relationshipTypes` — inline arrays, or let them be derived
  from the schema `$defs` (default keys `archimateElementType` /
  `archimateRelationshipType`, or `elementType` / `relationshipType`).
- `rules` — optional `argob-rules.json`:
  ```json
  {
    "elementTypeMetadata": { "Team Node": { "layer": "Org", "aspect": "Active" } },
    "relationshipCategoryByType": { "Depends On": "Dependency" },
    "relationshipTargetMatrix": { "Depends On": { "Team Node": ["Service Node"] } }
  }
  ```
  When omitted, element metadata is derived from the schema enums and endpoint
  validation is **permissive** (any known type may relate to any known type).
- `invariants` — switching the ArchiMate-specific invariants on/off for the
  bundle. Defaults for a custom bundle: `statementGrammar: true`,
  `endpointMatrix: <matrix present>`, `rootViewName: "SystemArchitecture"`,
  `maxElementsPerView: 15`. Set `rootViewName: null` (no name requirement) and
  `maxElementsPerView: null` (unlimited) to disable.
- `deliveryDependencies` — which relationship types express a delivery
  dependency and in which direction (`sourceDependsOnTarget` /
  `targetDependsOnSource`). Consumed by `runArchitectureTests` (delivery-status
  ordering) and the MCP semantic-edge walk. The default bundle declares the
  ArchiMate mapping; a custom bundle declares its own (e.g. `Depends On`). If a
  bundle declares none, tests still run in declaration order (no ordering
  constraint). Referenced relationship types are validated (fail-closed).

### The actor contract (bundle validation)

The ARGO workflow identifies the agent through an **Actor element** (the wakeup
gate). A custom schema could rename or omit that type, silently breaking actor
identification — so the actor type is part of the bundle contract:

- `argob.config.json` → `actorElementType` (string). Default `Business Actor`.
- Set `"actorElementType": null` to explicitly declare the schema has **no**
  actor/agent concept (actor identification is then skipped).
- On load, the bundle is **validated fail-closed**; `bundleValidation.status`
  becomes `failed` and validation/writes are blocked with a clear message when:
  - no element/relationship types are defined;
  - `actorElementType` is not one of the bundle's element types (fix the name
    or set it to `null`);
  - the endpoint matrix references unknown relationship/element types.

The resolved `actorElementType` and `bundleValidation` are reported by
`queryNeo4jGraph {schema:true}`, so an agent resolves them at runtime instead of
assuming `Business Actor`. Host override remains `ARGO_ACTOR_ELEMENT_TYPE` for
hosts that cannot query first (e.g. the static OpenCode wakeup hook).

### Built-in default bundle

`argo/schema/argob.config.json` describes the default bundle (language
`ArchiMate 3.2`, guide `archimate3.2.md`, endpoint matrix on). Its rule data now
ships as **data** in `argo/schema/argob-rules.json` (dialect
`archimate-class-matrix`), not code: `argo/scripts/archimate32-rules.js` is only
a legacy fallback for installs without that file. Because the default bundle is
therefore a plain data bundle, it is **replaceable file-for-file** exactly like a
custom one — swapping `~/.argo/schema/` (or `ARGO_SCHEMA_DIR`) changes the
default language, not just a per-repo override.

### Default graph (fail-closed)

Only the **built-in ArgoBument default schema** auto-provides a graph: when
`design/KG/SystemArchitecture.json` is missing it copies the packaged default
(`~/.argo/defaults/design/KG/SystemArchitecture.json`).

For **any other schema** (a repository's `.argo/schema` bundle, `ARGO_SCHEMA_DIR`,
or a replaced default whose dialect is not ArchiMate) the graph is the user's
own: `argo init` does **not** copy the packaged default (it would not match the
schema). If the workspace has no graph, init **fails closed**
(`NO_DEFAULT_GRAPH`, message surfaced). A graph that exists but does not validate
under the active schema also fails init (the harness validates it).

### Reporting the active schema

The active schema is surfaced wherever a user needs to see it:

- `initializeWorkspace` result → `schema: { kind, language, dialect, dir, guide, actorElementType, bundleValidation }` (also inside the harness report as `schemaBundle`).
- `validateSystemArchitecture` prints `… passed … [schema: <kind> / <language>]`.
- `queryNeo4jGraph { "schema": true }` → `schemaKind`, `schemaLanguage`, `schemaDialect`, `actorElementType`, `bundleValidation`.

So after `argo init` / the argo-init skill, the reported `schema.kind` is
`default` (built-in ArgoBument) or `workspace` (the repository's own bundle), and
`schema.language` is its name (e.g. `ArchiMate 3.2` or `Team Graph`).

## 3. Coupling inventory (survey) and resolution

| # | Coupling point | Before | Now |
| --- | --- | --- | --- |
| 1 | Schema path resolution | bundled-first; the repo-local `.argo/schema` override was unreachable dead code (`systemarchitecture-mcp-server.js:resolveSchemaPath`, `validateSystemArchitecture.js`) | `argob-schema.js` resolves `.argo/schema` (and `ARGO_SCHEMA_DIR`) **before** the default |
| 2 | Element/relationship type enums | duplicated in `SystemArchitecture.schema.json`, `archimate32-rules.js`, `ea-qea-sync-lib.js`, `generateArchitectureDiffPlantuml.js`, `eatool/.../export-to-kg.js` | the **validation path** now reads the resolved bundle's enums; the default bundle's data moved to `argob-rules.json` (module kept only as fallback) |
| 3 | Endpoint legality matrix | hardcoded `archimate32-rules.js` only | supplied per bundle (`argob-rules.json`, class- or type-keyed); default unchanged; custom bundles default to permissive |
| 4 | `graph-semantics.js` invariants | hardcoded language name, `SystemArchitecture` root view, 15-element limit | parameterised by the ontology (`ontology.invariants`, `ontology.language`) |
| 5 | MCP guidance strings | hardcoded "ArchiMate 3.2 relationship matrix" / "15 elements" / "SystemArchitecture" | derived from the resolved ontology (`addGuidanceForError(.., ontology)`) |
| 6 | `queryNeo4jGraph {schema:true}` | read enums from a fixed `$defs.archimateElementType` | reads the resolved bundle; reports `schemaKind`, `schemaLanguage`, `schemaDir`, `guidePath` |
| 7 | Tool descriptions | named `.argo/schema/SystemArchitecture.schema.json` / ArchiMate | reference the workspace-resolved bundle |
| 8 | Rules `<Ontology>` | declared ArchiMate only | documents the default + `.argo/schema` override + `ARGO_ACTOR_ELEMENT_TYPE` |
| 9 | Wakeup gate / actor type | hardcoded `Business Actor` | `ARGO_ACTOR_ELEMENT_TYPE` (default `Business Actor`); gate text notes the schema's actor type |
| 10 | Skills (`ea-human-reconcile`, `argo-init`) | example Cypher + steps assumed ArchiMate | resolve the workspace language first; `.qea` projection documented as generic (runs for any schema) |
| 11 | `.qea` projection | always attempted | always attempted; custom types map generically (unknown element → EA `Class` + stereotype = type name; unknown relationship → `Association`), so it is NOT skipped for custom schemas |
| 12 | Env classification | — | `ARGO_SCHEMA_DIR`, `ARGO_ACTOR_ELEMENT_TYPE` classified as host-only keys |

### Residual couplings (documented, intentional)

- **Neo4j projection labels** (`Element` / `ArchitectureRelationship` / `View`,
  `ARCHIMATE_RELATES`) are structural, not vocabulary — they stay fixed so the
  read/query surface is stable for every ontology.
- **`runArchitectureTests` delivery ordering** is now schema-declared, not
  hardcoded: the bundle's `deliveryDependencies` (default bundle = the ArchiMate
  mapping) drive both the test-runner's delivery status and the MCP
  semantic-edge dependency walk. A custom schema that declares none runs tests in
  declaration order (safe, no failure).
- **EA round-trip tooling** (`ea-qea-sync-lib.js`, `eatool/*`) maps ArchiMate
  stereotypes to EA shapes precisely. It is not a blocker for custom schemas:
  unknown element types project to a generic EA `Class` whose stereotype is the
  type name, and unknown relationship types project to `Association`, so `.qea`
  projection runs for every schema (no skip).

## 4. Authoring a workspace schema (example)

A complete, runnable example lives in `custom-schema/` (Team Graph ontology:
`Agent Node` / `Team Node` / `Service Node`; `Assigned To` / `Depends On`).
It is exercised by `tests/argob-schema-bundle.test.js` ("the shipped
custom-schema example bundle loads and validates end-to-end").

```
<repo>/.argo/schema/
  SystemArchitecture.schema.json   # copy the default and edit $defs enums (or write your own)
  argob.config.json                # { "language": "...", "actorElementType": "...", "invariants": {...} }
  argob-rules.json                 # optional matrix/metadata
  ARGOB.md                         # optional guide
```

The MCP server resolves the bundle per call from the caller's `workspaceRoot`
(or `ARGO_REPO_ROOT`), so one global installation serves many repositories with
different schemas.

## 5. Verification

**Schema resolution** — `tests/argob-schema-bundle.test.js` (17 cases): default
resolution, workspace override, `ARGO_SCHEMA_DIR` precedence, custom-type
accept/reject, actor contract / bundle validation, endpoint-matrix on/off,
custom matrix enforcement, per-view limit, the shipped `custom-schema/` example,
and the live MCP projection.

**Docker (isolated, node + opencode)** — `sandbox/schema-decoupling/`:

- `verify.js` — 7 checks: toolchain install, schema acceptance tests + MCP
  regressions, deployed MCP custom-vs-default resolution, the shipped example,
  and `opencode mcp list` loading the deployed server.
- `verify-all.js` — 10 checks: the full surface under **both** schema modes
  (A custom Team Graph, B default ArgoBument) against a **real Neo4j + real
  embedding provider**, each exercising all 19 MCP tools: `initializeWorkspace`
  (Neo4j sync + semantic lifecycle, and asserts the result reports the active
  schema kind/language), `getSystemArchitecture` (semantic retrieval),
  `getIntentElementContext`, `getArchitectureViewContext`, `queryNeo4jGraph`
  (`{schema:true}` and Cypher), `memory_search`, `validateSystemArchitecture`
  (before/after writes), every write tool (element/relationship/view
  add·update·remove, preview, apply), and `runArchitectureTests`. It also
  replaces the installed `~/.argo/schema` with a custom bundle and proves a
  plain workspace adopts it (the default is replaceable), proves a custom
  schema with no graph fails closed (the packaged graph is never copied), and
  routes a cross-project read (`projectId=soc-demo`) to the federation center
  (docs/external-graph-query.md). Run:

  ```
  docker run --rm --entrypoint node \
    -v "<repo>:/repo:ro" -v "<repo>/results:/results" \
    -v "<HOME>/.argo/.env:/env/argo.env:ro" \
    archgraph-schema-verify /opt/verify/verify-all.js
  ```

The full Node suite is otherwise unchanged (remaining failures pre-date this
branch: EA-import tooling, cost-log env keys, graph-content drift).
