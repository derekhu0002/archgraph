# `custom-schema/finance-cdm/` — Finance CDM ontology

A prebuilt ARGO schema bundle for **financial contracts and their lifecycle**,
inspired by the [ISDA Common Domain Model (CDM)](https://www.isda.org/2020/06/08/isda-cdm/).
Use it as a starting point for contract / product / cashflow architecture that
needs to be modelled, traced and validated rather than kept in prose.

## What it models

- **Party** — a legal entity that enters into a contract (the actor type).
- **Legal Agreement** — the governing agreement (e.g. an ISDA Master Agreement).
- **Product** — the economic product definition (e.g. a USD SOFR OIS swap).
- **Contract** — an executed agreement between parties, based on a product.
- **Lifecycle Event** — execution / novation / termination, etc.
- **Cashflow** — a payment obligation triggered by a lifecycle event.
- **Observation** — a market-data observation a cashflow is settled against.

Relationships: `Entered Into`, `Governed By`, `Based On`, `Derived From`,
`Has Event`, `Triggers`, `Payable To`, `Observed By`.

See [`GUIDE.md`](.argo/schema/GUIDE.md) for the full endpoint matrix and axioms.

## Use it

```bash
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/finance-cdm/.argo/schema/.  <your-repo>/.argo/schema
# then author <your-repo>/design/KG/SystemArchitecture.json with these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

The runnable example graph is [`design/KG/SystemArchitecture.json`](design/KG/SystemArchitecture.json)
(a small interest-rate-swap lifecycle: two parties, a master agreement, a product
and its index, an execution event, and the fixed/floating cashflows it triggers).

## Provenance

Modelled after ISDA CDM concepts; this bundle is a **compact, illustrative
subset**, not the full CDM (which is far larger and event-sourced). Elements and
relationships were chosen so the model carries **behaviour and constraints**
(lifecycle events, cashflow triggers, functional/transitive axioms) rather than
being a flat vocabulary.
