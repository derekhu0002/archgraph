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

## 3. 用户故事

- US-1：作为一个从未用过 EA 的用户，我希望在本地一键启动 Web 服务并在浏览器中打开，以便无需安装/学习 EA 就能导入导出知识图谱。
- US-2：作为一个用户，我希望通过网页上传一个知识图谱 JSON 文件并执行导入，以便把外部知识图谱写入本地 ArchGraph 图谱（`design/KG/SystemArchitecture.json`）。
- US-3：作为一个用户，我希望通过网页一键导出本地知识图谱，以便下载 `SystemArchitecture.json` 用于分享或备份。
- US-4：作为一个用户，我希望在导入/导出时看到清晰的结果与校验错误提示，以便快速发现并修正格式问题。
- US-5：作为一个用户，我希望导入前对文件做格式与大小校验，以便避免损坏本地图谱。

## 4. 功能需求

- FR-1（本地服务）：提供本地 Web 服务（HTTP 服务 + 网页 UI），默认绑定 `127.0.0.1`，用户零配置即可启动并访问。
- FR-2（导出）：提供导出能力，读取 `design/KG/SystemArchitecture.json`，以 UTF-8 无 BOM 的 JSON 返回供浏览器下载；导出内容与本地文件一致。
- FR-3（导入）：提供导入能力，接收用户上传/选择的 JSON 文件，按 `argo/schema/SystemArchitecture.schema.json`
  校验通过后写入本地图谱 `design/KG/SystemArchitecture.json`。
- FR-4（导入校验）：导入前校验：JSON 合法性、schema 结构（根 `name`/`description`/`elements`/`relationships`/`views`）、
  元素/关系/视图字段类型、id 唯一性、`parent`/`source_id`/`target_id` 等引用完整性。
- FR-5（结果反馈）：导入/导出完成后返回清晰结果（成功、失败原因、校验错误明细）。
- FR-6（零 EA 依赖）：整个 Web 服务不调用任何 EA COM/JScript 组件，不要求安装 Sparx EA。

## 5. 非功能需求

- NF-1（本地运行）：服务在本地机器运行，零配置启动（一条命令/双击即可）。
- NF-2（零 EA 依赖）：不依赖 Sparx EA 客户端、EA COM 对象或 JScript 引擎。
- NF-3（易用性）：通过浏览器页面即可完成导入/导出，面向无技术背景、无 EA 经验的用户。
- NF-4（安全）：默认仅监听本机回环地址（127.0.0.1），不对外网暴露；不把图谱数据上传到任何外部服务。
- NF-5（格式校验）：严格按 schema 校验，错误信息可读、可定位到具体字段。
- NF-6（数据安全）：导入写入采用备份/原子写入策略，校验失败时不修改本地图谱，避免损坏 `SystemArchitecture.json`。
- NF-7（资源限制）：限制上传文件大小与非 JSON 内容，拒绝超大/非 JSON 输入。

## 6. 验收标准（GIVEN-WHEN-THEN）

- AC-1（导入）：GIVEN 本地 Web 服务已启动且用户持有一个符合 schema 的 SystemArchitecture.json 文件；WHEN 用户在浏览器上传该文件并执行导入；THEN 文件通过校验并成功写入本地图谱 `design/KG/SystemArchitecture.json`，返回成功结果。
- AC-2（导出）：GIVEN 本地 Web 服务已启动且 `design/KG/SystemArchitecture.json` 存在；WHEN 用户点击导出；THEN 浏览器下载该 JSON 文件，内容与本地文件一致（UTF-8 无 BOM）。
- AC-3（无 EA 依赖）：GIVEN 一台未安装 Sparx EA 的机器；WHEN 用户启动本地 Web 服务并执行导入/导出；THEN 功能正常工作，全程不调用任何 EA COM/JScript 组件。
- AC-4（格式校验）：GIVEN 用户上传一个非法/损坏的 JSON（缺少 `elements` 或结构不符合 schema）；WHEN 执行导入；THEN 服务返回明确的校验错误信息，且本地图谱 `SystemArchitecture.json` 不被修改。
- AC-5（大小校验）：GIVEN 用户上传超大文件或非 JSON 文件；WHEN 执行导入；THEN 服务拒绝该文件并给出可读提示，不写入本地图谱。

## 7. 留待系统设计师决策的要点

- 导入语义：外部 JSON 是「整体替换」本地图谱，还是「合并/追加」到本地图谱（需给出方案与理由）。
- 技术栈与启动方式：Node 服务 / 静态页 + CLI 等；如何做到「零配置、一条命令启动」。
- 是否提供网页 UI、还是仅提供 HTTP 接口（需覆盖 US-1 的易用性目标）。
