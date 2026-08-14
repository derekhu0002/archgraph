---
name: XKG-TEST
description: "a test repo which created a online mindmapping draft panel"
repo: https://github.com/derekhu0002/XKG-TEST
branch: main
commit_id: 1372c4e528f1ae93538af37272f0937fa52bdfee
---

Read [](file:///d%3A/Projects/XKG-TEST/design/KG/SystemArchitecture.json#1-1), lines 1 to 340

Here's the current summary of SystemArchitecture.json (16 elements, 16 relationships, 4 views):

## Viewpoints (Grouping)
| ID | Name |
|---|---|
| 1240 | Application Cooperation Viewpoint |
| 1249 | Implementation and Migration Viewpoint |

## Work Package & Constraint
| ID | Name | Type | Test case |
|---|---|---|---|
| 1244 | 开发一个网站 | Work Package | AT-1244-01 |
| 1245 | JS编码规范 | Constraint | AT-1245-01 |

## Application Components (parent: 1240)
| ID | Name | Type | Test cases |
|---|---|---|---|
| 1250 | 前端WEB | Application Component | AT-1250-01 |
| 1251 | 后端SERVER | Application Component | AT-1251-01…04 |
| 1252 | 数据与持久化层 | Application Component | AT-1252-01 |
| 1253 | Docker Container | Node | AT-1253-01 |
| 1256 | 通过前端进行手绘 | Application Collaboration | AT-1256-01 |

## Skills & Rules (parent: 1249)
| ID | Name | Type | GitHub link |
|---|---|---|---|
| 1321 | ai-generate | Skill | SKILL.md |
| 1322 | backend-api | Skill | SKILL.md |
| 1323 | collab-crdt | Skill | SKILL.md |
| 1324 | data-persistence | Skill | SKILL.md |
| 1325 | docker-deploy | Skill | SKILL.md |
| 1326 | frontend-canvas | Rule | SKILL.md |
| 1327 | js-coding-standard | Rule | js-coding-standard.instructions.md |

## Views
| ID | Name | Parent |
|---|---|---|
| 176 | AgentCapabilities | 1249 |
| 174 | Implementation and Migration | 1249 |
| 169 | Application Cooperation | 1240 |
| 170 | SystemArchitecture | top-level |

## Relationships (16)
- **Application Cooperation (169):** `前端WEB → 后端SERVER` (Triggering); `数据与持久化层 → 后端SERVER` (Serving); `Docker Container → 后端SERVER/前端WEB/数据与持久化层` (Serving); `通过前端进行手绘 → 前端WEB/后端SERVER` (Aggregation).
- **Implementation & Migration (174):** `开发一个网站 → 通过前端进行手绘` (Realization); `开发一个网站 → JS编码规范` (Association); `开发一个网站 →` 6 skills/rules (Association).

**Totals:** 2 groupings + 1 work package + 1 constraint + 5 application components + 7 skills/rules = **16 elements**, **16 relationships**, **4 views**, and **8 acceptance test cases**.