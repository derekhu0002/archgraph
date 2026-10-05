# GUIDE — Acme + UML 2 State Machine

This workspace schema bundle composes on top of the built-in default bundle
(the **Acme base**: ArchiMate 3.2 + ARGO extensions) and adds a UML 2
state-machine profile. It is authored as a delta (`extends` + `addElementTypes`
+ `addRelationships`), so the effective element/relationship universe is
**base ∪ added** — existing ArchiMate elements/relationships stay valid.

## Modeling language

- Base: `default` (ArchiMate 3.2 + ARGO), id `default`, aliases `archimate3.2` / `archimate` / `base`.
- Profile id: `acme-uml2-statemachine` (aliases `acme-uml2`, `uml2-sm`).
- Display language: `Acme + UML 2 State Machine`.

## Added UML 2 state-machine element types

| Type | Meaning |
| --- | --- |
| `State` | A state in the machine (the work/condition the process is in). |
| `Initial State` | Initial pseudostate (entry). |
| `Final State` | Final state (completion). |
| `Composite State` | A state that contains sub-states (nested / orthogonal regions). |
| `Choice` | Choice pseudostate (guarded branch). |
| `Entry Point` | Entry point pseudostate. |
| `Exit Point` | Exit point pseudostate. |

## Added UML 2 state-machine relationship types

| Type | Category | Meaning |
| --- | --- | --- |
| `Transition` | Dynamic | Directed transition from a source state to a target state; carries event/guard/action text. |

## Viewpoints

- **UML 2 State Machine Viewpoint** (`uml2-sm-viewpoint`) — mounts the coding
  business-process state-machine views.

Metrics are modeled with the inherited ArchiMate **Assessment** element
(motivation aspect) and associated to the states they measure.
