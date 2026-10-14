# Mathematics — custom modeling language (schema bundle)

This bundle replaces the default ArchiMate 3.2 (+ ARGO) schema for **one
repository only**: any workspace that has this directory at
`<workspace>/.argo/schema/`. It models mathematical knowledge, research and
problem solving.

The intellectual structure (`Concept` / `Definition` / `Axiom` / `Theorem` /
`Conjecture` / `Proof` / `Counterexample` / `Technique`) is inspired by the
OntoMathPRO and MaRDI (MathModDB) ontologies; the `Problem` / `Solution Step` /
`Skill` layer mirrors solution-graph geometry ontologies; the `Formal Library` /
`Benchmark` layer mirrors the Mathlib + Lean / Coq / Isabelle formalization stack.

## Element types

| Type | Layer | Aspect | Notes |
| --- | --- | --- | --- |
| `Mathematician` | Organization | Active Structure | **Actor element type** — the ARGO wakeup gate looks up elements of this type to identify the agent (a researcher/prover, human or AI). |
| `Mathematical Domain` | Knowledge | Passive Structure | A branch/area of mathematics (algebra, analysis, number theory, geometry...). |
| `Concept` | Knowledge | Passive Structure | A mathematical object/notion (group, manifold, prime, morphism...). |
| `Definition` | Knowledge | Passive Structure | A rigorous definition of a concept. |
| `Axiom` | Knowledge | Passive Structure | A foundational assumption/postulate. |
| `Theorem` | Knowledge | Passive Structure | A proven statement (includes lemma/corollary/proposition). |
| `Conjecture` | Knowledge | Passive Structure | An open/unproven statement or research problem statement. |
| `Counterexample` | Knowledge | Passive Structure | An example refuting a claim. |
| `Proof` | Knowledge | Behavior | A proof (informal reasoning, sketch, or formal proof artifact). |
| `Technique` | Knowledge | Behavior | A proof/solution technique (induction, diagonalization, ...). |
| `Problem` | Solving | Behavior | A problem to be solved (competition or research-level). |
| `Solution Step` | Solving | Behavior | A step within a solution (solution-graph node). |
| `Skill` | Solving | Passive Structure | A competency required or acquired. |
| `Formal Library` | Formalization | Passive Structure | A formalized corpus (Mathlib, AFP, MML...). |
| `Benchmark` | Formalization | Passive Structure | An evaluation set (miniF2F, ProofNet, PutnamBench...). |

## Relationship types

| Type | Category | Legal endpoints (source → allowed targets) |
| --- | --- | --- |
| `Defines` | Structure | `Definition → Concept` |
| `Depends On` | Dependency | `Theorem|Conjecture|Proof|Definition|Concept|Technique → Theorem|Definition|Axiom|Concept|Technique` |
| `Proves` | Realization | `Proof → Theorem` |
| `Refutes` | Influence | `Counterexample → Conjecture|Theorem` |
| `Applies Technique` | Realization | `Proof → Technique` |
| `Belongs To` | Structure | `Concept|Theorem|Technique|Problem → Mathematical Domain` |
| `Solves` | Realization | `Proof → Problem` |
| `Has Step` | Composition | `Proof|Problem → Solution Step` |
| `Requires Skill` | Dependency | `Problem|Theorem|Technique → Skill` |
| `Formalized In` | Realization | `Theorem|Proof → Formal Library` |
| `Evaluated By` | Association | `Theorem|Problem|Skill → Benchmark` |
| `Specializes` | Specialization | `Concept|Theorem → Concept|Theorem` |
| `Studies` | Association | `Mathematician → Mathematical Domain|Problem` |

## Invariants

- `statementGrammar: true` — every relationship statement is `<source> --(<type>)--> <target>`.
- `endpointMatrix: true` — endpoints checked against `schema-bundle.rules.json`.
- `rootViewName: "SystemArchitecture"` — exactly one top-level view.
- `maxElementsPerView: 25` — per-view element limit.

## Axioms / logical constraints (optional)

`ontology-axioms.json` declares the logical layer the endpoint matrix cannot
express; it is read by the **ontology-validation engine** (ignored by the core):

- `disjointClasses` — the intellectual kinds are mutually exclusive
  (a statement is a `Theorem` or a `Conjecture`, not both; a `Proof` is not a
  `Counterexample`; a `Formal Library` is not a `Benchmark`; ...);
- `functionalProperties: ["Proves", "Solves", "Formalized In"]` — a `Proof`
  proves at most one `Theorem`, solves at most one `Problem`, and is
  `Formalized In` at most one library;
- `transitiveProperties: ["Depends On", "Specializes"]` — dependency and
  specialization are transitive (closure is entailed);
- `objectPropertyDomain` / `objectPropertyRange` for `Proves`;
- `distinctIndividuals: true` — so a functional-property conflict is detectable.

Enable the engine with `argo-deploy -EnableOntologyValidation` (opt-in; fail-close).
Full reference — every layer: [docs/ontology-authoring.md](../../../docs/ontology-authoring.md).

## Example viewpoints

- **Knowledge view** — a `Mathematical Domain` with its `Concept`s/`Definition`s
  /`Theorem`s and their `Depends On` / `Belongs To` edges.
- **Solution view** — a `Problem` with its `Solution Step`s, the `Proof` that
  `Solves` it, and the `Requires Skill` edges.
- **Formalization view** — a `Theorem` / `Proof` with its `Formalized In`
  `Formal Library` and `Evaluated By` `Benchmark`.

## How to activate

```bash
# copy only the schema bundle (not .argo/temp/ runtime files)
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/math/.argo/schema/.  <your-repo>/.argo/schema   # Windows: New-Item -Force the dir, then Copy-Item -Recurse -Force
# then author <your-repo>/design/KG/SystemArchitecture.json with these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

Verify from the MCP: `queryNeo4jGraph { "schema": true }` reports
`schemaLanguage: "Mathematics"`, the enums, `actorElementType: "Mathematician"`,
and `bundleValidation.status: "passed"`.
