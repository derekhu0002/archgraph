# `custom-schema/ipd/` — IPD (Integrated Product Development) ontology

A prebuilt ARGO schema bundle for **Integrated Product Development (IPD)**: the
staged/gated R&D process together with the **external standards that govern each
discipline**, so process and compliance live in one validated, traceable graph.

## What it models

- **Process** — `Phase` (Concept → Plan → Develop → Qualify → Launch) and gated
  governance: `Decision Checkpoint` (DCP) and `Technical Review` (TR).
- **Disciplines** — `Process Area` (requirements engineering, systems
  engineering, functional safety, quality, configuration management, risk, …).
- **Standards** — `Standard` (ISO 15288, ISO 29148, ISO 26262, APQP, Stage-Gate, CMMI, …).
- **Artifacts** — `Deliverable`, `Requirement`, `Risk`.
- **Organization** — `Role` (the actor type: IPMT, PDT, …).

Relationships: `Precedes`, `Gated By`, `Produces`, `Performed By`,
`Accountable For`, `Governed By`, `Reviews`, `Satisfies`, `Mitigates`.

See [`GUIDE.md`](.argo/schema/GUIDE.md) for the full standards-mapping table,
endpoint matrix and axioms.

## Standards insight (what "integrating IPD standards" means)

IPD itself is a **process framework** (originally PACE/PRTM; popularized by
Huawei's IPD); it is *not* a single standard. A real IPD operating model is held
together by a stack of standards, each governing a slice:

- **Process/governance**: Stage-Gate (Cooper), PACE — the phase + DCP/TR skeleton.
- **Project mgmt**: PMBOK / ISO 21500.
- **Requirements**: ISO/IEC/IEEE 29148.
- **Systems engineering**: ISO/IEC/IEEE 15288.
- **Quality**: ISO 9001; automotive **APQP/PPAP**; **CMMI / ASPICE** for maturity.
- **Safety**: ISO 26262 / IEC 61508.
- **CM / risk / DFSS**: ISO 10007 / ISO 31000 / DFSS-DoE-FMEA.

This bundle encodes that stack as a first-class `Standard` type wired to
`Process Area` via `Governed By`, so you can ask *"which standards govern the
Deliverable I produce in the Develop phase?"* and get a validated answer.

## Use it

```bash
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/ipd/.argo/schema/.  <your-repo>/.argo/schema
# then author <your-repo>/design/KG/SystemArchitecture.json with these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

The runnable example graph is [`design/KG/SystemArchitecture.json`](design/KG/SystemArchitecture.json)
(5 phases chained by `Precedes`, a DCP and a TR gate, three disciplines mapped to
ISO 29148 / ISO 15288 / ISO 26262 plus APQP / Stage-Gate / CMMI, the deliverables
they produce, a safety goal and a supply risk).
