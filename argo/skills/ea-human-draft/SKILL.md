---
name: ea-human-draft
description: "把人类在 EA 里对当前项目 .qea 的草稿改动收敛进正式图谱（WP2792 draft-proposal 流程）：① 断言前提（EA 已关闭 / 项目根唯一 *.qea 可还原 / 工具存在）→ ② 用 ea-human-diff 提取语义 diff 提议（默认自动发现当前项目根唯一 *.qea，JSON+Markdown，读 EA 可见对象模型、不读 kg_sync_meta、纯几何不产出）→ ③ git restore 还原 .qea 到上次提交 → ④ 把提议交给 agent/人类伙伴，按其指引经 ARGO preview/apply 写回 canonical JSON（自动增量投影回 .qea 并 commit）。Use when 人类专家用 Sparx EA 直接改了当前项目的 .qea 需要并入正式图谱、提取人类 EA 改动的语义 diff、把 .qea 还原回已提交状态、或按 draft-proposal 收敛人类草稿。Keywords: EA 人类草稿, human draft, semantic diff, ea-human-diff, draft-proposal, reverse-ea2kg, 人类参与建图."
argument-hint: 人类 EA 草稿收敛
---

# EA HUMAN DRAFT（人类 EA 草稿 → 语义 diff → 写回图谱）

定位：**EA 只当草稿纸**，`design/KG/SystemArchitecture.json` 是唯一真源。人类在 agent 空闲间隙用 EA 改**当前项目的 `.qea`**（即仓库根的唯一 `*.qea`，不限定文件名）；本技能负责把人类改动**安全地提取为提议**（断言 + diff + 还原），并把提议交给 agent/人类伙伴，按其指引经 ARGO 写回 canonical——不建立有损的全自动 EA→JSON 反向投影。

依赖工具：`argo/scripts/ea-human-diff.js`（仓库内）或部署版 `~/.argo/scripts/ea-human-diff.js`（随 `archgraph-argo` npm 包发布）。`--work` 默认指向**当前项目根唯一 `*.qea`**（自动发现，`ARGO_EA_QEA` > 仓库根唯一 `*.qea`），`--base` 可省略：自动取 git HEAD 里 `--work` 的版本作基线。

## 前置（Assert —— 全部满足才继续，任一失败即停下报告）

- [ ] 工作区含 `design/KG/SystemArchitecture.json`，且存在仓库根唯一 `*.qea`（自动发现：`Get-ChildItem *.qea` 恰一个，或 `$env:ARGO_EA_QEA` 已设）。该 `.qea` 被 git 跟踪（`git ls-files <该qea>` 有输出）。
- [ ] diff 工具存在：仓库 `argo/scripts/ea-human-diff.js` 或部署 `~/.argo/scripts/ea-human-diff.js`。
- [ ] **EA 已完全关闭**（人类改动已保存落盘）——否则读到的不是最终状态，且 `git restore` 可能被文件锁破坏/EA 关盘重写。
- [ ] git 可用；`HEAD` 中存在该 `.qea`（自动基线依赖）。若人类还没开改（`git status --short <该qea>` 为空）→ 说明：需先在 EA 里改、保存、关闭后再回来。

Windows 可选核实无进程持有：
```powershell
Get-Process EA -ErrorAction SilentlyContinue   # 有输出则先关闭 EA
```

## Workflow

### 1 · Assert（断言）
逐条检查上方前置并报告结果。任一失败 → 停下，不做 diff、不做 revert。

### 2 · 提取语义 diff
仓库根执行（`--work` 默认 = 当前项目根唯一 `*.qea`，无需写死文件名；`--base` 省略 = git HEAD 版本）：
```powershell
node argo/scripts/ea-human-diff.js --out results/human-draft
```
产物：
- `results/human-draft.json` —— 机器提议集（`proposals[]`：`op`/`kind`/`id`/`fields`/`proposed`/`sourceEa` 等 + `summary`）。
- `results/human-draft.md` —— 人读摘要（分类表格 + 逐条明细 + EA guid 溯源）。

先给人伙伴看 `human-draft.md`：确认是预期改动、无意外删除；留意 `layoutOnly` / `outOfScopeNew` / `removedUnanchored` 计数（这些不产出提议）。
若仓库根有多个 `*.qea` 或未自动发现，须显式 `--work <项目.qea>`；若 `--work` 不是 git 跟踪文件（如临时副本），须显式 `--base <committed.qea>`，不能用自动基线。

### 3 · 还原 .qea 到上次提交
```powershell
git restore <项目.qea>
git status --short     # 应只剩 results/human-draft.* 等产物，<项目.qea> 不再 dirty
```
目的：把 `.qea` 拉回与 HEAD 一致，杜绝残留分叉；人类草稿只以提议文件形式存在，避免后续 agent 写图触发投影时静默覆盖/合并混乱。

### 4 · 交给下一步（按人类指引写回正式图谱）
提议**不会自动写回**。把 `human-draft.json`/`.md` 呈现给人类伙伴，按其指引执行（或交给负责写图的 agent）：
1. 审阅每条提议（add/update/remove / 视图成员 / 删除需确认），必要时删改。
2. 经 ARGO MCP `previewSystemArchitectureMutation` → `applySystemArchitectureMutation` 写入 canonical JSON。
3. apply 后 MCP 自动增量投影回 `.qea`——**不要手工编辑 .qea 覆盖**。
4. 对受影响元素跑回归验收（WP2792 AT 集等）后 `git commit`，并把 commit id 登记到对应图谱元素的 `commit` 属性（见全局 ArchGraph 红线）。

## Rules

- **MUST** 只在 EA 关闭后运行；diff 前先做断言并报告。
- **MUST** diff 以 EA **可见对象模型**（`schema_id` 锚 tag 对齐）为准；**绝不**用 `kg_sync_meta` 判定人类改动（人类改动不进镜像）。
- **MUST** 提取 diff 后先 `git restore <项目.qea>` 再进入写回阶段，避免 qea 侧残留被后续投影覆盖/丢失。
- **MUST** 把每条**删除**提议（removeElement/removeRelationship）标记为需人类/负责 agent 确认后再 apply。
- **MUST NOT** 把 `human-draft.json` 当 canonical 直接写——必须先 ARGO `preview` 校验，再 `apply`。
- **MUST NOT** 在 `.qea` 上手工写 canonical 内容（唯一写回通道是 canonical JSON → 自动增量投影）。
- **MUST NOT** 读取/复述 `.env` 中的 secret。
- 纯几何（`t_diagramobjects` 坐标）**不进提议**（语义优先）；若人类排版也是交付物，需另行走布局侧车（本技能不产出）。

## 产物

| 文件 | 内容 |
| --- | --- |
| `results/human-draft.json` | 机器提议集：source / baselineCommit / extractedAt / summary / proposals[]（每条含 op / kind / id / fields / proposed / sourceEa） |
| `results/human-draft.md` | 人读摘要：操作计数表 + 逐条明细（EA guid 溯源）+ 排除说明（layoutOnly 等） |

## 故障排查

- `git HEAD has no tracked file "<项目.qea>"`：`--work` 未被 git 跟踪 → 显式 `--base <committed.qea>`。
- `git restore` 失败/文件锁：EA 还开着 → 关闭 EA 后重试。
- diff 为空但人类确实改过：多半只做了纯几何或超出 canonical 作用域改动 → 看 `.md` 的 `layoutOnly` / `outOfScopeNew` 计数。
- 关系侧提议异常（id 为 undefined）：确认基线 .qea 由投影生成（`t_connectortag` 带 `schema_id`），手绘模型无锚时关系不参与。
