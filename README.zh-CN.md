# ArchGraph

**一个由你定义本体的知识图谱框架 —— 通过一个统一的 MCP 接口接入你的编码 Agent。**

[English](README.md) · **简体中文**

面向在真实代码库上运行编码 Agent 的团队，ArchGraph 让 Agent 在一张**意图图谱（intent graph）**上拥有持久、分层的长期记忆 —— 这是一张带版本的架构图，记录系统*为什么*长成这样，而不只是*长什么样*。你和 Agent 通过一个 **MCP** 服务端（**MCP** = **Model Context Protocol**，让 AI 工具把外部服务当作工具调用的开放标准）来读写它。图谱的形态由**本体（ontology）**决定 —— 也就是元素与关系类型的词汇表 —— 而这套本体由你定义。内置默认是 **ArchiMate 3.2 + ARGO 扩展**，其中 **ArchiMate** 是一套标准的企业架构建模语言，**ARGO** 是 `argo-deploy` 与 `argo-init` 命令背后的工具链与 Agent 工作流层。一个仓库可以接入自己的本体 —— 本仓库就是这么做的。**一次安装，一个接口，学一次。**

准备好试一试了吗？直接跳到 **[构建你自己的图谱](#构建你自己的图谱)**。

[安装](#安装) · [构建你自己的图谱](#构建你自己的图谱) · [为什么选择 ArchGraph](#为什么选择-archgraph) · [能力总览](#能力总览) · [文档](#文档) · [社区](#社区)

![ArchGraph 核心模型 —— 一张图同时承载 Agent 的记忆与产品的设计](docs/diagrams/core-model.svg)

## 这是什么？

如果你在真实代码库上运行编码 Agent，那么每个会话都是「冷启动」，而系统背后的「为什么」无处安放。ArchGraph 让**一张架构图**成为唯一的事实来源 —— Agent 的记忆与产品的设计合于同一个模型。你只需安装并学习*一个 MCP 接口*：Agent 在会话开始时恢复上下文，在需要时召回细节，并复用已知内容而不是重复创建（若确实要建重复项，必须显式确认）。

- **架构师 / 技术负责人** —— 用一张模型同时描述产品、工具链与 Agent。
- **Agent 使用者** —— 会话开始时记忆已恢复，需要时按需召回，复用而非重复。
- **平台团队** —— 一个接口，部署进你已在使用的编辑器。

→ 完整上手：**[docs/getting-started.html](docs/getting-started.html)**

## 为什么选择 ArchGraph

每个运行编码 Agent 的团队都会撞上同一堵墙：代码在仓库里，但代码背后的*推理*无处安放。常见的四种做法各有用武之地，但都撑不了多久。

真正的差异**不在于**「自定义 vs. 锁定」。Protégé/OWL、Neo4j、TerminusDB、Archi/EA 都允许你扩展模型或自带词汇。而在于 ArchGraph 把本体做成一个**一等公民、受校验、运行时解析的 schema bundle**，并把它放在**一个** Agent 既能读*又能*写的 **MCP 接口**之后，且内建类型化去重与提交可追溯。

包含成本的诚实对比只放在一个权威位置 —— **[docs/capabilities.html#compare](docs/capabilities.html#compare)**。

## 自带本体

只会说一种语言的知识图谱框架，称不上框架。ArchGraph 把**内核**与**本体**分离：仓库在 `.argo/schema/` 下放一份 *schema bundle*（元素/关系类型、端点规则、actor 契约、可选 guide），校验、MCP 指引与 `.qea` 投影都会随之改变。一份 bundle 可以 `extends: "default"` —— 继承内置的 **ArchiMate 3.2 + ARGO 扩展** —— 再追加自己的类型；无需改动框架。

本仓库就是证明：它自己的 bundle 用 `extends: "default"` 并叠加了一份 **UML 2 状态机 profile**，在运行时从 `.argo/schema/` 解析，而不是硬编码在框架里。

→ 一个完整示例 —— 定义本体后一步步建图：**[docs/case-team-graph.html](docs/case-team-graph.html)** · 预置本体目录：[`custom-schema/`](custom-schema/README.md)（Team Graph · Finance CDM · Industry 4.0 AAS · STIX Threat Intelligence · UML 2 · SysML · IPD · Mathematics）· 完整编写参考（类型、关系结构、公理/约束）：**[docs/ontology-authoring.md](docs/ontology-authoring.md)**

## 本体校验（可选）

你的 schema bundle 已经能约束端点规则。ArchGraph 还能更进一步，在框架既有的校验时机上运行一个**真正的本体 / 推理引擎** —— **写入时**（本次变更的增量子图）与**初始化时**（整张图）—— 以捕捉仅靠 schema 无法发现的问题：

- **逻辑矛盾**（OWL 不一致 —— 例如一个元素同时属于两个互斥类型，或单值槽位被赋了两个值），以及
- **约束违规**（SHACL，由你的端点矩阵编译而来）。

它是**可选的、默认关闭**；一旦启用则是**失败即阻断（fail-close）** —— 已配置但不可用的引擎会被视为**阻断性错误**，而不是默默通过（咨询类校验器可以按条目用 `onError: "warn"` 选择退出）。

**启用它。**

```bash
argo-deploy -EnableOntologyValidation
```

这会把两个键写进 `~/.argo/.env`（也就是部署器配置的同一个文件）—— 你不用手动编辑：

```
ARGO_ONTOLOGY_PYTHON=python
ARGO_VALIDATION_EXTENSIONS=[{"name":"ontology","timings":["write","init"],"command":["node","<argo>/scripts/ontology-projection/cli.js","--workspace","{workspaceRoot}","--graph","{graphPath}","--mode","{mode}"]}]
```

然后**重启你的编辑器 / 宿主**，让 MCP 服务端重新加载 `~/.argo/.env`。要关闭它，清空 `ARGO_VALIDATION_EXTENSIONS` 这一行（或部署时不带该标志）并重启即可。

**依赖。** 引擎是 **pySHACL** + **owlready2/HermiT**。部署器会替你安装这些 Python 包（`pyshacl`、`owlready2`）；**Python 3 与一个 JRE** 是前置条件 —— 若缺任一，部署会**带告警停止**（它绝不会擅自安装系统运行时），请先装上再重跑 `argo-deploy`。传 `-SkipOntologyEngine` 可完全跳过引擎步骤。

**验证。**

```bash
Get-Content "$env:USERPROFILE\.argo\.env" | Select-String ARGO_VALIDATION_EXTENSIONS   # macOS/Linux 上是 ~/.argo/.env
python -c "import pyshacl, owlready2; print('ok')"
```

这个扩展点是**开闭的**：任何遵守这份小契约的外部校验器（argv 令牌 `{workspaceRoot}` / `{graphPath}` / `{mode}`；从环境读取变更后的文档与被触碰的 id；打印 `{errors, warnings}`）都可以作为**一条条目**加入 `ARGO_VALIDATION_EXTENSIONS` —— 无需改动框架。规范：[`argo/scripts/ontology-projection/EXTENSION_PROTOCOL.md`](argo/scripts/ontology-projection/EXTENSION_PROTOCOL.md)。

## 安装

**前置条件：Node.js ≥ 18**（ARGO 工具链与 MCP 服务端都跑在 Node 上）。

```bash
npm install -g archgraph-argo
argo-deploy
```

`argo-deploy` 会注册 `argo` MCP 服务端，并把 skills 与 rules 安装进 **GitHub Copilot、Cursor、OpenCode、DeepSeek Harness、OpenClaw 和 Codex**（agents 只在支持它的宿主上安装）。随后它会提示你填写 `~/.argo/.env` 里的少量设置。**部署完成后，重启你的编辑器 / 宿主**，让它重新加载 MCP 服务端。语义查询还需要 **Neo4j** 与一个 **embedding** 端点 —— 见 [构建你自己的图谱](#构建你自己的图谱)。

## 快速开始

只有**一条**权威起点：**[构建你自己的图谱](#构建你自己的图谱)** —— 装一次，然后选路线 A（默认本体）或路线 B（你自己的本体）。那一节包含每一步与每个 MCP 调用；这里刻意不再放第二份副本，所以只有一条路可走。

**唯一开箱即用之外的前置条件：**语义（Graph RAG）检索需要一台 **Neo4j** 实例与一个 OpenAI 兼容的 **embedding** 端点。上下文读取、写入与 Enterprise Architect 互操作无需它们；**Cypher**（Neo4j 的图查询语言）结构投影与全部语义检索则需要 Neo4j。

## 构建你自己的图谱

二选一。一切都在你的编码 Agent 与 ARGO MCP 服务端之间完成；你唯一需要亲自运行的命令就是安装。初始化之后，意图图谱就是唯一的事实来源。

### 路线 A —— 默认本体（最快）

无需本体工作：使用内置的 **ArchiMate 3.2 + ARGO 扩展**。

1. **安装（一次）。** 需要 **Node.js ≥ 18**。

   ```bash
   npm install -g archgraph-argo
   argo-deploy
   ```

   然后**重启你的编辑器 / 宿主**，让它重新加载 MCP 服务端。

2. **初始化。** 让你的编码 Agent 运行 `argo-init`（工作区初始化 CLI）。它会创建并校验起始的 `design/KG/SystemArchitecture.json`，其中已经包含名为 `SystemArchitecture` 的项目根视图。

3. **添加元素与关系。** 让你的编码 Agent 调用 `applySystemArchitectureMutation`，把每个新元素与关系挂到项目的**既有根视图**上 —— 先让它解析该视图真实的 `view_id`（`queryNeo4jGraph` / `getArchitectureViewContext`）。**不要**预建视图：一个名为 `SystemArchitecture` 的新视图会与 `argo-init` 创建的那个冲突，此后任何指向别的 id 的 `view_ids` 都会失败。

4. **验证。** 让你的编码 Agent 调用 `validateSystemArchitecture`，再用 `{"schema": true}` 调用 `queryNeo4jGraph` 确认生效的元素与关系类型。

### 路线 B —— 你自己的本体

1. **安装（一次）。** 同路线 A。

2. **编写你的 schema。** 把你的建模语言放到 `.argo/schema/` 下。一份**独立** bundle —— 一个完整的 `SystemArchitecture.schema.json`，编辑其两个 `$defs` 枚举数组 `archimateElementType` 与 `archimateRelationshipType` —— **还必须**在 `schema-bundle.config.json` 中声明 `actorElementType`，设为你某个元素类型（若你的 schema 确实没有 actor 概念则设为 `null`），否则会加载失败即阻断（`bundleValidation.status: "failed"`），校验/写入都会被阻塞。仅 `extends: "default"` 的 bundle 只需那份 config。`schema-bundle.rules.json` 保持可选（没有它时端点检查较为宽松）。

3. **自己编写图谱。** 使用自定义 schema 时，`argo-init` **不会**创建图谱 —— 打包的默认图与你的词汇不匹配 —— 它会**失败即阻断**并报 `NO_DEFAULT_GRAPH`。在任何 MCP 写入之前，手工创建 `design/KG/SystemArchitecture.json`，使用你自己的元素与关系类型以及你自己的根视图。然后让你的编码 Agent 运行 `argo-init` 来校验它。

4. **加入你自己的根视图。** 让你的编码 Agent 调用 `applySystemArchitectureMutation`，把每个元素与关系挂到**你编写的**根视图上（而不是默认那个）。

5. **验证。** 让你的编码 Agent 调用 `validateSystemArchitecture`，再用 `{"schema": true}` 调用 `queryNeo4jGraph`。

完整图文、分步的走查见 **[docs/case-team-graph.html](docs/case-team-graph.html)**（中文），预置示例 bundle 收录于 [`custom-schema/`](custom-schema/README.md)。结果看起来是这样：

![Team Graph 示例 —— Agent 001 被指派给 Team A，Team A 依赖 Service A，Service A 依赖 Service B](docs/diagrams/team-graph-elements-relations.svg)

## 能力总览

每一行都链接到一个简短的页面 —— 这是地图，不是手册。

- **[分层长期记忆](docs/capabilities.html#memory)** —— 会话开始时一份紧凑的工作记忆，按需召回一份长期记忆，以及一个归档。
- **[可插拔本体](docs/capabilities.html#ontology)** —— 交付你自己的 schema bundle；默认（ArchiMate 3.2 + ARGO 扩展）是数据，不是代码。
- **[语义 + 结构检索](docs/capabilities.html#retrieval)** —— Graph RAG 召回，加上只读 Cypher 精确查询结构。
- **[去重写入](docs/capabilities.html#quality)** —— 复用既有的元素、关系或视图，而不是复制它；近似重复会作为候选被拦下。
- **[验收测试先行 + 可追溯](docs/capabilities.html#quality)** —— 每次改动都可测试，且 commit id 会登记回元素。
- **[Enterprise Architect 互操作](docs/capabilities.html#interop)** —— 图谱投影为 `.qea`；人类在 EA 里的编辑以语义 diff 返回。
- **[联邦图谱共享](docs/capabilities.html#federation)** —— 主权图谱通过注册中心–代理（registry–broker）互联；读取经授权并按引用返回。
- **[一个 MCP 接口，六个宿主](docs/capabilities.html#harness)** —— 装一次，在 Copilot、Cursor、OpenCode、DeepSeek Harness、OpenClaw 与 Codex 中运行。

## 如何使用

**初始化一次**（`argo-init`），然后打开你的项目，让你的编码 Agent 干活。它会：

1. 在改动任何东西之前，先定位任务背后的架构元素，
2. 用该元素的 Skills 与 Rules 武装自己，
3. 测试先行（GIVEN-WHEN-THEN），并把每个 commit 追溯到图谱，
4. 默认复用既有元素 —— 近似重复需要显式确认。

意图架构图就是唯一的事实来源。

## 支持的宿主

| 宿主 | MCP | Skills | Rules | Agents |
|---------|:---:|:------:|:-----:|:------:|
| GitHub Copilot    | ✓ | ✓ | ✓ | ✓ |
| Cursor            | ✓ | ✓ | ✓ | ✓ |
| OpenCode          | ✓ | ✓ | ✓ | ✓ |
| DeepSeek Harness  | ✓ | ✓ | ✓ | ✓ |
| OpenClaw          | ✓ | ✓ | ✓ | — |
| Codex             | ✓ | ✓ | ✓ | — |

一次 `argo-deploy` 即可注册 `argo` MCP 服务端，并把全部产物自动安装进每个宿主。

## 跨项目读写

跨项目访问走**两条独立通道** —— 不能混为一谈：

1. **本地路径** —— 每次调用传 `workspaceRoot`，读取同机上一个对等项目的图谱。写入**按设计只读**：外部写入会被拒绝并返回 `WORKSPACE_WRITE_DENIED`。
2. **联邦** —— 每次调用传 `projectId`，经**联邦中心**路由，在其处授权（默认拒绝），并按引用返回。

本地通道是否可用取决于宿主，因为宿主可能桥接 MCP 服务端并按调用固定工作区：

| 宿主 | 本地读（`workspaceRoot`） | 本地写 | 联邦读（`projectId`） |
|---------|:----------------------------:|:-----------:|:----------------------------:|
| OpenCode         | ✓ | blocked（`WORKSPACE_WRITE_DENIED`） | ✓ |
| Codex            | ✓ | blocked（`WORKSPACE_WRITE_DENIED`） | ✓ |
| DeepSeek Harness | ✗ | ✗ | ✓ |
| GitHub Copilot   | ✓ | blocked（`WORKSPACE_WRITE_DENIED`） | ✓ |
| Cursor           | 待测 | 待测 | ✓ |
| OpenClaw         | 不涉及 | 不涉及 | ✓ |

DeepSeek Harness **无法**做本地跨项目访问：它的桥接固定了会话工作区，请求不会按原样到达服务端，只有联邦通道可用。

## 社区

ArchGraph 建立在开放共建之上：在项目间分享与复用**架构子图**。分享是**联邦式**的 —— 每个项目保持图谱主权，成员通过**引用**进行注册、发现、授权与读取已开放内容（默认拒绝；不复制、不合并）。中心是一个**注册中心–代理**，只保存联邦元数据，从不保存内容。

- **社区站点** —— https://argo.derekworkspacev5.com/archgraph/
- **graph-wiki**（图谱资产之家）—— https://github.com/derekhu0002/graph-wiki
- **GitHub** —— https://github.com/derekhu0002/archgraph

## 文档

- [使用介绍](docs/getting-started.html) · [能力总览](docs/capabilities.html) · [完整案例：Team Graph](docs/case-team-graph.html)
- [Schema bundles / 本体解耦](docs/schema-bundle-decoupling.md) · [自建 embedding 部署](docs/self-hosted-embedding-deployment.md) · [MCP 验收](docs/mcp-acceptance.md)
- [洞察](docs/insights.html) —— GraphRAG、Agent 记忆与可移植技能。

## 许可证

[Apache License 2.0](LICENSE)
