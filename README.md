# open_knowledge_graph_engineering

A Knowledge graph driven method for Agentic Engineering.

## What is this?

`open_knowledge_graph_engineering` treats an **intent architecture graph** as the single source of
truth for agentic engineering. Every piece of work starts from an element in the graph — a Work
Package, a Skill, a Rule, a Viewpoint, or an Application Component — and every repository change is
traced back to that element.

The canonical graph lives at [`design/KG/SystemArchitecture.json`](design/KG/SystemArchitecture.json).

## Core principles

1. **Arm before acting** — before any development, pull the Work Package's associated Skills and
   Rules and materialize them under `.github/skills/<name>/SKILL.md` and `*.instructions.md`.
2. **Find the element first** — every repository change maps to an architecture element. If none
   exists, create one inside a sensible View and Viewpoint.
3. **Acceptance tests first** — check the affected acceptance cases before changing anything.
   Tests verify elements from the outside (GIVEN-WHEN-THEN), never their internals.
4. **Commit traceability** — after each change, commit and register the commit id plus file paths
   back into the graph element.

These rules are encoded in [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `design/KG/SystemArchitecture.json` | Canonical intent architecture graph (single source of truth) |
| `.github/copilot-instructions.md` | Global agent rules |
| `.github/kglibrary.instructions.md` | Global rule for `KGlibrary/*/info.md` frontmatter format |
| `.github/skills/<name>/SKILL.md` | Skills materialized from the graph (`argo-init`, `create-github-repository-page`, `optimize-web-layout-style`) |
| `.argo/` | ARGO harness: MCP server, schema, validators, semantic (Graph RAG) lifecycle and Neo4j sync |
| `KGlibrary/` | Reference project knowledge library |
| `index.html` | GitHub Pages home site |
| `tests/` | Executable acceptance tests (Node.js built-in test runner) |

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

## Home site

The project home site is a static GitHub Pages site served from `index.html` and published at
<https://derekhu0002.github.io/open_knowledge_graph_engineering/>.

## Tests

Run the acceptance suite with:

```powershell
node --test
```

## Requirements

- Node.js (built-in `node:test` runner)
- Optional: a reachable Neo4j database for the semantic lifecycle / sync tooling

## License

[Apache License 2.0](LICENSE)
