# AGENTS.md — ArchGraph repository (project-scoped rules)

These rules apply to work **in this repository only**. They are project
development practices, not framework rules — the framework/agent contract lives
in `argo/rules/archgraph.instructions.md` and must stay universally true.

## Acceptance & coverage (this repo)

1. **Durable coverage.** Every delivered/live feature keeps an executable
   acceptance test until it is explicitly removed. Do not drop coverage for a
   live feature (a feature is only "removed" when the human partner says so).
2. **Register live features in the coverage guardian.** Add a guard entry in
   `tests/acceptance-guardian.test.js` (MCP interfaces / deliverables) and, where
   it belongs to a graph element, a mounted AT pointing at a real test file.
3. **End-to-end acceptance for THIS project runs in Docker.** All e2e acceptance
   goes through `npm run acceptance` (`scripts/mcp-acceptance.js` →
   `sandbox/schema-decoupling/verify-all.js`): an isolated container with a real
   Neo4j and the real embedding provider; the host framework is only read-mounted
   and never modified. Do not run e2e acceptance by deploying on the host.
4. **Both schema modes + semantic.** MCP acceptance must cover the default
   ArchiMate 3.2 schema and a custom schema, and must exercise **semantic retrieval**
   (`getSystemArchitecture`, `memory_search`) as well as non-semantic retrieval —
   semantic must not be skipped.
5. **Zero regressions.** `npm test` must stay at **0 failures / 0 skips**. Fix or
   explicitly retire stale tests case by case; do not leave red or skipped tests
   for live features.

See `docs/mcp-acceptance.md` for the acceptance standard and the tool coverage
matrix.

## Deployment (this repo)

1. **Deploy only via the official method.** Host deployment MUST install the
   published package from the registry, then run the deployer:
   `npm i -g archgraph-argo-beta@<version>` followed by `argo-deploy -SkipEnv`.
   Never install from a local tarball, folder, `npm pack`, or any other path —
   the registry artifact is the only sanctioned source. Dev releases publish to
   `archgraph-argo-beta` with `--tag beta`.
2. **Wait out registry propagation, don't bypass it.** After `npm publish`,
   confirm `npm view archgraph-argo-beta@<version> version` succeeds before
   installing. If it lags, retry — do not fall back to a local install.
3. **The deployer copies, it does not mirror.** `argo-deploy` copy-overlays
   `argo/schema` into `~/.argo/schema` without deleting renamed/removed files.
   After a rename, manually delete stale files under `~/.argo` (e.g. old
   `argob.*`), then verify `~/.argo` has no removed tokens.
4. **Restart MCP clients after deploy.** Running `argo-mcp-server` processes hold
   the code loaded at start; restart opencode/VS Code/Cursor/OpenClaw/Doubao so
   they pick up the new deployment.
