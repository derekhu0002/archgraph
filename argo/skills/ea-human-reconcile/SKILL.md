---
name: ea-human-reconcile
description: "把人类从 EA 提取的 draft 提议（results/human-draft.md，内嵌 JSON 提议集）交给 Agent 后，Agent 结合当前全局（canonical 意图图 design/KG/SystemArchitecture.json + Neo4j 语义检索）逐条/整体分析并给出建议，最终由人类裁决是否写入。它是『人类 EA 草稿 → 语义 diff 提取 → 人类裁决写回』的最后一步：Agent 只做分析+建议，绝不自作主张 apply。Use when the user hands over an EA human-draft proposal set (human-draft.md) and wants the agent to analyze it against the whole architecture and propose, leaving the final decision to the human. Keywords: EA human draft, reconcile, EA 人类草稿裁决, draft review, 语义diff建议, ARGO preview/apply, 人类裁决."
argument-hint: human-draft
disable-model-invocation: true
---

# EA HUMAN DRAFT RECONCILE（EA 人类草稿 → Agent 分析建议 → 人类裁决）

Agent 的职责：结合全局分析 draft 中的每条提议、给出建议与理由、识别风险，把结论呈现给人类，由人类裁决。Agent 不自动执行写入。

## 前置

- [ ] 存在 `results/human-draft.md`（人类从 EA 提取的草稿提议集）。
- [ ] 工作区有 `design/KG/SystemArchitecture.json`（canonical 意图图）——分析全局的依据。
- [ ] ARGO MCP 可用。关键查询手段：
  - 语义/上下文：`getSystemArchitecture`（带 query.purpose + query.intent）、`getIntentElementContext`（看单个元素/关系/视图的依赖与受影响对象）。
  - 结构/类型：`queryNeo4jGraph`（只读 Cypher，如 `MATCH (e:Element {graphKey: $graphKey, type:'Business Actor'}) ...`；先 `{schema:true}` 查投影 schema）。
  - 校验：`validateSystemArchitecture`；写图：`previewSystemArchitectureMutation` / `applySystemArchitectureMutation`。

## 原则

- **人类裁决**：Agent 只分析、给建议、识别风险；**MUST NOT 未经人类裁决就 `applySystemArchitectureMutation`（或任何写图）**。人类拍板（采纳/拒绝/修改）后才写。
- **全局优先**：不只对着 draft 字段，要用查询手段读 canonical 中相关对象及其依赖（被谁引用、级联影响谁、子视图是否悬空、命名/类型是否与全局一致、是否与既有元素重复冲突），再下判断。
- **删除/破坏性提议单独把关**：对 `removeElement` / `removeRelationship` / `removeView`，必须指出 canonical 里谁引用它、删除会级联影响谁，并给出「保留 / 改挂 / 确认删除」的建议，交由人类确认。
- **新增/更新提议**：核对 type / name / description / attributes 是否与全局命名与类型一致、是否与既有元素/关系重复冲突、应挂在哪个 parent / 视图下。
- **视图提议**：核对成员是否落在正确层级（parent_element_id 是否合理）、删视图会否使相关 subdiagram_views 悬空。
- **只读取、不泄露**：MUST NOT 读取/复述 `.env` 里的 secret 或推断敏感配置值。

## 目标

读 draft → 结合全局逐条分析 → 给出「逐条建议 + 整体结论 + 待人类裁决项」。具体产出：

1. **操作统计**：add/update/remove × element/relationship/view。
2. **逐条建议**：每条含 `提议`（op + id/名称）、`分析`（全局依赖/冲突/层级）、`建议`（采纳/拒绝/修改后采纳，附理由）、`风险`（若有）。
3. **整体结论**：这批草稿的整体风险等级、必人工确认的高风险项。
4. **待裁决**：明确列出需人类拍板的条目，并询问哪些采纳、哪些修改、哪些拒绝。

**等待人类答复之后**才进入写回；若人类同意，才经 `previewSystemArchitectureMutation` →（确认后）`applySystemArchitectureMutation`；拒绝/搁置的不写。
