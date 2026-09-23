# Agent Cost Recorder（框架内建：后台记录到固定路径）

> 归属：ARGO 框架（随 `argo-deploy` 下发到 `~/.argo/scripts/graph-rag/agentCostProfiler.js`）。
> **设计原则：只记录，不提供取数接口**——不新增 MCP 工具、不提供 CLI。日志写在固定路径，需要时直接去取。

## 为什么

在真实项目里，Agent 的活动范围是**整个仓（无界内容源）**，而意图图（KG）只是**语义目录/路由层**，
并不覆盖全仓。于是 Agent 会在两个后端之间往返：KG 语义检索 ↔ 仓 `read`/`grep`/`glob`。
**成本主要发生在往返轮次上**（轮次一多，累积上下文使 token 近平方级膨胀）。要优化而不伤召回，
必须先把它记录下来。

## 记录到哪

固定路径（每个工作区各自一份）：

```
<workspace>/.argo/temp/argo-cost-trace.ndjson
```

- 追加式；按大小轮转（默认 5 MB，`ARGO_COST_TRACE_MAX_BYTES`），轮转后旧文件为 `argo-cost-trace.ndjson.1`。
- 默认开启；`ARGO_COST_PROFILER=0` 关闭。
- **只观测已经产出的结果**，不改检索、不缩候选、不改内容；任何异常都被吞掉，绝不影响工具调用。

## 每条记录（一行 JSON）记什么

| 字段 | 含义 |
|---|---|
| `at` / `pid` | 时间戳 / 进程 |
| `tool` | 工具名 |
| `backend` | `graph`（架构图工具）/ `framework`（校验、初始化）/ `other` |
| `kind` | `read` / `write` / `framework` / `other` |
| `durationMs` | 该次调用耗时 |
| `ok` / `errorKind` | 成功与否；失败时错误类型 |
| `args.keys` / `args.bytes` | 入参的键名与字节数（**绝不记录原始取值**） |
| `args.intentPreview` | 语义检索的 intent 预览（≤120 字符，便于分析） |
| `resultBytes` / `resultTokens` | 返回内容大小与粗略 token 估算 |

`resultTokens` 为确定性启发式：CJK 约 1 token/字，其余约 1 token/4 字符。

## 怎么用

1. 正常使用你的项目（框架 MCP 后台自动记录，无需任何操作）。
2. 需要分析时，把该路径下的 `argo-cost-trace.ndjson`（必要时连同 `.1`）取走发回即可。

> 说明：仓库侧工具（`read`/`grep`/`glob`）由宿主执行，MCP 看不到，因此不在本记录内；
> 本记录聚焦**图侧**调用（次数、按工具/后端/读写分布、耗时、返回 token）。

## 红线（与 retrieval-recall-first 一致）

记录**只增不改**：不得为了好看而缩小候选/截断内容；本记录只观测结果，不影响召回。
