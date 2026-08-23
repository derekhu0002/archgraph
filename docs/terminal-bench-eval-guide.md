# Terminal-Bench 评测参与指导（archgraph-eval 工程）

> 本指导面向「用 ARCHGRAPH 框架参加 Terminal-Bench 评测」这件事。
> 目标：新建 `archgraph-eval` 工程，把 ARCHGRAPH 作为 harness 接进 Harbor（Terminal-Bench 官方 runner），
> 先跑几轮构建该工程的 harness，再逐步跑完全部测试，最终把结果提交到官方榜单。
>
> **前置结论**：argo 框架已部署在**用户级**（`~/.argo`、用户级 MCP 注册等），本工程**无需重新部署**，
> 只需依赖用户级已装好的 ARGO 工具链即可。

---

## 1. 背景与定位

- **Terminal-Bench**（Stanford × Laude，tbench.ai）是业界少有的、**在官方榜单上给 harness 留了席位**（Custom Agent 入口）的 Agent 基准：
  - 评测对象 = agent 系统（harness + 底层模型），榜单按 `agent × model` 双维度列出；
  - 榜单提交 = 往 HF 仓库 `alexgshaw/terminal-bench-2-leaderboard` 开 PR，官方团队人工复核。
- **ARCHGRAPH 是 harness，不是模型**：所以正确打法不是去拼模型榜，而是——
  1. 用 ARCHGRAPH 框架构建一个面向 Terminal-Bench 的 harness；
  2. 用「同一底层模型 ± ARCHGRAPH」的**对照实验**量化 harness 增量；
  3. 以 `archgraph` 之名提交到 **agent 列**。

> 诚实边界：Terminal-Bench 每个任务是**一次性沙箱**（全新容器、全新 `/app`），沙箱状态不跨任务；
> ARCHGRAPH 的价值来自**图谱里的 Skill/Rule/LTM 跨任务持久 + 自验闭环**，不是记住上一题的答案。

---

## 2. 前置条件（一次性）

| 项 | 要求 | 说明 |
|---|---|---|
| Docker Desktop | 必选 | Terminal-Bench 沙箱是 Linux 容器，agent 在其中执行命令 |
| Harbor | 必装 | Terminal-Bench 官方评测 runner：`harbor run -d terminal-bench/terminal-bench-2-1` |
| 底层模型 API | 任选 | ARCHGRAPH 目前用 DashScope（`argo/.env` 的 `QWEN_KEY`），可换你可用、能跑满 89 任务的模型 |
| argo 框架 | 已就绪 | **用户级已部署，无需重新部署**；`archgraph-eval` 直接依赖即可 |

---

## 3. 工程结构（archgraph-eval）

```
archgraph-eval/                            ← 新工程（git init）
├── design/KG/SystemArchitecture.json      ← 评测工作区的意图图谱（唯一真相源）
├── harbor_agents/
│   └── archgraph_agent.py                 ← ★薄适配层：把 Harbor 接进 ARCHGRAPH harness
├── tasks/                                 ← harbor dataset pull 下来的任务定义（含验证器）
├── tests/                                 ← 本工程验收测试（GIVEN-WHEN-THEN 可执行）
└── scripts/
    └── run_eval.ps1 / run_eval.sh         ← 冒烟/全量运行脚本
```

---

## 4. 关键组件一：Harbor agent 适配层（`harbor_agents/archgraph_agent.py`）

实现 Harbor 的 `BaseAgent`（4 个方法，接口见 Harbor `src/harbor/agents/base.py`）：

```python
from harbor.agents.base import BaseAgent

class ArchGraphAgent(BaseAgent):
    @staticmethod
    def name() -> str:
        return "archgraph"            # 榜单 agent 列显示这个

    def version(self) -> str | None:
        return "0.1.0"

    async def setup(self, environment) -> None:
        # 可选：把 ARCHGRAPH 的 Skill/Rule 放进沙箱
        # await environment.exec("pip install ...")
        pass

    async def run(self, instruction, environment, context) -> None:
        # ★ ARCHGRAPH harness 主循环：
        # 1. 读 instruction → 交给底层模型 + ARCHGRAPH 检索/Skill 加载
        # 2. 模型产出 bash 命令 → environment.exec("...") 在沙箱执行
        # 3. 拿 stdout/stderr → 回填模型，循环
        # 4. 直到"自验通过"或轮次用尽
        # 5. 回填 token/成本到 context
        pass
```

**要点**：ARCHGRAPH 的编排（模型调用、图谱检索、Skill、自验闭环）都跑在**宿主机**，
Harbor 适配层只是把"要执行的命令"翻译成 `environment.exec()` 发进沙箱。

---

## 5. 关键组件二：多轮构建 harness（bootstrap loop）

```
Round 0  建工程：空图谱 + 写适配层 + 建本工程 Work Package 与验收用例
         ↓
Round 1  跑 k=5 种子任务（git 类 / 安全类 / 数据类 / SQL 类 各一个）→ 裸模型基线
         ↓ 观察失败模式（自验缺失？缺 skill？命令解析崩？）
Round 2  把教训蒸馏成 Skill/Rule 挂进图谱：
         · Skill「openssl 证书生成」· Skill「git 历史恢复」
         · Rule「提交前必须自跑验证器可查命令」...
         ↓ 重跑同一批 → 看 resolve rate 提升（这就是 harness 增量）
Round 3.. 扩大切片（k=20 → k=40）→ 持续蒸馏 → 收敛
         ↓
Final   全量 89 任务 → resolve rate → 对照报告 → PR 上榜
```

**每一轮产出的不是"更好的代码"，而是"更好的图谱 + 规则"。**

---

## 6. 参与流程（分步）

### Step 1：建工程 + 冒烟
```powershell
# 建目录、git init；初始化空图谱（design/KG/SystemArchitecture.json）
# 写 harbor_agents/archgraph_agent.py
# 拉任务定义看考纲
harbor dataset pull terminal-bench/terminal-bench-2-1
# 冒烟：1 个任务
harbor run -d terminal-bench/terminal-bench-2-1 `
  --task openssl-selfsigned-cert `
  --agent path.to.archgraph_agent:ArchGraphAgent `
  -m "dashscope/qwen3-..." -k 1
```
- 通过 → `reward: 1`；失败 → `reward: 0` + 轨迹日志（看验证器哪条断言没过）。

### Step 2：k=5 种子 + 基线
- 选 5 个代表任务（每个任务族一个）；
- 用**裸模型 agent**（不带 ARCHGRAPH 编排）跑一遍 → 拿到基线 resolve。

### Step 3：图谱挂 Skill/Rule + 重跑
- 把失败教训蒸馏成 `Skill`/`Rule` 元素，挂到评测图谱；
- 重跑同批 5 个 → 记录增量。

### Step 4：全量 + 对照报告
```powershell
harbor run -d terminal-bench/terminal-bench-2-1 `
  --agent path.to.archgraph_agent:ArchGraphAgent `
  -m "dashscope/qwen3-..." -n 8
```
- 全量 resolve + 成本；写对照报告（A 裸模型 / B ARCHGRAPH / C ARCHGRAPH+Skill）。

### Step 5：提交榜单（可选）
- 往 `alexgshaw/terminal-bench-2-leaderboard` 开 PR，附 agent 名、模型名、resolve rate、成本、trial 链接；
- 官方复核后挂上 tbench.ai 的 agent 列。

---

## 7. 对照实验设计（证明 harness 增量，必做）

| 组 | 配置 | 测什么 |
|---|---|---|
| A | 裸模型 ReAct（无 harness） | 模型本身的天花板 |
| B | ARCHGRAPH harness（A + 自验闭环） | 自验闭环增量 |
| C | B + Skill 挂载（图谱技能） | 技能复用增量 |

---

## 8. 反奖励黑客与合规提醒

- **禁止改超时/资源**：榜单规则明确 "submissions may not modify timeouts or resources"。
- **验证器是唯一裁判**：agent 交的是沙箱文件状态，不是对话；提交前必须自验。
- **数据污染**：Terminal-Bench 数据带 canary 串（`terminal-bench-canary GUID ...`），禁止让底层模型用评测数据训练。

---

## 9. 参考

- Terminal-Bench 官网 / 榜单：https://tbench.ai
- Harbor（runner）：https://www.harborframework.com/docs/agents
- 评测数据仓库：`harbor-framework/terminal-bench-2-1`
- 榜单日志仓库：`alexgshaw/terminal-bench-2-leaderboard`（PR 提交）
