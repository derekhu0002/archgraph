# 代码检视报告：发布 ArchGraph 为 DSH 插件（dsh-plugin bundle）

> 检视人：adam（Business Actor 2733 / Business Role Reviewer 2732）
> 检视对象：commit `3f95448`（`feat: package ArchGraph as native dsh plugin bundle`）
> 检视范围：`package.json`、`cordis.patch.yml`、`dsh-argo-workspace/{index.js,package.json}`、`dsh-argo-wakeup/{index.js,package.json}`
> 检视依据：`docs/dsh-plugin-design.md`（AD-a..AD-e）、`docs/dsh-plugin-publish.md`（AC-1..AC-7）、`tests/dsh-plugin-publish.test.js`、`install-argo.ps1` 356–535 行内联模板、`C:\Users\admin\.dsh\plugins\*` 部署工件、`argo/rules/archgraph.instructions.md`

## 总体结论：有条件通过（Conditional Pass）

本次提交把两个既有 Cordis 插件封装为可 `dsh plugin add` 安装的 **单包 bundle**，架构形态自洽、`import.meta.url` 路径解析正确、回退链完备、ESM/CJS 边界无冲突、两个入口与既有部署工件语义逐字一致、无 shell 注入面、`install-argo.ps1`/`argo-deploy` 无回归。**但存在 1 个 Major 问题（R-1）**：bundle 的运行时依赖 `neo4j-driver` 仍只列在 `devDependencies`，`dsh plugin add` 安装后语义检索路径会因 `require('neo4j-driver')` 抛 `MODULE_NOT_FOUND` 而失败——该风险在 AD-e 风险 #2 中已被明确 flag，但实现期未落实「提升到根 `dependencies` 或优雅降级」。其余为 Minor 级（漂移风险、清理边界、可观测性、README 补充等）。

- 结论取值：**有条件通过**——基础工具与唤醒门文本可用、安装可成功；但语义检索（含 STEP 0 唤醒门首个语义调用）在 bundle 安装用户侧会失败，须在发布前解决 R-1（或显式声明为已知限制）方可放行。

---

## 问题清单

| 编号 | 级别 | 位置 | 描述 | 修复建议 |
| --- | --- | --- | --- | --- |
| R-1 | Major | `package.json`（根，无 `dependencies`）、`argo/scripts/systemarchitecture-mcp-server.js:2751`、`argo/scripts/graph-rag/defaultSemanticRetrieval.js:239` | `neo4j-driver` 仅存在于根 `devDependencies`；`dsh plugin add github:...` 只安装根 `dependencies`（本包该键缺失），故安装后 `require('neo4j-driver')` 无保护地抛 `MODULE_NOT_FOUND`，语义检索路径（`getSystemArchitecture` 带语义 query，即 STEP 0 唤醒门首个调用）失败。设计 AD-e 风险 #2 已明确要求「实现期验证优雅降级，若否则提升到根 dependencies」，本次提交两者皆未做。 | 将 `neo4j-driver` 从 `devDependencies` 提升到根 `dependencies`（零风险、幂等）；或为语义检索路径补「缺模块/缺凭据时降级到文件读」的优雅降级，并加测试覆盖。 |
| R-2 | Minor | `dsh-argo-wakeup/index.js:10` vs `argo/rules/archgraph.instructions.md:<WakeupGuideline>` | 唤醒门文本现为两份事实源：installer 动态从规则文件 `ConvertTo-Json` 生成，bundle 则硬编码静态副本。当前两者语义逐字一致（已核对），但未来改规则文件不会传播到 bundle 副本。AD-e 仅把 workspace 副本定为新单一事实源，wakeup 副本未纳入。 | 增加一条验收测试，断言 bundle 副本的 `WAKEUP_GATE` 文本与规则文件 `<WakeupGuideline>` 块语义一致（防漂移）；或后续让 `install-argo.ps1` 直接拷贝仓库文件消除双源。 |
| R-3 | Minor | `dsh-argo-workspace/index.js:86-140`（`ctx.effect` 工具清理在循环之后注册） | 工具 disposer 的 `ctx.effect` 在 `for` 循环全部结束后才注册；若循环中途 `ctx.tools.register` 抛异常（如工具名冲突），已注册工具不会被 dispose（泄漏）。client 的 dispose 已提前注册，故进程会关闭。此为从 installer 模板逐字迁移的既有行为，非本次回归。 | 用 `try/finally` 包裹注册循环，或先收集注册结果、异常时回滚已注册 disposer。 |
| R-4 | Minor | `dsh-argo-workspace/index.js:56`（`close: () => child.kill()`） | dispose 时直接 `child.kill()`，未先 `child.stdin.end()`，argo server 子进程无 JSON-RPC 优雅退出（可能丢失未刷写输出）。同为既有迁移行为。 | dispose 时先 `child.stdin.end()`，再带超时 `kill`，实现优雅关闭。 |
| R-5 | Minor | `package.json:28`（`exports["./cordis.patch.yml"]`） | 把 `.yml` 透出到 `exports` 无实际模块作用（Node 无法 import/require 非 JS 文件，patch 实际由 dsh 通过 `dsh.bundle.patch` 相对路径用 fs 读取）。该导出仅作对齐 in-box bundle 的元数据。 | 保留（对齐惯例），或在 `package.json`/设计文档注明其为非模块元数据，避免误用。 |
| R-6 | Minor（可选） | `README.md`「Install」段 | README 仅记录 `npm install -g archgraph-argo` + `argo-deploy`，未补充本工作包的安装方式 `dsh plugin --profile <name> add github:derekhu0002/archgraph`（AC-1/US-1 面向的入口）。 | 在「Install」段补充一行 `dsh plugin add` 说明（可选，不强制）。 |
| R-7 | Minor（预存，非本次引入） | `argo/rules/archgraph.instructions.md:9`（唤醒门文本，bundle 副本同源复制） | 唤醒门示例调用 `getSystemArchitecture(purpose:"audit", subject:"Business Actor")` 未带 `intent`，当前 server 会拒绝并返回 `QUERY_INTENT_REQUIRED`（实测）。该文本为规则文件单一事实源，bundle 逐字复制，非 3f95448 引入；但影响 AC-5「唤醒门首调用可成功」的顺畅度（capable agent 会自行补 `intent` 重试）。 | 后续在规则文件示例调用中补 `intent`（如 `purpose:"audit"` + `intent:"list all Business Actors"`），再重新生成/同步 bundle 副本。 |

---

## 检视重点逐条结论

### 1. 架构（单包 bundle 形态 / exports 不映射 `.` / dsh.bundle.patch 与 files 自洽）—— 通过

- 单包 bundle 形态正确：`dsh.bundle.patch = "./cordis.patch.yml"`，`cordis.patch.yml` 以**包名** `archgraph-argo/dsh-argo-workspace`、`archgraph-argo/dsh-argo-wakeup` 插入两行（非 `file://`），与 `id`（`argo-workspace`/`argo-wakeup`）同 installer 受管块一致。
- `exports` 不映射 `"."` 是**正确**的：patch 行按包名**子路径**解析（`archgraph-argo/dsh-argo-workspace` → `exports["./dsh-argo-workspace"]`），无需根入口；本包无根模块，伪造根入口反而误导。不映射 `.` 不会导致 DSH 解析失败。
- `dsh.bundle.patch` 与 `files` 自洽：`cordis.patch.yml`、`dsh-argo-workspace`（目录，含其 `package.json`）、`dsh-argo-wakeup`、`argo/scripts`（含 `argo-mcp-server.js`、`argo-paths.js`、`graph-rag/` 子树）均在 `files` 内，发布后包内齐全。目录级 `{"type":"module"}` 随目录打包。
- 附带 R-5（`./cordis.patch.yml` 导出无模块作用）。

### 2. 正确性（import.meta.url 路径 / 回退链 / ESM-CJS 边界 / ctx.effect 清理）—— 通过（含 R-1、R-3、R-4 备注）

- `import.meta.url` 相对定位**正确**：入口位于 `<pkg>/dsh-argo-workspace/index.js`，`new URL('../argo/scripts/argo-mcp-server.js', import.meta.url)` 的 `../` 落到 `<pkg>/`，最终解析到 `<pkg>/argo/scripts/argo-mcp-server.js`（已核对该文件存在且为 CJS）。
- 回退链**完备**：`config.serverPath → process.env.ARGO_SERVER_PATH → DEFAULT_SERVER_PATH`，三者都不可用时 `console.warn` 并跳过注册（与既有行为一致，不挂起会话）。
- ESM/CJS 边界**无冲突**：入口模块为 ESM（目录级 `{"type":"module"}`），`argo/scripts` 为 CJS（`argo/package.json` 无 type=module），但后者被 `spawn('node', [serverPath])` 作为**子进程**启动，父进程模块形态与其无关。根包不加 `"type":"module"`，避免破坏 `bin/`、`argo/scripts` 的 CJS。
- `ctx.effect` 清理**覆盖** client（`dsh-argo-workspace.dispose()`，在连接前即注册）与工具注册（`dsh-argo-workspace.tools`，循环后注册）。见 R-3（局部失败泄漏）与 R-4（非优雅 kill）的加固建议。
- **R-1 例外**：语义检索的运行时依赖 `neo4j-driver` 在 bundle 安装路径下缺失（详见问题清单）。

### 3. 迁移一致性（与 installer 模板 / 部署工件逐字一致）—— 通过

- 两个入口与 `install-argo.ps1` 内联模板、`~/.dsh/plugins/*` 部署工件**语义逐字一致**；`dsh-argo-workspace` 的唯一差异是**增补**：`import { fileURLToPath } from 'node:url'` + `DEFAULT_SERVER_PATH` + 三级回退链（原模板 `const serverPath = config.serverPath`）。
- 工具名 `mcp__argo__*`、`workspaceRoot` 注入 `exec.agent.session.header?.cwd`（含「非 requestHeader()」注释）、`ARGO_WORKSPACE_ROOTS`、`ctx.tools.register` 输出 schema 均一致。
- 唤醒门文本（`name`/`inject`/`apply`/`argo:wakeup`/`order:-90`/`WAKEUP_GATE` 内容）与部署工件及规则文件 `<WakeupGuideline>` 一致（含 `\u003c`/`\r\n` 转义）。见 R-2（漂移风险）与 R-7（文本本身缺 `intent`，预存）。

### 4. 安全性 —— 通过

- `spawn('node', [serverPath])` 使用**参数数组**、无 `shell: true`，无 shell 注入面；`serverPath` 仅来自 `config.serverPath`/环境变量/包内静态默认值，均为管理员/配置受控输入，非用户可控数据。
- 工具调用参数 `workspaceRoot` 经 JSON-RPC 传给 server，不进入 shell。
- 无密钥/凭据暴露：插件不读取/传递 `.env`（由 server 侧读取）；代码中无 token/secret。
- `serverPath` 可被 config/env 覆盖是既定的「高级用户自建 server」边界，可接受（覆盖值仍为可信配置，非远程不可信输入）。

### 5. 无回归 —— 通过

- `git show --stat 3f95448` 确认仅改 6 个文件（`cordis.patch.yml`、两个入口 `index.js` + 两个 `package.json`、根 `package.json`），**未触碰** `install-argo.ps1` 与 `bin/argo-deploy.js`。既有「installer 生成 → `~/.dsh/cordis.patch.yml` 受管块（`file://` + `config.serverPath`）」部署路径保持不变，bundle 为并存的新增路径。

### 6. 遗漏（可选建议）—— R-6

README 未补 `dsh plugin add` 说明（可选，见问题清单 R-6）。

---

## 验收准则（AC）覆盖结论

| 验收准则 | 结论 | 说明 |
| --- | --- | --- |
| AC-1 bundle 清单 | 通过 | `package.json.dsh.bundle.patch = "./cordis.patch.yml"`。 |
| AC-2 行插入 | 通过 | `cordis.patch.yml` 以包名插入 `argo-workspace`/`argo-wakeup` 两行，无 `file://`。 |
| AC-3 可安装 | 有条件通过 | 纯 JS 无 `prepare`，git 源码直装可成功；但 R-1 使安装后的语义检索路径缺 `neo4j-driver`，安装可成、功能不完整。 |
| AC-4 工具可用 | 有条件通过 | 基础工具（`getIntentElementContext`/`getArchitectureViewContext`/`updateArchitectureElement` 等）可用；语义工具 `mcp__argo__getSystemArchitecture`（带语义 query）在缺 `neo4j-driver` 时失败（R-1）。 |
| AC-5 唤醒门 | 通过（附 R-7） | `WAKEUP_GATE` 文本与单一事实源一致并注入 `argo:wakeup` 段；但文本示例调用缺 `intent`（R-7，预存），capable agent 会补 `intent` 重试。 |
| AC-6 话题标签 | 不适用本次 | 非代码检视范围（topic 已由发布员用 `gh`/fetch 验证）。 |
| AC-7 无回归 | 通过 | `install-argo.ps1`/`argo-deploy` 未改（见「检视重点 5」）。 |

---

## 附：核对事实记录

- `git show --stat 3f95448`：6 文件、+181/-1，未含 `install-argo.ps1`、`bin/argo-deploy.js`。
- 根 `package.json`：`dependencies` 键**不存在**；`devDependencies` = `@resvg/resvg-js`、`neo4j-driver`。
- `argo/package.json`：`dependencies.neo4j-driver`（该嵌套 package.json 随包发布，但不会被 `dsh plugin add` 作为依赖安装）。
- `argo/scripts/argo-paths.js`：`getArgoRoot()` = `path.resolve(__dirname, '..')`（`<pkg>/argo`），server 从包内启动即自包含。
- 部署工件 `~/.dsh/plugins/dsh-argo-workspace/index.js`（133 行）与仓库副本（141 行）差异仅 3 处：新增 `fileURLToPath` import、`DEFAULT_SERVER_PATH` 常量、回退链表达式。
- 部署工件 `~/.dsh/plugins/dsh-argo-wakeup/index.js` 与仓库副本逐字一致。
