# ArchGraph 导航能力评测题集（v1）

> 依据：项目愿景「给 AGENT 一张以 ArchiMate 为 schema 的导航地图」（2026-08-28 人类伙伴确认定位）。ArchGraph 的价值不是「检索后直接给答案」（那是 RAG / LightRAG 的定位），而是**让 AGENT 拿着地图按图索骥**——知道自己在哪、能沿语义路径去哪、能按视角切换看哪幅图、能在给定边界内找全。
> 目的：作为「读取的极致」中**导航能力**的可执行评测输入，与 `docs/memory-eval-dataset.md`（事实提取/多会话/时间/知识更新/拒答/多跳召回）互补。
>
> 区别：`memory-eval-dataset.md` 测「从记忆里取出答案」；本评测集测「AGENT 能否在这张图上导航」——不要求生成答案，只要求**正确到达图谱中的目标位置**（元素/视图/关系/边界）。

---

## 0. 设计原则

1. **导航而非问答**：每题 THEN 是「到达图谱中哪个 id/名称」，不是「事实答案是什么」。
2. **地图 schema = ArchiMate 3.2**：导航沿元素类型、关系类型（Assignment/Realization/Composition/Aggregation/Serving…）、分层与 Viewpoint 进行。
3. **三件套 + 检索路径**：`GIVEN 地图现状` → `WHEN 导航问题` → `THEN 到达的目标（ground truth）` + `检索提示`（用哪个 ARGO 工具）。
4. **可验证**：所有目标元素/视图/关系均存在于 `design/KG/SystemArchitecture.json`，可回放、可判定。
5. **边界合法**：边界内导航题要求「在 scope 内找全且不越界」，越界/漏找均判 FAIL。

---

## 1. 导航能力维度映射

| 维度 | 英文 | 测什么（导航地图类比） |
|---|---|---|
| 定位 | Locate | 语义/结构检索能否**命中正确的地图位置**（元素/视图）——「我现在在哪幅图」 |
| 可达 | Reachability | 能否**沿 ArchiMate 语义关系多跳导航**到目标——「按路标走不迷路」 |
| 视角切换 | Viewpoint | 能否**按不同 Viewpoint/分层找到正确的一幅图**——「换一本图册看」 |
| 边界内导航 | Scoped Navigation | 能否**在给定 scope 内找全且不越界**——「只在这片区域找，不跑到别区」 |

---

## 2. 题集

### 维度 1：定位（Locate）——命中正确的地图位置

- **NV-01**
  - GIVEN：意图图中有一个组织 Grouping 管理所有 Business Actor
  - WHEN：通过结构查询找到「AgentOrganization」这个组织元素
  - THEN：`1962`「AgentOrganization」(`type=Grouping`, `parent=1961`)
  - 检索提示：`queryNeo4jGraph`：`MATCH (e:Element {graphKey:$graphKey, name:'AgentOrganization'}) RETURN e.id, e.name, e.type`

- **NV-02**
  - GIVEN：项目愿景元素是长期记忆系统的北极星
  - WHEN：语义检索「项目愿景 为 AGENT 提供长期记忆系统」
  - THEN：命中元素 `overseer-vision-001`「项目愿景：为 AGENT 提供长期记忆系统」
  - 检索提示：`getSystemArchitecture` purpose=`intent-decision` intent=「项目愿景为 AGENT 提供长期记忆系统」

- **NV-03**
  - GIVEN：长期记忆评测相关视图聚合了评测工作包
  - WHEN：定位「长期记忆评测」这一视图（按视图名）
  - THEN：视图 `memory-eval-view-001`「长期记忆评测」(`parent_element_id=1249`)
  - 检索提示：`queryNeo4jGraph`：`MATCH (v:View {graphKey:$graphKey}) WHERE v.view_name='长期记忆评测' RETURN v.view_id, v.parent_element_id`

- **NV-04**
  - GIVEN：项目总管是默认对话身份 Business Actor
  - WHEN：在 AgentOrganization 视图（299）中定位「项目总管」元素
  - THEN：`project-overseer-001`「项目总管」(`type=Business Actor`)
  - 检索提示：`getArchitectureViewContext` view_id=`299`，找 type=Business Actor 且 name=项目总管

- **NV-05**
  - GIVEN：愿景三要素被 ArchiMate 定位为「分类编目规则」
  - WHEN：语义检索「ArchiMate 在长期记忆中的定位」
  - THEN：命中元素 `overseer-archimate-role-001`
  - 检索提示：`getSystemArchitecture` purpose=`intent-decision` intent=「ArchiMate 在长期记忆系统愿景中的定位」

### 维度 2：可达（Reachability）——沿语义路径多跳导航

- **NV-06**
  - GIVEN：`project-overseer-001` 是 Business Actor，`1962` 是其组织父元素
  - WHEN：从项目总管出发，沿父链上溯到所属组织
  - THEN：到达 `1962`「AgentOrganization」（`parent=1961`）
  - 检索提示：`getIntentElementContext` elementId=`project-overseer-001` → 读 `parent`；再从该 parent 上溯

- **NV-07**
  - GIVEN：`memory-eval-run-wp-001` 是挂在 `memory-eval-view-001` 视图下的评测工作包
  - WHEN：从评测工作包出发，沿视图父链上溯到视图所属的顶层 Grouping
  - THEN：到达 `1249`「Implementation and Migration Viewpoint」（顶层，parent 为空）
  - 检索提示：`getArchitectureViewContext` view_id=`memory-eval-view-001` → `parentElement.id`；再 `getIntentElementContext` 该 id 看其父链

- **NV-08**
  - GIVEN：AgentOrganization（1962）下挂多个专项团队视图（subdiagram_views）
  - WHEN：从 1962 出发，沿 subdiagram_views 找到公众号发布团队视图
  - THEN：到达视图 `433`「公众号发布团队」
  - 检索提示：`getIntentElementContext` elementId=`1962` → 读 `subdiagram_views` 中 view_name 含「公众号」

- **NV-09**
  - GIVEN：长期记忆评测视图（memory-eval-view-001）挂于 1249
  - WHEN：从该视图出发，先取其 parent（1249），再从 1249 的 subdiagram_views 找「EA Tooling」视图
  - THEN：到达视图 `1800`「EA Tooling」
  - 检索提示：`getArchitectureViewContext` view_id=`memory-eval-view-001` → parentElement.id；`getIntentElementContext` 该 id → subdiagram_views 含 EA Tooling

- **NV-10**
  - GIVEN：自进化测试环境视图与长期记忆评测视图同属 1249 的分幅
  - WHEN：从 memory-eval-view-001 上溯到 1249，再从 1249 的 subdiagram_views 找到自进化测试环境视图
  - THEN：到达视图 `self-evolution-sandbox-view-001`「自进化测试环境（Docker 沙箱）」
  - 检索提示：同上两跳

### 维度 3：视角切换（Viewpoint）——按分层/Viewpoint 找到正确的一幅图

- **NV-11**
  - GIVEN：意图图有多个顶层 Grouping（Viewpoint）
  - WHEN：找到管理「业务/组织」分幅的视图（含 AgentOrganization 1962 的视图）
  - THEN：到达视图 `299`（AgentOrganization 视图）
  - 检索提示：`getArchitectureViewContext` 遍历 1249 的 subdiagram_views，找包含 1962 的视图

- **NV-12**
  - GIVEN：视频创作团队是媒体创作体系的分幅
  - WHEN：按「媒体创作」视角找到视频创作团队视图
  - THEN：到达视图 `video-team-001`「视频创作团队」
  - 检索提示：`getIntentElementContext` elementId=`1962` → subdiagram_views 含 video-team-001

- **NV-13**
  - GIVEN：EA 工具链是独立工作区（1800 视图）
  - WHEN：按「EA 工具」视角定位 EA 工具链视图
  - THEN：到达视图 `1800`「EA Tooling」
  - 检索提示：`getArchitectureViewContext` view_id=`1249` 的 subdiagram_views（或遍历 1249 子视图找 view_name 含 EA）

- **NV-14**
  - GIVEN：公众号发布是内容发布分幅（180 视图）下的工作包
  - WHEN：按「内容发布」视角，在 180 视图内找到公众号发布团队相关视图/元素
  - THEN：`180` 视图（Content Publication and Announcement）或其成员（含公众号发布员 2755 相关 WP）
  - 检索提示：`getArchitectureViewContext` view_id=`180`

- **NV-15**
  - GIVEN：自进化测试是工程/验证视角的工作
  - WHEN：按「工程验证」视角，从 1249 的 subdiagram_views 找到 Docker 沙箱视图
  - THEN：到达视图 `self-evolution-sandbox-view-001`
  - 检索提示：`getIntentElementContext` elementId=`1249` → subdiagram_views 含 self-evolution-sandbox-view-001

### 维度 4：边界内导航（Scoped Navigation）——scope 内找全且不越界

- **NV-16**
  - GIVEN：长期记忆评测视图（memory-eval-view-001）是评测工作包的边界
  - WHEN：在该视图边界内找全全部成员元素
  - THEN：恰好包含 `memory-eval-bench-wp-001`、`memory-eval-dataset-wp-001`、`memory-eval-run-wp-001`（且不包含评测之外的其它元素）
  - 检索提示：`getArchitectureViewContext` view_id=`memory-eval-view-001` → included_elements 恰好 3 个

- **NV-17**
  - GIVEN：`overseer-ltm-001` 是项目总管长期记忆子视图的边界
  - WHEN：在该边界内找全项目总管的历史记忆元素
  - THEN：包含 `overseer-vision-001`（至少），全部在 LTM 视图内（不越界到其它 Actor 的 LTM）
  - 检索提示：`getArchitectureViewContext` view_id=`overseer-ltm-001` → 成员全部以 `overseer-` 前缀开头

- **NV-18**
  - GIVEN：AgentOrganization（1962）是组织边界
  - WHEN：在该边界内找全其直属子视图（subdiagram_views）
  - THEN：包含 430/433/media-team-001/video-team-001 等（组织下全部团队视图，且不含 1249 直属的评测/工具视图）
  - 检索提示：`getIntentElementContext` elementId=`1962` → subdiagram_views（应与 1249 的直属子视图区分）

- **NV-19**
  - GIVEN：长期记忆评测视图（memory-eval-view-001）是评测工作包的边界
  - WHEN：在该视图边界内找全成员，且确认不含视图外元素（结构验证）
  - THEN：恰好包含 memory-eval-bench/dataset/run-wp 三个 WP，且不含 2760/EA Tooling/video-team-001 等越界元素
  - 检索提示：`getArchitectureViewContext` view_id=`memory-eval-view-001`（只检查 members，见判定口径）

- **NV-20**
  - GIVEN：EA 工具链边界是 1800 视图
  - WHEN：在该视图边界内找全成员，且确认不含评测/记忆视图元素（结构验证）
  - THEN：包含 2758/2760 等 EA 工具链元素，且不含 memory-eval-view-001/overseer-ltm-001
  - 检索提示：`getArchitectureViewContext` view_id=`1800`（只检查 members）

---

## 3. 判定口径

- **定位/可达/视角**：到达的目标 id/名称与 ground truth 一致（确定性字符串/结构包含）。
- **边界内导航**：只检查视图**成员集合**（elements），确认恰好的成员 + 无越界元素（expectAbsent）；不把 parent 上下文的 subdiagram_views 计入边界判定。
- **拒导航**：导航到不存在的目标时，正确行为是报告「目标不在图中」，不得硬编。
- 注：`getSystemArchitecture` 的 scope 语义检索在宿主 repo 模式下因语义生命周期 env 信任（`argo/.env` 含 DEEPSEEK 非白名单键）与 scope 命中稳定性问题，暂不用于边界题；边界题用结构验证（`getArchitectureViewContext` members）保证可复现。

## 4. 检索工具约定

- `queryNeo4jGraph`：结构查询（按 name/id/type 精确定位）
- `getArchitectureViewContext`：视图成员与父链（定位分幅、边界内找全）
- `getIntentElementContext`：元素上下文（父链/subdiagram_views/语义邻居，多跳导航）
- `getSystemArchitecture`：语义检索（语义定位、scope 限定边界）
