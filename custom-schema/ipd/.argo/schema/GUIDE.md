# IPD — custom modeling language (schema bundle)

This bundle replaces the default ArchiMate 3.2 (+ ARGO) schema for **one
repository only**: any workspace that has this directory at
`<workspace>/.argo/schema/`.

It is an **Integrated Product Development (IPD)** ontology: the staged/gated
development process (phases + decision checkpoints + technical reviews), the
disciplines that carry it out, the deliverables they produce, the roles that own
and decide, and — the point of this bundle — the **external standards that govern
each discipline**. It lets a product-development process, and its compliance
posture, be modelled, traced and validated as one graph.

## The standards integrated

| Process area (discipline) | Governing standard(s) |
| --- | --- |
| Process model / gated governance | **Stage-Gate** (Cooper), **PACE** |
| Project management | **PMI PMBOK** / **ISO 21500** |
| Requirements engineering | **ISO/IEC/IEEE 29148** (IEEE 830 legacy) |
| Systems engineering / life cycle | **ISO/IEC/IEEE 15288** |
| Process maturity / assessment | **CMMI**, **Automotive SPICE (ASPICE)** |
| Quality management | **ISO 9001** |
| Product quality planning (automotive) | **AIAG APQP** / **PPAP** |
| Functional safety | **ISO 26262** (automotive), **IEC 61508** |
| Configuration management | **ISO 10007** |
| Risk management | **ISO 31000** |
| Design for Six Sigma / robustness | **DFSS (DMADV/DMAIC)**, **DoE**, **FMEA** |
| Innovation / problem solving | **TRIZ**, **ISO 56002** |

The example graph instantiates a representative subset; add the rest as
`Standard` elements.

## Element types

| Type | Layer | Aspect | Notes |
| --- | --- | --- | --- |
| `Phase` | IPD Process | Behavior | A stage (Concept, Plan, Develop, Qualify, Launch, …). |
| `Decision Checkpoint` | IPD Governance | Behavior | A DCP gate that closes a phase. |
| `Technical Review` | IPD Governance | Behavior | A TR technical review. |
| `Deliverable` | IPD Artifact | Passive Structure | A produced artifact (spec, plan, FMEA, …). |
| `Role` | IPD Organization | Active Structure | **Actor element type** — IPMT, PDT, functional role. |
| `Process Area` | IPD Discipline | Behavior | A discipline (requirements, SE, safety, quality, …). |
| `Standard` | External Standard | Passive Structure | An external standard that governs a discipline. |
| `Requirement` | IPD Artifact | Passive Structure | A requirement the deliverables must satisfy. |
| `Risk` | IPD Governance | Passive Structure | A project/technical risk. |

## Relationship types

| Type | Category | Legal endpoints (source → allowed targets) |
| --- | --- | --- |
| `Precedes` | Sequencing | `Phase → Phase` (transitive) |
| `Gated By` | Governance | `Phase → {Decision Checkpoint, Technical Review}` |
| `Produces` | Production | `Phase → Deliverable`; `Process Area → Deliverable` |
| `Performed By` | Assignment | `Process Area → Role`; `Phase → Role` |
| `Accountable For` | Assignment | `Role → Decision Checkpoint` |
| `Governed By` | Compliance | `Process Area → Standard`; `Deliverable → Standard`; `Phase → Standard` |
| `Reviews` | Verification | `Technical Review / Decision Checkpoint → Deliverable` |
| `Satisfies` | Realization | `Deliverable → Requirement` |
| `Mitigates` | Risk | `Process Area → Risk`; `Deliverable → Risk` |

## Invariants

- `statementGrammar: true` — every relationship statement must be `<source> --(<type>)--> <target>`.
- `endpointMatrix: true` — endpoints are checked against the matrix in `schema-bundle.rules.json`.
- `rootViewName: "SystemArchitecture"` — exactly one top-level view with that name.
- `maxElementsPerView: 25` — per-view element limit.

## Axioms / logical constraints (optional)

`ontology-axioms.json` declares the **logical** layer the endpoint matrix cannot
express; it is read by the **ontology-validation engine** (ignored by the core):

- `disjointClasses` — e.g. `Phase`/`Standard`, `Process Area`/`Standard`, `Deliverable`/`Standard`, `Deliverable`/`Requirement` are mutually exclusive;
- `transitiveProperties: ["Precedes"]` — phase ordering is transitive;
- `objectPropertyDomain` / `objectPropertyRange` for `Satisfies`;
- `distinctIndividuals: true` — so a functional-property conflict is detectable.

Enable the engine with `argo-deploy -EnableOntologyValidation` (opt-in; fail-close — a configured-but-unavailable engine is a blocking error, not a silent pass).
Full reference — every layer: [docs/ontology-authoring.md](../../../docs/ontology-authoring.md).

## Example viewpoints

- **Phase/gate view** — the `Phase` chain and the `Decision Checkpoint` / `Technical Review` that gate each phase.
- **Compliance view** — each `Process Area` and the `Standard` that governs it (the IPD → standards mapping).
- **Deliverable view** — a `Deliverable`, the `Requirement`s it `Satisfies`, and the `Risk`s it `Mitigates`.

## How to activate

```bash
# copy only the schema bundle (not .argo/temp/ runtime files)
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/ipd/.argo/schema/.  <your-repo>/.argo/schema   # Windows: New-Item -Force the dir, then Copy-Item -Recurse -Force
# then create design/KG/SystemArchitecture.json yourself using these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

Verify from the MCP: `queryNeo4jGraph { "schema": true }` reports
`schemaLanguage: "IPD"`, the enums, `actorElementType: "Role"`,
and `bundleValidation.status: "passed"`.
