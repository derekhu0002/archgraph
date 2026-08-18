# Intent Query Runtime Contract

This local contract refines `OVERALL_ARCHITECTURE.md`.

## Responsibilities

- `.argo/scripts/argo-mcp-server.js` owns transport-neutral tool registration, keeps canonical `initializeWorkspace`/argo init semantics explicit, privately invokes the canonical semantic lifecycle after initialization, and delegates `getSystemArchitecture` without interpreting query policy.
- `.argo/scripts/systemarchitecture-mcp-server.js` owns the deep query and canonical-write orchestration module: request validation, mode selection, canonical full reads, per-call persistent semantic readiness, exact touched-ID mutation dispatch, and durable lifecycle outcome attachment.
- View capacity validation is a canonical mutation validation responsibility. Prospective add/update View and element/relationship membership mutations must apply one global 15 included_elements hard maximum, count only included_elements, keep included_relationships outside quota, preserve endpoint coexistence, and avoid recomposing existing View memberships solely because the policy is active.
- The BP MCP semantic query contract adds request-shape validation and canonical subset response mapping to this module. Forbidden response-shape controls (`responseProfile`, `detail`, `outputMode`, and debug/full/evidence variants) must fail before retrieval with `QUERY_RESPONSE_SHAPE_CONTROL_FORBIDDEN` for ordinary semantic queries with or without anchors; successful ordinary semantic payloads expose a `document` whose root contains only canonical `elements`, `relationships`, and `views` collections without requiring `query.anchors` to activate the contract.
- `design/KG/SystemArchitecture.json` remains the canonical read source; no query mode may rewrite it.
- W6 semantic-query responses must expose the governing canonical graph version in query/result evidence and it must equal the canonical version or Harness-defined fingerprint of the same legacy graph read; missing or mismatched canonical-version evidence blocks coherent-result delivery even when the no-argument canonical read still succeeds.

## Interface boundary

`getSystemArchitecture` accepts:

- no `query`: return exactly the legacy public envelope `{ status, graphPath, document }` with the complete canonical `document` and no query-mode metadata;
- `query.purpose`: one of `intent-decision`, `implementation-design`, `coding-repair`, `audit`, or `graph-tidy`;
- `query.intent`: required non-empty natural-language intent for an explicit query;
- `query.subject`: required non-empty audit subject when `purpose` is `audit`;
- optional deterministic anchors may be added without changing no-argument behavior.

All five purpose values remain legal contract inputs. `intent-decision`, `implementation-design`, `coding-repair`, and valid `audit` requests invoke the semantic retrieval boundary; `graph-tidy` never invokes it and reports `mode: "full-snapshot"` plus `semanticRetrieval: "bypassed"`.

For W6, semantic query results must remain traceable to the canonical graph version used by the same no-argument legacy read. Endpoint, View, and provenance completion are delegated inward to the Graph RAG boundary, but the query service must surface their evidence without silently dropping or rewriting `canonicalVersion`, policy, index, or alignment fields.

For BP-MCP-SEM-PAYLOAD and BP-MCP-SEM-ELEMENT, semantic result mapping is object-set selection rather than field-level shaping. Returned Elements, Relationships, and Views must deep-equal their canonical objects. Element-only hits do not add adjacent relationships, endpoint neighbors, or owning Views unless independently selected or required by selected Relationship/View closure.

Validation occurs before retrieval and returns these stable categories:

- missing purpose: `QUERY_PURPOSE_REQUIRED`;
- purpose outside the legal enum: `QUERY_PURPOSE_INVALID`;
- missing or blank intent: `QUERY_INTENT_REQUIRED`;
- missing or blank audit subject: `AUDIT_SUBJECT_REQUIRED`.
- forbidden response-shape control: `QUERY_RESPONSE_SHAPE_CONTROL_FORBIDDEN`.

Public semantic `getSystemArchitecture` dispatch privately composes accepted WP-P2 readiness and retrieval on every ordinary query. No prior explicit readiness command or durable WP-P3 authorization record is required or publicly routable. This applies to exported System/unified `callTool` invocations and JSON-RPC handlers alike. Only the private raw semantic-query delegate accepts `semanticRetrievalBoundary.retrieve(request)` after the same invocation has freshly verified persistent readiness; it is not a public tool path or a missing-dependency fallback. No-argument and graph-tidy reads continue to bypass semantic work. System and unified JSON-RPC handlers preserve one exact readiness error object containing only `category`, `state`, `verified`, canonical/content/index versions, completed/missing/mismatched channels, `fullSnapshotFallback`, and `action`. Every value derives from its identically named approved error diagnostic under the frozen normalization, except literal-false `fullSnapshotFallback`; constants, cross-field substitutions, message, stack, secrets, unsafe source, and extras are prohibited.

`startNewProjectSemanticJourney`, `backfillSystemArchitectureSemanticProjection`, and `verifySystemArchitectureSemanticReadiness` are retired public names. They are absent from both `TOOLS` registries, both `tools/list` responses, `SYSTEM_ARCHITECTURE_TOOL_NAMES`, and all public `callTool` branches. Their WP-P1/WP-P2 operations remain private ports under canonical argo init and ordinary `getSystemArchitecture(query)`.

Every successful batch or focused canonical write clears readiness before semantic side effects and passes exact `touchedElementIds`, `touchedRelationshipIds`, and `touchedViewIds` to the durable incremental lifecycle. Preview/dry-run never enters that lifecycle. Canonical JSON remains written and authoritative when semantic work is disabled or fails; the response records Pending, Stale, or Failed with `fullSnapshotFallback: false`.

View capacity mutation validation uses `graph-semantics.js` `validateViewElementLimits(document, errors, { touchedViewIds })` from `systemarchitecture-mcp-server.js`. The validator is responsible for the `view15-global-limit-principle`, `view15-counting-semantics-requirement`, `view15-prospective-stability-constraint`, `view15-enforcement-completeness-requirement`, and `view15-active-authority-requirement` mappings; active policy comments, diagnostics, mutation/remediation guidance, graph descriptions, acceptance wording, current tests, and active MCP guidance in `design/mcp/意图架构 MCP 功能列表.md` use Fifteen/15 while historical records preserve their original seven-element semantics. `included_relationships` consume no quota, endpoint coexistence remains enforced by graph semantics, and every focused or batch addView, addElement-to-View, updateView, addRelationship, or updateRelationship route that can grow View membership uses the same prospective 15-element gate before persistence. Actual rejected write payloads must carry the same maximum-15 and observed-count-16 diagnostics that preview/dry-run payloads expose.

The cumulative canonical lifecycle target set remains `argo-mcp-server.js`, `systemarchitecture-mcp-server.js`, `graph-rag/semanticOperatorJourney.js`, `graph-rag/mutationEmbeddingVectorLifecycle.js`, and `graph-rag/defaultSemanticRetrieval.js`. The current SP-05 correction authorizes only `argo-mcp-server.js`, `systemarchitecture-mcp-server.js`, and `graph-rag/semanticOperatorJourney.js`: canonical init must expose and invoke the existing readiness store's invalidate/failure ports so every outcome transforms one stable identity/recordId/canonical-version record with increasing revision, and the gateway's init-specific failure path must map exact actionable redacted category/message/action without raw-secret leakage. Shared semantic-query error mapping, mutation behavior, WP-P2 algorithms, configuration, WP-P1 persistence/backfill/checkpoint/Neo4j adapters, runtime, provider, and every other module remain frozen inward dependencies.

## Local dependencies

- The unified gateway may depend on `systemarchitecture-mcp-server.js` through `callTool` and one private post-initialize lifecycle port.
- The deep query module depends inward on the injected semantic retrieval boundary rather than constructing retrieval inside validation or mode selection.
- The query boundary may depend on graph/schema validation, canonical filesystem loading, and Neo4j synchronization support.
- Neither runtime module may depend on `tests/`, explicit entrypoints, or test-only fixtures.

## Owned tests

Runtime behavior is accepted through the test-owned paths declared in `tests/ARCHITECTURE.md`. The BP MCP semantic query contract is accepted through `tests/explicit/entries/runMcpSemanticQueryContract.js` with graph-mounted `#anchor` fragments that also exercise no-anchor public `callTool` and unified MCP handler subcases for request-shape rejection and canonical subset payloads. View15 capacity policy is accepted through `tests/explicit/entries/runView15GlobalScope.js`, `tests/explicit/entries/runView15Relationships.js`, `tests/explicit/entries/runView15NoMigration.js`, `tests/explicit/entries/runView15Consistency.js`, `tests/explicit/entries/runView15IndirectGrowth.js`, and the frozen `tests/architecture/view-capacity-policy/` guards. This module owns no mutable test expectations.
