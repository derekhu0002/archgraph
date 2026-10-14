# STIX Threat Intelligence — custom modeling language (schema bundle)

This bundle replaces the default ArchiMate 3.2 (+ ARGO) schema for **one
repository only**: any workspace that has this directory at
`<workspace>/.argo/schema/`.

It is a threat-intelligence ontology **inspired by OASIS STIX 2.1**: threat
actors and intrusion sets carry out campaigns that use attack patterns, malware
and tools, target identities and vulnerabilities, are indicated by indicators
based on observed data, and are mitigated by courses of action.

## Element types

| Type | Layer | Aspect | Notes |
| --- | --- | --- | --- |
| `Threat Actor` | Threat | Active Structure | **Actor element type** — a tracked threat actor. |
| `Intrusion Set` | Threat | Active Structure | a clustered set of activity. |
| `Campaign` | Threat | Behavior | a named campaign. |
| `Attack Pattern` | Threat | Behavior | a TTP (e.g. an ATT&CK technique). |
| `Malware` | Threat | Active Structure | a malware family. |
| `Tool` | Threat | Active Structure | a legitimate tool abused by an adversary. |
| `Vulnerability` | Threat | Passive Structure | a CVE-style weakness. |
| `Indicator` | Threat | Passive Structure | a detection pattern. |
| `Identity` | Business | Active Structure | a target identity. |
| `Course of Action` | Threat | Behavior | a mitigation. |
| `Observed Data` | Threat | Passive Structure | raw observed data. |

## Relationship types

| Type | Category | Legal endpoints (source → allowed targets) |
| --- | --- | --- |
| `Attributed To` | Attribution | `Intrusion Set → Threat Actor`; `Campaign → Threat Actor` |
| `Uses` | Usage | `Threat Actor / Intrusion Set / Campaign → Attack Pattern, Malware, Tool`; `Malware → Attack Pattern` |
| `Targets` | Targeting | `Threat Actor / Intrusion Set / Campaign / Attack Pattern → Identity, Vulnerability` |
| `Indicates` | Indication | `Indicator → Malware, Attack Pattern, Threat Actor, Intrusion Set, Campaign` |
| `Mitigates` | Mitigation | `Course of Action → Attack Pattern, Malware, Tool, Vulnerability` |
| `Exploits` | Exploitation | `Malware / Tool / Attack Pattern → Vulnerability` |
| `Based On` | Derivation | `Indicator → Observed Data` |
| `Related To` | Association | *(unconstrained)* |

## Invariants

- `statementGrammar: true` — every relationship statement must be `<source> --(<type>)--> <target>`.
- `endpointMatrix: true` — endpoints are checked against the matrix in `schema-bundle.rules.json`.
- `rootViewName: "SystemArchitecture"` — exactly one top-level view with that name.
- `maxElementsPerView: 15` — per-view element limit.

## Axioms / logical constraints (optional)

`ontology-axioms.json` declares the **logical** layer the endpoint matrix cannot
express; it is read by the **ontology-validation engine** (ignored by the core):

- `disjointClasses` — e.g. `Malware` / `Tool`, `Threat Actor` / `Intrusion Set`, `Indicator` / `Observed Data` are mutually exclusive;
- `functionalProperties: ["Attributed To"]` — an intrusion set / campaign is attributed to at most one threat actor;
- `objectPropertyDomain` / `objectPropertyRange` for `Based On`;
- `distinctIndividuals: true` — so a functional-property conflict is detectable.

Enable the engine with `argo-deploy -EnableOntologyValidation` (opt-in; fail-close — a configured-but-unavailable engine is a blocking error, not a silent pass).
Full reference — every layer: [docs/ontology-authoring.md](../../../docs/ontology-authoring.md).

## Example viewpoints

- **Campaign view** — a `Campaign`, the `Threat Actor` it is attributed to, the
  `Attack Pattern` / `Malware` / `Tool` it uses, and the `Identity` / `Vulnerability` it targets.
- **Detection view** — an `Indicator`, the `Observed Data` it is based on, and the
  `Malware` / `Attack Pattern` it indicates.

## How to activate

```bash
# copy only the schema bundle (not .argo/temp/ runtime files)
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/threat-intel-stix/.argo/schema/.  <your-repo>/.argo/schema   # Windows: New-Item -Force the dir, then Copy-Item -Recurse -Force
# then create design/KG/SystemArchitecture.json yourself using these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

Verify from the MCP: `queryNeo4jGraph { "schema": true }` reports
`schemaLanguage: "STIX Threat Intelligence"`, the enums, `actorElementType: "Threat Actor"`,
and `bundleValidation.status: "passed"`.
