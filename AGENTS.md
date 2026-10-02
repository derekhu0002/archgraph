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
   `npm i -g archgraph-argo-beta` followed by `argo-deploy -SkipEnv`. Never
   install from a local tarball, folder, `npm pack`, or any other path — the
   registry artifact is the only sanctioned source.
2. **Tag policy: one `latest` per package; separate dev/stable by PACKAGE NAME.**
   Stable = `archgraph-argo` (its own `latest`); dev = `archgraph-argo-beta` (its
   own `latest`, tracking the newest dev build). Do NOT use `--tag beta` (or any
   extra dev tag): publish dev releases with the default tag so the dev package
   keeps a single `latest`. Install dev with `npm i -g archgraph-argo-beta`
   (no version, no tag).
3. **Wait out registry propagation, don't bypass it.** After `npm publish`,
   confirm `npm view archgraph-argo-beta@<version> version` succeeds before
   installing. If it lags, retry — do not fall back to a local install.
4. **The deployer copies, it does not mirror.** `argo-deploy` copy-overlays
   `argo/schema` into `~/.argo/schema` without deleting renamed/removed files.
   After a rename, manually delete stale files under `~/.argo` (e.g. old
   `argob.*`), then verify `~/.argo` has no removed tokens.
5. **Restart MCP clients after deploy.** Running `argo-mcp-server` processes hold
   the code loaded at start; restart opencode/VS Code/Cursor/OpenClaw/Doubao so
   they pick up the new deployment.

## Framework generality (this repo IS the framework owner)

1. **`argo/**` stays modeling-language- and project-agnostic.** No hardcoded
   language or project names, and no product-specific semantics in framework code
   or in the bundle resolver. The built-in default happens to be ArchiMate 3.2,
   but that is data in a bundle, never a name baked into logic (e.g. `extends`
   accepts the neutral `default` or a path — never `archimate3.2`).
2. **A consuming project's need is met by an opt-in, declarative, generic
   mechanism** (bundle `schema`/`rules`/`config`), never by weakening the general
   contract. If a feature cannot be expressed generically, stop and surface the
   trade-off to the human partner before implementing.
3. **Review every requested change for generality before implementing** and after
   delivering — a feature that only works for one project/language is a defect.
   Default-bundle behaviour must stay byte-identical unless the change is itself
   opt-in.
