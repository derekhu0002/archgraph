# ArchGraph 长期记忆评测题集（v2）

> 依据：`docs/memory-eval-benchmarks.md` 调研结论——以 LongMemEval（ICLR 2025）5 能力维度为骨架，裁剪适配「agent 元记忆」场景。
> 目的：作为 ArchGraph 长期记忆系统「读写的极致」的**可执行评测输入**。后续评测跑法见「评测运行约定」。
>
> v2 新增（2026-08-26，对齐 LLM-Wiki 双层面评测口径）：**维度 6 多跳召回**（MH-01~05，沿拓扑内链逐跳检索找全）+ **成本/压缩率评测**（Query Cost：检索上下文 token 成本与 context 压缩率，目标减 70~90%）。

---

## 0. 设计原则

1. **借维度不借场景**：保留 LongMemEval 的 5 大能力维度，把「用户-助手闲聊记忆」换成「agent 元记忆」——即意图图 + 分层 SUBVIEW 长期记忆 + 决策/里程碑/经验坑。
2. **每题三件套**：`GIVEN 记忆场景` → `WHEN 问题` → `THEN 期望答案（ground truth）`，并附 `检索提示`（应检索哪份记忆）。
3. **可验证**：期望答案全部可从当前意图图（`design/KG/SystemArchitecture.json`）验证，可回放。
4. **拒答合法**：记忆中没有的，正确答案是「拒答」，而非硬编。

---

## 1. 能力维度映射

| LongMemEval 能力 | ArchGraph 适配含义 |
|---|---|
| 信息抽取 | 从记忆里精确取出一个明确事实（某个元素/属性/关系） |
| 多会话推理 | 综合多个记忆记录/视图得出新结论 |
| 时间推理 | 依据 commit 顺序/时间戳判断先后、演进 |
| 知识更新 | 识别旧表述已被新表述取代，取最新 |
| 拒答 | 记忆里没有的内容，正确行为是拒绝回答 |
| 多跳召回（LLM-Wiki 找得全） | 顺着拓扑内链（视图/父元素/关系）逐跳检索，把深层复杂关联找全 |

---

## 2. 题集

### 维度 1：信息抽取（information extraction）

- **MQ-01**
  - GIVEN：AgentOrganization 视图（299）
  - WHEN：谁是 ArchGraph 项目的「项目总管」Business Actor？
  - THEN：`project-overseer-001`「项目总管」
  - 检索提示：`queryNeo4jGraph` 查 type='Business Actor' AND name='项目总管'

- **MQ-02**
  - GIVEN：项目总管元素
  - WHEN：项目总管的长期记忆子视图 id 与名称是什么？
  - THEN：`overseer-ltm-001`「项目总管工作记录」
  - 检索提示：查元素 `project-overseer-001` 的 subdiagram_views

- **MQ-03**
  - GIVEN：愿景元素 `overseer-vision-001`
  - WHEN：愿景三要素中「目标」是什么？
  - THEN：读写的极致（方便高效的读取 + 写入）
  - 检索提示：读 `overseer-vision-001` 描述

- **MQ-04**
  - GIVEN：长期记忆评测调研（`docs/memory-eval-benchmarks.md`）
  - WHEN：业界公认的三大长期记忆基准是哪三个？
  - THEN：LongMemEval / LOCOMO / BEAM
  - 检索提示：`getSystemArchitecture` 语义查「长期记忆评测基线」

- **MQ-05**
  - GIVEN：视频团队（`video-team-001` 视图）
  - WHEN：视频制作流程有几个 Business Actor，分别是谁？
  - THEN：3 个——视频制作 / 视频审核 / 视频制作Leader
  - 检索提示：查 `video-team-001` 视图成员

### 维度 2：多会话推理（multi-session reasoning）

- **MQ-06**
  - GIVEN：愿景「记住」的全过程
  - WHEN：项目愿景被固化在了哪些记忆层？
  - THEN：四层——图内 LTM（overseer-ltm-001）、持久用户记忆（/memories/project-vision.md）、仓库记忆、会话记忆
  - 检索提示：综合图内元素 + 记忆文件

- **MQ-07**
  - GIVEN：AgentOrganization（1962）下的团队子视图
  - WHEN：项目有几类专项团队？各是哪几类？
  - THEN：4 类——开发团队、公众号发布、媒体创作、视频创作
  - 检索提示：查 1962 的 subdiagram_views（430/433/media-team-001/video-team-001）

- **MQ-08**
  - GIVEN：愿景「总纲」与「概念校正」
  - WHEN：为什么说 ArchiMate 是「手段」而不是「目标」？
  - THEN：因为目标=读写的极致；ArchiMate 是分类编目规则（结构），服务于读写，与「结构是手段」一致
  - 检索提示：综合 `overseer-vision-001` + `overseer-archimate-role-001`

- **MQ-09**
  - GIVEN：评测工作流（`memory-eval-view-001`）
  - WHEN：长期记忆评测相关已登记元素有哪些？
  - THEN：视图 memory-eval-view-001 + WP memory-eval-bench-wp-001 + WP memory-eval-dataset-wp-001 + 里程碑 overseer-mem-eval-001
  - 检索提示：查 `memory-eval-view-001` 视图成员

- **MQ-10**
  - GIVEN：多角色团队
  - WHEN：项目里既有「人类角色」也有「专项 Agent 角色」，各举一个例子？
  - THEN：人类角色如 Xiaoming/John；专项 Agent 角色如 公众号发布员/媒体艺术家/视频制作
  - 检索提示：`queryNeo4jGraph` 列全部 Business Actor

### 维度 3：时间推理（temporal reasoning）

- **MQ-11**
  - GIVEN：愿景演进 commit 顺序
  - WHEN：「升格为总纲」（67ae3f1）与「概念校正：结构是手段」（b2324c9）哪个先发生？
  - THEN：升格为总纲先（67ae3f1 → b2324c9）
  - 检索提示：读 `overseer-vision-001` 的 commit 属性序列

- **MQ-12**
  - GIVEN：项目总管 Actor 与愿景元素
  - WHEN：「项目总管」Actor 与「项目愿景」元素哪个先创建？
  - THEN：Actor 先（4ae5c1a）→ 愿景元素后（16cea7f）
  - 检索提示：比对二者 commit 属性

- **MQ-13**
  - GIVEN：两个评测工作
  - WHEN：Terminal-Bench 评测指导 与 长期记忆评测基线调研 哪个先完成？
  - THEN：Terminal-Bench 先（8ae5cee）→ 记忆评测调研后（49b2366）
  - 检索提示：查 WP `tb-eval-guide-001` 与 `memory-eval-bench-wp-001` 的 commit

- **MQ-14**
  - GIVEN：愿景描述演进
  - WHEN：「图书馆类比」是「目标/手段校正」之前还是之后提出的？
  - THEN：之后（b2324c9 校正 → f3c5bb2 类比）
  - 检索提示：读 `overseer-vision-001` commit 属性顺序

- **MQ-15**
  - GIVEN：`overseer-vision-001` 的 commit 属性
  - WHEN：愿景描述经历了哪几个演进 commit（按时间顺序）？
  - THEN：16cea7f（记录）→ 67ae3f1（升格总纲）→ b2324c9（概念校正）→ f3c5bb2（图书馆类比）
  - 检索提示：读该元素全部 commit 属性

### 维度 4：知识更新（knowledge updates）

- **MQ-16**
  - GIVEN：愿景初始与最新表述
  - WHEN：愿景从「初始表述」到「最新表述」发生了哪些实质更新？
  - THEN：从「为 AGENT 提供长期记忆系统」→ 增加总纲（世界级最优秀）→ 增加目标/手段校正 → 增加图书馆类比
  - 检索提示：读 `overseer-vision-001` 描述（以最新 commit 为准）

- **MQ-17**
  - GIVEN：view 429 子视图
  - WHEN：SystemArchitecture 顶层视图（429）当前有多少个子视图？
  - THEN：15 个；早期 12 → 新增 tb-eval-view-001、memory-eval-view-001、self-evolution-sandbox-view-001
  - 检索提示：`getArchitectureViewContext view_id=429 includeChildViews=true`

- **MQ-18**
  - GIVEN：结构在愿景中的地位
  - WHEN：「结构」在愿景中的地位被如何修正？
  - THEN：最初被列为并列维度 → 被人类伙伴修正为「手段而非目标」
  - 检索提示：读 `overseer-vision-001` 描述 + `overseer-archimate-role-001`

- **MQ-19**
  - GIVEN：总纲加入
  - WHEN：「世界级最优秀的 AGENT 长期记忆系统」这个总纲是哪次 commit 加入愿景的？
  - THEN：67ae3f1（描述变更）
  - 检索提示：查愿景元素 commit 属性

- **MQ-20**
  - GIVEN：最新口径
  - WHEN：愿景当前完整表述应以哪个 commit 为准？为什么？
  - THEN：f3c5bb2——它是描述的最新一次变更（含图书馆类比），之后的变更只登记 commit 不再改描述
  - 检索提示：比对描述变更 commit 与登记 commit

### 维度 5：拒答（abstention）

- **MQ-21**
  - GIVEN：意图图全部内容
  - WHEN：图谱里是否记录了名为「XYZ 长期记忆系统」的某个外部系统？
  - THEN：没有——应拒答，不编造
  - 检索提示：`queryNeo4jGraph` 查该名，无结果即拒答

- **MQ-22**
  - GIVEN：项目总管的 LTM（overseer-ltm-001）
  - WHEN：项目总管的长期记忆里是否有「某具体日期的某次具体对话细节」（如 2026-07-01 某次会议）？
  - THEN：没有——应拒答
  - 检索提示：查 overseer-ltm-001 成员，无此细节即拒答

- **MQ-23**
  - GIVEN：愿景元素描述
  - WHEN：愿景元素是否记录了「界面配色偏好」等无关信息？
  - THEN：没有——应拒答
  - 检索提示：读 `overseer-vision-001` 描述，无关即拒答

### 维度 6：多跳召回（multi-hop recall / 找得全）

> 对齐 LLM-Wiki「找得全」：不仅查单点事实，还能顺着拓扑内链（视图成员 / `parent_element_id` / 关系）做多跳推理，把深层复杂关联找全。harness 的 **pick 机制**让下一步检索参数（如 elementId）由上一步结果动态派生，实现真实逐跳检索。

- **MH-01**
  - GIVEN：项目总管 LTM 视图（overseer-ltm-001）
  - WHEN：项目愿景元素挂在哪个 LTM 子视图下？该视图又挂在哪位 Business Actor 下？（两跳）
  - THEN：愿景在 `overseer-ltm-001` → 该视图挂载于 `project-overseer-001`「项目总管」（第一跳取视图 parentElement，第二跳取元素 parent）
  - 检索提示：`getArchitectureViewContext(overseer-ltm-001)` 的 parentElement → `getIntentElementContext(parentElement.id)`

- **MH-02**
  - GIVEN：项目总管 LTM 视图
  - WHEN：沿「视图→Actor→组织元素」三跳追踪，该组织元素下还有哪些团队视图？
  - THEN：1962 `AgentOrganization` 下含 299/430/433/media-team-001/video-team-001（开发/公众号发布/媒体创作/视频创作团队）
  - 检索提示：第一跳取 parentElement.id（project-overseer-001）→ 第二跳取元素 parent（1962）→ 第三跳 `getIntentElementContext(1962)` 枚举 subdiagram_views

- **MH-03**
  - GIVEN：长期记忆评测视图（memory-eval-view-001）
  - WHEN：评测工作包挂在哪个视图下？该视图又挂在哪个组织元素下？（两跳）
  - THEN：`memory-eval-view-001` 含 memory-eval-bench/dataset/run-wp-001 → 挂载于 1249「Implementation and Migration Viewpoint」
  - 检索提示：`getArchitectureViewContext(memory-eval-view-001)` → `getIntentElementContext(parentElement.id)`

- **MH-04**
  - GIVEN：公众号发布团队视图（433）
  - WHEN：公众号发布员挂在哪位组织元素下？该组织元素下还有哪些团队视图？（两跳）
  - THEN：2755「公众号发布员」在 433 → 视图父元素 1962 AgentOrganization → 同组织下还有 299/430/media-team-001/video-team-001
  - 检索提示：`getArchitectureViewContext(433)` → `getIntentElementContext(1962)`

- **MH-05**
  - GIVEN：项目总管 LTM 视图
  - WHEN：项目总管长期记忆当前包含哪些元素（找全）？其中「评测口径」是否已登记？
  - THEN：7 个——vision / archimate-role / mem-eval / query-rules / content-storage / subgraph-semantic / wiki-eval（2026-08-26 新增评测口径 `overseer-wiki-eval-001`）
  - 检索提示：`getArchitectureViewContext(overseer-ltm-001)` 枚举 included_elements，全部命中即找全

---

## 3. 评测运行约定

- **检索路径**：评测 harness 用 ARGO 语义查询（`getSystemArchitecture` / `getIntentElementContext`）与 `queryNeo4jGraph`（按类型/关系结构查询）作为记忆读取入口。
- **多跳检索**：多跳召回题（MH-*）的检索参数（如 elementId）由上一步检索结果动态派生（harness 的 pick 机制），真实沿拓扑内链逐跳检索，验证「找得全」。
- **评分流程**（对齐 Ingest→Search→Evaluate）：
  1. **Search**：对每题按其「检索提示」读取记忆；
  2. **Answer**：judge LLM 基于取回的记忆生成答案；
  3. **Judge**：judge LLM 对照 `THEN 期望答案` 判定 正确 / 错误 / 正确拒答；
- **指标**：各维度准确率、整体准确率、拒答准确率（MQ-21~23 判「正确拒答」）、单题检索时延与 token 成本。
- **成本与压缩率（Query Cost）**：对齐 LLM-Wiki「回得快且省」——统计每次检索序列化上下文的估计 token 成本（`avgRetrievedTokens`）；以全量意图图 `design/KG/SystemArchitecture.json` 的估计 token 数为「原始语料」（`rawCorpusTokens`），压缩率 = 1 − 平均检索 token / 原始语料 token，目标 ≥ 70%（context 减 70~90%）。token 估算为确定性启发式：CJK 字符按 1 token/字、其它按 1 token/4 字符（无 tokenizer 依赖，可复现）。
- **基线回放**：`THEN` 答案均可从当前意图图重放验证，保证题集长期有效。

---

## 4. 后续

1. 接评测 harness，跑出**当前实测基线**（各维度准确率 + 时延 + token + 压缩率）。
2. 以 LongMemEval 头部成绩（~94%）为「世界级」量化门槛参照，定 ArchGraph 目标。
3. 题集按需扩充（当前 v2 = 28 题：信息抽取 5 / 多会话推理 5 / 时间推理 5 / 知识更新 5 / 拒答 3 / 多跳召回 5；另附成本与压缩率评测）。
