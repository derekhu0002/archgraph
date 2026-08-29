---
name: argo-init
description: "通过 ARGO MCP 的 initializeWorkspace 接口完成工作区确定性的初始化（NEO4J 初始同步 + 语义生命周期 + canonical 校验 + subdiagram_views 一致性），无需执行 WORKSPACE 外脚本。Use when the user asks to verify Argo MCP readiness and perform or verify the canonical JSON-to-Neo4j initial sync plus semantic lifecycle init. Keywords: ARGO INIT, harness init, initializeWorkspace, Neo4j initial sync, semantic lifecycle."
argument-hint: scope-or-mode
disable-model-invocation: true
---

# ARGO INIT

`argo-init` 通过 ARGO MCP 的 `initializeWorkspace` 接口完成确定性初始化：工作区 bootstrap（缺 `SystemArchitecture.json` / `.feap` 自动生成）+ Neo4j 结构投影同步 + 语义生命周期初始化 + canonical 校验 + subdiagram_views 一致性，并返回完整报告。**不需要也不应执行任何 WORKSPACE 外脚本**——所有确定性步骤都在 MCP 进程内完成，避免扩大访问面。

- 工作区缺少 `design/KG/SystemArchitecture.json` 时自动从部署的 `defaults` 拷贝默认模板；缺 `.feap` 时以当前项目名拷贝默认模板。
- 本机 Neo4j 连接可用，canonical 意图图完成至少一次 JSON -> Neo4j 初始同步并通过一致性校验。
- 语义生命周期：双 gate 未开启时记录 skipped/disabled；开启时执行全量 embedding backfill 与 readiness 对齐。

## Rules

- **MUST** 调用 ARGO MCP 工具 `initializeWorkspace`（传当前工作区根）执行确定性初始化，并以其返回报告为最终判断依据。
- **MUST** 报告 `mcp` / `systemArchitecture` / `neo4j` / `semanticLifecycle` / `subdiagramViews` 与整体 `status`。
- **MUST NOT** 读取、打印或复述 `.env` 中的 secret 值；排查时只允许报告 key 是否存在、ACL 主体。
- **MUST NOT** 通过 shell 手工执行 WORKSPACE 外的初始化脚本或一组无关命令来替代 `initializeWorkspace`（除非报告显示底层脚本自身失败需要排查）。

## Workflow

### 1. Run Deterministic Init via initializeWorkspace

调用 ARGO MCP 工具 `initializeWorkspace`（传入当前工作区根 `workspaceRoot`）。该接口在 MCP 进程内完成全部确定性步骤并返回报告：

- `workspaceBootstrap`：缺 `SystemArchitecture.json` / `.feap` 时自动生成（createdFiles / skippedSteps）
- `mcp`：ARGO MCP 健康（协议 / tools-list / ping）
- `systemArchitecture`：canonical 校验（元素/关系/视图计数）
- `subdiagramViews`：subdiagram_views 一致性检查/修复
- `neo4j`：Neo4j 连通 + 结构投影初始同步 + 一致性校验（initialSync / verification）
- `semanticLifecycle`：语义生命周期初始化（state / alignment / readiness；未开 gate 时 skipped/disabled）

### 2. Interpret The Report

- 整体 `status=ok`：环境就绪。
- 任一 section `status=failed` → 整体 `status=failed`，指出失败阶段：`mcp` / `systemArchitecture` / `neo4j` / `semanticLifecycle` / `subdiagramViews`。

### 3. Handle Secret File Blockers（仅当报告含 secret 相关失败）

`semanticLifecycle` 或 `systemArchitecture` 失败可能源于 `.env` 安全预检。诊断（不打印 secret 值）：

```powershell
icacls "$env:USERPROFILE\.argo\.env"
```

处理规则：

- `SECRET_FILE_ACL_UNSAFE`：收紧 Windows ACL，只保留当前用户、Administrators、SYSTEM。
- `SECRET_FILE_REPARSE_PROHIBITED`：将 `.env` 替换为普通文件（去掉符号链接/重解析点）。
- `SECRET_FILE_PATH_PROHIBITED`：修正 `ARGO_ENV_FILE` 与安装根 `.env` 不一致的路径。
- git 跟踪/忽略类错误（`SECRET_FILE_TRACKED` / `SECRET_FILE_NOT_IGNORED`）只在 `.env` 位于 git 仓库内时出现；全局 `.env` 位于仓库外时天然不适用。

修复后重跑 `initializeWorkspace`。

### 4. Report Concisely

输出应直接说明：`mcp` 是否正常、`SystemArchitecture.json` 是否正常、Neo4j 是否连通、是否完成一次初始同步、语义生命周期状态与 alignment、报告路径（`.argo/temp/argo-harness-init-report.json`）。

## Output

输出必须包含：

### 1. Environment Status
- overall status: ok / failed
- whether mcp health passed
- whether neo4j health passed

### 2. Sync Status
- whether initial sync was executed
- whether verification matched JSON and Neo4j
- current counts summary when available

### 3. Semantic Lifecycle Status
- whether semantic lifecycle init ran, skipped, or failed
- state/alignment/readiness summary when available
