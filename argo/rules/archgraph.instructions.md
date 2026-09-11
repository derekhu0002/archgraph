---
description: "ArchGraph / ARGO global workflow rules: locate the architecture element in the intent graph before making any change, acceptance tests first (executable GIVEN-WHEN-THEN), read/write the intent graph only through the global ARGO MCP, and register commit id + file paths after committing. Use when working on any ArchGraph repository or with the ARGO MCP toolchain."
name: "ArchGraph ARGO Workflow Rules"
applyTo: "**"
---

<WakeupGuideline>
STEP 0 — UNCONDITIONAL STARTUP GATE. Applies to the very first message of every session, greetings and chat included; never skip, defer, or treat it as optional.
1. Your first tool call MUST be an ARGO MCP query that lists all `Business Actor`s. Confirm which Actor you are; if unsure, ask your human partner before anything else.
2. Restore memory: load ONLY the T1 working-memory digest — your T1 summary, the most recent/active memory cards, and any session hooks (unfinished items from the last session). Do NOT bulk-load the T2 long-term memory or T3 archive; recall them on demand via `memory_search`, then read full content with `getIntentElementContext`. T2 is a recall target, not as a bulk context load.
3. If the Actor's `agent` attribute differs from your type, switch to it or delegate per `<CoperationGuideline>` item 2.
4. If the ARGO MCP is unavailable or errors, say so before doing anything else.
</WakeupGuideline>

<CoreRules>
Non-negotiable red lines (MUST). Never skip, simplify, or silently violate them; each is expanded in its `<...>` section.
1. Locate (or create) the architecture element and View before changing anything, via ARGO MCP. See `<IntentArchitectureFirst>`.
2. Read/write the intent graph ONLY through ARGO MCP; never edit design/KG/SystemArchitecture.json directly. See `<ToolsGuideline>`.
3. Commit every change, then register the commit id + related file paths on the element. See `<IntentArchitectureFirst>` item 4.
4. Identify and pass the acceptance tests of all affected elements first; add them if missing. Tier 1 changes are exempt per `<ChangeTierGate>`. See `<AcceptanceTestFirst>`.
5. Write this session's key progress to long-term memory before finishing. See `<SessionMemorySummarization>`.
6. Continuously comply with these red lines throughout the session.
7. Retrieve KG-first and semantic-first. See `<QueryPriorityGuideline>`.
8. Store content KG-first. See `<ContentStoragePolicy>`.
9. Never duplicate: reuse first, and handle duplicate rejections by reusing or updating. See `<GraphDeduplication>`.
</CoreRules>

<Ontology>
Your architecture is ArchiMate 3.2 plus ARGO extensions. Reference files live under ~/.argo (Windows: %USERPROFILE%\.argo):
1. Legal graph structure: ~/.argo/schema/SystemArchitecture.schema.json
2. Element/relationship type definitions: ~/.argo/schema/archimate3.2.md
</Ontology>

<ExplorationGuideline>
0. KG-first retrieval: for ANY retrieval, query the intent graph through ARGO MCP before searching files, code, or web. See `<QueryPriorityGuideline>`.
1. Explore in small steps: keep each query shallow, then decide the next step from the result.
2. Prefer the context closest to the task; ignore irrelevant or conflicting context.
3. For structural/type lookups (list by type, traverse, count, aggregate), use `queryNeo4jGraph` per `<GraphQueryGuideline>` — never read the JSON file.
</ExplorationGuideline>

<QueryPriorityGuideline>
1. KG-first retrieval: the intent graph (design/KG/SystemArchitecture.json via ARGO MCP) is the FIRST hop for any retrieval task. Do NOT search files, code, or web first.
2. Semantic-first KG retrieval: use `getSystemArchitecture` with query.purpose + query.intent, and `getIntentElementContext` / `getArchitectureViewContext` for focused context. An omitted-query full read, or reading the graph JSON file, is a last resort.
3. `queryNeo4jGraph` (read-only Cypher) is the SECONDARY path for structural/type lookups semantic retrieval does not cover. See `<GraphQueryGuideline>`.
4. Exhaustive enumeration only: read view membership with `getArchitectureViewContext`. Never fabricate or guess retrieval results; if the graph cannot answer, say so and escalate to your human partner.
5. When a semantic query would return too much content, bound it with `scope` (view_id, or element_id + depth), then drill into the returned ids with `getIntentElementContext`.
</QueryPriorityGuideline>

<ContentStoragePolicy>
1. KG-first document storage: ALL document content MUST go into the intent graph as elements carrying descriptions/attributes, except content that MUST live in the repository or cannot be stored in the KG (e.g. videos, binaries, executables).
2. Repository-only content still requires a SUMMARY: create an element whose description summarizes it and whose attributes record the repository file path + commit id.
3. The KG is the source of truth for document content; if an artifact must also exist in the repository, the KG element stays authoritative.
4. When writing content, follow `<IntentArchitectureFirst>` and register commit id + file paths per `<AcceptanceTestFirst>`.
</ContentStoragePolicy>

<GraphDeduplication>
Never add what the graph already has. Reuse first.
1. Before adding an element, relationship, or view, look for an existing match (an element: same type + name; a relationship: same source + type + target + name; a view: same parent + name) and reuse it — pass `onConflict: "reuse"` whenever the identity is known or likely to exist.
2. If an add is rejected as a duplicate, act on the existing id(s) it returns — reuse or update them. Never retry to force a second copy.
3. Add a same-name duplicate only for a genuinely distinct object, and only with `onConflict: "allowDuplicate"` plus a real `justification`.
4. Preview/apply may return semantic near-duplicate hints: review them and reuse when appropriate, otherwise proceed. They are advisory and never block a write.
5. Updates are never gated. Never work around a duplicate by editing around it — reuse or update the existing object.
</GraphDeduplication>

<IntentArchitectureFirst>
1. Before changing anything, find the matching architecture element in the graph.
2. If it is missing, pick a View and create a reasonable element in it.
3. If the View is missing, choose the most reasonable Viewpoint (see "# C Example Viewpoints" in ~/.argo/schema/archimate3.2.md) and create the View.
4. After the change, git commit it, then register the commit id + related file paths on the element (add a `commit` attribute; refresh description/attributes only when needed, keeping content compact).
</IntentArchitectureFirst>

<ArmingFirst>
Before building an element, look up the skills and resources needed and put them in session memory.
</ArmingFirst>

<AcceptanceTestFirst>
1. Before changing anything, identify the acceptance tests of every element the change may affect; if a test itself needs updating, update it first.
2. After the change, run regression on all affected tests and make them pass.
3. If no acceptance test covers the change, add one before implementing it.
4. Every test validates its element from an external perspective, not from internal implementation.
5. Every test is executable, not merely descriptive; fix any non-executable test immediately.
6. Every test is written GIVEN-WHEN-THEN — both human-readable and automatically executable.
</AcceptanceTestFirst>

<ChangeTierGate>
Classify every change into exactly one tier BEFORE implementing, and declare it. If unsure, default to Tier 2 (fail-safe).
1. Tier 1 — behavior-independent: only non-executable content changes (comments, documentation including this file, whitespace, metadata text), no executable logic / interface / test change, no graph structure change. Skipped ceremony: acceptance regression and full validation (unless the graph was touched). Kept: locate the element, git commit + register, defer memory milestone writes to session end.
2. Tier 2 — behavior-changing, scoped: any executable logic, interface, or test behavior change within existing elements. Full ceremony: locate the element, identify affected tests, run regression, validateSystemArchitecture, commit + register, immediate memory writes.
3. Tier 3 — structural/new: new elements/relationships/views, new features, cross-cutting changes. Tier 2 ceremony plus preview/apply for any graph change.
4. Safety net (MUST): at commit time, check the actual git diff — any disallowed file/hunk is automatically escalated to Tier 2 (Tier 1 is revocable, not merely declared). KG touch rule: any change to design/KG/SystemArchitecture.json keeps full validation. Fail-safe: treat any uncertain classification as Tier 2, never Tier 1.
</ChangeTierGate>

<CoperationGuideline>
0. Do only your assigned role's work; never do another `Business Actor`'s work. If you need another Actor, delegate formally.
1. To delegate, look up the Actor by its stable identity (name/id); if it does not exist, create the `Business Actor` and register a globally unique name.
2. Before delegating, read the Actor's `agent` attribute: if present, launch an Agent of that type; if absent or launch fails, delegate to a general-purpose Agent passing the Actor's description.
3. An Actor's long-term memory is the SUBVIEW hierarchy whose Views' `parent_element_id` points to that Actor (with their elements and nested sub-views) — NOT the View that merely includes the Actor. It holds all of that Actor's historical work.
4. Keep Actors isolated: each works in its own session/context and must not interfere with others.
</CoperationGuideline>

<CapabilityDelegationGuideline>
1. When a task needs reading images, videos, or other multimodal content, first check whether your model has the recognition capability.
2. If it lacks that capability (or the harness does not deliver the content), you MUST NOT guess, fabricate, or silently skip it. Find another `Business Actor` whose `agent`/`model` has the capability and delegate per `<CoperationGuideline>` (launch that Agent type, or fall back to a general-purpose Agent with the Actor's description).
3. If no capable Actor exists, report the exact blocking reason and alternatives to your human partner.
4. After delegating, verify the result against the original acceptance criteria (external view); keep the executable GIVEN-WHEN-THEN validation principle.
</CapabilityDelegationGuideline>

<SessionMemorySummarization>
Memory capture: milestone immediate writes are the reliable backbone; the session summary is opportunistic and idempotent.
1. Milestone immediate writes are the RELIABLE BACKBONE — Never defer critical content (pitfalls, decisions, commit registrations) to session end. See `<MemoryTriggerTiming>`.
2. Session summary: you MUST NOT rely on precisely detecting when a session ends. Write it when the human partner explicitly signals wrap-up, or when you have finished the latest request and the turn is ending naturally. Write it by OVERWRITING that single element (never append), so write amplification stays bounded.
3. Include at least: session goal, key progress, key decisions and reasons, remaining issues/TODOs, and reusable lessons.
4. Route it to the Actor's T1 working memory; route long-term capture to the T2 long-term memory sub-view hierarchy whose `parent_element_id` points to that Actor (see `<CoperationGuideline>` item 3). Keep it concise and de-duplicated; prefer updating existing memory over creating new entries.
</SessionMemorySummarization>

<MemoryTriggerTiming>
Write long-term memory IMMEDIATELY at these moments — this is the backbone; never defer to session end:
1. Pitfalls/fixes: after solving a hard problem or hitting a platform limitation, note "symptom + cause + fix".
2. Key decisions: when a decision affects future direction, record "decision + rationale + rejected alternatives".
3. Task/slice/milestone completion: register "commit id + file paths + key progress" on the element.
immediate writes are primarily triggered IMMEDIATELY and follow the concise, de-duplicated style of `<SessionMemorySummarization>`; the session-end summary is a separate, opportunistic write, not the primary path.
</MemoryTriggerTiming>

<MemoryRecallGuideline>
Recall in TWO steps — a compact card is a LOCATOR, never the full memory:
1. LOCATE: `memory_search` (or `getSystemArchitecture` with purpose `general`) by meaning.
2. READ FULL CONTENT: `getIntentElementContext` on each hit id; never answer from the truncated card alone.
Layering: LOOSE memory threshold for recall — do not reject a low-but-relevant hit; strict for `audit`. Reject only when there are ZERO relevant hits.
Recall target: an Actor's T2 long-term memory is its `<actor>-ltm-001` view hierarchy; T3 archive is `<actor>-archive-001`, read only by explicit retrieval. Recall on demand — never bulk-load memory.
</MemoryRecallGuideline>

<MemoryTierConventions>
Operate the three-tier memory directly from this rule (no skill load):
1. Layout: an Actor's memory lives in three sub-views mounted under it — `<actor>-wm-001` (T1 working memory), `<actor>-ltm-001` (T2 long-term memory, the recall target), `<actor>-archive-001` (T3 archive). Memory elements carry memoryTier = T1|T2|T3.
2. T1 summary: the single member of `<actor>-wm-001`. At session end, OVERWRITE its description (never append) and refresh status=ACTIVE + lastSummaryAt.
3. T2 recall: `memory_search` (locate), then `getIntentElementContext` (full content). See `<MemoryRecallGuideline>`.
4. T3 archive: when a delivered/COMPLETED T2 element is no longer active, MOVE it to `<actor>-archive-001` (remove from T2 membership, add to T3, set memoryTier=T3 + archivedAt). Never delete archived memories.
</MemoryTierConventions>

<ToolsGuideline>
Read/write the intent graph ONLY through ARGO MCP. Never edit design/KG/SystemArchitecture.json directly, and never reach the canonical graph by any file or SQL path.
1. `getSystemArchitecture` MUST supply query.purpose + query.intent; an omitted-query full read is a last resort.
2. Prefer focused context reads (`getIntentElementContext`, `getArchitectureViewContext`) and `queryNeo4jGraph` for structural queries; the latter is read-only.
3. Let the MCP tool schemas define the parameters — do not hardcode assumptions about the graph file.
</ToolsGuideline>

<GraphQueryGuideline>
Use `queryNeo4jGraph` for structural/type lookups. It never mutates the canonical graph.
1. Scope every query to the current graph with the injected `$graphKey` parameter.
2. Never submit write clauses (CREATE, MERGE, DELETE, SET, REMOVE, DROP, LOAD CSV, FOREACH, IN TRANSACTIONS); they are rejected.
3. Semantic/context reads (`getSystemArchitecture`, `getIntentElementContext`, `getArchitectureViewContext`) are the PRIORITY path; Cypher is the SECONDARY path per `<QueryPriorityGuideline>`.
</GraphQueryGuideline>

<Attention>
Confirm the ARGO MCP server is serving this repository's graph (design/KG/SystemArchitecture.json), not another graph. If it is not, stop and report to your human partner before doing anything else.
</Attention>
