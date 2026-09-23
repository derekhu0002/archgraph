# Agent Cost Log（框架内建：后台采集，汇成一份、一次取全）

> 归属：ARGO 框架，随 `argo-deploy` 下发。
> **一份汇总日志 + 固定路径**：不新增 MCP 取数接口、不提供 CLI；所有来源写入同一文件，需要时直接取一份即可。

## 为什么汇总成一份

在真实项目里，Agent 的活动范围是**整个仓（无界内容源）**，意图图（KG）只是**语义目录/路由层**，不覆盖全仓。
Agent 因此在两个后端之间往返：KG 语义检索 ↔ 仓 `read`/`grep`/`glob`。**成本主要在往返轮次上**（轮次一多，
累积上下文使 token 近平方级膨胀）。要优化而不伤召回，必须先度量——而且**不要东一处西一处地取**。

## 写到哪里（唯一固定路径）

```
<workspace>/.argo/temp/agent-cost-log.ndjson
```

- 追加式；按大小轮转（默认 5 MB，`ARGO_COST_TRACE_MAX_BYTES`），旧文件为 `agent-cost-log.ndjson.1`。
- 默认开启；`ARGO_COST_PROFILER=0` 关闭。
- **只观测已产出结果**，不改检索、不缩候选、不改内容；任何异常都被吞掉，绝不影响工具调用。

## 谁写入（两个来源，同一文件）

| `source` | 写入者 | 采集范围 |
|---|---|---|
| `host` | OpenCode 插件 `argo/plugins/argo-cost-collector.js` | **全部工具调用**（图侧 + 仓侧）+ assistant 的 token/cost 用量 —— OpenCode 下的完整采集器 |
| `mcp` | ARGO MCP 服务端（`agentCostProfiler.js` 兜底） | 仅图/框架侧调用；**当宿主采集器已激活时自动静默**，避免同一份日志重复计数 |

宿主采集器激活时会在同目录写一个标记文件 `.agent-cost-host-collector`；MCP 兜底据此让位（标记过期 12h 自动失效）。

## 每条记录（一行 JSON）

公共字段：`at` / `pid` / `source` / `type`。

**`type: "tool"`（工具调用）**

| 字段 | 含义 |
|---|---|
| `tool` | 工具名 |
| `backend` | `graph`（架构图工具）/ `repo`（read·grep·glob 等）/ `framework`（校验/初始化）/ `other` |
| `kind` | `read` / `write` / `framework` / `other` |
| `durationMs` | 该次调用耗时 |
| `ok` / `errorKind` | 成功与否；失败时错误类型 |
| `args.keys` / `args.bytes` | 入参键名与字节数（**绝不记录原始取值**） |
| `args.intentPreview` | 语义检索 intent 预览（≤120 字符，仅 MCP 兜底路径） |
| `resultBytes` / `resultTokens` | 返回内容大小与粗略 token 估算 |
| `sessionID` / `callID` | 宿主侧会话/调用标识（host 来源） |

**`type: "usage"`（宿主来源）**：assistant 的 `tokens{input,output,reasoning,cache}` 与 `cost`。

`resultTokens` 为确定性启发式：CJK 约 1 token/字，其余约 1 token/4 字符。

## 怎么用

1. 正常使用你的项目（框架后台自动采集，无需任何操作）。
2. 需要分析时，把 `<你的项目>/.argo/temp/agent-cost-log.ndjson`（必要时连同 `.1`）取一份发回即可。

## 红线（与 retrieval-recall-first 一致）

采集**只增不改**：不得为了好看而缩小候选/截断内容；本日志只观测结果，不影响召回。
