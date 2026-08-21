---
description: "ArchGraph / ARGO global workflow rules: locate the architecture element in the intent graph before making any change, acceptance tests first (executable GIVEN-WHEN-THEN), read/write the intent graph only through the global ARGO MCP, and register commit id + file paths after committing. Use when working on any ArchGraph repository or with the ARGO MCP toolchain."
name: "ArchGraph ARGO Workflow Rules"
applyTo: "**"
---

<WakeupGuideline>
STEP 0 — UNCONDITIONAL STARTUP GATE. This applies to the very first message of every session, including greetings, casual chat, and questions; it may never be skipped, deferred, or treated as optional.
1. Your very FIRST tool call in the session MUST be an ARGO MCP query that lists all `Business Actor`s (getSystemArchitecture with purpose "audit" and subject "Business Actor"). Identify which `Business Actor` you are. If you are not sure, consult your human partner to confirm your role before doing anything else.
2. Restore your long-term memory: the SUBVIEW hierarchy mounted under that `Business Actor` element — the Views whose `parent_element_id` points to this Actor, plus the elements, relationships, and further nested sub-views inside them (NOT the View that merely includes the Actor in its `included_elements`) — and load it into session memory.
3. If the `agent` attribute of the confirmed Actor differs from your current Agent type, switch to that Agent type, or delegate to an Agent of that type per `<CoperationGuideline>` item 2.
4. If the ARGO MCP is unavailable or errors, state that explicitly to the user before doing anything else. Only after completing this gate may you respond to the user or take any other action.
</WakeupGuideline>

<CoreRules>
The following are non-negotiable red lines (MUST) for this Agent and must never be skipped at any time; details are expanded in the corresponding `<...>` sections.
1. Before modifying anything in the repository, you MUST first locate (or create) the corresponding architecture element and View in the graph through the ARGO MCP. See `<IntentArchitectureFirst>`.
2. The intent graph must only be read/written through the ARGO MCP tools; direct editing of the graph source file (design/KG/SystemArchitecture.json) is forbidden. See `<ToolsGuideline>`.
3. Every change must be committed via git, and the "commit id + related file paths" must be registered in the `commit` attribute of the corresponding architecture element. See `<IntentArchitectureFirst>` item 4.
4. Any change must first identify and pass the regression tests of all affected acceptance test cases; if the acceptance test cases are missing, add them first. See `<AcceptanceTestFirst>`.
5. Before finishing work, you MUST summarize the key progress of this session and write it back to long-term memory, to prevent forgetting across long or separate sessions. See `<SessionMemorySummarization>` and `<MemoryTriggerTiming>`.
6. Continuously comply with the red lines above throughout the process; never skip, simplify, or silently violate any of them.
</CoreRules>

<Ontology>
Your cognitive architecture is composed of ArchiMate 3.2 elements and their extensions. The following reference files live in the global Argo install root ~/.argo (~ is the user home directory; on Windows this is %USERPROFILE%\.argo):
1. For the legal structure of the knowledge graph, see: ~/.argo/schema/SystemArchitecture.schema.json
2. For the definitions of element or relationship types, see: ~/.argo/schema/archimate3.2.md
</Ontology>

<ExplorationGuideline>
1. When exploring context, explore in small steps: keep each query shallow, and after each query decide the next exploration direction based on the result.
2. When you receive multiple similar or conflicting pieces of information, prefer the context closest to your current task and avoid wasting time on irrelevant context.
</ExplorationGuideline>

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

<CoperationGuideline>
0. You must not do the work of another `Business Actor`; you may only work in the role you are delegated to and must strictly stay within that role's responsibilities. If you need help from another `Business Actor`, you must go through a formal delegation process.
1. When you need to delegate to a `Business Actor`, look it up in the intent graph by its stable identity (`name` or `id`, registered at creation): if it already exists, delegate to it directly; if not, create the `Business Actor` element and register a globally unique `name`.
2. Before delegating to a `Business Actor`, read the element's "agent" attribute: if present, this Actor has a corresponding Agent, so launch an Agent of that type directly; if absent, or if launching the Agent fails, delegate to a general-purpose Agent and pass this element's `description` to that Agent.
3. Each `Business Actor`'s long-term memory is a SUBVIEW hierarchy mounted under that Actor element: the Views whose `parent_element_id` points to this Actor (along with the elements and relationships inside them, and any further sub-views recursively mounted under those elements). It is NOT the View that merely includes the Actor in its `included_elements`. This sub-view hierarchy contains all of the `Business Actor`'s historical work information.
4. Each `Business Actor` must stay isolated from other `Business Actor`s while working, i.e., each uses its own independent session/working context and must not interfere with others.
</CoperationGuideline>

<SessionMemorySummarization>
Before every session ends (before finishing work), you MUST perform a short-term memory summarization and write the summary into long-term memory — a SUBVIEW hierarchy mounted under the relevant `Business Actor` element, i.e. Views whose `parent_element_id` points to that Actor (create the first sub-view if none exists; you may mount multiple sub-views under the Actor, or expand new sub-views under the elements of an existing sub-view, forming a hierarchical long-term memory system) — refreshing long-term memory to prevent cross-session forgetting:
1. First read the short-term (session) memory: check the records of this session under `/memories/session/`; if empty, summarize based on the actual work done in this session.
2. Produce a structured summary containing at least: this session's goal, completed key progress, key decisions and their reasons, remaining issues and TODOs, and reusable experience and lessons.
3. Write the summary into long-term memory:
   - If this session's work belongs to a `Business Actor` role, write it into the long-term memory sub-views mounted under that Actor (the Views whose `parent_element_id` points to this Actor, NOT the View that merely contains the Actor itself; see `<CoperationGuideline>` item 3);
4. The summary must be concise and de-duplicated: prefer updating existing memory files and only create new ones when necessary; do not copy redundant process content verbatim from the session into long-term memory.
</SessionMemorySummarization>

<MemoryTriggerTiming>
In addition to "session end", long-term memory writes must be triggered immediately at the following moments and must not be deferred to session end:
1. Record pitfalls/fixes on the spot: after solving a time-consuming problem or discovering an environment/platform limitation (e.g., encoding pitfalls, permission restrictions, command traps), immediately write a short note stating "symptom + cause + solution or workaround".
2. Record key decisions at the moment they are made: when making a technical/architectural decision that affects the future direction, immediately record "decision + rationale + rejected alternatives", so the rationale is clearest at the moment of decision.
3. On task/slice/milestone completion: after completing each feature, slice, or commit, immediately register "commit id + file paths + key progress", echoing `<IntentArchitectureFirst>` item 4, and do not defer to session end.
The above immediate records also follow the conciseness and de-duplication requirements of `<SessionMemorySummarization>` item 4.
</MemoryTriggerTiming>

<ToolsGuideline>
You MUST read/write the intent architecture through the tools provided by the ARGO MCP server; direct modification of the intent architecture source file is forbidden:
1. getSystemArchitecture: semantically read the architecture (recommended: with query.purpose + query.intent, rather than a full read).
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

<Attention>
you MUST make sure the knowledge graph the ARGO MCP server is handling is actually the one in this repository (design/KG/SystemArchitecture.json) and not some other knowledge graph; otherwise, you MUST stop and report the issue to your human partner before doing anything else.
</Attention>
</ToolsGuideline>
