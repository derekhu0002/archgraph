# Publish ArchGraph as a native DeepSeek Harness plugin (dsh-plugin)

## Goal

将 ArchGraph 发布为原生 **DeepSeek Harness（dsh）插件（bundle）**，使 DSH 用户无需单独运行
`argo-deploy` / `install-argo.ps1` 即可通过 `dsh plugin add` 安装并获得 ARGO 工具链与唤醒门；
同时在 GitHub 仓库打上 `dsh-plugin` 标签，使其出现在 https://github.com/topics/dsh-plugin 。

参考：https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/
（`index.md`「Your first plugin」与 `publish.md`「Package and install a plugin」）。

## Current state

- 仓库：`derekhu0002/archgraph`（`main` 分支），当前 topics 为 `[]`。
- `package.json` 现为 `archgraph-argo`（npm 工具链安装器，`argo-deploy` 把 ARGO MCP 注册进
  Copilot / Cursor / OpenCode / DeepSeek Harness）。
- DSH 集成目前由 `install-argo.ps1` 生成两个 Cordis 插件部署工件到 `~/.dsh/plugins/`：
  - `dsh-argo-workspace/index.js` —— 直连 argo MCP server，把每个 argo 工具注册为
    `mcp__argo__*`，并把当前会话 `workspaceRoot` 注入每次调用。
  - `dsh-argo-wakeup/index.js` —— 把无条件唤醒门（STEP 0）注册为 system prompt 首段。
- 这两个插件目前以 `file://` 行写入 `~/.dsh/cordis.patch.yml`（`# BEGIN ArchGraph ARGO
  deployment` 受管块），**不是** `dsh.bundle`，无法被 `dsh plugin add` 安装/分发。

## User scenarios（外部视角）

- **US-1 安装**：GIVEN 一个已安装 `dsh` CLI 的 DSH 用户；WHEN 执行
  `dsh plugin --profile <name> add github:derekhu0002/archgraph`；THEN 该 bundle 被加入该
  profile 的 `dsh.profile.bundles`，无需运行 `argo-deploy` / `install-argo.ps1`。
- **US-2 工具可用**：GIVEN 已启用该 bundle 并启动 dsh；WHEN 调用 argo 工具；THEN
  `mcp__argo__*` 工具可用（如 `getSystemArchitecture`），且每次调用自动注入当前会话
  `workspaceRoot`，无需模型感知内部参数。
- **US-3 唤醒门**：GIVEN 已启用该 bundle；WHEN 启动新会话；THEN 系统提示最前包含
  STEP 0 无条件唤醒门（`argo:wakeup` 段）。
- **US-4 发现**：GIVEN 仓库为 public；WHEN 访客打开 https://github.com/topics/dsh-plugin；
  THEN 能看到 ArchGraph 仓库。

## Acceptance criteria（GIVEN-WHEN-THEN，外部可验证）

- **AC-1 bundle 清单**：GIVEN 仓库根目录 `package.json`；WHEN 读取其 `dsh` 键；THEN 存在
  `dsh.bundle.patch` 指向 `cordis.patch.yml`。
- **AC-2 行插入**：GIVEN 仓库根目录 `cordis.patch.yml`；WHEN 读取该 patch；THEN 以包名
  （非 `file://`）引用插入 `argo-workspace`（dsh-argo-workspace）与 `argo-wakeup`
  （dsh-argo-wakeup）两行。
- **AC-3 可安装**：GIVEN 一个空 profile；WHEN 执行 `dsh plugin --profile <name> add
  github:derekhu0002/archgraph`；THEN 安装成功且 bundle 进入 `dsh.profile.bundles`（git 安装
  无需 build 许可，或提供 `prepare` / 预构建产物）。
- **AC-4 工具可用**：GIVEN 已启用 bundle 并 dump 配置；THEN 配置中出现该 bundle 层；
  启动后 tools 列表含 `mcp__argo__getSystemArchitecture` 等。
- **AC-5 唤醒门**：GIVEN 已启用 bundle；WHEN 启动会话；THEN system prompt 含 STEP 0
  唤醒门文本。
- **AC-6 话题标签**：GIVEN 仓库为 public 且已打标签；WHEN 查询
  `gh api repos/derekhu0002/archgraph/topics`；THEN `names` 含 `dsh-plugin`，且
  https://github.com/topics/dsh-plugin 能检索到该仓库。
- **AC-7 无回归**：GIVEN 既有部署路径；WHEN 运行 `node --test tests/*.test.js` 与
  `install-argo.ps1` 既有 DSH 部署逻辑；THEN 全部通过，`argo-deploy` 流程不受影响。

## Out of scope

- 不改动 argo MCP server 本身的功能语义。
- 不迁移 Copilot / Cursor / OpenCode 的部署方式。
- 不发布到 npm registry（若采用 npm 发布则为额外可选项，非本次必需）。

## Handoff

需求经产品经理确认后，转交系统设计师产出 bundle 结构设计（`package.json` dsh.bundle 形态、
`cordis.patch.yml` 行、argo server 定位方式、git 安装的 `prepare`/预构建策略），再转 Developer
实现并打标签。
