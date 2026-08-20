# ArchGraph 本地 Web 服务 — UI/UX 技术先进性洞察

> 角色：规划专家（tanwen，Business Actor 2737，Business Role 2736「规划专家」）
> 输入：`docs/ea-web-service-design.md`（AD-a..AD-i，重点 AD-c 界面形态、AD-g 图形渲染）
> 交付对象：系统设计师（caoyang，Business Actor 2739）
> 任务：对「内置单页 UI 是否够用」做业界技术先进性调研，评估「自研 SPA vs 成熟开源 UI 方案」，并对 AD-c / AD-g 给出修订反馈。

## 0. 核心结论（一句话）

**继续保留「内置单页 UI + REST JSON API 并存」的架构形态（AD-c 形态本身成立），但 UI 的图形内核应从「自研 SVG 渲染 + 自研力导向布局」改为引入成熟开源图库（首选 AntV G6 v5，备选 Cytoscape.js），即“自研 SPA 外壳 + 开源图内核”，而非全盘自研、也非整体替换为 React 等框架。**

---

## 1. 候选开源项目/组件对比表

说明：所有许可证、Star 数、活跃度均为 2026-08 实际查证（GitHub 仓库页 / LICENSE 文件），未臆造。

| 候选 | 定位 | 许可证 | 图形化查看+自动布局+拖动 | 节点/关系编辑+撤销重做 | 多项目/多视图切换 | 语义检索结果呈现 | 无技术背景用户上手成本 | 社区活跃度（查证） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **AntV G6 v5** | 图可视化框架（引擎） | **MIT** | ✅ 全覆盖：10+ 布局（force/dagre/radial/circular/grid 等）内置；`drag-node`/`drag-canvas` 行为内置；固定节点位置原生支持 | ⚠️ 部分：选择/事件/画布交互齐备，编辑面板与撤销栈需应用层自建 | 应用层职责（自建） | 应用层职责（自建高亮/跳转，库提供定位） | 低-中（中英双语文档） | 12.3k⭐，216 贡献者，v5.1.1（约 4 月前），活跃 |
| **Cytoscape.js** | 图论库 + 可选渲染器 | **MIT** | ✅ 全覆盖：内置 cose 力导向 + 布局扩展 dagre/ELK/cose-bilkent；拖动/选择/命中内置 | ⚠️ 部分：事件/选择 API 完善，编辑 UI 自建 | 应用层职责 | 应用层职责 | 中（英文文档为主，扩展需组装） | 11.2k⭐，139 贡献者，v3.34.1（上周），月频发布 |
| **React Flow (xyflow)** | 节点编辑器 React/Svelte 库 | **MIT** | ✅ 查看+拖动强；自动布局需外接 dagre/ELK | ✅ 强：节点增删/连线/自定义节点表单；撤销需自建 | 应用层职责 | 应用层职责 | 中（需 React 技术栈） | 38.1k⭐，141 贡献者，提交 3 小时前，极活跃 |
| **AntV X6** | 图**编辑**引擎（HTML/SVG） | **MIT** | ✅ 查看+拖动强；**自动布局弱**（面向 DAG/ER/流程图手工绘制） | ✅ 强：10+ 编辑扩展（框选/对齐线/缩略图）；React/Vue/Angular 节点 | 应用层职责 | 应用层职责 | 中 | 6.7k⭐，134 贡献者，v3.1.7 |
| **vis-network** | 网络可视化 | MIT + Apache-2.0 双许可 | ✅ 覆盖（Canvas；物理模拟布局；拖动；聚类），≤ 数千节点流畅 | ⚠️ 弱：编辑需自建 | 应用层职责 | 应用层职责 | 低（API 简单） | 3.6k⭐，v10.1.2（17 小时前），活跃 |
| **Sigma.js** | WebGL 大规模图可视化 | **MIT** | ✅ 查看覆盖（千级节点）；布局依赖 graphology-layout；拖动需自建 | ❌ 弱：非编辑库 | 应用层职责 | 应用层职责 | 中-高 | 12.1k⭐，v4 alpha（4 月前） |
| **ELK (elkjs)** | 布局算法库（**无渲染**） | **EPL-2.0**（GPL-3.0 二次许可） | ➖ 仅布局：layered/stress/mrtree/radial/force/disco | N/A | N/A | N/A | 低（纯算法，可作 G6/Cytoscape 的分层算法来源） | 2.7k⭐，57k 依赖，v0.12.0（上月） |
| **dagre** | 有向图分层布局（**无渲染**） | **MIT** | ➖ 仅分层布局 | N/A | N/A | N/A | 低 | 5.8k⭐，v2.0.0（近期复活，`@dagrejs/dagre`），63k 依赖 |
| **d3-force** | 力导向布局（**无渲染**） | ISC（D3） | ➖ 仅力导向 | N/A | N/A | N/A | 低 | D3 生态 |
| **draw.io / diagrams.net** | 完整图编辑器应用（mxGraph） | Apache-2.0（源码）+ **图标/模板库受限** | ✅ 查看+拖动+编辑强；自动布局需插件 | ✅ 强：撤销重做内置 | ⚠️ 文件级，非多项目/多视图 | ❌ 弱（无图谱语义） | 低（最终用户）但**嵌入难**：iframe/自托管、难编程绑定图谱数据与 MCP 编辑映射 | 7.6k⭐，成熟，**不接受 PR**，v31.1.8 |
| **Excalidraw** | 手绘白板 | **MIT** | ❌ 白板，无图数据自动布局 | ✅ 撤销重做内置（但非图编辑） | N/A | N/A | 低 | 130.1k⭐，386 贡献者，v0.18.1 |
| **tldraw** | 无限画布 React SDK | **专有（tldraw license：开发免费/生产需授权，4.0 起）** | ❌ 白板，无图布局引擎 | ✅ 画布编辑强 | N/A | N/A | 低 | 49.9k⭐，230 贡献者 |
| **Neo4j Browser** | 图数据库 UI（UX 标杆） | **GPL-3.0** | ✅ 查看+拖动+布局内置 | ⚠️ 只读查询为主 | 数据库级 | ✅ 强（查询结果到图，高亮） | 低（最终用户）但**不可嵌入复用**：整应用 + GPL | 831⭐，90 贡献者，活跃度下降（最后一次提交约 1 年前） |
| **Memgraph Lab** | 图数据库 UI（开源，随 Memgraph Platform） | Memgraph **BSL**（社区）+ MEL（企业） | ✅ 查看+拖动+布局 | ⚠️ 只读查询为主 | 数据库级 | ✅ 强 | 低（最终用户）但**绑定数据库** | 4.3k⭐（Memgraph），活跃 |
| **ArangoDB Web UI** | 图数据库 UI | **BSL**（已改） | ✅ 查看 | ⚠️ 只读 | 数据库级 | ✅ 强 | 低 | 14.3k⭐，活跃 |
| **Gephi** | 桌面图分析平台 | GPL-3.0 / CDDL 双许可 | ✅ 覆盖（ForceAtlas2 等，可至百万级） | ❌ 只读分析为主 | 桌面单图 | ❌ 弱 | 高（非技术用户不友好） | 6.6k⭐，Java 桌面，v0.11.2 |
| **Obsidian Graph View** | 笔记知识图谱视图（UX 参考） | **专有（闭源）** | ⚠️ 只读查看 + 局部展开，不编辑 | ❌ | 库级 | ❌ 弱 | 低 | 闭源，仅作 UX 取舍参考 |
| **Logseq** | 笔记平台（图谱视图） | **AGPL-3.0** | ⚠️ 只读图视图 | ❌ | 库级 | ❌ 弱 | 低 | 44.5k⭐，活跃 |

图例：✅ 覆盖 / ⚠️ 部分覆盖 / ❌ 不适用 / ➖ 仅单一职责。

---

## 2. 针对「内置单页 UI 是否够用」的结论

**结论：架构形态（单页应用）够用，但“全自研”的实现方式不够。**

1. **单页应用形态本身足以承载**。功能丰富度（多项目+状态、语义/上下文检索、图形化查看+自动布局+拖动、图编辑+撤销重做、导入导出）并不要求重客户端架构——Neo4j Browser、Memgraph Lab、draw.io、tldraw 都是单页 Web 应用的成功先例，均以「REST/WebSocket API + 前端 SPA」形态交付。AD-c「内置单页 UI + REST JSON API 并存」的**形态决策正确**。

2. **但“纯手写 HTML/CSS/JS + 自研 SVG + 自研力导向”的图形内核不可取**。本服务的图形需求（自动布局、节点拖动、命中/选择、缩略图、框选、与撤销重做联动）已经进入「图编辑器」的通用问题域，而这正是 G6 / Cytoscape.js / X6 / React Flow 等成熟库十余年打磨的强项。自研这部分投入大、边界 case 多（拖拽后的固定坐标、力导向稳定性、命中测试、可访问性、大图性能），且**没有任何业务差异价值**。

3. **推荐路线：保留自研 SPA 外壳 + 引入开源图内核**，而非整体切换到 React 框架。理由：
   - 集成 UI（项目列表/搜索/编辑面板/导入导出）与 REST API 的编排逻辑是**本服务的业务价值**，值得自研；
   - 图形渲染/布局/交互是**通用基础设施**，交给开源库更先进、更省成本；
   - 继续零构建（静态页面 + vendored JS）即可满足 NF-1/NF-2「零配置、零 EA 依赖」，不必为引入图库而被迫引入 Vite/React 构建链（除非团队自愿）。

---

## 3. 给系统设计师的 AD-c / AD-g 修订建议（反馈条款）

### 3.1 AD-c 修订建议

> **建议改为**：保留「内置单页 UI + REST JSON API 并存」的架构形态不变；但将 UI 层实现从「全部自研 HTML/CSS/JS（含 SVG 渲染）」修订为「**内置单页 UI（继续零构建静态页面）+ 图形内核采用成熟开源图库（首选 AntV G6 v5，MIT；备选 Cytoscape.js，MIT）**」。REST JSON API 仍由 Node 内置 http 服务提供，前端通过该 API 交互，保持不变。
>
> **理由**：单页应用形态已被 Neo4j Browser / Memgraph Lab / draw.io 等同类工具验证可承载丰富功能；而图形内核（渲染/布局/拖动/命中）是成熟图库的强项，自研无业务价值且维护成本高。G6/Cytoscape 均可零构建接入静态页面，不破坏 AD-b 的零配置目标。
>
> **被否方案**：
> 1. 继续「全自研 HTML/CSS/JS + SVG」——图形内核维护成本高、边界 case 多、无差异价值；
> 2. 整页嵌入 draw.io/diagrams.net（iframe）——draw.io 是完整应用且图标/模板库有使用限制、不接受 PR，难以编程绑定图谱数据模型与「编辑↔ARGO MCP」映射表；
> 3. 整体迁移 React/Vite 前端框架——编辑体验上限最高但引入构建链与 npm install，违背 AD-b「零配置」；可列为后续演进项而非本阶段默认。

### 3.2 AD-g 修订建议

> **建议改为**：图形渲染与自动布局采用**成熟开源图库 AntV G6 v5（MIT）**，默认 Canvas 渲染（G6 支持 Canvas/SVG/WebGL 切换）；自动布局采用其**内置力导向（force）+ 分层（dagre）+ 其它（radial/circular/grid）可切换**；节点**拖动/选择/命中**由库内置行为（`drag-node` 等）提供，**固定节点位置由库原生支持**，无需自研斥力/弹簧与 `fx/fy` 固定逻辑；缩略图（minimap）、tooltip 等交互组件随库插件获得。
>
> **理由**：渲染/布局/命中/拖动是通用基础设施，G6 单包即覆盖「力导向 + 分层 + 拖动 + 缩略图 + tooltip」，社区验证、中英双语文档；自研「SVG + 力导向 + 拖动命中」是图编辑器中最复杂、最易出 bug、且无业务价值的部分。原 AD-g 否决 Canvas 的理由（“命中/选择/拖动需自建坐标系统，可访问性差”）在引入成熟库后**不再成立**——G6/Cytoscape 已把命中、事件、可访问性处理完毕。
>
> **被否方案**：
> 1. 继续自研「SVG + 力导向 + 拖动固定 fx/fy」——维护成本高，命中/可访问性仍需自建；
> 2. 自建 Canvas 坐标系统——理由同上（命中/选择/拖动、可访问性需自建）；
> 3. React Flow (xyflow) + ELK——节点编辑体验最佳，但需 React 构建链，违背 AD-b「零配置」，列为后续演进项。

### 3.3 集成方式（若引入开源组件，仍在本地运行、零/低依赖、默认 127.0.0.1）

- **零构建接入**：将 G6 v5 的 ESM/UMD 产物以 vendored 静态文件放入 Web 服务静态目录（如 `web/vendor/g6.min.js`），由内置静态文件服务提供；前端用原生 `<script type="module">` 或 UMD 全局变量加载，**无需 npm install / 无需构建链**。
- **备选（若接受 npm 依赖）**：`npm install @antv/g6` 后由本服务的静态资源管线拷贝 dist 产物；仍由 Node http 服务本机（127.0.0.1）提供，无外网依赖。
- **分层布局算法来源**：G6 内置 dagre 已够用；若对分层质量有更高要求，可另引入 elkjs（EPL-2.0，对本机工具无传染义务）或 dagre（MIT）作为 G6 的自定义布局扩展。
- **数据契约不变**：前端仍从 `GET /api/projects/:id/views/:viewId/graph` 取 `nodes/edges` 图数据；仅将渲染/布局/交互交由 G6 执行，`fx/fy` 语义由 G6 的固定节点机制承接，REST API 与「编辑↔ARGO MCP」映射表不变。

---

## 4. 调研附录：可查证来源

- AntV G6：https://github.com/antvis/G6（MIT，12.3k⭐）
- Cytoscape.js：https://github.com/cytoscape/cytoscape.js（MIT，11.2k⭐）
- React Flow (xyflow)：https://github.com/xyflow/xyflow（MIT，38.1k⭐）
- AntV X6：https://github.com/antvis/X6（MIT，6.7k⭐）
- AntV Graphin：https://github.com/antvis/Graphin（MIT，1.1k⭐，基于 G6 的 React 封装）
- vis-network：https://github.com/visjs/vis-network（MIT + Apache-2.0，3.6k⭐）
- Sigma.js：https://github.com/jacomyal/sigma.js（MIT，12.1k⭐）
- ELK (elkjs)：https://github.com/kieler/elkjs（EPL-2.0 / GPL-3.0，2.7k⭐）
- dagre：https://github.com/dagrejs/dagre（MIT，5.8k⭐）
- draw.io / diagrams.net：https://github.com/jgraph/drawio（Apache-2.0，7.6k⭐）
- Excalidraw：https://github.com/excalidraw/excalidraw（MIT，130.1k⭐）
- tldraw：https://github.com/tldraw/tldraw（tldraw license，49.9k⭐）
- Neo4j Browser：https://github.com/neo4j/neo4j-browser（GPL-3.0，831⭐）
- Memgraph：https://github.com/memgraph/memgraph（BSL/MEL，4.3k⭐）
- ArangoDB：https://github.com/arangodb/arangodb（BSL，14.3k⭐）
- Gephi：https://github.com/gephi/gephi（GPL-3.0/CDDL，6.6k⭐）
- Logseq：https://github.com/logseq/logseq（AGPL-3.0，44.5k⭐）
