# Agent Cost Log（框架内建：宿主插件后台采集，一份取全）

> 归属：ARGO 框架，随 `argo-deploy` 下发。
> **一份汇总日志 + 固定路径**：宿主插件是唯一采集器；不加 MCP 打点、不提供取数接口/CLI。需要时直接取一份。

## 为什么

在真实项目里，Agent 的活动范围是**整个仓（无界内容源）**，意图图（KG）只是**语义目录/路由层**，不覆盖全仓。
Agent 因此在两个后端之间往返：KG 语义检索 ↔ 仓 `read`/`grep`/`glob`。**成本主要在往返轮次上**（轮次一多，
累积上下文使 token 近平方级膨胀）。要优化而不伤召回，必须先度量——而且一份取全，不要东拼西凑。

## 唯一采集器：OpenCode 宿主插件

`argo/plugins/argo-cost-collector.js`（部署到 `~/.argo/plugins/`，由 `install-argo.ps1` 注册进 OpenCode）。

它挂在宿主钩子上，能看到 agent 的**全部动作**：
- `tool.execute.before/after` —— **每一个工具调用**：MCP 接口调用（`getSystemArchitecture` 等）、
  **写图调用**（`applySystemArchitectureMutation` 等）、仓侧调用（`read`/`grep`/`glob`）——全都记录。
- `event` —— assistant 的 `tokens{input,output,reasoning,cache}` 与 `cost`。

> 为什么不加 MCP 打点：MCP 只能看到图侧的调用，看不到仓侧工具与 token 用量；没有宿主侧的记录是**不完整**的，
> 因此**不在 MCP 服务端做任何采集**——只保留插件这一个完整采集器。

## 写到哪里（唯一固定路径）

```
<workspace>/.argo/temp/agent-cost-log.ndjson
```

- 追加式；按大小轮转（默认 5 MB，`ARGO_COST_TRACE_MAX_BYTES`），旧文件为 `agent-cost-log.ndjson.1`。
- 默认开启；`ARGO_COST_PROFILER=0` 关闭。
- **只观测已产出结果**，不改检索、不缩候选、不改内容；任何异常都被吞掉，绝不影响会话。

## 每条记录（一行 JSON）

公共字段：`at` / `pid` / `source`（`host`）/ `type`。

**`type: "tool"`（工具调用）**

| 字段 | 含义 |
|---|---|
| `tool` | 工具名（含 MCP 接口/写图/仓侧） |
| `backend` | `graph`（架构图工具）/ `repo`（read·grep·glob 等）/ `framework`（校验/初始化）/ `other` |
| `kind` | `read` / `write` / `framework` / `other` |
| `durationMs` | 该次调用耗时 |
| `ok` | 成功与否 |
| `args.keys` / `args.bytes` | 入参键名与字节数（**绝不记录原始取值**） |
| `resultBytes` / `resultTokens` | 返回内容大小与粗略 token 估算 |
| `sessionID` / `callID` | 会话/调用标识 |

**`type: "usage"`**：assistant 的 `tokens{input,output,reasoning,cache}` 与 `cost`。

`resultTokens` 为确定性启发式：CJK 约 1 token/字，其余约 1 token/4 字符。

## 已知边界

`tool.execute.*` 只在**经宿主会话**发起的调用上触发。不经宿主会话、直接调 MCP 服务端的后台进程（如 argo-init 的子进程）
不在记录内——那不属于「agent 的动作记录」。

## 怎么用

1. 正常使用你的项目（插件后台自动采集，无需任何操作）。
2. 需要分析时，把 `<你的项目>/.argo/temp/agent-cost-log.ndjson`（必要时连同 `.1`）取一份发回即可。

## 红线（与 retrieval-recall-first 一致）

采集**只增不改**：不得为了好看而缩小候选/截断内容；本日志只观测结果，不影响召回。
