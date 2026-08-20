# ArchGraph 本地 Web 服务（EA 知识图谱导入/导出）— 需求分析

> 工作包：开发EA知识图谱导入导出本地Web服务（2758）
> 角色：产品经理（xiaoniu）
> 交付对象：系统设计师（caoyang）

## 1. 背景与目标

当前 ArchGraph 知识图谱（`design/KG/SystemArchitecture.json`，schema 见
`argo/schema/SystemArchitecture.schema.json`）的导入/导出能力由 Sparx Enterprise Architect（EA）
桌面客户端中的 JScript 脚本承担，脚本位于 `eatool/EA-jsscript/`：

- `export-to-kg.js`：读取 EA 当前打开的图，导出节点/关系/视图为 JSON 文件（根字段 `name`、
  `description`、`attributes`、`elements`、`relationships`、`views`，UTF-8 无 BOM）。
- `import-from-kg.js`：读取 `design/KG/SystemArchitecture.json`，在 EA 中创建对应的元素/关系/视图。
- `import-from-external-package.js`：导入变体，不保留原 schema id，所有对象按新元素导入，并要求用户
  显式提供导入文件路径。

问题：这套工具链要求用户安装并熟悉 Sparx EA 客户端，且脚本依赖 EA COM 对象
（`Repository`/`Session`/`ActiveXObject`）。对于从未使用过 EA 的用户，导入/导出知识图谱的门槛过高、
不友好。

本需求的目标：把上述导入/导出能力迁移到一个**本地 Web 服务**，让从未用过 EA 的用户也能通过浏览器
一键导入/导出 ArchGraph 知识图谱，**完全不再依赖 Sparx EA**。

## 2. 用户场景

| 编号 | 场景 |
| --- | --- |
| S1 | 一个从未用过 EA 的用户在本地启动 Web 服务，在浏览器中打开本地页面（默认 http://127.0.0.1） |
| S2 | 该用户通过页面选择/上传一个外部知识图谱 JSON 文件，执行「导入」，将其写入本地图谱 `design/KG/SystemArchitecture.json` |
| S3 | 该用户点击「导出」，下载本地图谱 `design/KG/SystemArchitecture.json`（UTF-8 无 BOM），用于分享或备份 |
| S4 | 该用户在导入/导出后看到清晰的成功/失败结果，以及校验错误的可读提示 |
| S5 | 该用户上传了非法 JSON 或超大文件，看到明确的拒绝原因，且本地图谱未被破坏 |
| S6 | 该用户在本地启动 Web 服务后，后台自动实时读取「各个项目」的 `SystemArchitecture.json`，前端页面展示各项目的图谱状态（如是否有效、元素/关系/视图数量、最近修改时间），用户从项目列表中选择某个项目 |
| S7 | 该用户选中某项目后，使用搜索功能（语义检索、上下文检索等当前 ARGO MCP 支持的检索方法）在知识图谱中定位关心的元素/关系/视图 |
| S8 | 该用户从视图列表中选择自己关心的视图，视图以图形化方式展开，自动布局成便于人类分析的布局，节点可拖动调整位置 |
| S9 | 该用户对选中项目进行编辑（新增视图、新增元素、编辑元素属性、删除元素、编辑关系属性、删除关系），所有操作可撤销/重做；写入图谱通过 ARGO MCP 提供的接口，与 Agent 保持一致 |
| S10 | 该用户导入外部知识图谱 JSON 文件到当前选中项目 |
| S11 | 该用户导出当前选中项目的知识图谱 JSON 文件，用于分享或备份 |

## 3. 用户故事

- US-1：作为一个从未用过 EA 的用户，我希望在本地一键启动 Web 服务并在浏览器中打开，以便无需安装/学习 EA 就能导入导出知识图谱。
- US-2：作为一个用户，我希望通过网页上传一个知识图谱 JSON 文件并执行导入，以便把外部知识图谱写入本地 ArchGraph 图谱（`design/KG/SystemArchitecture.json`）。
- US-3：作为一个用户，我希望通过网页一键导出本地知识图谱，以便下载 `SystemArchitecture.json` 用于分享或备份。
- US-4：作为一个用户，我希望在导入/导出时看到清晰的结果与校验错误提示，以便快速发现并修正格式问题。
- US-5：作为一个用户，我希望导入前对文件做格式与大小校验，以便避免损坏本地图谱。
- US-6：作为一个用户，我希望后台自动实时读取各个项目的 `SystemArchitecture.json` 并在前端看到各项目图谱状态，以便快速了解所有项目并选择要操作的项目。
- US-7：作为一个用户，我希望在选中项目后用语义检索、上下文检索等 ARGO MCP 支持的检索方法搜索知识图谱，以便快速定位关心的元素/关系/视图。
- US-8：作为一个用户，我希望从视图列表选择视图并图形化展开、自动布局、拖动节点，以便直观分析图谱结构。
- US-9：作为一个用户，我希望对图谱进行新增视图/元素、编辑属性、删除元素/关系等编辑操作，并支持撤销/重做，且写图统一走 ARGO MCP 接口与 Agent 保持一致，以便安全地维护图谱。
- US-10：作为一个用户，我希望导入外部知识图谱 JSON 到当前项目，以便把外部图谱纳入管理。
- US-11：作为一个用户，我希望导出当前项目的知识图谱 JSON，以便分享或备份。

## 4. 功能需求

- FR-1（本地服务）：提供本地 Web 服务（HTTP 服务 + 网页 UI），默认绑定 `127.0.0.1`，用户零配置即可启动并访问。
- FR-2（导出）：提供导出能力，读取 `design/KG/SystemArchitecture.json`，以 UTF-8 无 BOM 的 JSON 返回供浏览器下载；导出内容与本地文件一致。
- FR-3（导入）：提供导入能力，接收用户上传/选择的 JSON 文件，按 `argo/schema/SystemArchitecture.schema.json`
  校验通过后写入本地图谱 `design/KG/SystemArchitecture.json`。
- FR-4（导入校验）：导入前校验：JSON 合法性、schema 结构（根 `name`/`description`/`elements`/`relationships`/`views`）、
  元素/关系/视图字段类型、id 唯一性、`parent`/`source_id`/`target_id` 等引用完整性。
- FR-5（结果反馈）：导入/导出完成后返回清晰结果（成功、失败原因、校验错误明细）。
- FR-6（零 EA 依赖）：整个 Web 服务不调用任何 EA COM/JScript 组件，不要求安装 Sparx EA。
- FR-7（多项目自动发现与状态展示）：后台自动实时读取「各个项目」的 `SystemArchitecture.json`，在前端页面展示各项目的图谱状态（如项目名、图谱是否有效、元素/关系/视图数量、最近修改时间）。
- FR-8（项目选择）：用户可从项目列表中选择某个项目，作为后续查看/编辑/搜索/导入/导出的操作对象。
- FR-9（搜索）：提供搜索能力，支持当前 ARGO MCP 支持的检索方法——语义检索（`getSystemArchitecture` 语义查询，`query.purpose` + `query.intent`）与上下文检索（`getIntentElementContext` 语义依赖遍历、`getArchitectureViewContext` 视图上下文）等。
- FR-10（图形化查看）：从视图列表选择视图后，以图形化方式展开，自动布局成便于人类分析的布局，节点可拖动调整位置。
- FR-11（编辑操作集）：支持新增视图、新增元素、编辑元素属性、删除元素、编辑关系属性、删除关系。
- FR-12（撤销/重做）：所有编辑操作均可撤销和重做。
- FR-13（写图一致性）：所有写入图谱的操作必须通过 ARGO MCP 提供的接口（`addArchitectureElement` / `updateArchitectureElement` / `removeArchitectureElement` / `addArchitectureView` / `updateArchitectureView` / `removeArchitectureView` / `addArchitectureRelationship` / `updateArchitectureRelationship` / `removeArchitectureRelationship` / `applySystemArchitectureMutation` 等）完成，与 Agent 写图保持一致，禁止绕过 MCP 直接编辑 `SystemArchitecture.json`。
- FR-14（导入导出）：支持导入外部知识图谱 JSON 文件到当前项目，以及导出当前项目的知识图谱 JSON 文件。

## 5. 非功能需求

- NF-1（本地运行）：服务在本地机器运行，零配置启动（一条命令/双击即可）。
- NF-2（零 EA 依赖）：不依赖 Sparx EA 客户端、EA COM 对象或 JScript 引擎。
- NF-3（易用性）：通过浏览器页面即可完成导入/导出，面向无技术背景、无 EA 经验的用户。
- NF-4（安全）：默认仅监听本机回环地址（127.0.0.1），不对外网暴露；不把图谱数据上传到任何外部服务。
- NF-5（格式校验）：严格按 schema 校验，错误信息可读、可定位到具体字段。
- NF-6（数据安全）：导入写入采用备份/原子写入策略，校验失败时不修改本地图谱，避免损坏 `SystemArchitecture.json`。
- NF-7（资源限制）：限制上传文件大小与非 JSON 内容，拒绝超大/非 JSON 输入。
- NF-8（实时性）：后台实时读取各项目图谱状态，状态变化在合理时间内（如秒级）反映到前端。
- NF-9（性能）：大图谱（元素/关系数量较多时）的搜索、图形化渲染与自动布局保持流畅可用。
- NF-10（易用性）：图形化查看与编辑交互直观，面向无 EA 经验的用户，关键操作（编辑/撤销/重做）有明确入口与反馈。
- NF-11（数据安全与备份）：编辑写入前备份当前图谱，写图失败或校验失败时不破坏图谱；撤销/重做栈保证可恢复到历史状态。

## 6. 验收标准（GIVEN-WHEN-THEN）

- AC-1（导入）：GIVEN 本地 Web 服务已启动且用户持有一个符合 schema 的 SystemArchitecture.json 文件；WHEN 用户在浏览器上传该文件并执行导入；THEN 文件通过校验并成功写入本地图谱 `design/KG/SystemArchitecture.json`，返回成功结果。
- AC-2（导出）：GIVEN 本地 Web 服务已启动且 `design/KG/SystemArchitecture.json` 存在；WHEN 用户点击导出；THEN 浏览器下载该 JSON 文件，内容与本地文件一致（UTF-8 无 BOM）。
- AC-3（无 EA 依赖）：GIVEN 一台未安装 Sparx EA 的机器；WHEN 用户启动本地 Web 服务并执行导入/导出；THEN 功能正常工作，全程不调用任何 EA COM/JScript 组件。
- AC-4（格式校验）：GIVEN 用户上传一个非法/损坏的 JSON（缺少 `elements` 或结构不符合 schema）；WHEN 执行导入；THEN 服务返回明确的校验错误信息，且本地图谱 `SystemArchitecture.json` 不被修改。
- AC-5（大小校验）：GIVEN 用户上传超大文件或非 JSON 文件；WHEN 执行导入；THEN 服务拒绝该文件并给出可读提示，不写入本地图谱。
- AC-6（多项目状态展示）：GIVEN 存在多个项目且各自拥有 `SystemArchitecture.json`；WHEN 用户打开前端页面；THEN 后台自动读取并展示各项目的图谱状态（有效性、元素/关系/视图数量等），用户可从中选择某个项目。
- AC-7（搜索）：GIVEN 用户已选中某项目；WHEN 用户输入查询并选用语义检索或上下文检索；THEN 返回与 ARGO MCP 检索方法（`getSystemArchitecture` 语义查询 / `getIntentElementContext` 上下文检索）一致的结果，可定位到元素/关系/视图。
- AC-8（图形化查看）：GIVEN 用户已选中某项目并打开视图列表；WHEN 用户选择某视图；THEN 该视图以图形化方式展开并自动布局，节点可拖动调整位置。
- AC-9（编辑写图一致性）：GIVEN 用户已选中某项目并进入编辑；WHEN 用户执行新增视图/新增元素/编辑元素属性/删除元素/编辑关系属性/删除关系；THEN 操作通过 ARGO MCP 提供的接口写入图谱，与 Agent 写图保持一致，且写后图谱通过 schema 校验。
- AC-10（撤销/重做）：GIVEN 用户已执行若干编辑操作；WHEN 用户点击撤销或重做；THEN 图谱状态分别回退或前进到对应历史状态。
- AC-11（导入到当前项目）：GIVEN 用户已选中某项目并持有外部知识图谱 JSON；WHEN 用户执行导入；THEN 文件通过校验后写入当前项目图谱，返回成功结果。
- AC-12（导出当前项目）：GIVEN 用户已选中某项目且该项目图谱 JSON 存在；WHEN 用户点击导出；THEN 下载当前项目知识图谱 JSON 文件（UTF-8 无 BOM）。

## 7. 留待系统设计师决策的要点

- 导入语义：外部 JSON 是「整体替换」本地图谱，还是「合并/追加」到本地图谱（需给出方案与理由）。
- 技术栈与启动方式：Node 服务 / 静态页 + CLI 等；如何做到「零配置、一条命令启动」。
- 是否提供网页 UI、还是仅提供 HTTP 接口（需覆盖 US-1 的易用性目标）。
- 项目如何定义/枚举：多项目的根目录、项目发现规则、`SystemArchitecture.json` 的路径映射与项目命名。
- 实时读取机制：文件系统监听（watch）还是定时轮询；刷新频率与性能权衡。
- Web 服务如何调用 ARGO MCP 写图接口：进程内直接调用 MCP 模块，还是以子进程方式作为 MCP 客户端调用，确保与 Agent 写图路径一致。
- 图形渲染与自动布局技术选型（如 SVG/Canvas 渲染、力导向或分层布局算法）。
- 撤销/重做栈实现：基于命令（Command）模式还是图谱快照（snapshot）模式，以及内存/磁盘占用权衡。
- 多项目编辑的数据安全：编辑前备份、并发写入与文件锁。
