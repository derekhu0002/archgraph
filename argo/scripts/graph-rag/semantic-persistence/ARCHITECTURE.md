# Production Semantic Persistence Contract

This local contract refines `OVERALL_ARCHITECTURE.md` and the parent `.argo/scripts/graph-rag/ARCHITECTURE.md`.

## Responsibilities

- `productionSemanticBackfill.js` owns the explicit WP-P1 backfill use case through `createProductionSemanticBackfill(dependencies).execute({ explicitOptIn })`.
- Backfill begins only after the injected structural-projection boundary proves the same canonical version complete. Structural projection is a prerequisite, not semantic readiness.
- Backfill reads one immutable canonical snapshot and independently enumerates every Element, ArchitectureRelationship, and View. It never fabricates a canonical mutation to trigger embedding generation.
- Work is bounded by an explicit positive batch size. Every channel has durable totals, completed counts, cursor, canonical version, retry, and isolated-failure checkpoints.
- Resume starts from durable channel checkpoints and does not repeat completed work. Acceptance independently compares provider and durable-upsert canonical identities before and after interruption; an implementation-reported resume flag is not evidence. Rerun performs stable-identity upserts and is idempotent for unchanged canonical/content/index/provider/model/version/dimensions/vector evidence.
- A record failure is observable and isolated from other records. Partial or failed channels remain non-Aligned. Alignment may become `Aligned` only after Element, ArchitectureRelationship, and View channels all report complete for the same canonical version.
- `productionSemanticProjectionStore.js` owns `createProductionSemanticProjectionStore(dependencies)` and exposes only `upsertRecords(records)`, `deleteTombstones(tombstones)`, `readRecords()`, and `close()`.
- `productionSemanticNeo4jAdapter.js` owns `createProductionSemanticNeo4jAdapter(dependencies)` as the concrete durable production projection adapter. `productionSemanticCheckpointStore.js` owns `createProductionSemanticCheckpointStore(dependencies)` as the concrete durable per-channel checkpoint adapter. Deterministic tests inject only a recording raw Neo4j driver beneath these production factories; they do not substitute an in-memory projection or checkpoint implementation.
- The production store validates stable canonical identity and complete channel, canonical/content/index, provider/model/model-version/dimensions, and vector metadata before persistence.
- The production store depends inward on a durable Neo4j persistence adapter. It must MERGE/upsert changed records by stable canonical identity and delete tombstones by that identity.
- Production records have no `runId`; a `runId`-bearing record is rejected before persistence. The store's complete callable public surface is exactly `upsertRecords`, `deleteTombstones`, `readRecords`, and `close`: no cleanup, runId-delete, truncate, clear, or reset API is permitted. Production never imports or delegates to `liveEmbeddingNeo4jBoundary.js`.
- Existing live E2E runId cleanup remains test-only and unchanged. It cannot select or delete production semantic projection labels or identities.
- The same four-method production store is the only durable target for automatic incremental indexing. Successful batch and focused Element, ArchitectureRelationship, and View add/update/remove writes provide exact touched identities: add/update records use `upsertRecords`, removed identities use `deleteTombstones`, and unrelated records remain unchanged across restart. Incremental records carry the same complete canonical/content/index/provider/model/model-version/dimensions/vector contract as full reconciliation.
- Readiness invalidation belongs to the canonical-write orchestration boundary and occurs before this store or provider is called. This directory may report persistence success/failure but cannot mark Aligned; queryability and global coherence are later outer checks.
- External Neo4j and provider credentials use the existing approved external configuration and qualification boundaries. Missing configuration or provider qualification blocks before provider, projection, checkpoint, or index side effects. Missing `neo4jUri` blocks startup; tests never invent synchronization evidence.
- Canonical JSON remains authority at `design/KG/SystemArchitecture.json`. The durable Neo4j records are subordinate projection/index state and have no API that writes canonical JSON.

## Public interface

- `createProductionSemanticBackfill(dependencies)` requires canonical-source, structural-projection, qualified-provider, durable projection-store, checkpoint-store, external configuration, qualification, and bounded-batch dependencies; it returns `execute({ explicitOptIn })`.
- `createProductionSemanticProjectionStore(dependencies)` requires the concrete durable adapter, canonical-authority policy, external configuration, and qualified-provider evidence; it returns exactly the four store methods listed above.
- `createProductionSemanticNeo4jAdapter(dependencies)` and `createProductionSemanticCheckpointStore(dependencies)` translate store/checkpoint operations to the configured durable Neo4j driver boundary.
- The parent runtime exposes `runSemanticBackfill(request)` and composes the concrete adapter, store, checkpoint store, and backfill from `semanticPersistence` production dependencies.
- The parent durable incremental lifecycle composes the existing projection store directly for exact touched upsert/tombstone operations. It does not reuse live-E2E `writeEvidence(runId, ...)` or cleanup APIs.
- Canonical argo init privately delegates to `runtime.runSemanticBackfill(request)` after its exact enabled/valid gate decision. No standalone MCP backfill route is exposed. The private composition must exist without Harness injection; missing internal consent fails `SP01_EXPLICIT_OPT_IN_REQUIRED`, and structural/canonical mismatch fails `SP01_STRUCTURAL_VERSION_MISMATCH`, both before provider or durable effects. Structural mutation uses the incremental lifecycle and never fakes a full-backfill trigger.

## Local dependencies

- MCP gateway → production Graph RAG composition → semantic backfill → canonical/structural/provider/store/checkpoint ports.
- Semantic backfill may depend on provider and projection interfaces; provider and store adapters must not depend outward on backfill orchestration.
- Production semantic persistence may depend on the approved Neo4j JavaScript driver adapter and existing external configuration/qualification modules.
- No file in this directory may depend on `tests/`, Python, Neo4j GenAI procedures, the live-E2E evidence boundary, or mutable canonical-write internals.
- Checkpoint persistence and semantic projection persistence are durable production state. Neither is a process-local map in production composition.

## Owned tests

- `tests/harness/productionSemanticPersistenceHarness.js`
- `tests/explicit/entries/runProductionSemanticBackfill.js` — SP-01 control point: shipped non-injected JSON-RPC `tools/call` plus explicit backfill after structural projection. Observation: the default MCP path owns production composition and fails closed before secrets/Neo4j, while the deterministic injected raw-driver scenario proves independent complete channels, bounded checkpoints, interruption/resume, isolated failure, idempotent rerun, complete metadata, no fake mutation, and alignment only after all channels complete.
- `tests/explicit/entries/runPersistentSemanticProjectionLifecycle.js` — SP-02 control point: durable projection across restart, changed-record upsert, tombstone deletion, and unrelated live-E2E cleanup. Observation: stable identity and metadata survive, production has no runId cleanup, canonical authority remains intact, and Neo4j remains subordinate.
- `tests/architecture/production-semantic-persistence/architecture-boundary.guard.js` — `ArchitectureBoundaryGuard`.
- `tests/architecture/production-semantic-persistence/dependency-direction.guard.js` — `DependencyDirectionGuard`.
- `tests/architecture/production-semantic-persistence/explicit-entrypoint-correctness.guard.js` — `ExplicitEntrypointCorrectnessGuard`.
- `tests/architecture/production-semantic-persistence/implementation-traceability.guard.js` — `KeyImplementationTraceabilityGuard`.

All owned Harness, explicit entrypoints, guards, this contract, the root and parent contracts, incoming intent handoff, runner failure records, and canonical graph are frozen during Coding/Repair. The protected fixture is `canonicalThreeChannelFixture`; the protected baseline is the committed WP-P1 pre-coding full-run result in `design/KG/test-failure-records.json`.
