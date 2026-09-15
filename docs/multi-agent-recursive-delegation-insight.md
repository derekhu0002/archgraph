# 框架级「可递归派生/委派的通用 Agent 定义与协作机制」业界洞察

> 执行：业界技术洞察团队（洞察Lead `insight-lead-001` 编排，麦肯锡新五步法）
> 日期：2026-09-15
> 交付形态：洞察报告（结论先行 / 论据支撑 / 可执行建议）

---

## 0. 核心结论（一句话结论 / 结论先行）

**部分是（Partially）。** 业界已经成体系地存在「**框架级、可递归派生/委派 Agent**」的机制（Claude Code subagents 默认支持**向下 3 层**的递归派生、Anthropic 研究系统的 orchestrator-worker、AutoGen nested teams、Google ADK collaborative workflows、LangGraph 子图/层级团队）；但人类伙伴设定中的「**单一通用角色 + 派生权限一路无差别继承**」**并非业界主流**——业界主流是「**专精角色 + 继承但单调收窄（least-privilege）**」。四步设定里，**递归派生**与**结果回馈重拆**有充分先例；**单一通用角色**只有弱先例（generic catch-all agent）；**派生权限无差别继承**与业界安全实践**直接冲突**，需改造为「继承但权限不放大」。

**置信度**：高（结论由 14 个一手来源交叉支撑；唯一系统性局限见 §6）。

---

## 1. 界定问题（Step 1）

### 1.1 问题陈述
> **业界是否已经存在「框架级的、可递归派生/委派的通用 Agent 定义与协作机制」？代表方案有哪些？它们的 Agent 定义、继承与权限模型各是什么？优缺点与落地模式如何？对 ArchGraph 的 Graph 框架集成有哪些可复用/应规避的参考？**

### 1.2 目标
把人类伙伴的诉求（把「复杂多 Agent 协作模式」做成 ArchGraph Graph 框架的框架级机制）落到**可决策的业界事实**上：不是设计 ArchGraph 的实现，而是回答「业界有没有、怎么做的、坑在哪」。

### 1.3 范围
- **设计范式**：orchestrator-worker、handoff、agent-as-tool、递归/动态 spawn、blackboard/共享状态。
- **具体框架/协议**：Claude Code subagents、Anthropic 多 Agent 研究系统、OpenAI Swarm/Agents SDK、AutoGen、CrewAI、Google ADK、LangGraph、Google A2A、MCP。
- **工程落地模式**：上下文工程、压缩交接、权限与继承、深度/预算护栏、失败模式。
- **时间**：近 1–2 年为主，回溯奠基工作（Anthropic《Building effective agents》2024-12）。

### 1.4 成功标准
① 代表方案清单（含 Agent 定义/委派方式/权限继承模型/优缺点）；② 对人类伙伴 4 条设定逐条「支持度 + 证据 + 风险」；③ 对 ArchGraph 集成的可执行建议（含反模式）。

### 1.5 约束
- 验证阶段**必须**经 BAILIAN MCP（bl search web）全网收集。**本会话该通道不可用（见 §6）**，已改用真实联网抓取（`webfetch`）并如实标注，不以模型记忆冒充验证结论。
- 每条结论标注来源与置信度。

---

## 2. 拆解问题（Step 2）—— MECE 议题树

```
Q0 业界是否存在「框架级可递归派生的通用 Agent 定义与协作机制」？
├─ Q1 递归/动态派生：框架是否支持子 Agent 再派生子 Agent？上限与护栏？
│   ├─ Q1.1 Claude Code subagents 的递归深度与隔离
│   ├─ Q1.2 Anthropic orchestrator-worker 的动态 spawn
│   └─ Q1.3 agent-as-tool / dynamic spawn 范式
├─ Q2 委派与交接（handoff）：控制权如何在 Agent 间转移？
│   ├─ Q2.1 OpenAI Swarm → Agents SDK handoffs
│   ├─ Q2.2 AutoGen teams（RoundRobin/Selector/MagenticOne/Swarm）+ GraphFlow
│   ├─ Q2.3 CrewAI sequential/hierarchical/hybrid
│   ├─ Q2.4 LangGraph supervisor / 层级团队 / 子图
│   └─ Q2.5 Google ADK collaborative / template / graph workflows
├─ Q3 互操作与定义注册：Agent 定义如何被描述、发现、注册？
│   ├─ Q3.1 Google A2A AgentCard / AgentSkill / AgentCapabilities
│   └─ Q3.2 MCP（工具侧）与 Agent 定义文件注册
├─ Q4 通用角色 vs 角色专精：主流是哪种？「单一通用 + 派生继承定义」可行性？
├─ Q5 权限与继承：subagent 的 tool allowlist / least-privilege；派生继承的安全风险
│   ├─ Q5.1 继承语义（Claude Code permissionMode 继承）
│   └─ Q5.2 风险（权限放大、越权、confused deputy、token passthrough）
├─ Q6 上下文工程依据：「上下文过大→Agent 变笨」是否有权威事实支撑？
│   ├─ Q6.1 context rot / 注意力预算
│   └─ Q6.2 对策：compaction / note-taking / sub-agent isolation
└─ Q7 图/共享状态作为协作底座：blackboard / graph 编排 / 图式记忆
```

**MECE 校验**：Q1（派生）与 Q2（交接）互斥（前者是「生成新执行体」，后者是「转移控制权」）；Q3 覆盖「定义与发现」；Q4–Q5 覆盖「角色与权限」；Q6–Q7 覆盖「为什么与靠什么」。七支穷尽三类范围。

---

## 3. 提出假设（Step 3）

| # | 假设 | 对应子问题 |
|---|------|-----------|
| H1 | 已有框架支持子 Agent 递归派生，且**默认设深度上限**（非无限递归）。 | Q1 |
| H2 | handoff/委派是主流一等原语，但主流是**专精角色**间的转移。 | Q2, Q4 |
| H3 | Agent 定义已有**注册/发现**标准（A2A AgentCard），但面向「跨组织互操作」而非「同框架内派生继承」。 | Q3 |
| H4 | 「单一通用角色」**非主流**，但存在 generic catch-all agent 的弱先例。 | Q4 |
| H5 | 子 Agent **默认继承父权限**，但业界以 **tool allowlist/least-privilege 收窄**；「派生权限无差别继承」与安全实践冲突。 | Q5 |
| H6 | 「上下文过大→变笨」有**权威实证**（context rot / 注意力预算）。 | Q6 |
| H7 | 图/共享状态（blackboard）是多 Agent 协作的有效底座，但**并发写同一状态**是已知失败点。 | Q7 |

---

## 4. 验证假设（Step 4）—— 证据与结论

> 检索通道：BAILIAN MCP 本会话不可用（§6），改用 `webfetch` 真实抓取 14 个一手来源（官方文档 / 官方 GitHub 源码 / 权威技术报告 / 工程博客）。逐条标注来源与置信度。

### H1 递归派生——**成立（有界）**｜置信度：高
- **Claude Code**（官方文档）：*"By default, a subagent can spawn subagents of its own, **up to three layers below the main conversation**. At the depth limit, Claude Code withholds the `Agent` tool... To change the limit, set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`."* 且 *"Each subagent starts with a **fresh, isolated context window**."*
  → 递归派生**是一等能力**，但**默认硬性深度上限 = 3 层**，且超限时工具被收回，子 Agent 只能自己完成并回一份摘要。
- **Anthropic 多 Agent 研究系统**（官方工程博客 2025-06-13）：*"the LeadResearcher synthesizes these results and decides whether more research is needed—if so, it can **create additional subagents or refine its strategy**."*
  → 动态派生已产品化；同时暴露失败模式：*"Early agents made errors like **spawning 50 subagents for simple queries**"*。
- **AutoGen / ADK / LangGraph**：nested teams、collaborative workflows、子图/层级团队均支持嵌套（见 H2）。
- **结论**：H1 成立，但**必须带深度与数量上限**——业界无一采用「无限递归」。

### H2 委派/交接是主流原语——**成立**｜置信度：高
- **OpenAI Agents SDK**（官方文档）：*"Handoffs are represented as **tools** to the LLM"*（工具名 `transfer_to_<agent_name>`），支持 `input_filter` 过滤历史、`Agent.as_tool(...)` 做「不转移对话的结构化子调用」。
- **OpenAI Swarm**（官方 GitHub README）：两个原语 `Agents` + **handoffs**；*"An `Agent` can at any point choose to hand off a conversation to another `Agent`"*；标注为 **experimental/educational**，已被 Agents SDK 取代。
- **AutoGen**（官方文档）：团队预设 `RoundRobinGroupChat` / `SelectorGroupChat` / `MagenticOneGroupChat` / **`Swarm`（用 `HandoffMessage` 转移）**，另有 GraphFlow；且明确 *"start with a single agent for simpler tasks, and **transition to a multi-agent team when a single agent proves inadequate**"*。
- **CrewAI**（官方文档）：sequential / **hierarchical** / hybrid 三类 process。
- **Google ADK**（官方文档）：graph workflows / dynamic workflows / **collaborative workflows（单 coordinator + 子 Agent）** / template workflows（sequential/loop/parallel）；Agent Routing 为实验特性。
- **LangGraph**（官方 GitHub README）：*"low-level orchestration framework for building, **stateful** agents"*，durable execution / HITL / memory；高层封装 Deep Agents *"can plan, **use subagents**, and leverage file systems"*。
- **结论**：H2 成立。handoff/委派是跨框架共识原语。

### H3 定义注册/发现标准存在——**成立（但定位不同）**｜置信度：中高
- **Google A2A v1.0.0**（官方规范）：核心是 **AgentCard**（身份、capabilities、skills、endpoint、认证要求）+ `AgentCapabilities` / `AgentSkill` / `AgentInterface` / `AgentCardSignature`；设计原则为 **Opaque Execution**——*"agents collaborate based on declared capabilities... **without needing access to each other's internal state, memory, or tools**"*。
- **MCP**：工具侧接入标准（非 Agent 定义注册）。
- **结论**：H3 成立。但 A2A 的注册面向**跨组织互操作（黑盒发现）**，**不提供**「同框架内父子派生 + 定义继承」语义——这正是人类伙伴诉求的空白区。

### H4 「单一通用角色」——**弱成立（非主流）**｜置信度：中
- **主流是专精角色**：Claude Code 开篇即 *"Subagents are **specialized** AI assistants"*；OpenAI handoff 示例为 billing/refund/FAQ 专精；AutoGen 示例为 primary + critic；CrewAI 有 role/goal/backstory。
- **弱先例**：Claude Code 内置 **`general-purpose`** 子 Agent（*"A catch-all with every tool"*）与 `claude`（*"When a task doesn't fit a more specialized agent. A catch-all"*）；**Anthropic 研究系统的 worker 是「同一通用定义 + 不同任务描述」的同构 Agent**——更接近人类伙伴的设想。
- **反证**：Claude Code 明确警告子 Agent 描述过多会挤占上下文（超过 15,000 token 触发启动告警）——**「单一通用角色」反而规避了这一成本**。
- **结论**：H4 成立（弱）。「通用 Agent + 任务契约」在 orchestrator-worker 里成立，但「靠角色专精换质量」是主流取舍。

### H5 权限继承——**成立但被收窄；「无差别继承」被证伪**｜置信度：高（本洞察关键）
- **继承存在**（Claude Code）：内置子 Agent *"Each **inherits the parent conversation's permissions**"*；`permissionMode` 未设时*"the subagent **inherits** the main conversation's mode"*。
- **但被收窄**：*"most run with a **restricted tool set**"*；提供 `tools`（allowlist）与 `disallowedTools`（denylist）；*"Subagents **inherit** the built-in tools... **narrowed by two filters**"*；插件来源的子 Agent **被禁止**设置 `hooks`/`mcpServers`/`permissionMode`（安全原因）。
- **安全实践直接冲突**：
  - **MCP 安全最佳实践**（官方规范）：明确 **scope minimization / progressive least-privilege**（*"Minimal initial scope set... **Incremental elevation**"*），并把 **token passthrough 列为 anti-pattern**；风险点包含 **privilege chaining**（*"attacker can immediately invoke high-risk tools without further elevation prompts"*）与 **expanded blast radius**。
  - **confused deputy** 被 MCP 列为需要专门缓解的攻击面。
- **结论**：H5 成立，且**证伪了「打开派生权限、一路沿用同一通用定义」的无差别继承**：业界共识是「**继承（default inherit）但单调收窄（≤ 父权限）**」。人类伙伴的设想若无深度/权限护栏，等于**权限放大（privilege amplification）**。

### H6 「上下文过大→变笨」——**成立（强实证）**｜置信度：高
- **Chroma《Context Rot》技术报告**（2025-07-14，18 个模型）：*"models do not use their context uniformly; instead, their performance grows **increasingly unreliable as input length grows**"*；即使**任务难度固定、仅增加输入长度**，性能仍下降；LongMemEval「focused(~300 token) vs full(~113k token)」全模型显著劣化。
- **Anthropic 上下文工程**（官方工程博客 2025-09-29）：*"as the number of tokens in the context window increases, the model's ability to accurately recall information... **decreases**"*；成因是注意力预算 + transformer 的 **n² pairwise** 关系；结论 *"Context... must be treated as a **finite resource**"*。
- **结论**：H6 成立。人类伙伴的前提**有权威实证支撑**（高置信度）。

### H7 图/共享状态作协作底座——**成立，但并发写是失败点**｜置信度：中高
- **LangGraph**：以 **graph + state** 为核心，durable execution / memory（README）；被 **Pregel / Apache Beam** 启发。
- **Anthropic**：*"Subagent output to a **filesystem** to minimize the 'game of telephone'"*——用外部持久化状态做「共享黑板」，只回轻量引用。
- **反证（关键）**：**Cognition《Don't Build Multi-Agents》**（2025-06-12）提出两原则——*"**Share context**, and share full agent traces, not just individual messages"*、*"**Actions carry implicit decisions**, and conflicting decisions carry bad results"*；指出并行子 Agent 基于**未事先约定的冲突假设**行动，会产生**不一致的合并结果**，并明确 Claude Code 子 Agent *"never does work in parallel... usually only tasked with answering a question"*。
- **结论**：H7 成立。图/共享状态是有效底座，但**多 Agent 并发写同一状态**是已证失败点，需单写者/锁。

---

## 5. 综合建议（Step 5）—— 最终洞察交付

### 5.1 代表方案清单（对比）

| # | 方案 | Agent 定义方式 | 委派/派生方式 | 权限继承模型 | 一句话优缺点 |
|---|------|---------------|--------------|-------------|-------------|
| 1 | **Claude Code subagents** | Markdown + YAML frontmatter（`name/description/tools/model/permissionMode`…），文件系统注册（`.claude/agents/`、`~/.claude/agents/`、plugin） | 内置 `Agent` 工具（原 Task）委派；**子 Agent 可再派生子 Agent，默认深度 3 层**（`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`） | **继承父权限** + `tools`/`disallowedTools` **收窄**；插件子 Agent 禁用 `hooks/mcpServers/permissionMode` | 优：定义即文件、隔离上下文、递归有界、权限可收窄；缺：偏专精角色、深度/数量需自设 |
| 2 | **Anthropic 多 Agent 研究系统** | 同构 worker + 任务契约（objective/output format/tool guidance/boundaries） | orchestrator-worker：lead **动态 spawn** 并行子 Agent，可按需**追加子 Agent 或改策略** | 未强调逐级权限继承；靠**委派提示 + guardrails + 预算**控制 | 优：并行探索、压缩交接（子 Agent 回 1–2k token）、实证 +90.2%；缺：token ~15×、同步执行成瓶颈、易过度 spawn |
| 3 | **OpenAI Swarm → Agents SDK** | `Agent(instructions, functions, tools)` | **handoff 即工具**（`transfer_to_x`）；`Agent.as_tool()` 结构化子调用；`input_filter` 裁剪历史 | 无内建逐级权限模型；靠应用层/`RunContext` | 优：原语极简、可测；缺：Swarm 已废弃、无权限继承语义、偏专精 |
| 4 | **AutoGen** | `AssistantAgent`（system_message + tools） | 团队预设：RoundRobin / Selector / MagenticOne / **Swarm（HandoffMessage）**；**nested teams**、GraphFlow | 无内建权限继承；团队共享上下文 | 优：团队拓扑丰富、可嵌套；缺：共享上下文=context rot 风险、权限模型缺位 |
| 5 | **CrewAI** | Agent（role/goal/backstory/tools）+ Task | sequential / **hierarchical**（manager 委派）/ hybrid process | 无内建逐级权限继承 | 优：角色化开箱即用、hierarchical 现成；缺：强角色范式，与「单一通用角色」相悖 |
| 6 | **Google ADK** | Agent + 可组合节点；Agent Config | graph / dynamic / **collaborative（单 coordinator + 子 Agent）** / template（seq/loop/parallel）；A2A 暴露 | 无内建逐级权限继承；有 confirmation / auth 工具层 | 优：workflow 谱系完整、原生 A2A；缺：新（2.0 图能力）、权限继承非重点 |
| 7 | **LangGraph** | 低层编排：图 + 状态；Deep Agents 高层封装 | supervisor / 层级团队 / **子图**；`deepagents` 原生「用子 Agent」 | 无内建逐级权限继承；靠 HITL interrupt 控制 | 优：状态/持久化/可恢复最强、图即协作底座；缺：低层、需自建权限与预算 |
| 8 | **Google A2A（v1.0.0）** | **AgentCard**（身份/capabilities/skills/endpoint/auth）+ AgentSkill | 任务委派（SendMessage/Task 生命周期）；**黑盒**（Opaque Execution） | 传输层安全方案（OAuth2/mTLS/APIKey）+ **in-task authorization**；不定义父子派生继承 | 优：跨组织发现与互操作标准；缺：**不覆盖同框架内派生继承**（正是本项目空白） |

### 5.2 对人类伙伴 4 条设定的逐条裁决

| 设定 | 业界支持度 | 证据要点 | 风险 |
|------|-----------|---------|------|
| **① 单一通用角色（非多专精角色）** | **弱支持** | Claude Code 内置 `general-purpose`/`claude` catch-all；Anthropic worker 为同构通用 Agent + 任务契约 | 主流靠专精换质量；通用化易使**路由/边界模糊**（Anthropic：委派描述不清→重复劳动/留缺口） |
| **② 递归派生（子 Agent 再派生子 Agent）** | **支持（必须有界）** | Claude Code 默认 **3 层**上限 + 超限收工具；Anthropic lead 可追加子 Agent | 无深度/数量上限 → **成本爆炸、错误复合**（Anthropic 早期「简单问题 spawn 50 个子 Agent」） |
| **③ 结果回馈主 Agent 重新拆分** | **支持** | Anthropic：lead 综合结果后**决定是否再派子 Agent 或改策略**；evaluator-optimizer 循环；`Agent.as_tool` 回传调用方 | 结果经协调者转述会**信息损耗**（"game of telephone"）；应回压缩摘要而非全量历史 |
| **④ 派生权限一路沿用同一通用定义（打开派生权限）** | **不支持（与业界冲突）** | Claude Code 虽**继承**父权限，但一律 **tool allowlist 收窄**；MCP 强制 **least-privilege + progressive scope**、把 **token passthrough 列为反模式**、点名 **privilege chaining / expanded blast radius / confused deputy** | **权限放大**：深度 N 的任一子 Agent 被提示注入即获得父级全权；越权、审计失效、越权链式调用 |

**综合裁决**：设定 ②③ 可直接落地；设定 ① 可落地但需以「任务契约」补足专精缺失；设定 ④ **必须改造**——保留「继承」，但加入「**权限单调不放大 + 深度/数量上限 + 写入门禁**」三条护栏。

### 5.3 对 ArchGraph Graph 框架集成的建议（可执行）

**R1 采用 orchestrator-worker + 有界递归（照搬 Claude Code 的默认值）**
主 Agent 拆解→委派；子 Agent 可递归，但设**硬性深度上限（默认 3 层）**与**并发子 Agent 数量上限**；把「继续递归」设为**异常路径**（默认不递归），并写死「超限即自行完成并回一份摘要」。依据：Claude Code depth limit、Anthropic「scale effort to query complexity」。

**R2 用「单一通用定义 + 任务契约」替代角色专精，但契约必须四要素齐全**
每个委派携带 **objective / output format / tool guidance / task boundaries**。依据：Anthropic 明确「无详细任务描述→子 Agent 重复劳动、留缺口、误搜」。**规避**：只给一句模糊指令。

**R3 结果回馈做「压缩交接」，大产物落图谱/文件（图谱即共享黑板）**
子 Agent 只回 **1–2k token 结构化摘要**，重产物写入图谱元素/文件并回**轻量引用**。依据：Anthropic sub-agent 返回 1,000–2,000 token、subagent output to filesystem 抗「game of telephone」。

**R4 权限「继承但单调收窄」——这是对人类伙伴设定的强制修正**
派生 Agent 权限 **≤ 父 Agent**（allowlist 表达，参照 Claude Code `tools`/`disallowedTools`）；**禁止**派生 Agent 自我提权或新增未授权工具；沿用本项目既有铁律：**图谱写入必须经 ARGO MCP `preview→apply` 门禁**。依据：MCP least-privilege / token passthrough anti-pattern / confused deputy / privilege chaining。

**R5 以图谱状态为协作底座，但对同一 ArchiMate 元素强制「单写者」**
用图/状态做 blackboard（LangGraph 式 durable state）；**同一元素/视图同一时刻只允许一个 Agent 写**（锁或串行化）。依据：Cognition「actions carry implicit decisions」——并行子 Agent 的冲突假设会导致不一致合并。

**应规避的反模式（Anti-patterns）**
1. ❌ **无深度/数量上限的递归派生**（→成本爆炸、错误复合）。
2. ❌ **权限放大继承**（子 Agent 权限 ≥ 父 Agent；self-escalation）。
3. ❌ **把完整对话历史全量传给每个子 Agent**（→context rot，H6）。
4. ❌ **为简单任务过度 spawn 子 Agent**（Anthropic「50 个子 Agent」）。
5. ❌ **多子 Agent 并行写同一图谱区域**（→冲突合并，Cognition）。
6. ❌ **结果全量经协调者转述**（→信息损耗，应用压缩摘要+产物落盘）。
7. ⚠️ **一开始就上多 Agent**：Anthropic 与 AutoGen 都建议「**先用单 Agent，证明不足再升级**」；Cognition 更主张「单线程 Agent + 压缩模型」在编码域往往更稳。ArchGraph 集成应先做**最小递归委派闭环**，用验收用例证明收益后再放开。

---

## 6. 局限与检索通道说明（诚实声明）

- **BAILIAN MCP（bl search web）本会话不可用**，具体卡点：
  1. 本会话工具面**未挂载** `bailian-websearch` MCP 工具（仓库 `opencode.json` 虽配置了该远端 MCP，但当前会话未加载其工具）；
  2. 环境变量 **`DASHSCOPE_API_KEY` 未设置**（`argo/.env` 受 ACL 保护且示例仅含 `QWEN_KEY`）；
  3. 直连 `https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp` 返回 **401 Unauthorized**。
- 因此本轮**未完成 BAILIAN 全网收集**，改用 **`webfetch` 真实抓取 14 个一手来源**（非模型记忆）。**覆盖局限**：未覆盖中文技术社区（知乎/CSDN/掘金）、YouTube、以及 GitHub issue 级讨论；代表方案选取以官方一手文档为主，可能遗漏小众框架。
- 与团队先例一致（`insight-lead-milestone-tablet-app-001`、`insight-lead-milestone-ea-tool-frontend-001` 同样在 BAILIAN 未挂载时改用 webfetch 并如实标注）。

---

## 7. 来源清单

| # | 来源 | 类别 | 用途 |
|---|------|------|------|
| S1 | Anthropic《How we built our multi-agent research system》(2025-06-13) | 官方工程博客 | H1/H2/H6/H7 orchestrator-worker、+90.2%、压缩交接 |
| S2 | Anthropic《Effective context engineering for AI agents》(2025-09-29) | 官方工程博客 | H6 context rot、注意力预算、compaction/note-taking/sub-agent |
| S3 | Anthropic《Building effective agents》(2024-12-19) | 官方工程博客 | H2/H4 范式（orchestrator-workers、evaluator-optimizer）、「先简单后复杂」 |
| S4 | Claude Code《Create custom subagents》官方文档 | 官方文档 | H1 递归 3 层、H5 权限继承与收窄、H4 general-purpose |
| S5 | OpenAI Agents SDK《Handoffs》官方文档 | 官方文档 | H2 handoff-as-tool、input_filter、Agent.as_tool |
| S6 | OpenAI Swarm GitHub README | 开源代码 | H2 Agents+handoffs 原语（experimental） |
| S7 | Microsoft AutoGen《Teams》官方文档 | 官方文档 | H2 团队预设/HandoffMessage/nested、H4「先单 Agent」 |
| S8 | CrewAI 官方文档（Docs 首页） | 官方文档 | H2 sequential/hierarchical/hybrid |
| S9 | Google ADK《Workflows》官方文档 | 官方文档 | H2 graph/dynamic/collaborative/template workflows |
| S10 | LangGraph GitHub README | 开源代码 | H2/H7 图+状态编排、durable state、Deep Agents 子 Agent |
| S11 | Google A2A Protocol Specification v1.0.0 | 官方规范 | H3 AgentCard/AgentSkill、Opaque Execution、in-task auth |
| S12 | MCP《Security Best Practices》官方规范 | 官方规范 | H5 least-privilege、token passthrough、confused deputy、privilege chaining |
| S13 | Chroma《Context Rot》技术报告 (2025-07-14) | 权威技术报告 | H6 18 模型实证、focused vs full |
| S14 | Cognition《Don't Build Multi-Agents》(2025-06-12) | 工程博客 | H7 反证：并行冲突、共享全轨迹、单线程+压缩 |

---

## 附：五步法执行轨迹
- **界定问题**：把「业界有没有这种 Agent 定义和协作的做法」收敛为 Q0（§1.1）。
- **拆解问题**：MECE 七支议题树（§2）。
- **提出假设**：H1–H7（§3）。
- **验证假设**：逐条检索取证、修正/推翻（H5 被证伪「无差别继承」）（§4）。
- **综合建议**：结论先行 + 方案对比 + 4 条设定裁决 + 5 条可执行建议 + 7 条反模式（§5）。
