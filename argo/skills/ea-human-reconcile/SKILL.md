---
name: ea-human-reconcile
description: "把人类从 EA 提取的 draft 提议（results/human-draft.md，内嵌 JSON 提议集）交给 Agent 后，Agent 结合当前全局（canonical 意图图 design/KG/SystemArchitecture.json + Neo4j 语义检索）逐条/整体分析并给出建议，最终由人类裁决是否写入。它是『人类 EA 草稿 → 语义 diff 提取 → 人类裁决写回』的最后一步：Agent 只做分析+建议，绝不自作主张 apply。Use when the user hands over an EA human-draft proposal set (human-draft.md) and wants the agent to analyze it against the whole architecture and propose, leaving the final decision to the human. Keywords: EA human draft, reconcile, EA 人类草稿裁决, draft review, 语义diff建议, ARGO preview/apply, 人类裁决."
argument-hint: human-draft
disable-model-invocation: false
---

# EA HUMAN DRAFT RECONCILE（EA 人类草稿 → Agent 分析建议 → 人类裁决）

定位：人类用 EA 画/改草稿，`extract-human-draft` 已把它提取成 `results/human-draft.md`（内嵌 JSON 提议集）。现在人类把这份 draft **交给 Agent**。Agent 的职责是：**结合当前全局架构分析每条提议、给出建议与理由、识别风险，然后把结论呈现给人类，由人类裁决**。Agent **不自动执行**写入。

关键分工：

- **人类（EA 侧）**：用 EA 改模型 → 跑 `extract-human-draft` → 得到 `results/human-draft.md` → 交给 Agent。
- **Agent（本 skill）**：读 draft + 结合全局分析 + 给建议 + 等人类裁决。
- **人类（裁决）**：对 Agent 的建议逐条拍板（采纳/拒绝/修改）后，Agent 才经 ARGO preview/apply 写入。

**本 skill 只管「先分析给建议」。写不写在裁决后。**

## 前置

- [ ] 存在 `results/human-draft.md`（人类从 EA 提取的草稿提议集）；若也在 `results/human-draft.json` 则忽略（新脚本只产出 .md）。
- [ ] 工作区有 `design/KG/SystemArchitecture.json`（canonical 意图图）——分析全局的依据。
- [ ] ARGO MCP 可用（语义检索 / getIntentElementContext / preview 工具）。

## Rules

- **MUST** 先读 `results/human-draft.md`，从中解析出完整提议集（`addElement / updateElement / removeElement / addRelationship / updateRelationship / removeRelationship / addView / updateView / removeView`）。
- **MUST** 结合**全局**分析——不只对着 draft 的字段，要用 ARGO MCP（`getSystemArchitecture` 语义检索、`getIntentElementContext`）读取 canonical 中相关元素/关系/视图及其**依赖与受影响的其它元素/视图**，再下判断。
- **MUST** 对每条**删除/破坏性**提议（`removeElement` / `removeRelationship` / `removeView`）单独给出：该对象在 canonical 被谁引用、删除会级联影响谁、是否建议保留/改挂/确认删除。
- **MUST** 对**新增/更新**提议给出：建议的 type/name/description/attributes 是否与全局命名与类型一致、是否与既有元素重复/冲突、归属哪个视图是否合理。
- **MUST** 对**视图**提议（addView/updateView/removeView）核对：成员是否落在正确层级（parent_element_id 是否合理）、删视图会否使相关 subdiagram_views 悬空。
- **MUST NOT** 未经人类裁决就执行 `applySystemArchitectureMutation`（或任何写图）。
- **MUST NOT** 读取/复述 `.env` 中的 secret，或推断任何敏感配置值。
- **MUST** 把最终产物组织成「逐条建议 + 整体风险 + 待人类裁决项」的结论，而非直接改图。

## Workflow

### 1 · 读取 Draft 提议集

解析 `results/human-draft.md`：

```jsonc
// 内嵌在 ```json 块里，每行一条提议
{"op":"addElement","kind":"element","id":null,"proposed":{...},"sourceEa":{...}}
{"op":"removeView","kind":"view","id":"176","sourceEa":{}}
```

先给出**操作统计**（add/update/remove × element/relationship/view）。

### 2 · 结合全局逐条分析

对每条提议，用 ARGO MCP 检索对应 canonical 对象及其依赖，判断：

- **删除类**：`canonical 里谁引用它？`（关系 source/target、视图 included_elements/included_relationships、subdiagram_views）——若仍有引用，建议「先改挂再删」或「标记需人类确认」。
- **新增类**：`是否与既有元素/关系重名或语义重复？type 是否规范？应挂在哪个 parent 下？`
- **更新类**：`name/description/type/attributes 改动是否与全局一致，会不会破坏别的引用？`
- **视图类**：`成员归属层级是否合理；删视图后其子视图是否悬空。`

### 3 · 形成建议清单

输出一份**逐条建议**，每条含：

- `提议`（op + id/名称）
- `分析`（结合全局：依赖/冲突/层级）
- `建议`（采纳 / 拒绝 / 修改后采纳，附理由）
- `风险`（若有）

以及一条**整体结论**：这批 draft 是否安全、有没有必须人工确认的高风险项。

### 4 · 交由人类裁决

把建议清单呈现给人类，明确问：

> 以上 N 条建议，哪些采纳、哪些修改、哪些拒绝？

**等待人类答复**之后，才进入下一步（若人类同意，才经 `previewSystemArchitectureMutation` →（确认后）`applySystemArchitectureMutation` 写回；拒绝/搁置的不写）。

## Output

输出必须包含：

1. **操作统计**：add/update/remove × element/relationship/view 的数量。
2. **逐条建议**：每条提议的分析 + 建议 + 理由 + 风险。
3. **整体结论**：这批草稿的整体风险等级、必人工确认的高风险项。
4. **待裁决问题**：明确列出需要人类拍板的条目，等待人类答复。
