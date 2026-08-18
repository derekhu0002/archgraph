---
title: "官宣｜ArchGraph：架构图驱动的 Agentic Engineering 框架"
author: "derek"
digest: "正式官宣 ArchGraph：用一张意图架构图，把 Harness 设计与产品设计统一成单一模型，让 Agent 可观测、可控、可验证。"
banner_path: "diagrams/image.png"
open_comment: 1
source_url: "https://archgraph.org"
---

# 官宣｜ArchGraph：架构图驱动的 Agentic Engineering 框架

今天，我们正式对外官宣 **ArchGraph**——一个架构图驱动的 Agentic Engineering 框架。

一句话概括：**ArchGraph 建立了一门"统一语言"，把 Harness 设计与目标产品设计放进同一个模型，让你获得一张可以边工作、边观察的单一视图，并真正掌控你的 Agent。**

---

## 一、我们为什么做这件事

Agent 已经能写代码、能调研、能发布内容，但工程化交付仍然很"虚"：

- **意图漂移**：Agent 在长任务里逐步偏离最初目标，人很难察觉；
- **黑盒执行**：它读了什么、遵循了什么规则、为什么这么改，缺乏可观测性；
- **验收靠感觉**：交付物"看起来对"，但缺少可执行、可回归的验收标准；
- **经验无法沉淀**：每次开工都从零开始，技能与规则难以复用。

ArchGraph 的出发点很朴素：**Agent 缺的不是更强的模型，而是一张"施工图"。** 人和 Agent 应该基于同一张图协作，而不是各说各话。

---

## 二、ArchGraph 是什么

ArchGraph 的核心，是一张 **意图架构图谱（Intent Architecture Graph）**，用 ArchiMate 3.2 建模，作为整个工程的**单一事实源**。

在这张图上：

- 每个任务背后都有明确的**架构元素**；
- 每个元素都挂载它需要的 **SKILL 与全局规则**；
- 每个元素都带**可执行的验收用例**（GIVEN-WHEN-THEN 格式）；
- 每一次代码改动，都把 **commit id + 文件路径**回登记到对应元素。

于是，**Harness 设计**（Agent 怎么被武装、怎么被约束）与**目标产品设计**（我们要交付什么），第一次被放进同一个模型里。

---

## 三、Agent 的工作流

安装后，打开项目、启动编程 Agent，它会自动：

1. **先定位**：动手前，先在意图架构图谱中找到任务背后的架构元素；
2. **再武装**：从该元素获取完成任务所需的 SKILL 与全局规则；
3. **测试先行**：先确认可能受影响的验收用例，用 GIVEN-WHEN-THEN 驱动实现；
4. **可追溯**：改动完成后提交留证，并把提交信息登记回图谱。

这意味着：**Agent 的每一步都"有据可查"，每一次交付都"可回归验证"。**

---

## 四、为什么是"架构图"

用图来表达 Agent 工程，不是我们的拍脑袋，而是与业界前沿高度同构（详见我们此前发布的洞察报告《知识图谱驱动的 Agent 构建》）：

- **GraphRAG**：图正从 RAG 的"可选项"变成 Agent 的"默认基础设施"；
- **Agent 记忆图化**：Neo4j 等厂商把短期对话、长期知识、推理轨迹统一建模为"上下文图"；
- **技能蒸馏**：AIP 提出把技能表示为**带类型的图**，可移植、可执行。

ArchGraph 把这些理念落进了一个具体、可运行的工程工作流里。

---

## 五、快速开始

```powershell
npm install -g archgraph-argo
argo-deploy
```

安装完成后，ARGO 工具链、技能与规则自动部署，`argo` MCP server 自动注册，开箱即用。

> 语义（Graph RAG）查询需要额外配置 Neo4j 与向量引擎；其余能力开箱即用。

---

## 六、开源与后续计划

ArchGraph 以 **Apache License 2.0** 开源：

- 官网：https://archgraph.org
- 仓库：https://github.com/derekhu0002/archgraph

后续我们会沿着图谱主线继续推进：

1. 为意图图谱引入**社区/层次索引**，支撑全局性查询；
2. 将 **Agent 推理轨迹**写回图谱，为"技能蒸馏"做准备；
3. 持续沉淀可复用的 **SKILL 与验收用例库**。

欢迎关注、试用、提 Issue。一起把 Agent 工程，从"玄学"变成"工程"。
