# `custom-schema/uml2/` — UML 2 ontology

A prebuilt ARGO schema bundle for **UML 2 core** modeling (structural +
behavioral). Use it as a starting point when a software design must live as a
validated intent graph — classes, interfaces, use cases and a state machine —
instead of a pile of diagrams.

## What it models

- **Structural**: `Class`, `Interface`, `Enumeration`, `Data Type`, `Package`, `Component`.
- **Use cases**: `Actor` (the actor type), `Use Case`.
- **Behavioral**: `State`, `Initial State`, `Final State`, `Composite State`, `Choice`, `Activity`, `Action`.

Relationships: `Generalization`, `Realization`, `Association`, `Aggregation`,
`Composition`, `Dependency`, `Transition`, `Include`, `Extend`, `Control Flow`.

See [`GUIDE.md`](.argo/schema/GUIDE.md) for the full endpoint matrix and axioms.

## Use it

```bash
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/uml2/.argo/schema/.  <your-repo>/.argo/schema
# then author <your-repo>/design/KG/SystemArchitecture.json with these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

The runnable example graph is [`design/KG/SystemArchitecture.json`](design/KG/SystemArchitecture.json)
(a checkout use case included by a payment use case, a small order/payment class
model realizing a gateway interface, and a created→authorized→settled payment state machine).

## Relationship to the default bundle

This is a **standalone** UML language bundle (its own type universe), so a repo
can adopt UML as *the* language instead of ArchiMate. If instead you want to
**layer UML onto ArchiMate** (keep all ArchiMate types and add UML), use the
`extends` mechanism — see this repo's own `.argo/schema` ("Acme + UML 2 State
Machine"), which is exactly that `extends: "default"` + `addElementTypes` delta.
