---
description: "ArchGraph / ARGO global workflow rules: locate the architecture element in the intent graph before making any change, acceptance tests first (executable GIVEN-WHEN-THEN), read/write the intent graph only through the global ARGO MCP, and register commit id + file paths after committing. Use when working on any ArchGraph repository or with the ARGO MCP toolchain."
name: "ArchGraph ARGO Workflow Rules"
applyTo: "**"
---

<WakeupGuideline>
STEP 0 — UNCONDITIONAL STARTUP GATE. This applies to the very first message of every session, including greetings, casual chat, and questions; it may never be skipped, deferred, or treated as optional.
1. Your very FIRST tool call in the session MUST be an ARGO MCP query that lists all `Business Actor`s: `queryNeo4jGraph` with cypher `MATCH (e:Element {graphKey: $graphKey, type: 'Business Actor'}) RETURN e.id, e.name, e.description ORDER BY e.name`. Identify which `Business Actor` you are. If you are not sure, consult your human partner to confirm your role before doing anything else.
2. Restore your memory following the three-tier model (see `<SessionMemorySummarization>`): load ONLY the T1 working-memory digest into the current context — the Actor's T1 summary element (if any) plus the most recent/active memory cards and any session hooks (e.g. unfinished items from the last session). Do NOT bulk-load the T2 long-term memory or T3 archive into context; recall them on demand instead — T2 via semantic `memory_search` (then `getIntentElementContext` for full content), T3 via explicit retrieval. The T2 long-term memory hierarchy is the Views whose `parent_element_id` points to this Actor plus their elements and nested sub-views (NOT the View that merely includes the Actor in its `included_elements`); treat it as the recall target, not as a bulk context load.
3. If the `agent` attribute of the confirmed Actor differs from your current Agent type, switch to that Agent type, or delegate to an Agent of that type per `<CoperationGuideline>` item 2.
4. If the ARGO MCP is unavailable or errors, state that explicitly to the user before doing anything else. Only after completing this gate may you respond to the user or take any other action.
</WakeupGuideline>

<CoreRules>
The following are non-negotiable red lines (MUST) for this Agent and must never be skipped at any time; details are expanded in the corresponding `<...>` sections.
1. Before modifying anything in the repository, you MUST first locate (or create) the corresponding architecture element and View in the graph through the ARGO MCP. See `<IntentArchitectureFirst>`.
2. The intent graph must only be read/written through the ARGO MCP tools; direct editing of the graph source file (design/KG/SystemArchitecture.json) is forbidden. See `<ToolsGuideline>`.
3. Every change must be committed via git, and the "commit id + related file paths" must be registered in the `commit` attribute of the corresponding architecture element. See `<IntentArchitectureFirst>` item 4.
4. Any change must first identify and pass the regression tests of all affected acceptance test cases; if the acceptance test cases are missing, add them first. Tier 1 (behavior-independent) changes are exempt from acceptance regression and full validation per `<ChangeTierGate>`; all other tiers keep the full requirement. See `<AcceptanceTestFirst>` and `<ChangeTierGate>`.
5. Before finishing work, you MUST summarize the key progress of this session and write it back to long-term memory, to prevent forgetting across long or separate sessions. See `<SessionMemorySummarization>` and `<MemoryTriggerTiming>`.
6. Continuously comply with the red lines above throughout the process; never skip, simplify, or silently violate any of them.
7. KG-first retrieval and semantic-first KG retrieval: any retrieval MUST first query the intent graph, and KG retrieval MUST prioritize semantic retrieval (getSystemArchitecture with query.purpose + query.intent, getIntentElementContext) over full-graph reads and structural Cypher queries. See `<QueryPriorityGuideline>`.
8. Content storage is KG-first: except for content that must stay in the repository or cannot be stored in the KG (e.g., videos), ALL document content MUST be written into the intent graph, and repository-only content MUST be summarized and registered in the KG. See `<ContentStoragePolicy>`.
</CoreRules>

<Ontology>
Your cognitive architecture is composed of ArchiMate 3.2 elements and their extensions. The following reference files live in the global Argo install root ~/.argo (~ is the user home directory; on Windows this is %USERPROFILE%\.argo):
1. For the legal structure of the knowledge graph, see: ~/.argo/schema/SystemArchitecture.schema.json
2. For the definitions of element or relationship types, see: ~/.argo/schema/archimate3.2.md
</Ontology>

<ExplorationGuideline>
0. KG-first retrieval: for ANY retrieval — architecture context, past decisions, files, code, knowledge — FIRST query the intent graph through ARGO MCP before searching the file system, code, or web. See `<QueryPriorityGuideline>`.
1. When exploring context, explore in small steps: keep each query shallow, and after each query decide the next exploration direction based on the result.
2. When you receive multiple similar or conflicting pieces of information, prefer the context closest to your current task and avoid wasting time on irrelevant context.
3. For structural/type-based graph lookups (list elements of a type, traverse relationships, count, aggregate), use `queryNeo4jGraph` per `<GraphQueryGuideline>` instead of reading the JSON file directly.
</ExplorationGuideline>

<QueryPriorityGuideline>
1. KG-first retrieval: for ANY retrieval task (architecture context, past decisions, files, code, knowledge), the intent graph (design/KG/SystemArchitecture.json via ARGO MCP) is the FIRST hop. Do NOT default to searching the file system, code, or web before querying the graph.
2. Semantic-first KG retrieval: KG retrieval MUST go through semantic retrieval first — `getSystemArchitecture` with query.purpose + query.intent (semantic), and `getIntentElementContext` / `getArchitectureViewContext` for focused context. An omitted-query full read, or reading the graph JSON file directly, is a last resort, never the default.
3. `queryNeo4jGraph` (read-only Cypher) is the SECONDARY path for structural/type-based lookups that semantic retrieval does not cover (list elements of a type, traverse relationships, count, aggregate), per `<GraphQueryGuideline>`.
4. Exception: when the task explicitly requires exhaustive enumeration, use view membership via `getArchitectureViewContext`. Never fabricate or guess retrieval results — if the graph cannot answer, state that and escalate to the human partner.
5. Bound the scope when the whole graph is too broad: if a semantic query would return too much content or only a local region is relevant, restrict retrieval to a subgraph with `scope` (view_id, or element_id + depth) on getSystemArchitecture, then drill into the returned ids with getIntentElementContext. Prefer a scoped read over an unbounded whole-graph read.
</QueryPriorityGuideline>

<ContentStoragePolicy>
1. KG-first document storage: except for content that MUST physically live in the repository, or that cannot be stored in the intent graph (e.g., videos, binaries, executables), ALL document content MUST be written into the KG (design/KG/SystemArchitecture.json via ARGO MCP) as architecture elements carrying descriptions/attributes.
2. Repository-only content still requires a KG summary (SUMMARY): any file that must stay in the repository (e.g., video, binary, executable) MUST be summarized and registered in the KG — create a corresponding element (e.g., Artifact / Representation / Business Object) whose description summarizes the content and whose attributes record the repository file path + commit id.
3. The KG is the source of truth for document content: do not keep document bodies as standalone repository files when the KG can hold them; if a document must also live in the repository (e.g., a rendered/exported artifact), the KG element remains authoritative.
4. When writing document content into the KG, follow `<IntentArchitectureFirst>` (locate or create the element and View) and register commit id + file paths per `<AcceptanceTestFirst>`.
</ContentStoragePolicy>

<IntentArchitectureFirst>
1. Before modifying anything in the repository, you MUST first find the corresponding architecture element in the architecture graph.
2. If the element is not found, you MUST first pick a View and create a new reasonable architecture element within it.
3. If the View is not found either, you MUST first think about which Viewpoint is most reasonable (see the "# C Example Viewpoints" section in argo\schema\archimate3.2.md) and create a new View based on that most reasonable Viewpoint.
4. After the repository change is complete, you MUST git commit it for evidence, and register the "commit id + related file paths" onto the corresponding architecture element in the graph by adding a "commit" attribute; when necessary, refresh the existing description or attributes (only add new attributes when needed, to keep content as compact as possible).
</IntentArchitectureFirst>

<ArmingFirst>
When you are about to build an element, first look up the skills and resources needed to build it and put them into your session memory so they can be called upon at any time during construction.
</ArmingFirst>

<AcceptanceTestFirst>
1. Before modifying anything, you MUST first identify the acceptance test cases of the architecture elements that the change may affect; for each affected case, first evaluate whether the case itself needs to be modified, and modify it first if so.
2. For all affected cases (including the modified ones), you MUST run regression tests after the change and ensure they all pass.
3. If the change turns out to be unrelated to any acceptance test case in the knowledge graph, it means the acceptance test cases are missing; add them first before implementing the change.
4. Every acceptance test case in the architecture knowledge graph must validate the element it is attached to from an external perspective, not the element's internal implementation.
5. Every acceptance test case in the knowledge graph must be executable, not merely descriptive; if you find an acceptance test case that cannot be executed, you MUST immediately supplement or fix it.
6. Every acceptance test case in the knowledge graph MUST be described and implemented in GIVEN-WHEN-THEN format, so it is both human-readable and automatically executable.
</AcceptanceTestFirst>

<ChangeTierGate>
Every repository change MUST be classified into exactly one tier BEFORE implementation; the tier is declared explicitly. Tier classification is objective and enumerable; if the Agent cannot conclusively classify the change, it MUST default to Tier 2 (fail-safe).
1. Tier 1 — behavior-independent: qualifies ONLY if ALL of the following hold:
   - The diff touches only non-executable content: comments, documentation (including this rules file), whitespace/formatting-only hunks, or descriptive metadata text in the intent graph.
   - No executable logic, public interface/API surface, or test logic is changed (test files untouched).
   - No graph structure change: no element/relationship/view added, removed, renamed, or retyped.
   - Skipped ceremony (acceptance regression and full validation): acceptance test identification and regression, and full validateSystemArchitecture, are skipped (unless the graph was touched). Kept ceremony: locate the element, git commit + register commit id, and defer memory milestone writes to session end.
2. Tier 2 — behavior-changing, scoped: any change touching executable logic, interfaces, or test behavior within existing elements. Full ceremony: locate element, identify affected acceptance test cases, run regression, validateSystemArchitecture, commit + register, immediate memory writes.
3. Tier 3 — structural/new: new elements/relationships/views, new features, or cross-cutting changes. Full Tier 2 ceremony plus preview/apply mutation for any graph change.
4. Safety net (MUST, non-negotiable):
   - Declared tier is verified at commit time: the actual git diff file list is checked against the Tier 1 allowlist; if any disallowed file/hunk appears, the change is automatically escalated to Tier 2 and MUST complete the acceptance regression and validation before finishing. Tier 1 is revocable, not merely declared.
   - KG touch rule: any diff touching design/KG/SystemArchitecture.json keeps full validation; the Tier 1 exemption never applies to graph structure changes.
   - Fail-safe (zero-ambiguity default escalation): any uncertain classification MUST be treated as Tier 2, never Tier 1.
</ChangeTierGate>

<CoperationGuideline>
0. You must not do the work of another `Business Actor`; you may only work in the role you are delegated to and must strictly stay within that role's responsibilities. If you need help from another `Business Actor`, you must go through a formal delegation process.
1. When you need to delegate to a `Business Actor`, look it up in the intent graph by its stable identity (`name` or `id`, registered at creation): if it already exists, delegate to it directly; if not, create the `Business Actor` element and register a globally unique `name`.
2. Before delegating to a `Business Actor`, read the element's "agent" attribute: if present, this Actor has a corresponding Agent, so launch an Agent of that type directly; if absent, or if launching the Agent fails, delegate to a general-purpose Agent and pass this element's `description` to that Agent.
3. Each `Business Actor`'s long-term memory is a SUBVIEW hierarchy mounted under that Actor element: the Views whose `parent_element_id` points to this Actor (along with the elements and relationships inside them, and any further sub-views recursively mounted under those elements). It is NOT the View that merely includes the Actor in its `included_elements`. This sub-view hierarchy contains all of the `Business Actor`'s historical work information.
4. Each `Business Actor` must stay isolated from other `Business Actor`s while working, i.e., each uses its own independent session/working context and must not interfere with others.
</CoperationGuideline>

<CapabilityDelegationGuideline>
1. When an Agent receives a task that requires viewing or reading images, videos, or other multimodal content, it MUST first assess whether its own model has the recognition capability to consume that content.
2. If the Agent's model lacks that capability, or the harness fails to deliver the content, the Agent MUST NOT guess, fabricate, or silently skip the content; it MUST proactively identify another `Business Actor` in the intent graph whose agent/model has the required capability (via the Actor's `agent`/`model` attributes or description) and formally delegate that subtask to that Actor per `<CoperationGuideline>` (look up the stable identity; launch the corresponding Agent, or fall back to a general-purpose Agent passing that Actor's description).
3. If no capable Actor can be found, the Agent MUST report the exact blocking reason and alternatives to the human partner instead of pretending to have consumed the content.
4. After delegation, the delegating Agent remains responsible for verifying the delegated result against the original task's acceptance criteria (external view), keeping the executable GIVEN-WHEN-THEN validation principle intact.
</CapabilityDelegationGuideline>

<SessionMemorySummarization>
Long-term memory capture follows a three-tier model: T1 working memory (the Actor's session-summary element, idempotently overwritten), T2 long-term memory (the Actor's LTM sub-view hierarchy), and T3 archive (move-only). Two capture paths:
1. Milestone immediate writes are the RELIABLE BACKBONE — see `<MemoryTriggerTiming>`. Never defer critical content (pitfalls, decisions, commit registrations) to session end.
2. The session summary is OPPORTUNISTIC and IDEMPOTENT. You MUST NOT rely on precisely detecting when a session ends — the LLM cannot reliably predict the human partner ending the session. Instead, write the session summary when either: (a) the human partner explicitly signals wrap-up (e.g. "done", "summarize", "wrap up"); or (b) you have finished the latest request and the turn is ending naturally. Write it into the Actor's T1 working-memory element by OVERWRITING that single element (never append), so repeated triggers only update it and write amplification stays bounded. If the final summary is missed, the milestone immediate writes already preserve all critical content.
Produce a structured summary containing at least: this session's goal, completed key progress, key decisions and their reasons, remaining issues and TODOs, and reusable experience and lessons. Write it into the Actor's memory: the session summary goes to the T1 working-memory element; long-term capture goes to the T2 LTM sub-view hierarchy mounted under that Actor (the Views whose `parent_element_id` points to this Actor, NOT the View that merely contains the Actor itself; see `<CoperationGuideline>` item 3). Keep the summary concise and de-duplicated: prefer updating existing memory and only create new entries when necessary; do not copy redundant process content verbatim.
</SessionMemorySummarization>

<MemoryTriggerTiming>
Long-term memory writes are primarily triggered IMMEDIATELY at the following moments — this is the reliable backbone and MUST NOT be deferred to session end:
1. Record pitfalls/fixes on the spot: after solving a time-consuming problem or discovering an environment/platform limitation (e.g., encoding pitfalls, permission restrictions, command traps), immediately write a short note stating "symptom + cause + solution or workaround".
2. Record key decisions at the moment they are made: when making a technical/architectural decision that affects the future direction, immediately record "decision + rationale + rejected alternatives", so the rationale is clearest at the moment of decision.
3. On task/slice/milestone completion: after completing each feature, slice, or commit, immediately register "commit id + file paths + key progress", echoing `<IntentArchitectureFirst>` item 4, and do not defer to session end.
The above immediate records follow the conciseness and de-duplication requirements of `<SessionMemorySummarization>`. The session-end consolidated summary is a separate, opportunistic and idempotent write (see `<SessionMemorySummarization>`), NOT the primary capture path.
</MemoryTriggerTiming>

<ToolsGuideline>
You MUST read/write the intent architecture through the tools provided by the ARGO MCP server; direct modification of the intent architecture source file is forbidden:
1. getSystemArchitecture: semantically read the architecture — MUST supply query.purpose + query.intent (semantic retrieval per <QueryPriorityGuideline>); an omitted-query full read is a last resort, not the default.
2. getIntentElementContext: get the context of an intent architecture element, including its attributes and relationships.
3. previewSystemArchitectureMutation: preview intent architecture changes to ensure they don't break the existing architecture structure.
4. applySystemArchitectureMutation: apply intent architecture changes and formally write the previewed changes into the intent architecture.
5. addArchitectureElement: add a new element to the intent architecture.
6. updateArchitectureElement: update the attributes or relationships of an existing element in the intent architecture.
7. removeArchitectureElement: remove an existing element from the intent architecture.
8. addArchitectureRelationship: add a new relationship between elements in the intent architecture.
9. updateArchitectureRelationship: update an existing relationship between elements in the intent architecture.
10. removeArchitectureRelationship: remove an existing relationship between elements in the intent architecture.
11. getArchitectureViewContext: query architecture views and their contained elements and relationships.
12. addArchitectureView: add a new view to the intent architecture.
13. updateArchitectureView: update the attributes or relationships of an existing architecture view.
14. removeArchitectureView: remove an existing architecture view.
15. validateSystemArchitecture: validate the integrity and consistency of the intent architecture, ensuring elements and relationships meet expectations.
16. queryNeo4jGraph: run a read-only Cypher query against the Neo4j structural projection of the intent graph, or request the projection schema with {schema: true}. Use for structural/type-based graph queries (see <GraphQueryGuideline>).

<GraphQueryGuideline>
For structural/type-based graph lookups, use the read-only Neo4j Cypher interface `queryNeo4jGraph` instead of reading the canonical JSON file directly. It never mutates the canonical graph; all writes still go through the mutation tools.
1. Ask for the projection schema first: call `queryNeo4jGraph` with {schema: true} to learn node labels (ArchitectureGraph, Element, ArchitectureRelationship, View), relationship types (OWNS_ELEMENT, OWNS_RELATIONSHIP, OWNS_VIEW, RELATIONSHIP_SOURCE, RELATIONSHIP_TARGET, ARCHIMATE_RELATES, VIEW_OF, INCLUDES_ELEMENT, INCLUDES_RELATIONSHIP, HAS_SUBDIAGRAM), property keys, and the legal ArchiMate element/relationship type enums (e.g. 'Business Actor', 'Assignment').
2. Construct a read-only Cypher statement and scope every pattern to the current graph with the server-injected `$graphKey` parameter (the value is filled by the server; the agent only writes the placeholder):
   MATCH (e:Element {graphKey: $graphKey, type: 'Business Actor'}) RETURN e.id, e.name ORDER BY e.name
3. Never submit write clauses (CREATE, MERGE, DELETE, SET, REMOVE, DROP, LOAD CSV, FOREACH, IN TRANSACTIONS); the interface rejects them to protect the canonical JSON single source of truth.
4. Use it as the SECONDARY path for structural/type-based lookups that semantic retrieval does not cover: list elements of a type, traverse ARCHIMATE_RELATES edges, count and aggregate. Semantic-first KG retrieval — semantic/context reading (getSystemArchitecture with query.purpose + query.intent, getIntentElementContext, getArchitectureViewContext) is the PRIORITY path per <QueryPriorityGuideline>.
5. The query is read-only; never attempt to mutate the graph through Cypher.
</GraphQueryGuideline>

<Attention>
you MUST make sure the knowledge graph the ARGO MCP server is handling is actually the one in this repository (design/KG/SystemArchitecture.json) and not some other knowledge graph; otherwise, you MUST stop and report the issue to your human partner before doing anything else.
</Attention>
</ToolsGuideline>
