# ACTOR 三层记忆模型（工作记忆 / 长期记忆 / 档案）

> 对齐北极星：为 AGENT 提供长期记忆系统，目标是**读写的极致**。本设计解决一个实际约束——
> **一个 ACTOR 的记忆可能太多，无法全部加载进上下文**（会撑爆上下文），因此需要像人类记忆一样分层：
> 短期（意识区）/ 长期（需回忆唤起）/ 更长期（笔记档案）。
> 状态：设计已对齐（2026-08-30）。载体：意图图 + 分层 SUBVIEW + ARGO MCP。

## 一、三层模型

| 层 | 视图约定 | 内容 | 上下文规模 | 访问方式 |
|---|---|---|---|---|
| **T1 工作记忆**（意识区） | `<actor>-wm-001` | 身份+职责、当前任务、最近记忆摘要、会话钩子 | ≤2~4K token（必进上下文） | 会话开始直接加载 |
| **T2 长期记忆**（可回忆） | `<actor>-ltm-001`（即现有 LTM 子视图） | 全部里程碑/决策/教训/commit 台账 | 中（命中才加载） | `memory_search` 语义回忆 → `getIntentElementContext` 取全文 |
| **T3 档案**（更长期） | `<actor>-archive-001` | 已完结/封存的旧记忆 | 大（显式检索才读） | 结构化枚举 / 语义检索 |

现有 `overseer-ltm-001` 这类**就是 T2**——只需补 T1 与 T3，不动存量。

## 二、机制设计

### A. T1 摘要怎么生成 —— 静态摘要元素 + 最近 N 条（混合）
- 写入侧维护静态摘要元素 `<actor>-wm-001`：每次会话收尾把「本次要点 + 未完成项 + 关键指针」写入（幂等覆盖，不追加）
- 加载侧：直接读该元素（零计算）+ 按 freshness 取最近 N 个 T2 元素的紧凑卡片（复用 `memory_search` 的 `max_desc_len=800` 卡片格式）
- 理由：读取极致（T1 加载几乎零成本、确定性）；不依赖每次会话跑 LLM 动态摘要（贵、不稳定）

### B. T2/T3 切分 —— 视图分层为主 + 自动归档规则
- **物理分区**：T2/T3 是不同的子视图，元素归属决定层级（与现有 subdiagram_views 机制一致，导航/枚举天然支持）
- **自动归档规则**：元素 `deliveryStatus=delivered` 且超过 N 天无引用 → 移入 `<actor>-archive-001`；或人类/主管显式归档
- 记忆元素带辅助属性 `memoryTier: T2|T3`（可选，用于检索过滤）

### C. STEP 0 加载策略 —— 只加载 T1，绝不加载 T2/T3 全量
- WakeupGuideline STEP 0 改为三件事：① 定位 Actor（身份）② 加载 T1 摘要（静态元素 + 最近 N 条）③ 恢复「会话钩子」（上次未完成项/关键决策指针 1~2 个）
- T2 靠 `memory_search` 回忆，T3 显式检索——这是「不撑爆上下文」的解

### D. 回忆两步法 —— 固化进规则
- 第 1 步 `memory_search`（语义，宽松阈值）→ 紧凑卡片定位
- 第 2 步 命中 → `getIntentElementContext` 取全文
- 理由：A/B 第 7 轮实测——agent 不取全文是丢分主因，必须把「两步」写成硬性规则而非自由发挥

### E. 阈值分层 —— 回忆宽松、拒答严格
- T2 回忆用宽松阈值（`ARGO_SEMANTIC_MEMORY_THRESHOLD=0.55`）
- 只有「零命中/语义无关」才拒答；不为低分命中拒答（0.8 阈值教训）

### F. 归档机制 —— 只移不删
- 会话收尾更新 T1 摘要 → 满足归档规则（delivered+过期）的记忆移入 T3 视图
- 归档不删，进档案仍可检索（结构化枚举/语义均可达）

## 三、会话收尾触发 —— 不靠 LLM 精确判断「会话结束」

**核心原则**：把「会话结束」从「必须精确检测」降级为「锦上添花的汇总」——关键内容不依赖它兜底。

1. **关键内容靠里程碑即时写入**（可靠，不依赖会话结束识别）：`MemoryTriggerTiming` 的踩坑/修复、关键决策、任务/切片/提交完成时**当场写**——这些触发点 Agent 一定知道。即使最终摘要漏写，关键内容早已入账，零数据丢失。
2. **会话摘要靠「显式信号 + 机会式」**：
   - 显式信号（最可靠）：人类说「结束/收尾/总结」→ 触发写摘要
   - 机会式：Agent 完成用户最后请求、回合自然结束时，**主动在本回合结束前**写摘要——成本低、可幂等
3. **幂等覆盖**：T1 摘要写**同一个** `<actor>-wm-001` 元素（覆盖更新，不追加）——多次触发只覆盖，不膨胀（写放大可控的关键）
4. **下会话自检（兜底）**：新会话 STEP 0 检查 T1「上次会话时间戳」陈旧/缺失 → 标记「上次未正常收尾」；上下文已丢则只提示人类可补充，不试图恢复内容（内容已在①入账）

**对 Agent 的判定规则**：不要把「判断会话结束」当负担——触发是「人类显式要求」或「回合已无新任务且自然收尾」，且写了能再覆盖，宁可写早写多次。

## 四、落地路径

1. **图内登记**：本项目总管 LTM 新增 Principle `overseer-memory-tiers-001`（挂 overseer-ltm-001）+ 本设计文档 + 可执行验收用例
2. **规则改造**：`archgraph.instructions.md` 的 `SessionMemorySummarization` 改为「里程碑即写为主 + 会话摘要机会式幂等覆盖为辅」；`WakeupGuideline STEP 0` 改为「只加载 T1 摘要 + 会话钩子」
3. **视图约定**：新建 `<actor>-wm-001`（T1）、`<actor>-archive-001`（T3）约定；存量 LTM 视图即 T2
4. **实现**（后续切片）：T1 摘要元素读写、归档迁移规则、STEP 0 分层加载、回忆两步法固化、阈值分层
5. **评测**：为 T2 回忆补充评测（含「摘要定位→取全文」两步的用例），验证「查得准 + 不撑爆上下文」

## 实现状态

- **Phase 0 ✅**：设计文档 + Principle `overseer-memory-tiers-001` + AT-actor-memory-tiers-01
- **Phase 1 ✅（规则层）**：`SessionMemorySummarization`/`MemoryTriggerTiming`（里程碑即写主干 + 会话摘要机会式幂等覆盖）；`WakeupGuideline STEP 0`（只加载 T1，T2/T3 按需回忆）
- **Phase 2 ✅（视图约定落地）**：T1 视图 `overseer-wm-001`「项目总管工作记忆」+ T3 视图 `overseer-archive-001`「项目总管档案」（均挂 project-overseer-001）+ T1 摘要元素 `overseer-wm-summary-001`（memoryTier=T1）
- **memoryTier 约定**：记忆元素带 `memoryTier: T1|T2|T3` 属性（T1=工作记忆必进上下文 / T2=长期记忆按需回忆 / T3=档案显式检索），用于检索过滤
- **Phase 3 ✅（T1 摘要读写机制）**：`scripts/actor-working-memory.js`（loadWorkingMemoryDigest 只读 / writeWorkingMemory 幂等覆盖不追加）+ AT-overseer-wm-01
- **Phase 4 ✅（归档迁移）**：`scripts/memory-archive.js`（delivered/COMPLETED+年龄门；只移不删；无日期安全跳过）+ AT-memory-archive-01
- **Phase 5 ✅（回忆两步法+阈值分层，框架级）**：规则 `<MemoryRecallGuideline>`（memory_search 宽松 0.55 定位 → getIntentElementContext 取全文；audit 严格 0.8；零命中才拒答）
- **Phase 6 ✅（T2 回忆评测，框架级）**：memory-eval 新增维度 7 两步回忆（TR-01~03），harness 31/31（100%）；验证定位→取全文、低分相关命中召回、无关不虚构
