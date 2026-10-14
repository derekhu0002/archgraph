# `custom-schema/sysml/` — SysML ontology

A prebuilt ARGO schema bundle for **SysML** systems-engineering modeling: blocks
and ports, requirements with derivation and traceability, verification and
allocation. Use it as a starting point when a system model must be a validated,
traceable intent graph rather than a set of diagrams.

## What it models

- **Structure**: `Block`, `Actor` (the actor type), `Value Type`, `Interface Block`, `Constraint Block`, `Port`, `Package`.
- **Requirements**: `Requirement` (with `Derive` / `Refine` / `Trace`).
- **Verification**: `Test Case` (`Verify`), and `Satisfy` from design to requirement.
- **Behavior & allocation**: `Activity`, `Action`, `State`, plus `Allocate` between behavior and structure.

Relationships: `Generalization`, `Association`, `Composition`, `Aggregation`,
`Satisfy`, `Verify`, `Derive`, `Refine`, `Trace`, `Allocate`,
`Binding Connector`, `Item Flow`.

See [`GUIDE.md`](.argo/schema/GUIDE.md) for the full endpoint matrix and axioms.

## Use it

```bash
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/sysml/.argo/schema/.  <your-repo>/.argo/schema
# then author <your-repo>/design/KG/SystemArchitecture.json with these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

The runnable example graph is [`design/KG/SystemArchitecture.json`](design/KG/SystemArchitecture.json)
(an adaptive-cruise-control block, a requirement and its derived requirement, a
verifying test case, composition of sensor/actuator blocks, and behavior allocation).

## Relationship to UML

SysML is conceptually a **UML profile**, and this bundle reuses UML concepts
(blocks are stereotyped classes, actors, activities, states, ports). It is
shipped **standalone** (its own type universe) so it can be adopted on its own,
consistent with the other catalog bundles; see
[`custom-schema/uml2/`](../uml2/README.md) for the more general UML 2 core, and
this repo's own `.argo/schema` for the `extends`-profile style.
