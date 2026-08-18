# ArchGraph

An architecture-graph driven framework for Agentic Engineering.

## What is this?

ArchGraph builds a **unified language** that puts harness design and target product design into
**one model** — so you get a single view to work and observe, and real control over your agents.

![alt text](docs/diagrams/image-1.png)

## Architecture

The global architecture (Layered Viewpoint) shows how the human, the coding agent, ARGO MCP, the
intent architecture graph, ArchiMate 3.2, and Enterprise Architect relate in graph-driven agentic
engineering:

![Global architecture — Layered Viewpoint](docs/diagrams/global-architecture.svg)

Editable source: [`docs/diagrams/global-architecture.excalidraw`](docs/diagrams/global-architecture.excalidraw)

## Install

```powershell
npm install -g archgraph-argo
argo-deploy
```

Done &mdash; the ARGO toolchain, skills, and rules are deployed, and the `argo` MCP server is registered automatically.

> Semantic (Graph RAG) queries also need **Neo4j** and a **vector engine** configured in
> `~/.argo/.env`; everything else works out of the box.

## How to use

After installing, open your project and start a coding agent. It will:

1. locate the architecture element behind the task before changing anything,
2. arm itself with that element's Skills and Rules,
3. work test-first (GIVEN-WHEN-THEN), and trace every commit back to the graph.

The intent architecture graph — modelled in **ArchiMate 3.2** — is the single source of truth.

## License

[Apache License 2.0](LICENSE)
