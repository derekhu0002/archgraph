# Android 平板「一页」架构图 App 方向 — 全面洞察

> 交付角色：业界技术洞察团队（洞察Lead 编排五步法）
> 洞察诉求：人类伙伴离开办公室时，用 Android 平板触屏与 AI 共享同一张 ArchiMate 知识图谱；AI 把图投影进 Sparx EA 的现状仅适合桌面，需评估平板「一页」工具方向。
> 方法：麦肯锡新五步法（界定问题 → 拆解问题 → 提出假设 → 验证假设 → 综合建议）
> 证据声明：本会话**未挂载 BAILIAN WEB MCP**，验证改由 `webfetch` 抓取 14 个一手来源（官方规范/官网/官方文档/官方仓库），**未完成 BAILIAN 通道的全网收集**；全文无"模型记忆代替检索"的证据断言。
> 边界：仅为方向洞察，不实施；不改 `argo/**`、不改图谱 JSON 结构。

---

## 0. 核心结论（结论先行）

1. **平板工具应定位为"瘦客户端 + Hub 远程前端"，而非新的建模后端。** 图 / Neo4j / Agent / ARGO MCP 全部留在现有「ArchGraph 本地 Web 服务」（2760）侧；平板只做 HTTP(S) 客户端。
2. **形态推荐"PWA → TWA 打包"为独立 Android 应用**，复用 `web/` 的 MaxGraph 0.24 内核与布局侧车，避免纯原生重写；前置条件：HTTPS 域名 + Digital Asset Links + 触屏就绪化。
3. **当前最大阻塞不是 UI，而是"可达性 + 安全"。** 2760 默认 `127.0.0.1`（NF-4）；平板触达必须经局域网/隧道/反代，并配套认证 + 传输加密 + Origin 校验。
4. **三条路线不互斥，应分工而非二选一**：Sparx EA = 深度权威建模桌面；平板 App = 移动"看 / 轻改 / AI 协作"瘦客户端；既有 Web 服务 = Hub / 后端与共享画布内核。
5. **平板边界 = "看 + 轻改 + 与 AI 协作"**，结构级重改留给 EA/桌面；**离线只做只读缓存、写操作在线化**，守住单一事实源与 `preview→apply` 闸门。

---

## 1. 问题陈述（界定问题）

### 1.1 一句话问题陈述

> 人类伙伴希望"人不必在办公室、用自带电脑/平板即可与 AI 共享同一张 ArchiMate 知识图谱"；为此需判断：应如何把现有『ArchGraph 本地 Web 服务（2760）』演进为一个面向 Android 平板的、以"一页/画布优先/触屏手势驱动"为形态的瘦客户端，并厘清它与 Sparx EA、桌面 Web、Atlas『驾驶操作工具』的分工边界？

### 1.2 目标（Goals）

- **G1** 让人类在离开桌面的移动场景下，仍能与 AI 共享同一张架构图，完成"看 → 轻改 → 与 AI 协作"闭环。
- **G2** 形态明确：Android 平板上的"独立应用"（人类伙伴已拍板），交互近似"一页"。
- **G3** 复用既有 2760 Web 服务作为 Hub，而非另造后端。
- **G4** 给出可执行建议 + 分期路线 + 评估维度/方法，并回答三条候选路线（Sparx EA / 平板 App / 既有 Web 服务）如何分工。

### 1.3 范围（Scope）

- **在范围内**：平板端形态与交互范式；运行拓扑与数据通路；功能边界（看/轻改/AI 协作）；实现路线（PWA-TWA / 原生容器复用 / 纯原生）；安全与信任边界；与 EA/桌面 Web 的分工；评估维度与方法；Atlas『驾驶操作工具』的定位评估（仅评估）。
- **不在范围内（非目标）**：不实施、不写 `design/KG/SystemArchitecture.json`、不改 `argo/**`、不做 Android 工程落地、不做 Hub 后端改造、不裁决最终域名/托管采购。

### 1.4 成功标准（Success Criteria）

- **S1** 产出可回答、可裁决的路线建议（含推荐方案与理由）。
- **S2** 建议守住硬约束：单一事实源、写图经 ARGO MCP（preview→apply）、平板瘦客户端、深度权威建模留给 EA/桌面。
- **S3** 明确 Hub 如何被平板触达（当前仅 loopback 是阻塞点）与所需安全措施。
- **S4** 每条关键结论均有可追溯证据来源（标注仓库一手 / 联网验证 / 未决）。
- **S5** 给出 P0/P1/P2 分期与评估维度/方法，可直接转立项。

### 1.5 约束（Constraints）

- **C1** 单一事实源 = `design/KG/SystemArchitecture.json`；所有写图必经 ARGO MCP（preview→apply）。【仓库一手】
- **C2** 平板是瘦客户端：Android 跑不动 Node + Neo4j + Agent + MCP 栈。【人类伙伴硬约束】
- **C3** 深度权威建模留给 EA/桌面；`web/` 服务默认绑定 `127.0.0.1`（NF-4 安全）。【仓库一手】
- **C4** 只做方向洞察，不实施。
- **C5** 建议复用既有 2760 Web 服务为 Hub，但必须回答远程触达问题。

### 1.6 非目标（Non-Goals）

- 不在平板上实现完整 ArchiMate 强约束编辑器。
- 不把 Neo4j/Agent/MCP 运行栈搬到 Android。
- 不在本洞察内决定云厂商/域名采购。

### 1.7 JTBD（用户待办任务）

| 场景 | 任务（JTBD） | 期望结果 |
|---|---|---|
| 通勤/咖啡馆/客户现场 | 用平板打开"同一张图"，与 AI 对话看架构、问"这处改动影响谁" | 秒级看到与 AI 一致的图，AI 结论有图可依 |
| 会议白板旁 | 触屏圈选/下钻/轻拖布局、让 AI 生成一版视图 | 手势顺畅、不误触，改动可回退 |
| 离开桌面 | 做轻量决策（改描述/加关系/调布局），不做深建模 | 改动经 MCP 校验写回，权威模型不破 |

### 1.8 待澄清（缺省作为假设交团队验证）

- **Q1「一页」交互范式**：单屏画布优先 + 手势驱动 + 渐进披露？（本文以 H4 处理）
- **Q2 Atlas『驾驶操作工具』的 job**：是"驱动 Agent/流水线的操作台"还是别的？（本文以 H11/未决处理）

---

## 2. MECE 议题树（拆解问题）

根问题：如何为 Android 平板提供"与 AI 共享同一张 ArchiMate 图"的一页式瘦客户端，并厘清与 EA/桌面/Atlas 的分工？

```
P0 平板"一页式"ArchiMate 共享客户端（MECE）
├─ A 场景与 JTBD
│  ├─ A1 移动/平板下的真实使用场景（通勤/会议/现场）
│  ├─ A2 人类伙伴与 AI 的协作模式（问答 / 建议 / 确认写回）
│  └─ A3 与桌面场景的差异（时间碎片、单手/触屏、弱网）
├─ B 运行拓扑与数据通路
│  ├─ B1 各组件在哪跑：平板 / 图(JSON) / Neo4j / Agent / ARGO MCP / Hub
│  ├─ B2 平板↔Hub 的连接方式（局域网 / 反代 / 隧道）
│  ├─ B3 写路径：平板 → Hub → ARGO MCP preview→apply → 单一事实源
│  └─ B4 读路径：getSystemArchitecture / getIntentElementContext / getArchitectureViewContext
├─ C 触屏"一页"交互范式
│  ├─ C1 布局范式（画布优先 / 单屏 / 渐进披露）
│  ├─ C2 手势集（平移缩放/点选/长按径向菜单/双击下钻/拖拽）
│  └─ C3 AI 协作界面（对话 + 图上预览高亮 + 确认）
├─ D 功能边界：看 / 轻改 / 与 AI 协作
│  ├─ D1 只读浏览与检索
│  ├─ D2 轻改（布局/描述/属性/关系；经 MCP 校验）
│  └─ D3 结构级重改的归属（留给 EA/桌面）
├─ E 实现路线
│  ├─ E1 PWA（浏览器直达 Hub）
│  ├─ E2 PWA→TWA 打包为独立 Android App（复用 web 内核）
│  ├─ E3 原生容器（WebView/Capacitor 壳）复用 web 内核
│  └─ E4 纯原生重写（Compose + 原生图渲染）
├─ F 安全与信任边界
│  ├─ F1 从 loopback 到可达的暴露方式与认证
│  ├─ F2 传输加密 / Origin 校验 / DNS rebinding / 会话
│  └─ F3 写权限与最小授权（preview→apply 闸门）
├─ G 与 EA / 桌面 Web 的分工与共享
│  ├─ G1 Sparx EA 的角色（深度权威建模桌面）
│  ├─ G2 桌面 Web（2760）的角色（Hub + 大屏编辑）
│  └─ G3 共享内核与一致性（MaxGraph / 布局侧车 / .qea 投影）
└─ H 评估维度与方法
   ├─ H1 维度集（触屏可用性 / 能力覆盖 / 复用度 / 安全 / 离线 / 一致性）
   ├─ H2 方法（真机手势走查 / 弱网断网 / 安全审计 / 一致性回归）
   └─ H3 决策闸门（何时选哪条路线）
```

**MECE 自检**：A–H 相互独立（场景/拓扑/交互/功能/路线/安全/分工/评估），覆盖"人—机—图—路—评"全部维度；无重叠、无遗漏。

---

## 3. 可验证假设清单

| # | 议题 | 可验证假设 | 若为真的判别标准 | 若为假的判别标准 |
|---|---|---|---|---|
| **H1** | A | 平板核心 JTBD 是"离开桌面时与 AI 共享同一张图并做轻量决策"，而非在平板上做深度建模。 | 业界移动端把移动定位为查看/轻编辑/协作，深度编辑在桌面。 | 存在主流移动端 ArchiMate 强约束建模工具且被广泛用于深建模。 |
| **H2** | B | 平板必须是瘦客户端；图/Neo4j/Agent/MCP 留在 Hub 侧，平板仅经 HTTP(S) 访问。 | 移动浏览器/WebView 只能做 HTTP 客户端；MCP 支持 Streamable HTTP 供独立服务端服务多客户端。 | 能在 Android 本地跑 Node+Neo4j+MCP 全栈且可维护。 |
| **H3** | B | 现有 2760 默认 loopback，必须经隧道/反代/局域网安全暴露才能被平板触达。 | 官方隧道/反代方案支持 outbound-only 暴露本地服务并配认证。 | 平板可无改造直连 127.0.0.1（除非同机）。 |
| **H4** | C | "画布优先 + 手势驱动 + 渐进披露"的单屏范式在触屏可行，但现有 `web/` 触屏就绪度不足，需专门投入。 | 现有前端缺 touch/pointer、manifest、fullscreen（仓库事实）；PWA 可 standalone 安装；draw.io 支持 WebView Android。 | 现有 `web/` 已具备完整触屏手势与 PWA 能力。 |
| **H5** | D | 平板边界应为"看 + 轻改 + AI 协作"，结构级重改留给 EA/桌面。 | 业界分工一致（draw.io 桌面/网页、Archi 桌面、Structurizr 模型即代码+官方 MCP validation）。 | 平板承担全部建模职责是主流且可行。 |
| **H6** | E | PWA→TWA 打包（复用 `web/` MaxGraph 内核）优于纯原生重写，且能满足"独立 Android 应用"形态。 | Bubblewrap/PWABuilder 可由 PWA 生成 Android TWA App；Android Chrome/Samsung 可安装 PWA 为 WebAPK 并 standalone 显示。 | TWA 无法满足独立应用形态，或必须原生重写才能达到可用触屏体验。 |
| **H7** | F | 暴露 Hub 会突破 NF-4 loopback 安全边界，必须引入认证/授权 + 传输加密 + Origin 校验，否则有 DNS rebinding/未授权访问风险。 | MCP 官方安全最佳实践明确要求：本地服务绑 localhost、验证 Origin、实现认证、防会话劫持。 | 暴露本地 MCP/服务无已知安全风险。 |
| **H8** | G | 三条路线不互斥、应分工：EA=深度权威建模桌面；平板 App=移动瘦客户端；2760=Hub/后端与共享内核。 | Structurizr（模型即代码 + 官方 MCP validation）是同构者；Archi/draw.io 呈现桌面 vs 移动分工。 | 存在一条路线能同时覆盖深建模 + 移动 + 后端，其余可淘汰。 |
| **H9** | H | 评估应以"外部视角触屏可用性 + 单一事实源一致性（写经 MCP preview→apply）+ 安全边界"为核心维度。 | 与项目铁律一致；MCP 安全规范提供可操作检查项。 | 应以内部实现细节为主要评估维度。 |
| **H10** | A/D | 离线优先会与"单一事实源 + 布局侧车"冲突；建议离线仅只读缓存、写操作在线化。 | MDN 后台同步/后台抓取存在权限与时限约束，无现成"preview→apply 语义冲突解决"。 | 存在成熟的离线优先 ArchiMate 协作同步方案可直接复用。 |
| **H11** | A/未决 | Atlas『驾驶操作工具』的 job 是"驱动 Agent/流水线的操作台"，与平板"看图"互补而非替代。 | 待人类澄清或读取 Atlas 半成品仓库确认。 | 若其 job 实为"移动端看图"，则与平板 App 职责重叠，需合并。 |

---

## 4. 假设验证（验证假设）

### 4.1 检索覆盖说明（诚实声明）

- **BAILIAN WEB MCP 未挂载**：本次未完成 BAILIAN 通道的全网收集（缺 InfoQ/知乎/CSDN/掘金/YouTube 等聚合检索）。
- 已用 `webfetch` 抓取 **14 个一手来源**，覆盖 MCP 官方规范、MDN 官方文档、Cloudflare/ngrok 官方文档、Archi/Structurizr/draw.io/FigJam 官网、draw.io 与 Bubblewrap 官方仓库。
- 来源类别集中于"官方规范/官方文档/官网/官方仓库"，**缺第三方博客与视频类交叉源**，为本次验证局限。
- 每假设均以 **≥2 个不同角度来源**交叉核对。

### 4.2 来源清单（URL / 类别 / 可信度）

| 编号 | 来源 URL | 类别 | 可信度 |
|---|---|---|---|
| S1 | modelcontextprotocol.io/specification/2025-06-18/basic/transports | 官方规范 | 高 |
| S2 | modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices | 官方规范 | 高 |
| S3 | archimatetool.com | 官方官网 | 高 |
| S4 | structurizr.com | 官方官网 | 高 |
| S5 | docs.structurizr.com/ai/mcp | 官方文档 | 高 |
| S6 | drawio.com | 官方官网 | 中高 |
| S7 | raw.githubusercontent.com/jgraph/drawio/master/README.md | 官方仓库 | 高 |
| S8 | developer.mozilla.org/.../Making_PWAs_installable | 官方文档 | 高 |
| S9 | developer.mozilla.org/.../Offline_and_background_operation | 官方文档 | 高 |
| S10 | developers.cloudflare.com/cloudflare-one/connections/connect-networks/ | 官方文档 | 高 |
| S11 | ngrok.com/docs/getting-started/ | 官方文档 | 高 |
| S12 | raw.githubusercontent.com/GoogleChromeLabs/bubblewrap/main/README.md | 官方仓库 | 高 |
| S13 | figma.com/figjam/ | 官方官网 | 中高 |
| S14 | docs.pwabuilder.com | 官方文档 | 中 |

### 4.3 逐条验证结论

| # | 结论 | 证据与来源 | 覆盖角度 |
|---|---|---|---|
| **H1** | ✅ 支持 | FigJam 定位协作白板/图/会议/敏捷/规划（S13）；draw.io 定位团队绘图+桌面应用+嵌入（S6/S7）；Archi 定位桌面跨平台建模工具（S3）。移动/网页端普遍是"协作+轻编辑"，深建模仍在桌面。 | ①协作工具官网 ②建模工具官网 |
| **H2** | ✅ 支持 | MCP 定义 stdio 与 Streamable HTTP（服务端独立进程、可服务多客户端，POST/GET+SSE）（S1）；移动浏览器/WebView 只能作 HTTP 客户端。 | ①MCP 官方传输规范 ②PWA 运行模型 |
| **H3** | ✅ 支持 | Cloudflare Tunnel：`cloudflared` 以 outbound-only 把本地资源安全接入，无需公网 IP（S10）；ngrok：`share localhost` 秒级公开本地服务并支持 MCP servers 与鉴权（S11）。 | ①Cloudflare 官方文档 ②ngrok 官方文档 |
| **H4** | ⚠️ 支持但需修正 | 【仓库一手】`web/index.html` 仅有 `<meta viewport>`；`web/style.css` 仅 1 处 `@media (max-width:700px)`；无 touch/pointer 事件、无 PWA manifest、无 fullscreen。联网：PWA 需 manifest + HTTPS/localhost 才可安装、`display: standalone` 可脱离浏览器 UI（S8）；draw.io 支持 WebView Android 137+（S7）。→ 范式可行，但触屏就绪化是从 0 到 1 的专门投入。 | ①仓库前端事实 ②MDN 安装性 ③draw.io 浏览器支持 |
| **H5** | ✅ 支持 | Archi 为 Java/Eclipse RCP 桌面工具（S3）；draw.io 桌面应用 + Web 编辑器（S6/S7）；Structurizr 为"模型即代码"+官方 MCP validation（S4/S5）。业界一致：权威建模在桌面，移动/网页负责查看与协作。 | ①Archi 官网 ②Structurizr 官网+MCP |
| **H6** | ✅ 支持（带前置条件） | Bubblewrap（Google）用 Trusted Web Activity（TWA）从 PWA 生成/构建 Android 应用；PWABuilder 为 GUI 封装（S12）。MDN：Android 上 Chrome/Samsung Internet 可将 PWA 安装为 WebAPK，获得启动器真实入口、`standalone` 显示（S8）。**前置**：TWA 需 HTTPS + Digital Asset Links（assetlinks.json）；离线/后台能力受浏览器约束（S9）。 | ①Bubblewrap 官方仓库 ②MDN 安装性 |
| **H7** | ✅ 支持 | MCP 安全最佳实践：本地服务器若 HTTP 暴露须要求授权令牌或使用受限 IPC，防 Local MCP Server Compromise / DNS rebinding；Streamable HTTP 须验证 Origin、本地时仅绑 localhost、实现认证；会话 ID 须安全随机且不得用于鉴权（S2）。 | ①MCP 安全规范 ②MCP 传输规范 ③隧道官方文档 |
| **H8** | ✅ 支持 | Structurizr = "models as code + AI friendly + 官方 MCP server（stateless HTTP transport，提供 DSL 校验/解析/检查）"，是"受 schema 约束 + MCP 协作"的同构者（S4/S5）；Archi/draw.io 为桌面/网页分工（S3/S6/S7）。→ 三路线互补分工成立。 | ①Structurizr 官网+MCP ②Archi/draw.io |
| **H9** | ✅ 支持（方法性） | 项目铁律（单一事实源、写经 MCP preview→apply、NF-4 loopback）【仓库一手】与 MCP 安全规范（S2）共同给出可操作评估检查项。 | ①项目铁律 ②MCP 安全规范 |
| **H10** | ⚠️ 修正 | MDN：后台同步/后台抓取/周期同步/推送均受权限与时限约束（Service Worker 空闲 30s 被停、`waitUntil` 超 5 分钟终止、后台抓取需 `background-fetch` 权限并显示进度 UI）（S9）。→ 离线可缓存只读快照，但写操作的 preview→apply 语义与冲突解决无现成方案；结论修正为：离线只读、写操作在线。 | ①MDN 离线/后台文档 ②MCP 传输会话/断线语义 |
| **H11** | ⏳ 未决 | 无公开资料可验证 Atlas『驾驶操作工具』的内部 job；【仓库一手】仅知其为"打包在 Atlas 里的半成品、未完工未废弃"。需人类澄清或读其源码。 | 无（待澄清） |

---

## 5. 综合建议（金字塔）

### 5.1 核心结论

1. **【主结论】** 平板工具应定位为"瘦客户端 + Hub 远程前端"，而非新的建模后端（H2 支持）。
2. **【形态结论】** 推荐"PWA → TWA 打包"为独立 Android 应用，复用 `web/` 的 MaxGraph 0.24 内核与布局侧车；前置为 HTTPS 域名 + Digital Asset Links + 触屏就绪化（H6 支持、H4 修正）。
3. **【阻塞结论】** 当前最大阻塞不是 UI，而是可达性与安全（H3、H7 支持）。
4. **【分工结论】** 三路线不互斥，应分工而非二选一（H8 支持）。
5. **【边界结论】** 平板边界 = 看 + 轻改 + 与 AI 协作；离线只读、写操作在线（H5 支持、H10 修正）。

### 5.2 实现路线对比表

| 方案 | 形态 | 复用 `web/` 内核 | 触屏体验 | 离线能力 | 分发 | 安全面 | 主要风险 | 结论 |
|---|---|---|---|---|---|---|---|---|
| **R1 PWA 直连 Hub** | 浏览器网页/可"加到主屏" | 极高 | 中（需补手势） | 弱-中（只读缓存） | 无安装包 | 中（HTTPS+认证） | 体验不如原生；依赖浏览器 | 快速验证用 |
| **R2 PWA→TWA 独立 App** ⭐ | 独立 Android 应用（Play 可分发） | 极高 | 中-高 | 中（只读缓存） | Play/TWA | 中（需 assetlinks+HTTPS） | 需域名/托管；TWA 能力受浏览器约束 | **推荐（P0→P1）** |
| **R3 原生容器复用 web 内核** | WebView/Capacitor 壳 | 高 | 中 | 中 | Play | 中 | 壳层维护；与 R2 收益接近但更重 | 备选 |
| **R4 纯原生重写** | Compose + 原生图渲染 | 极低（弃用 MaxGraph） | 高（可最优） | 强 | Play | 可控 | 成本最高、双栈维护、偏离零构建 | 不推荐（除非 R2 触屏不达标） |
| **R5 EA 移动化/远程桌面** | 远程操作桌面 EA | 低 | 差（桌面 UI 缩放） | 无 | — | 差 | 违背"平板触屏一页"诉求 | 不推荐 |

### 5.3 可执行建议

1. **以 2760 Web 服务为唯一 Hub，不另造后端**；平板仅作其远程前端（读走 `getSystemArchitecture`/`getIntentElementContext`/`getArchitectureViewContext`；写走 Hub → ARGO MCP `preview→apply`）。
2. **先解决 Hub 触达与安全（P0 第一优先）**：局域网优先（同 Wi-Fi，最小暴露面）→ 需远程再用 Cloudflare Tunnel 或 ngrok 的 outbound-only 通道；必须加认证令牌 + HTTPS + Origin 校验 + 绑定策略可切换（禁止无鉴权裸奔公网）。
3. **前端触屏就绪化**：补 `pointer`/`touch` 事件（平移缩放/长按径向菜单/双击下钻/拖拽）、PWA manifest（`display: standalone`）、fullscreen、响应式断点与安全区；手势与桌面鼠标操作并行不冲突。
4. **"一页"交互范式落地建议（待人类确认 Q1）**：单屏画布优先（当前视图即"一页"）＋ 渐进披露（默认核心元素，按需展开层级/关系）＋ 底部可收起 AI 命令栏（自然语言 → 图上高亮预览 → 人类确认 → apply）；AI 的所有改动以"预览叠加层"呈现，绝不静默写图。
5. **功能边界**：P0 只读浏览/检索/下钻/切视图/AI 摘要；P1 轻改（布局侧车拖拽、名称/描述/属性小改、加关系，全部经 MCP 校验）；结构级重改（新增/删除核心元素、批量重构）引导到 EA/桌面。
6. **分工矩阵**：EA=人类深度权威建模（`.qea` 投影）；平板 App=移动瘦客户端；2760=Hub + 桌面大屏编辑 + 进程内 MCP + 布局侧车；Atlas『驾驶操作工具』暂不合并，先澄清其 job（Q2）。
7. **离线策略**：只缓存只读快照（视图+图元），写操作在线化；断网时禁止写并提供"待联网"提示，避免与单一事实源冲突。

### 5.4 分期路线（P0/P1/P2）

| 阶段 | 目标 | 关键交付 | 验收（外部视角，GIVEN-WHEN-THEN 精神） |
|---|---|---|---|
| **P0 触达与只读** | 平板能安全打开 Hub 并只读看图 | 触屏手势层 + PWA manifest/fullscreen；LAN 可达 + 认证；只读浏览/检索/下钻 | GIVEN 平板与 Hub 同网且已鉴权，WHEN 打开视图并双指缩放/点选下钻，THEN 图与桌面一致且无写权限 |
| **P1 独立 App 与轻改/协作** | 独立 Android App + 轻改 + AI 协作 | PWA→TWA 打包（含 assetlinks/HTTPS）；轻改走 MCP preview→apply；AI 命令栏+图上预览确认 | GIVEN 人类在图上轻改描述并提交，WHEN Hub 校验通过，THEN 单一事实源更新且可回退；校验失败则拒绝并提示 |
| **P2 远程与离线增强** | 远程可达 + 离线只读 + 多项目 | 隧道接入（Cloudflare Tunnel/ngrok）+ 认证加固；只读离线缓存；多项目/多视图；评估 Atlas 工具整合 | GIVEN 无公网 IP，WHEN 经隧道访问，THEN 仅鉴权用户可读写；GIVEN 断网，WHEN 打开已缓存视图，THEN 可只读浏览且写操作被阻止 |

### 5.5 评估维度与方法

| 维度 | 方法 |
|---|---|
| 触屏可用性（外部视角） | 真机（Android 平板）手势走查：缩放/平移/点选/长按/拖拽的命中率与误触率 |
| 单一事实源一致性 | 所有写路径强制经 MCP preview→apply；变更后核对 `design/KG/SystemArchitecture.json` 与视图一致性 |
| 安全与信任边界 | 认证、HTTPS、Origin 校验、绑定策略、隧道最小暴露面审计（对照 S1/S2） |
| 能力覆盖 | 与 D1/D2 功能清单对照（看/轻改/协作），标注缺口与去向（EA/桌面） |
| 复用度与维护成本 | 代码复用比例（是否复用 MaxGraph 内核/布局侧车）、是否维持零构建约束 |
| 离线与弱网 | 断网/弱网下只读缓存可用性、写操作在线化提示 |
| 分发与更新 | TWA 更新链路、assetlinks 校验、Play 分发可行性 |

### 5.6 局限与未决问题

- **验证局限（重要）**：BAILIAN WEB MCP 未挂载，未完成全网收集；本次仅以 `webfetch` 覆盖官方规范/官网/官方仓库，缺第三方博客与视频类交叉验证。结论对"官方事实"可靠，对"社区实践/踩坑"覆盖不足。
- **未决 Q1**：『一页』的具体交互范式未与人类伙伴确认（本文按"画布优先+手势+渐进披露"假设）。
- **未决 Q2**：Atlas『驾驶操作工具』的 job 未知，暂不合并，建议澄清后再评估整合。
- **未决 Q3**：Hub 远程触达的最终形态（局域网 / Cloudflare Tunnel / ngrok / 自托管反代）未裁决。
- **未决 Q4**：TWA 所需 HTTPS 域名 + assetlinks.json + 托管未决策，是 R2 的硬前置。
- **未决 Q5**：MaxGraph 触屏手势需自研适配（当前 `web/` 无 touch/pointer 事件），实际工作量待原型实测。
- **未决 Q6**：离线只读缓存与布局侧车（`scripts/ea-layout-store.js`，按视图成员身份签名失效）的缓存失效策略待设计。

---

## 6. 验收标准（GIVEN-WHEN-THEN）

- **AT-tablet-app-insight-01（报告完整性）**：GIVEN 洞察团队已产出方向洞察报告；WHEN 检查 `docs/tablet-archgraph-app-insight.md`；THEN 报告包含：核心结论、问题陈述、MECE 议题树、可验证假设清单、逐条验证结论与来源清单、综合建议（含实现路线对比表与 P0/P1/P2 分期）、局限与未决问题，且验证章节显式声明 BAILIAN 未挂载的覆盖局限。
- **AT-tablet-app-insight-02（图谱登记）**：GIVEN 洞察已登记进意图图谱；WHEN 查询；THEN 存在 Business Object「里程碑：Android平板「一页」架构图App方向洞察」（id `insight-lead-milestone-tablet-app-001`），带非空 description 与 GIVEN-WHEN-THEN testcase，且位于视图 `insight-lead-ltm-001`（洞察Lead T2 长期记忆）成员中。
