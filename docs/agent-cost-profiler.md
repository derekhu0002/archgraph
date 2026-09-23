# Agent Cost Profiler（框架内建：后台自动度量）

> 归属：ARGO 框架（随 `argo-deploy` 下发到 `~/.argo/scripts/graph-rag/agentCostProfiler.js`）。
> 目的：把「Agent 成本—召回」度量做成**框架能力**，让任意项目都能在自己的仓里后台自动采集，
> 再把结果回传用于分析优化——而不是只能在本仓跑一次性脚本。

## 为什么

在真实项目里，Agent 的活动范围是**整个仓（无界内容源）**，而意图图（KG）只是**语义目录/路由层**，
并不覆盖全仓。于是 Agent 会在两个后端之间往返：KG 语义检索 ↔ 仓 `read`/`grep`/`glob`。
**成本主要发生在往返轮次上**（轮次一多，累积上下文使 token 近平方级膨胀）。要优化而不伤召回，
必须先把它量化出来。

## 采什么、怎么采（零配置）

框架 MCP 服务端在**每次工具调用**后追加一条紧凑记录到：

```
<workspace>/.argo/temp/argo-cost-trace.ndjson
```

- 记录字段：`tool / backend(graph|framework|repo|other) / kind(read|write) / durationMs / ok / resultBytes / resultTokens / args(仅键名 + 语义 intent 预览，绝不记原始取值)`
- 追加式、按大小轮转（默认 5 MB，`ARGO_COST_TRACE_MAX_BYTES`）。
- **只观测已经产出的结果**，不改检索、不缩候选、不改内容；任何异常都被吞掉，绝不影响工具调用。
- 默认开启；`ARGO_COST_PROFILER=0` 关闭。

> 说明：仓库侧工具（`read`/`grep`/`glob`）由宿主执行，MCP 看不到；把它们纳入统计需要
> 导出宿主会话日志（见下）。

## 取结果（发给分析方）

**方式 A：MCP 工具（推荐）**
调用 `getAgentCostDigest`，可选参数：
- `hostLogPath`：导出的宿主会话 NDJSON（`opencode run --format json` 的原始事件流），加入跨后端指标；
- `seedPath`：项目自备的任务/oracle JSON（`{questions:[{id, oracle:{elements,repoPaths}}]}`），按 oracle 计算证据召回/精度；
- `universePath`：`{ids,paths}` 证据字典（用于精度，缺省则用 oracle）。

**方式 B：命令行**

```bash
node ~/.argo/scripts/graph-rag/agentCostProfiler.js report \
  --workspace <项目根> \
  [--host-log <会话.ndjson>] \
  [--seed <任务-oracle.json>] [--universe <字典.json>] [--json]
```

## 输出口径

- **图侧（自动）**：调用总数/错误数、按 `backend` 与 `kind` 汇总、延迟 p50·p95·max、返回 token、最贵工具 Top5。
- **跨后端（给 host-log 时）**：轮次 `turns`、工具调用数（graph vs repo）、**后端往返次数 `roundTrips`（graph↔repo 相邻切换）**、会话 token（含 reasoning）、端到端时延。
- **召回（给 seed 时）**：`evidenceRecall`（对 oracle 上界）、`evidencePrecision`、`missing`。

## 红线（与 retrieval-recall-first 一致）

- 度量**只增不改**：不得为了好看而缩小候选/截断内容。
- 任何以缩池/截断换速、造成召回缺口的优化，**必须**由 `missing` / `evidenceRecall < 1` 显式暴露，不得掩盖。

## 与项目自备评测的关系

项目可把任务语料（含 oracle 证据集）作为 seed 放进仓里；框架负责**后台自动采集 + 汇总 + 回传**，
项目只需在需要分析时提供宿主会话日志与 seed。二者组合即得到完整的「成本—召回」四元组：
**轮次 / 工具调用（按后端）/ 后端往返 / token·时延 / 证据召回率**。
