# Cross-project graph query (`projectId`)

The five ARGO **read** tools accept an optional `projectId`:

```
getSystemArchitecture, getIntentElementContext, getArchitectureViewContext,
queryNeo4jGraph, memory_search
```

- **omitted** → the local workspace (behaviour, result shape and performance
  unchanged — zero regression).
- **provided** → the call is routed to the federation center
  (`POST <centerUrl>/graph/read`), which authorizes the requester and forwards to
  the mirror engine; the native ARGO result is returned with an added
  `namespaceKey` (e.g. `proj:soc-demo`).

There is **no silent fallback**: a denied/failed external read returns a
structured error, never the local result.

## Identity (requester)

The requester is this project's own `projectId`, read from
`<workspace>/.argo/federation.json`:

```json
{ "projectId": "archgraph", "sourceRepo": "...", "centerUrl": "https://argo.derekworkspacev5.com", "branch": "main" }
```

If it is missing, an external query fails with `EXTERNAL_QUERY_NOT_REGISTERED`
("register first"); the id is never guessed.

## Router

`argo/scripts/external-graph-query.js` is the single Graph Query Router. It
strips `projectId` / `workspaceRoot` / `architecturePath` from the forwarded
`args` (the engine injects its own workspace), sends
`{ requester, projectId, tool, args }`, and maps responses:

| center response | client result |
| --- | --- |
| `200 {status:"ok", result, namespaceKey}` | the native `result` + `namespaceKey` |
| `403/… {status:"denied", reason}` | `{status:"failed", error:{category:"EXTERNAL_QUERY_DENIED", reason}}` |
| other / unreachable | `{status:"failed", error:{category:"EXTERNAL_QUERY_FAILED" \| "EXTERNAL_QUERY_UNREACHABLE", …}}` |

The dispatch lives in `argo-mcp-server.js` (`externalQueryRequested(name, args)`
→ `queryExternalRead`), before any local tool handling.

## Verification

- `tests/external-graph-query.test.js` (hermetic, mock center): router gating,
  pass-through + `namespaceKey`, denied reason surfaced, register-first on
  missing identity, local path unchanged, and the MCP end-to-end route.
- **Live** (real center, requester `archgraph`, target `soc-demo`) — all 5 read
  tools return the external project's result + `namespaceKey proj:soc-demo`,
  covering both semantic and non-semantic retrieval:
  - `queryNeo4jGraph` (structural Cypher) → `database=soc-demo`, `386` elements.
  - `getSystemArchitecture` (semantic) → `mode=semantic-query`, 63 elements.
  - `memory_search` (semantic) → 3 hits (scores 0.99 / 0.98 / 0.97).
  - `getIntentElementContext` (semantic context) → 4 elements for `soc-agent-artifact`.
  - `getArchitectureViewContext` (structural view) → 2 elements for view `170`.

## Boundary

Read-only (the center rejects write tools). Demo-stage federation has no strong
authentication (`requester` is self-declared); freshness follows the mirror's
git-commit sync. See the center spec in graph-wiki
(`community/EXTERNAL-GRAPH-QUERY-ADAPTATION.md`).
