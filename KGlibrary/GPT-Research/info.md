---
name: GPT-Research
description: "AML model of the GPT-Researcher multi-agent research workflow (Planner -> Researcher -> Editor -> Reviewer -> Publisher)"
repo: https://github.com/assafelovic/gpt-researcher
---

Read [](file:///d%3A/Projects/archgraph/KGlibrary/GPT-Research/GPT-Researcher_Multi-Agent_Research.json#1-1), the ArchiMate 3.2 Process Cooperation Viewpoint model of GPT-Researcher's multi-agent research workflow.

Here's the summary of `GPT-Researcher_Multi-Agent_Research.json` (15 elements, 18 relationships, 1 view):

## Viewpoint
| ID | Name |
|---|---|
| 1334 | Process Cooperation Viewpoint |

## Work Package / Course of Action
| ID | Name | Type |
|---|---|---|
| 1336 | gpt-researcher-research-program | Course of Action |

## Business Processes (parent: 1334)
| ID | Name | Type |
|---|---|---|
| 1337 | Plan Research | Business Process |
| 1338 | Conduct Sub-research | Business Process |
| 1339 | Write Report | Business Process |
| 1340 | Review Report | Business Process |
| 1341 | Publish Report | Business Process |

## Business Roles (parent: 1334)
| ID | Name | Type |
|---|---|---|
| 1342 | Planner | Business Role |
| 1343 | Researcher | Business Role |
| 1344 | Editor | Business Role |
| 1345 | Reviewer | Business Role |
| 1346 | Publisher | Business Role |

## Deliverable / Goal / Constraint / Principle
| ID | Name | Type |
|---|---|---|
| 1347 | Research Report | Deliverable |
| 1348 | Produce objective research report | Goal |
| 1349 | Cite every fact with source | Constraint |
| 1350 | Reduce bias and hallucination | Principle |

## View
| ID | Name | Parent |
|---|---|---|
| 177 | GPT-Researcher Multi-Agent Research | 1334 |

## Relationships (18)
- **Realization:** `Plan Research / Conduct Sub-research / Write Report / Review Report / Publish Report → gpt-researcher-research-program`
- **Triggering chain:** `Plan Research → Conduct Sub-research → Write Report → Review Report → Publish Report`
- **Assignment:** `Planner → Plan Research`, `Researcher → Conduct Sub-research`, `Editor → Write Report`, `Reviewer → Review Report`, `Publisher → Publish Report`
- **Association:** `Publish Report → Research Report`, `Cite every fact with source → Conduct Sub-research`
- **Realization:** `Research Report → Produce objective research report`
- **Influence:** `Reduce bias and hallucination → Produce objective research report`

**Totals:** 1 course of action + 5 business processes + 5 business roles + 1 deliverable + 1 goal + 1 constraint + 1 principle = **15 elements**, **18 relationships**, **1 view**.
