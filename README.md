# ArchGraph

An architecture-graph driven framework for Agentic Engineering.

## What is this?

`ArchGraph` treats an **intent architecture graph** as the single source of
truth for agentic engineering. Every piece of work starts from an element in the graph — a Work
Package, a Skill, a Rule, a Viewpoint, or an Application Component — and every repository change is
traced back to that element.

The canonical graph lives at [`design/KG/SystemArchitecture.json`](design/KG/SystemArchitecture.json).

## Architecture

The global architecture (Layered Viewpoint) shows how the human, the coding agent, ARGO MCP, the
intent architecture graph, ArchiMate 3.2, and Enterprise Architect relate in graph-driven agentic
engineering:

![Global architecture — Layered Viewpoint](docs/diagrams/global-architecture.svg)

Editable source: [`docs/diagrams/global-architecture.excalidraw`](docs/diagrams/global-architecture.excalidraw)

## Core principles

1. **Arm before acting** — before any development, pull the Work Package's associated Skills and
   Rules and materialize them under `~/.copilot/skills/<name>/SKILL.md` (user-level) or
   `.github/skills/<name>/SKILL.md` (project) and `*.instructions.md`.
2. **Find the element first** — every repository change maps to an architecture element. If none
   exists, create one inside a sensible View and Viewpoint.
3. **Acceptance tests first** — check the affected acceptance cases before changing anything.
   Tests verify elements from the outside (GIVEN-WHEN-THEN), never their internals.
4. **Commit traceability** — after each change, commit and register the commit id plus file paths
   back into the graph element.

These rules are encoded as user-level instructions `argo-copilot-instructions.instructions.md`
in the VS Code Copilot prompts folder (`%APPDATA%\Code\User\prompts`).

## Repository map

| Path | Purpose |
| --- | --- |
| `design/KG/SystemArchitecture.json` | Canonical intent architecture graph (single source of truth) |
| `%APPDATA%\Code\User\prompts\argo-copilot-instructions.instructions.md` | Global agent rules (user-level) |
| `~/.copilot/skills/argo-init/SKILL.md` | ARGO harness init skill (user-level) |
| `.github/kglibrary.instructions.md` | Global rule for `KGlibrary/*/info.md` frontmatter format |
| `.github/skills/<name>/SKILL.md` | Skills materialized from the graph (`argo-init`, `create-github-repository-page`, `diagram-draw`, `optimize-web-layout-style`) |
| `.argo/` | ARGO harness: MCP server, schema, validators, semantic (Graph RAG) lifecycle and Neo4j sync |
| `KGlibrary/` | Reference project knowledge library |
| `index.html` | GitHub Pages home site |
| `tests/` | Executable acceptance tests (Node.js built-in test runner) |

## Install

```powershell
npm install -g archgraph-argo
argo-deploy
```

Done &mdash; the ARGO toolchain, skills, and rules are deployed, and the `argo` MCP server is registered automatically.

> Semantic (Graph RAG) queries also need **Neo4j** and a **vector engine** configured in
> `~/.argo/.env`; everything else works out of the box.

## How to use

`ArchGraph` is an agentic engineering framework driven by a knowledge graph —
the intent architecture graph — whose schema complies with **ArchiMate 3.2**.

To adopt it as the building framework for another project, copy the following into the target project:

1. **`.argo/`** — the ARGO harness: the MCP server, the ArchiMate 3.2 schema, validators, the
   semantic (Graph RAG) lifecycle, and Neo4j sync.
2. **One agent-host configuration directory**, depending on which agent you use:
   - `.github/` — GitHub Copilot / VS Code
   - `.opencode/` — opencode
   - `.cursor/` — Cursor

   Each directory carries the global rules, the materialized skills, and the `argo` MCP wiring.
3. **The `.feap` Enterprise Architect model** — the ArchiMate 3.2 model used to author the
   knowledge graph (the `feap` tool).

Then point your agent at the harness (`node .argo/scripts/argo-mcp-server.js`) and bootstrap the
environment:

```powershell
node .argo/scripts/ensureArgoHarnessEnvironment.js
```

## ARGO MCP harness

Read and write the intent architecture through the **ARGO MCP server** — configured in
[`.github/mcp.json`](.github/mcp.json) and served by `node .argo/scripts/argo-mcp-server.js`.
Never edit `design/KG/SystemArchitecture.json` directly.

Bootstrap or health-check the harness with:

```powershell
node .argo/scripts/ensureArgoHarnessEnvironment.js
```

The harness validates the graph against `.argo/schema/SystemArchitecture.schema.json`, supports a
semantic (Graph RAG) query lifecycle, and can sync the graph into Neo4j (`neo4j-driver`).

## KGlibrary reference library

Each project under `KGlibrary/<project>/` provides an `info.md` with YAML frontmatter keys
(`name`, `description`, `repo`, `branch`, `commit_id`) so the home site and agents can uniformly
consume reference project information. See
[`.github/kglibrary.instructions.md`](.github/kglibrary.instructions.md).

## Tests

Run the acceptance suite with:

```powershell
node --test "tests/*.test.js"
```

## Requirements

- Node.js (built-in `node:test` runner)
- Neo4j and a vector engine (embedding provider) — required only for semantic (Graph RAG) queries

## License

[Apache License 2.0](LICENSE)
