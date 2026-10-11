---
name: argo-init
description: "通过 `argo-init` CLI 完成工作区确定性的初始化（工作区 bootstrap + NEO4J 初始同步 + .qea 全量投影 + 语义生命周期 + canonical 校验 + subdiagram_views 一致性 + 本体定义/校验）。Use when the user asks to verify Argo readiness and perform or verify the canonical JSON-to-Neo4j initial sync, .qea full projection (target file must be this repo's own .qea), plus semantic lifecycle init. Keywords: ARGO INIT, harness init, argo-init, initializeWorkspaceReport, Neo4j initial sync, qea projection, semantic lifecycle."
argument-hint: scope-or-mode
disable-model-invocation: true
---

# ARGO INIT

`argo-init` 是一个 **CLI 命令**（`argo-init [--workspace <dir>]`，默认当前目录），完成确定性初始化：工作区 bootstrap（缺 `SystemArchitecture.json` / EA 模型文件（`.qea`）自动生成）+ Neo4j 结构投影同步 + **.qea 全量投影（整库清空重建，逻辑同 Neo4j init）** + 语义生命周期初始化 + canonical 校验 + 本体定义/校验 + subdiagram_views 一致性，并输出完整报告。**初始化已从 MCP 接口移除**（它慢、且只由人/技能手动触发，长耗时曾导致 MCP 客户端超时）；CLI 与原来的 MCP 接口**功能一致**（同一 `initializeWorkspaceReport`）。

- 工作区缺少 `design/KG/SystemArchitecture.json` 时自动从部署的 `defaults` 拷贝默认模板；缺 EA 模型文件（仓库根无 `.qea`/`.feap`/`.eap`）时以当前项目名拷贝默认 `.qea` 模板（不再补建遗留 `.feap`）。
- 本机 Neo4j 连接可用，canonical 意图图完成至少一次 JSON -> Neo4j 初始同步并通过一致性校验；**投影到的 Neo4j 数据库名称必须与本仓库名称一致**（如仓库 archgraph → 库 archgraph），不一致须报告为告警/失败。
- **.qea 投影**：init 对仓库 EA 文件（仓库根 `.qea`，经 `ARGO_EA_QEA` 或仓库根唯一 `*.qea` 解析）执行整库清空后全量重建；**必须确认投影目标是本仓库自己的 `.qea` 文件**，并报告投影成功/失败与耗时。
- 语义生命周期：双 gate 未开启时记录 skipped/disabled；开启时执行全量 embedding backfill 与 readiness 对齐。

## Rules

- **MUST** 运行 **CLI 命令 `argo-init`**（默认当前工作区；或 `argo-init --workspace <dir>`）执行确定性初始化，并以其输出的报告为最终判断依据。
- **MUST** 报告当前 schema：报告里 `schema`（或 `schemaBundle`）中的 `kind`（default=内置 ArchiMate 3.2 / workspace=仓内自定义 / override）、`language`（名称）、`actorElementType`、`dir`、`guide`；输出形如 `schema: default / ArchiMate 3.2`。
- **MUST** 报告 `mcp` / `systemArchitecture` / `ontology` / `ontologyValidation` / `neo4j` / `qeaFullProjection` / `semanticLifecycle` / `subdiagramViews` 与整体 `status`。
- **MUST** 在面向用户的总结里明确给出两件事并逐条判「正常/不正常」：
  - ① **本体是否正常**（`ontology.status`；一句定义摘要：language + 元素/关系类型数 + 端点矩阵有无 + constraints + axioms；并列出缺失项 `ontology.missing` 的 structure/constraints/axioms）；
  - ② **本体校验引擎是否正常**（`ontologyValidation.status`：`passed`=正常 / `failed`=异常（附 `errors`）/ `disabled`=未启用）。
  **若任一不正常或未启用，必须在总结中显著说明**（否则用户无法感知）——不得只贴报告 JSON、不得省略。
- **MUST** 核验并报告：① `.qea` 投影是否成功（`qeaFullProjection.status`），且投影目标 `qeaFullProjection.qea` 是否为**本仓库自己的 .qea 文件**（解析自 `ARGO_EA_QEA` 或仓库根唯一 `*.qea`）；目标不是本仓库文件或投影失败 → 报告为告警/失败，不得视为 init 成功。
- **MUST** 核验并报告：Neo4j 投影目标数据库名（`neo4j.database`）是否**与本仓库名一致**（仓库 basename == 数据库名）；不一致 → 报告为告警/失败。
- **MUST NOT** 因 schema 是自定义的而跳过 `.qea` 投影：投影对任何 schema 都执行；只有确实没有 `.qea` 目标时才允许 `noop`。
- **MUST NOT** 读取、打印或复述 `.env` 中的 secret 值；排查时只允许报告 key 是否存在。
- **MUST NOT** 通过 MCP 工具做初始化（`initializeWorkspace` 已从 MCP 工具面移除；它在 `argo_mcp` 里会报错）。**MUST NOT** 手工拼装一组无关命令来替代 `argo-init` 的报告。若 `argo-init` 报告显示底层步骤失败，才按报告排查。

## Workflow

### 1. Run Deterministic Init via the `argo-init` CLI

运行 **`argo-init`**（默认当前工作区；或 `argo-init --workspace <dir>`）。这条 CLI 与原来的 MCP `initializeWorkspace` 接口**功能一致**（同一 `initializeWorkspaceReport`），完成全部确定性步骤并输出报告：

- `workspaceBootstrap`：缺 `SystemArchitecture.json` / EA 模型文件时自动生成 `.qea`（createdFiles / skippedSteps；仓库根已有 `.qea`/`.feap` 时不重复补建）
- `mcp`：ARGO MCP 健康（协议 / tools-list / ping）
- `systemArchitecture`：canonical 校验（元素/关系/视图计数）
- `subdiagramViews`：subdiagram_views 一致性检查/修复
- `neo4j`：Neo4j 连通 + 结构投影初始同步 + 一致性校验（initialSync / verification）；**并核验投影目标数据库名 == 本仓库名**
- `qeaFullProjection`：仓库 EA（.qea）整库清空重建 + 一致性（status / qea 目标路径 / ms）；**核验 qea 目标 == 本仓库自己的 .qea 文件**
- `semanticLifecycle`：语义生命周期初始化（state / alignment / readiness；未开 gate 时 skipped/disabled）

### 2. Interpret The Report

- 整体 `status=ok`：环境就绪。
- 任一 section `status=failed` → 整体 `status=failed`，指出失败阶段：`mcp` / `systemArchitecture` / `neo4j` / `qeaFullProjection` / `semanticLifecycle` / `subdiagramViews`。
- **目标一致性核验（在报告中明确给出）**：
  - `qeaFullProjection.qea` 是否为**本仓库自己的 .qea 文件**（== 解析自 `ARGO_EA_QEA`/仓库根唯一 `*.qea` 的路径）；投影成功且目标为本仓库文件才算该 section ok；投影失败或目标非本仓库文件 → 报告告警/失败。
  - `neo4j.database` 是否**与本仓库名（仓库根目录名）一致**；不一致 → 报告告警/失败。

### 3. Handle Secret File Blockers（仅当报告含 secret 相关失败）

`semanticLifecycle` 或 `systemArchitecture` 失败可能源于 `.env` 预检。诊断（不打印 secret 值）：

处理规则（env 文件不做 OS ACL / 权限加固；只保证不被提交）：

- `SECRET_FILE_REPARSE_PROHIBITED`：将 `.env` 替换为普通文件（去掉符号链接/重解析点）。
- `SECRET_FILE_PATH_PROHIBITED`：修正 `ARGO_ENV_FILE` 与安装根 `.env` 不一致的路径。
- git 跟踪/忽略类错误（`SECRET_FILE_TRACKED` / `SECRET_FILE_NOT_IGNORED`）：把 `.env` 加入 `.gitignore` 并 `git rm --cached`；全局 `.env` 位于仓库外时天然不适用。

修复后重跑 `argo-init`。

### 4. Report Concisely

输出应直接说明：`mcp` 是否正常、`SystemArchitecture.json` 是否正常、Neo4j 是否连通且**投影数据库名是否与本仓库名一致**、`.qea` 全量投影是否成功且**目标是否为本仓库 .qea 文件**、是否完成一次初始同步、语义生命周期状态与 alignment、报告路径（`.argo/temp/argo-harness-init-report.json`）。

## Output

输出必须包含：

### 1. Environment Status
- overall status: ok / failed
- **解析到的 schema：kind（default/workspace/override）+ language（名称）+ actorElementType + dir/guide**（默认 ArchiMate 3.2 还是仓内自定义 schema）
- whether mcp health passed
- whether neo4j health passed
- whether .qea full projection passed

### 2. Sync Status
- whether initial sync was executed
- whether verification matched JSON and Neo4j
- current counts summary when available
- **neo4j 投影数据库名 == 本仓库名？**（是/否，给出名称）
- **qea 投影目标文件 == 本仓库 .qea？**（是/否，给出路径）；投影耗时 ms

### 3. Semantic Lifecycle Status
- whether semantic lifecycle init ran, skipped, or failed
- state/alignment/readiness summary when available

### 4. Ontology Status
- **本体是否正常**：`ontology.status`；一句定义摘要（`language` + 元素/关系类型数 + 端点矩阵有无 + `invariants`(constraints) + `axioms`）；并**列出缺失项**（`ontology.missing` 的 `structure` / `constraints` / `axioms`）。
- **本体校验引擎是否正常**：`ontologyValidation.status`——`passed`=正常运行且无问题；`failed`=**异常**（附 `ontologyValidation.errors`）；`disabled`=**未启用**（说明 `ARGO_VALIDATION_EXTENSIONS` 未配置）。
- **任一项不正常（`failed` / `disabled` / 本体定义异常）必须在总结中显著指出**，不能省略。
