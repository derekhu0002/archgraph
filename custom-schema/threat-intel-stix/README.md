# `custom-schema/threat-intel-stix/` — STIX Threat Intelligence ontology

A prebuilt ARGO schema bundle for **threat intelligence**, inspired by
[OASIS STIX 2.1](https://oasis-open.github.io/cti-documentation/stix/intro).
Use it as a starting point for a validated threat-intelligence graph that links
actors, campaigns, TTPs, indicators, vulnerabilities and mitigations.

## What it models

- **Threat Actor** — a tracked adversary (the actor type).
- **Intrusion Set** — a clustered set of activity attributed to an actor.
- **Campaign** — a named, time-bound effort.
- **Attack Pattern** — a tactic/technique (e.g. an ATT&CK technique).
- **Malware** / **Tool** — adversary tooling.
- **Vulnerability** — a CVE-style weakness that is exploited.
- **Indicator** — a detection pattern, usually based on observed data.
- **Identity** — a target identity.
- **Course of Action** — a mitigation.
- **Observed Data** — raw observed data.

Relationships: `Attributed To`, `Uses`, `Targets`, `Indicates`, `Mitigates`,
`Exploits`, `Based On`, `Related To`.

See [`GUIDE.md`](.argo/schema/GUIDE.md) for the full endpoint matrix and axioms.

## Use it

```bash
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/threat-intel-stix/.argo/schema/.  <your-repo>/.argo/schema
# then author <your-repo>/design/KG/SystemArchitecture.json with these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

The runnable example graph is [`design/KG/SystemArchitecture.json`](design/KG/SystemArchitecture.json)
(APT-X, its intrusion set and Operation Nightfall campaign, the techniques and
tooling they use, an exploited CVE, a hash indicator based on observed data, and
a patch that mitigates the vulnerability).

## Provenance

Modelled after OASIS STIX 2.1 domain objects and relationships; this bundle is a
**compact, illustrative subset** (STIX's full object/SRO set is much larger). It
maps the semantics onto the ARGO element/relationship model and adds logical
axioms (disjointness, functional attribution) so the graph carries verifiable
constraints, not just vocabulary.
