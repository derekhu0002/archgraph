# ArchGraph

**A knowledge-graph framework with an ontology you define — wired into your coding agent through one MCP interface.**

ArchGraph gives coding agents durable, tiered long-term memory on an intent architecture graph that both you and the agent read and write through a single **MCP** server. The built-in default ontology is **ArchiMate 3.2**, but a repository can plug in its own — and this one does.

[Install](#install) · [Quick start](#quick-start) · [Capabilities](#capabilities) · [Docs](#docs) · [Community](#community)

![ArchGraph core model — one graph for the agent's memory and the product's design](docs/diagrams/core-model.svg)

## What is this?

If you run coding agents on a real codebase, every session starts cold and the "why" behind the system lives nowhere. ArchGraph makes **one architecture graph** the single source of truth — the agent's memory and the product's design in one model. It is *one MCP interface* to install and learn: the agent restores context at session start, recalls detail on demand, and never duplicates what it already knows.

- **Architects / tech leads** — one model of the product, the harness, and the agents.
- **Agent users** — memory restored at session start, recalled on demand, never duplicated.
- **Platform teams** — one interface, deployed into the editor you already use.

→ Full onboarding: **[docs/getting-started.html](docs/getting-started.html)**

## Bring your own ontology

A knowledge-graph framework that speaks only one language is not a framework. ArchGraph separates the **core** from the **ontology**: a repository drops a *schema bundle* under `.argo/schema/` (element/relationship types, endpoint rules, an actor contract, an optional guide), and validation, MCP guidance, and the `.qea` projection follow it. A bundle can `extends` the built-in default and add its own types — no framework change required.

This repository is the proof: its own schema **extends ArchiMate 3.2 with a UML 2 state-machine profile**, resolved at runtime from `.argo/schema/` rather than hardcoded in the framework.

→ Worked example — define an ontology, then build the graph step by step: **[docs/case-team-graph.html](docs/case-team-graph.html)** · runnable bundle: [`custom-schema/`](custom-schema/README.md)

## Install

```bash
npm install -g archgraph-argo
argo-deploy
```

`argo-deploy` registers the `argo` MCP server and installs the skills and rules into **GitHub Copilot, Cursor, OpenCode, DeepSeek Harness, OpenClaw, and Codex** (agents are installed where the host supports them). It then prompts for the few settings in `~/.argo/.env`. Semantic queries additionally need **Neo4j** and an **embedding** endpoint — see [Quick start](#quick-start).

## Quick start

```bash
# in a fresh project, ask your coding agent to run:
argo init        # the initializeWorkspace MCP call
```

`argo init` creates the starter `design/KG/SystemArchitecture.json` when missing, runs the first JSON → Neo4j sync, and initializes the semantic lifecycle. From then on the intent graph is the single source of truth: the agent locates the element behind a task, works test-first (GIVEN-WHEN-THEN), and registers each commit back onto the element it changed.

**The one prerequisite that is not out of the box:** semantic (Graph RAG) retrieval needs a **Neo4j** instance and an OpenAI-compatible **embedding** endpoint. Context reads, writes, and Enterprise Architect interop work without them; the Cypher structural projection and all semantic retrieval need Neo4j.

## Capabilities

Each line links to a short page — this is the map, not the manual.

- **[Tiered long-term memory](docs/capabilities.html#memory)** — a compact working memory at session start, a long-term memory recalled on demand, and an archive.
- **[Pluggable ontology](docs/capabilities.html#ontology)** — ship your own schema bundle; the default ArchiMate 3.2 is data, not code.
- **[Semantic + structural retrieval](docs/capabilities.html#retrieval)** — Graph RAG recall plus read-only Cypher for exact structure.
- **[Deduplicated writes](docs/capabilities.html#quality)** — reuse an existing element, relationship, or view instead of copying it; near-duplicates are blocked as candidates.
- **[Acceptance-test-first + traceability](docs/capabilities.html#quality)** — every change is testable, and the commit id is registered back onto the element.
- **[Enterprise Architect interop](docs/capabilities.html#interop)** — the graph projects to `.qea`; human EA edits return as a semantic diff.
- **[Federated graph sharing](docs/capabilities.html#federation)** — sovereign graphs joined by a registry–broker; reads authorized and returned by reference.
- **[One MCP interface, six hosts](docs/capabilities.html#harness)** — install once, run in Copilot, Cursor, OpenCode, DeepSeek Harness, OpenClaw, and Codex.

## How to use

**Initialize once** (`argo init`), then open your project and let your coding agent work. It will:

1. locate the architecture element behind the task before changing anything,
2. arm itself with that element's Skills and Rules,
3. work test-first (GIVEN-WHEN-THEN) and trace every commit back to the graph,
4. reuse an existing element instead of creating a duplicate.

The intent architecture graph is the single source of truth.

## Supported Harnesses

| Harness | MCP | Skills | Rules | Agents |
|---------|:---:|:------:|:-----:|:------:|
| GitHub Copilot    | ✓ | ✓ | ✓ | ✓ |
| Cursor            | ✓ | ✓ | ✓ | ✓ |
| OpenCode          | ✓ | ✓ | ✓ | ✓ |
| DeepSeek Harness  | ✓ | ✓ | ✓ | ✓ |
| OpenClaw          | ✓ | ✓ | ✓ | — |
| Codex             | ✓ | ✓ | ✓ | — |

A single `argo-deploy` registers the `argo` MCP server and installs all artifacts into each harness automatically.

## Cross-project read/write

Cross-project access runs over **two separate channels** — they must not be conflated:

1. **Local path** — a per-call `workspaceRoot` reads a peer project's graph on the same machine. Writes are **read-only by design**: a foreign write is refused with `WORKSPACE_WRITE_DENIED`.
2. **Federated** — a per-call `projectId` is routed through the **federation center**, authorized there (denied by default), and returned by reference.

Whether the local channel works depends on the harness, because a harness may bridge the MCP server and pin the workspace per call:

| Harness | Local read (`workspaceRoot`) | Local write | Federated read (`projectId`) |
|---------|:----------------------------:|:-----------:|:----------------------------:|
| OpenCode         | ✓ | blocked (`WORKSPACE_WRITE_DENIED`) | ✓ |
| Codex            | ✓ | blocked (`WORKSPACE_WRITE_DENIED`) | ✓ |
| DeepSeek Harness | ✗ | ✗ | ✓ |
| GitHub Copilot   | ✓ | blocked (`WORKSPACE_WRITE_DENIED`) | ✓ |
| Cursor           | 待测 | 待测 | ✓ |
| OpenClaw         | 不涉及 | 不涉及 | ✓ |

DeepSeek Harness **cannot** do local cross-project access: its bridge pins the session workspace, so the request never reaches the server as written and only the federated channel works.

## Community

ArchGraph runs on open co-building: share and reuse **architecture subgraphs** across projects. Sharing is **federated** — each project keeps its graph sovereign, and members register, discover, authorize, and read opened content **by reference** (denied by default; nothing copied or merged). The center is a **registry–broker** that holds federation metadata, never content.

- **Community site** — https://argo.derekworkspacev5.com/archgraph/
- **graph-wiki** (graph-asset home) — https://github.com/derekhu0002/graph-wiki
- **GitHub** — https://github.com/derekhu0002/archgraph

## Docs

- [Getting started](docs/getting-started.html) · [Capabilities](docs/capabilities.html) · [Worked case: Team Graph](docs/case-team-graph.html)
- [Schema bundles / ontology decoupling](docs/schema-bundle-decoupling.md) · [Self-hosted embeddings](docs/self-hosted-embedding-deployment.md) · [MCP acceptance](docs/mcp-acceptance.md)
- [Insights](docs/insights.html) — GraphRAG, agent memory, and portable skills.

## License

[Apache License 2.0](LICENSE)
