---
name: argo-init
description: "检查 ARGO MCP 是否正常，并完成 NEO4J 初始同步与语义生命周期初始化。Use when the user asks to verify Argo MCP readiness and perform or verify the canonical JSON-to-Neo4j initial sync plus semantic lifecycle init. Keywords: ARGO INIT, harness init, MCP health check, Neo4j initial sync, semantic lifecycle."
argument-hint: scope-or-mode
disable-model-invocation: true
---

# ARGO INIT

`argo-init` 负责检查 `argo` MCP 是否正常、完成或验证 canonical intent graph 的 Neo4j 初始同步，并在非 `--check-only` 模式下执行 canonical semantic lifecycle init。它不再负责调用旧的工作区 bootstrap / `initializeWorkspace` 工具。

- `argo` MCP 服务器能正常初始化、列出关键工具并响应 `ping`。
- `design/KG/SystemArchitecture.json` 可通过 `argo` MCP 正常读取和校验。
- 本机 Neo4j 连接可用。
- canonical intent graph 至少完成一次 JSON -> Neo4j 初始同步，并通过一致性校验。
- 非 `--check-only` 模式会在结构同步后执行语义生命周期：双 gate 未开启时记录 pending/disabled；双 gate 开启时执行全量 embedding backfill 与 readiness 对齐。

## Rules

- **MUST** 优先运行仓库原生命令 `node .argo/scripts/ensureArgoHarnessEnvironment.js`。
- **MUST** 将该命令返回的 JSON 结果作为最终判断依据，而不是凭主观描述报告环境状态。
- **MUST** 报告 `argo` MCP 是否通过、Neo4j 是否通过、初始同步是否完成、以及 `semanticLifecycle` 当前状态。
- **MUST** 在脚本失败时直接转述失败阶段、错误摘要和报告路径，不要改用含糊描述。
- **MUST NOT** 读取、打印或复述 `.argo/.env` 中的 secret 值；排查时只允许报告 key 是否存在、是否被 Git 跟踪/忽略、以及 ACL 主体。
- **MUST NOT** 绕开脚本分别手工执行一堆无关命令来替代初始化工作流，除非你是在排查脚本自身失败。

## Workflow

### 1. Run ARGO HARNESS Init

执行：

```powershell
node .argo/scripts/ensureArgoHarnessEnvironment.js
```

如用户只要求只读检查、不允许修改工作区或不想执行初始同步，则改为：

```powershell
node .argo/scripts/ensureArgoHarnessEnvironment.js --check-only
```

### 2. Interpret The Report

读取脚本输出的 JSON，并关注：

- `mcp`
- `systemArchitecture`
- `neo4j`
- `semanticLifecycle`
- `reportPath`

如果脚本输出 `status=ok`，说明 ARGO HARNESS 环境已准备完成或已确认健康。

如果脚本输出 `status=failed`，必须指出失败位于哪一个阶段：

- Argo MCP protocol health
- canonical SystemArchitecture validation
- Neo4j connectivity
- Neo4j initial sync / verification
- semantic lifecycle init / readiness alignment

### 3. Handle Semantic Credential File Blockers

如果 `semanticLifecycle` 失败且 category 属于 secret/config 文件边界，先做安全诊断，不要读取 `.argo/.env` 内容：

```powershell
git ls-files -- ".argo/.env"
git check-ignore -v ".argo/.env"
icacls ".argo\.env"
```

处理规则：

- `SECRET_FILE_TRACKED`: 将 `.argo/.env` 加入 `.gitignore`，执行 `git rm --cached -- ".argo/.env"`。这只移出 Git index，不删除本地 secret 文件。
- `SECRET_FILE_NOT_IGNORED`: 将 `.argo/.env` 加入 `.gitignore`，再重跑 init。
- `SECRET_FILE_ACL_UNSAFE`: 收紧 Windows ACL，只保留当前用户、Administrators、SYSTEM 可读写。

Windows ACL 修复命令：

```powershell
$identity = whoami
icacls ".argo\.env" /inheritance:r /grant:r "${identity}:F" "BUILTIN\Administrators:F" "NT AUTHORITY\SYSTEM:F" /remove:g "BUILTIN\Users" "Everyone" "Authenticated Users" "NT AUTHORITY\Authenticated Users"
```

修复后必须重跑：

```powershell
node .argo/scripts/ensureArgoHarnessEnvironment.js
```

### 4. Report Concisely

输出应直接说明：

- `argo` MCP 是否正常
- `SystemArchitecture.json` 是否正常
- Neo4j 是否连通
- 是否完成了一次初始同步
- 语义生命周期状态、alignment、是否因 `--check-only` 跳过
- 报告文件位置

## Output

输出必须包含：

### 1. Environment Status
- overall status: ok / failed
- whether Argo MCP health passed
- whether Neo4j health passed

### 2. Sync Status
- whether initial sync was executed
- whether verification matched JSON and Neo4j
- current counts summary when available

### 3. Semantic Lifecycle Status
- whether semantic lifecycle init ran, skipped, or failed
- state/alignment/readiness summary when available

### 4. Report Artifact
- `.argo/temp/argo-harness-init-report.json` 路径

### 5. Blocking Errors
- 若失败，列出失败阶段和关键错误摘要；如属于 credential file blocker，同时列出已检查的 Git tracking / ignore / ACL 状态