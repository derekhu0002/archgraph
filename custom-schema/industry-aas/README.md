# `custom-schema/industry-aas/` — Industry 4.0 AAS ontology

A prebuilt ARGO schema bundle for **assets and their digital twins**, inspired by
the [IEC 63278 Asset Administration Shell (AAS)](https://industrialdigitaltwin.org/)
and RAMI 4.0. Use it as a starting point for modelling equipment, its
administration shell, submodels, capabilities and operations as a validated graph.

## What it models

- **Asset Administrator** — the entity/agent that administers a shell (the actor type).
- **Administration Shell** — the digital shell representing an asset.
- **Asset** — a physical / logical asset (e.g. a pump).
- **Submodel** — a structured facet of the shell (e.g. Nameplate, TechnicalData).
- **Submodel Element** — a property / collection / operation inside a submodel.
- **Capability** — a capability an asset provides.
- **Operation** — an invocable operation that realizes a capability.

Relationships: `Administers`, `Represents`, `Contains`, `Provides Capability`,
`Realizes`, `Requires`.

See [`GUIDE.md`](.argo/schema/GUIDE.md) for the full endpoint matrix and axioms.

## Use it

```bash
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/industry-aas/.argo/schema/.  <your-repo>/.argo/schema
# then author <your-repo>/design/KG/SystemArchitecture.json with these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

The runnable example graph is [`design/KG/SystemArchitecture.json`](design/KG/SystemArchitecture.json)
(a pump P-101 with its administration shell, Nameplate/TechnicalData submodels, a
serial-number property, a pressure-control capability and a SetPressure operation).

## Provenance

Modelled after IEC 63278 AAS / RAMI 4.0 concepts; this bundle is a **compact,
illustrative subset** (the AAS metamodel itself has the full SubmodelElement
hierarchy — Property/Collection/Operation/ReferenceElement … — collapsed here
into a single `Submodel Element` type for clarity).
