---
title: "ArchGraph：8 个让 Agent 工程不再失控的创新"
author: "derek"
digest: "用企业架构标准 ArchiMate 3.2 来工程化 Agent 开发——8 个创新点，解决不可见、不可控、不可复用三大痛点。"
banner_path: "diagrams/cover-8-innovations.png"
open_comment: 1
source_url: "https://archgraph.org"
---

# ArchGraph：8 个让 Agent 工程不再失控的创新

Agent 能写代码了，能调研了，能帮你发公众号了。但工程化交付呢？

意图漂移、黑盒执行、验收靠感觉、经验无法沉淀——这些问题，换个更强的模型解决不了。

ArchGraph 的出发点很朴素：**Agent 缺的不是更聪明的脑子，而是一张施工图。** 我们用企业架构标准 ArchiMate 3.2 来建模 Agent 及其协作流程，把 Agent 设计与产品设计放在同一个知识图谱里。

这篇文章聊聊 ArchGraph 的 8 个核心创新。不吹概念，只说我们具体做了什么、为什么这么做、跟业界方案有什么不同。

---

## 一、用 ArchiMate 3.2 扩展为 Agent 建模语言

**问题**：Agent 框架那么多，但描述 Agent 的方式五花八门——YAML 配置、Python 代码、Markdown 文档。这些描述不可视化、不可推理、不可形式化验证。

**我们做了什么**：把 TOGAF 标准的企业架构语言 ArchiMate 3.2 扩展为 Agent 建模语言（AML）。

关键是：**我们没有重新发明一套 DSL。** ArchiMate 3.2 本身有 60 多个标准元素，能覆盖 90% 的 Agent 概念。AML 只扩展了 2 个新元素——Skill 和 Rule——因为这两个是 Agent 特有的，标准里确实没有。

形式化约束靠的是 1200 多行的关系推导规则（RELATIONSHIP_TARGET_MATRIX）。它定义了哪些元素之间可以建立什么类型的关系，防止语义上的非法连接。比如，你不能把一个 Skill 直接 assignment 给一个 Application Component——这种错误在 YAML 里只有运行时才能发现，在 ArchiMate 里建模阶段就会被拦住。

扩展遵循三步评估法：① 能不能映射到标准元素？② 能不能用 attributes 表达？③ 实在不行才扩展枚举。这保证了扩展的克制。

**业界对比**：LangChain 和 AutoGen 用 YAML 或 Python 代码定义 Agent 行为。代码不可视化，也无法做形式化推理。ArchGraph 用标准化、可视化、可推理的架构图来建模 Agent。

---

## 二、Agent 设计与产品设计在同一张图上

**问题**：Agent 的 prompt 在代码库里，产品需求在另一个文档里，两者之间没有结构化的关联。你很难回答"这个 Agent 到底在为哪个产品功能服务"。

**我们做了什么**：`design/KG/SystemArchitecture.json` 这一个文件，同时包含产品功能、Agent 行为、协作流程。

具体来说：

- 产品侧用 Application Component（比如 project website）和 Application Function（比如 choose_agent）
- Agent 侧用 Business Actor（比如 adam/Reviewer）、Business Role（比如 Developer）、Skill、Rule
- 连接枢纽是 Work Package——以"优化 WEB 布局和风格"为例，它同时关联产品组件 index.html 和 Agent 技能 optimize-web-layout-style Skill

同一个元素，可以在不同 Viewpoint 里从不同角度观察。产品经理看 Application Cooperation 视图，工程师看 Implementation and Migration 视图，看到的是同一张图的不同切面。

**业界对比**：LangChain 和 AutoGen 只关注 Agent 编排，不涉及产品设计。ArchGraph 把目标产品和构建产品的 Agent 放进同一个模型。目标对齐不是靠开会，而是结构性的。

---

## 三、图谱驱动的 Agent 记忆与上下文组装

**问题**：大多数 Agent 框架用向量数据库做 RAG。向量只能做相似度匹配，无法表达关系，无法做多跳推理。

**我们做了什么**：用 Neo4j + GraphRAG 作为 Agent 的长期记忆。

SystemArchitecture.json 是唯一权威数据源，Neo4j 是从属投影索引——JSON 改了，Neo4j 跟着同步，不是反过来。

五阶段 GraphRAG 管线：

1. 嵌入向量生成
2. 变更驱动增量索引（不是每次全量重建）
3. 三通道种子检索：Element 相似度 ≥ 0.8、Relationship ≥ 0.78、View ≥ 0.76
4. 目的策略闭包：基于 ArchiMate 语义做依赖遍历
5. 结构化补全

Agent 的长期记忆直接挂在 Business Actor 的 Sub-View 层级上。每次会话启动，WakeupGuideline 会先恢复这段记忆——Agent 不会忘记上次做到哪儿了。

安全方面，Fail-Closed 机制包含路径信任、OS 级 ACL 验证、完整性摘要。

**业界对比**：主流 RAG 用向量相似度检索，无法表达关系和多跳推理。Neo4j 的 NAMS 提出了类似方向（把 Agent 记忆建模为上下文图），但 ArchGraph 已经落地为可运行的工具链。

---

## 四、一套工具链自动适配多 Harness

**问题**：GitHub Copilot、Cursor、OpenCode、DeepSeek——四个 Harness，四套规则格式，四套 Skills 格式，四套 MCP 配置。手动适配？每次改动都要改四遍。

**我们做了什么**：`argo-deploy` 一条命令，把 ARGO MCP、Skills、Rules、Agents 部署到所有支持的 Harness。

19 步部署流水线，从 schema 校验到 MCP 注册，全自动。

关键适配逻辑：

- **Skills**：一份 SKILL.md 原样复制到 4 个 Harness，格式通用
- **Agents**：`.agent.md` 通过 Convert-AgentFile 按目标 Harness 转换格式
- **Rules**：全局规则转为各 Harness 的指令格式——copilot-instructions.md、cursor rules、opencode AGENTS.md
- **MCP 注册**：Write-McpConfig 按各 Harness 的 JSON key 差异注入配置

**业界对比**：各 Harness 的插件和规则格式各不相同，通常需要手动逐个适配。ArchGraph 实现一次定义，多端运行。你只需要维护一份源文件。

---

## 五、验收用例驱动 + 变更可追溯

**问题**：Agent 说它做完了，你怎么验证？代码改了，你怎么知道影响了哪些架构元素？

**我们做了什么**：每个架构元素挂载 GIVEN-WHEN-THEN 格式的验收用例，可执行（`node --test`）；每次 git commit 的 commit id + 文件路径回写到对应元素的 commit 属性。

验收用例不是文档，是代码。数据结构包含 name（AT-{elementId}-{序号}）、description（GIVEN-WHEN-THEN 三段式）、acceptanceCriteria（纯文件路径，不是自然语言描述）。

运行器遍历所有元素的 testcases，校验 acceptanceCriteria（禁止 shell 注入），按扩展名匹配执行器，自动计算 deliveryStatus。

核心原则是**外部验证**：只验证元素对外承诺的行为，不验证内部实现。

AcceptanceTestFirst 6 条红线：

1. 修改前识别受影响用例
2. 改后跑回归
3. 无用例先补
4. 外部验证
5. 必须可执行
6. GIVEN-WHEN-THEN 格式

commit 属性让每个元素有一份变更时间线。比如 project website 这个元素，挂了 15 条 commit 记录，谁在什么时候改了什么，一目了然。

**业界对比**：传统开发里，测试代码和设计文档是分离的。Agent 框架普遍缺乏对 Agent 行为的外部验证机制。ArchGraph 把验收用例直接挂载到架构元素上，实现"设计-实现-验证"闭环。

---

## 六、人对 Agent 的掌控力

**问题**：Agent 在长任务里跑偏了，你怎么发现？怎么纠偏？多数框架的答案是"没办法，等它跑完再看"。

**我们做了什么**：人类通过架构图理解 Agent 的职责、协作、进度；Agent 通过图谱查询理解任务的背景、约束、依赖。

具体机制：

- **WakeupGuideline**：Agent 启动的第一步，必须先确认"我是哪个 Business Actor"，恢复长期记忆，校验 agent 属性匹配。不是 Agent 自己觉得它是谁就是谁。
- **CoreRules 闭环**：找元素 → 走 MCP → 测试先行 → 提交登记 → 记忆回写 → 持续合规。每一步都有约束。
- **CoperationGuideline**：Agent 不能越权，必须通过正式委派流程协作。Developer 不能干 Reviewer 的活，除非有明确的委派关系。

人类怎么介入？

- **观察**：Viewpoint 分层，俯瞰全局
- **约束**：修改 Role description、testcases、Skill
- **纠偏**：修改 Assignment 关系，重新分配任务

**业界对比**：多数 Agent 框架是"给定目标，Agent 自由发挥"，人类难以介入。ArchGraph 提供了一张可导航的地图，人类可观察、可约束、可纠偏。

---

## 七、Skill/Rule 作为一等公民的物化机制

**问题**：Agent 需要技能才能工作，但大多数框架里，技能是散落的 prompt 片段，没有结构化关联。

**我们做了什么**：把 Skill 和 Rule 提升为图谱中的一等元素，并物化为文件系统上的具体文件。

- Skill 元素 → `.github/skills/<name>/SKILL.md`
- Rule 元素 → `.github/<name>.instructions.md`

Agent 领取 Work Package 后，沿 Association 关系找到关联的 Skill 和 Rule，读取对应的 SKILL.md 和 instructions.md，获得工作所需的全部知识。

这就是"自武装"——Agent 不是被动等待人类喂 prompt，而是主动从图谱中获取完成任务所需的能力。

技能可复用、可组合、可追溯，形成组织级的 Agent 能力资产。

**业界对比**：Copilot 和 Cursor 的 Skills 是散落的 Markdown 文件，没有结构化关联。ArchGraph 把 Skills 纳入图谱，建立了 Task → Skill → Capability 的语义链。

---

## 八、开发者社区 + 知识共享机制

**问题**：每个项目都在重新发明 Agent 的工作方法。规则、流程、技能，缺乏共享机制。

**我们做了什么**：KGlibrary/ 目录承载可分享的子图工作包，GitHub Discussions 作为社区交流载体。

目前 KGlibrary 收录了 4 个项目：

- GPT-Research：多 Agent 研究流程
- GPT-Researcher-Agent-Method：Agent 方法论
- McKinsey-5-Step：麦肯锡五步法
- XKG-TEST：测试用例

子图可以导出、复用、组合。导出通过 EA Automation API 递归遍历图表（1585 行脚本），导入保留 schema_id、parent 层级、subdiagram_views。

分享机制分三级：

1. GitHub Discussions：索引与讨论
2. 公开 Gist：≤10MB 的子图
3. KGlibrary/ 仓库文件：>10MB 的子图

安全控制：developer-community-publish.js 扫描 6 类敏感信息（凭据、绝对路径、commit 详情、个人信息），防止泄露。

**业界对比**：Hugging Face 共享模型参数（黑盒），LangChain 共享编排逻辑（白盒但仅限调用链）。ArchGraph 共享架构决策的结构化表达——含角色、流程、目标、约束、测试的完整语义网络。

---

## 总结：解决三大痛点

ArchGraph 的核心创新在于：用企业架构的严谨方法论（ArchiMate + TOGAF）来工程化 Agent 开发，而不是把 Agent 当作"Prompt 工程"的玩具。

它解决了当前 Agent 生态的三大痛点：

1. **不可见**：Agent 行为黑盒化 → 架构图让 Agent 可见、可理解
2. **不可控**：Agent 自由发挥难以纠偏 → 验收用例 + 追溯机制让人类保持掌控
3. **不可复用**：Skills/Rules 散落各处 → 图谱化让知识资产可组合、可共享

这与业界 GraphRAG、Agent Memory Service、Skill Distillation 等前沿趋势高度同构，且已经落地为可工作的工具链。

```powershell
npm install -g archgraph-argo
argo-deploy
```

ArchGraph 以 Apache License 2.0 开源：

- 官网：https://archgraph.org
- 仓库：https://github.com/derekhu0002/archgraph

欢迎试用、提 Issue。一起把 Agent 工程，从"玄学"变成"工程"。
