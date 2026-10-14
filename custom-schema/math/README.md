# `custom-schema/math/` — Mathematics ontology

A prebuilt ARGO schema bundle for **mathematics**: mathematical knowledge,
research and problem solving modelled as one validated, traceable graph, so a
research/解题 agent can navigate concepts, theorems and proofs and connect them
to the formal verification stack.

## What it models

- **Knowledge** — `Mathematical Domain`, `Concept`, `Definition`, `Axiom`,
  `Theorem`, `Conjecture`, `Counterexample`, `Proof`, `Technique`.
- **Problem solving** — `Problem`, `Solution Step` (solution-graph nodes), `Skill`.
- **Formalization / evaluation** — `Formal Library` (Mathlib, AFP, MML),
  `Benchmark` (miniF2F, ProofNet, PutnamBench).
- **Organization** — `Mathematician` (the actor type: a researcher/prover).

Relationships: `Defines`, `Depends On`, `Proves`, `Refutes`, `Applies Technique`,
`Belongs To`, `Solves`, `Has Step`, `Requires Skill`, `Formalized In`,
`Evaluated By`, `Specializes`, `Studies`.

See [`GUIDE.md`](.argo/schema/GUIDE.md) for the full endpoint matrix, invariants
and axioms.

## Where it comes from (industry grounding)

Mathematical ontologies exist in the industry, but mostly for **knowledge
management / FAIR data**, not for proof correctness — the engine that solves
hard problems is the **formal stack** (Mathlib + Lean/Coq/Isabelle) plus LLM
provers, with autoformalization as the bottleneck:

- OntoMath ecosystem (OntoMathPRO + Mocassin) — [arXiv:1702.05112](https://arxiv.org/abs/1702.05112).
- MaRDI / MathModDB / MathAlgoDB — [arXiv:2310.20443](https://arxiv.org/abs/2310.20443), [arXiv:2408.10003](https://arxiv.org/abs/2408.10003), [arXiv:2606.27933](https://arxiv.org/abs/2606.27933).
- Ontology-based geometry problem sets (solution graphs) — [arXiv:2509.02758](https://arxiv.org/abs/2509.02758).
- Autoformalization bottleneck for LLM theorem proving — [arXiv:2608.20153](https://arxiv.org/abs/2608.20153).

The bundle separates the *intellectual structure* (what a `Theorem` depends on),
the *problem-solving layer* (`Problem` → `Solution Step` → `Skill`) and the
*formal layer* (`Formal Library` / `Benchmark`), because correctness comes from
the formal layer while the ontology organises and retrieves the rest.

This bundle is also published to the ArchGraph federation center as the
`archgraph-mathematics` ontology (version `1.0.0`).

## Use it

```bash
mkdir -p <your-repo>/.argo/schema
cp -r custom-schema/math/.argo/schema/.  <your-repo>/.argo/schema
# then author <your-repo>/design/KG/SystemArchitecture.json with these types
# (a custom schema fails closed with NO_DEFAULT_GRAPH — argo-init will NOT create the graph)
```

The runnable example graph is [`design/KG/SystemArchitecture.json`](design/KG/SystemArchitecture.json)
(a number-theory slice: the `Theorem` "Infinitude of the Primes", Euclid's
`Proof` of it via `Proof by Contradiction`, the `Counterexample` that refutes
Euler's polynomial `Conjecture`, the infinitude `Problem` with its `Solution Step`s
and `Skill`, all `Formalized In` Mathlib and `Evaluated By` miniF2F).
