---
name: agent-search-diagnosis
description: "诊断一次 Agent 会话的检索/搜索行为（是否过度搜索、轮次/token/耗时花在哪、是否重复或空手、图↔仓往返），产出一份自包含的『诊断包』（diagnosis.md 总结 + metrics.json + 会话 NDJSON + 插件日志切片 + manifest.json），供人类伙伴打包回传以便进一步分析优化。Use when the user says an agent session searched too many rounds / wants to diagnose retrieval cost or over-search, or asks to produce a diagnostic bundle to send back. Keywords: 过度搜索, 诊断, over-search, search diagnosis, retrieval cost, diagnostic bundle, agent-search-diagnosis."
---

# Agent Search Diagnosis

把**一次 Agent 会话**变成一份自包含的**诊断包**：现场出诊断总结 + 聚合关键数据到一个目录，用户打包回传即可。

## 数据来源

- **主**：宿主会话 NDJSON（含每个工具的**完整入参/输出**、时间戳、tokens）。
- **辅**：框架后台日志 `<workspace>/.argo/temp/agent-cost-log.ndjson`（跨会话成本形态）。

## 输出（固定目录）

```
<workspace>/.argo/temp/diagnosis/<session-id>/
  ├─ diagnosis.md            # 人读诊断总结（含启发式建议，供 Agent 复核）
  ├─ metrics.json            # 总结背后的数字
  ├─ session.ndjson          # 原始会话（全保真）
  ├─ cost-log.slice.ndjson   # 匹配该会话的后台日志切片
  └─ manifest.json           # 文件清单 + 大小 + 版本
```

## Workflow

### 1. 定位并导出会话

- 若用户给出了 sessionID：`opencode export <sessionID> > <tmp>.ndjson`。
- 若未给出：`opencode session list` 取最近会话，或请用户指定。
- 宿主不支持导出时：退化为**仅用后台日志**（`agent-cost-log.ndjson`，诊断能力受限，须在报告中注明）。

### 2. 运行诊断脚本（确定性）

```
node ~/.argo/scripts/agentSearchDiagnose.js --session <session.ndjson> \
  [--session-id <id>] [--workspace .] [--cost-log <path>] [--json]
```

脚本**只读**会话与日志，写出上面的 bundle 目录，输出概览与启发式 hints。
支持两种输入：`opencode export` 的会话 JSON（`{info, messages}`）与 `opencode run --format json` 的事件流 NDJSON。

### 3. 复核并补充诊断总结（Agent）

- 读 `diagnosis.md` 与 `metrics.json`。
- 在报告末尾追加一节 `## Agent 复核解读`：结合会话片段指出**最可能的过度搜索根因**与**建议的优化方向**（去重/缓存、查询构造、停止判据、上下文压缩、图↔仓往返合并等）。
- 不臆造：结论必须能从 metrics/会话片段找到依据。

### 4. 交付给用户

- 报告 bundle 目录路径，请用户**打包该目录**回传。
- 给一段简短结论（轮次/token/耗时拆分 + 主要信号）。

## Rules（MUST / MUST NOT）

- **MUST** 只用确定性脚本 + 会话/日志读取；**MUST NOT** 修改图谱、仓库或任何框架内容。
- **MUST NOT** 读取或打印 `.env`/凭据；若会话片段疑似含密钥，**MUST** 提醒用户回传前先审查 `session.ndjson`（其中是原始工具 I/O）。
- **MUST** 在结论中区分「事实（metrics）」与「推断（根因假设）」，推断须标注依据。
- 若无法导出会话或脚本不可用，**MUST** 如实说明并给出退化方案，不得臆测诊断结果。
