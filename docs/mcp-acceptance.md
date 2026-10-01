# MCP Acceptance (end-to-end)

All end-to-end acceptance for the ARGO MCP runs in an **isolated Docker
container**, never against the host framework:

```
npm run acceptance          # = node scripts/mcp-acceptance.js
node scripts/mcp-acceptance.js --no-build   # reuse the image
```

It builds `sandbox/schema-decoupling` (node + OpenCode) and runs
`verify-all.js` against this repo with a **real Neo4j** (`host.docker.internal`,
isolated test databases, dropped after) and the **real embedding provider**
(credentials mounted read-only from `~/.argo/.env`). The repo is mounted
read-only; the host framework is never modified. The report is written to
`results/schema-decoupling-all-report.json` and the run exits non-zero on any
failure.

## What it verifies

- **All 19 ARGO MCP tools**, exercised end-to-end over stdio JSON-RPC:
  `initializeWorkspace`, `runArchitectureTests`, `getSystemArchitecture`,
  `getIntentElementContext`, `getArchitectureViewContext`, `queryNeo4jGraph`,
  `memory_search`, `validateSystemArchitecture`,
  `previewSystemArchitectureMutation`, `applySystemArchitectureMutation`,
  `add/update/removeArchitectureElement`, `add/update/removeArchitectureRelationship`,
  `add/update/removeArchitectureView`. The report asserts `tools.exercised === 19`.
- **Both schema modes**: the default ArgoBument schema and a custom schema
  (the shipped Team Graph bundle), each with its own isolated database.
- **Retrieval, semantic AND non-semantic**: semantic `getSystemArchitecture`
  (asserts a custom/default element is actually returned) and `memory_search`
  (asserts hits); non-semantic `queryNeo4jGraph` (`{schema:true}` and Cypher rows),
  `getIntentElementContext`, `getArchitectureViewContext`.
- **Init & lifecycle**: `initializeWorkspace` (Neo4j sync + semantic lifecycle
  `Aligned`) and the reported active schema (`kind`/`language`/`actorElementType`).
- **Validation before and after writes** (`validateSystemArchitecture`).
- **Fail-closed rules**: a custom schema with no graph is rejected (the packaged
  graph is never copied); the installed default bundle is replaceable.
- **Cross-project reads (real external project = our own registered `archgraph`)**:
  the 5 read tools route to the federation center; the structural reads are
  guaranteed by our registered member+mirror (`queryNeo4jGraph` → 298 elements,
  `database=archgraph`; `getIntentElementContext`; `getArchitectureViewContext`),
  each with `namespaceKey proj:archgraph`. Semantic reads on the mirror depend on
  the center engine's embedding config and are recorded (ok or structured
  unavailable); semantic retrieval is hard-verified locally under both schemas.

## In-suite vs Docker coverage

The Node unit suite (`npm test`) covers the read/validate/init surface and the
mutation engine directly; the Docker acceptance is the authority for the full
tool surface under both schemas. This closes the gaps the coverage audit found
in-suite (relationship/view focused tools, `previewSystemArchitectureMutation`,
`runArchitectureTests`, live-Cypher success, semantic-hit assertions).

## Node unit/regression suite

```
npm test      # node --test "tests/*.test.js"
```

Target state: 0 failures. Obsolete tests are removed rather than left red:

- EA `import-from-kg.js` / `import-from-external-package.js` were deleted from the
  repo, so their tests (`ea-import-*`) were removed; the current import path is
  covered by `tests/ea-qea-sync.test.js`.
- `excalidraw-diagram-skill` is an out-of-repo, user-level skill with no in-repo
  source; its test was removed.
- Graph-drift expectations were refreshed (`architecture-view-context` child
  views, `memory-eval-run` MQ-17, `overseer-ltm-layering` membership).
- EA desktop/headless tests were removed: `ea-export-mirror`,
  `ea-headless-roundtrip`, `ea-sync-r1`, and the headless cases in
  `ea-human-draft-script` / `ea-roundtrip`. They require a running Enterprise
  Architect (or `EA_RUN_HEADLESS=1` + EA installed) and were permanently
  skipped; the non-EA cases in those files are kept.

Target: `npm test` reports 0 failures and 0 skips.
