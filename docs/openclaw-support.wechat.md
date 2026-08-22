---
title: "ArchGraph 支持 OpenClaw 了：你的个人 AI 助手，也能看懂你的架构图"
author: "derek"
digest: "一条 argo-deploy 命令，ArchGraph 的规则、技能与 argo MCP server 自动装进 OpenClaw。个人 AI 助手第一次有了自己的施工图。"
banner_path: "diagrams/openclaw-banner.png"
open_comment: 1
source_url: "https://archgraph.org"
---

# ArchGraph 支持 OpenClaw 了：你的个人 AI 助手，也能看懂你的架构图

今天说一件小事，但对我们挺重要：**ArchGraph 正式支持 OpenClaw 了。**

OpenClaw 是开源的个人 AI 助手框架，跑在你自己机器上，管着你的聊天、工具、日常自动化。而 ArchGraph 想解决的，是让 AI 干活之前先"看懂图纸"。

现在这两件事接上了——你在 OpenClaw 里打开一个项目，它一上来就知道：**动手之前，先去找架构元素；改之前，先跑验收用例。**

---

## 一、装完长什么样

不用改任何配置，一条命令：

```powershell
npm install -g archgraph-argo
argo-deploy
```

跑完之后，OpenClaw 里多了三样东西：

**1. 规则，进了 workspace 的 AGENTS.md**

OpenClaw 每次会话都会把 workspace 里的 `AGENTS.md` 注入上下文，所以我们把 ArchGraph 的全局工作流规则（先定位架构元素、测试先行、提交回登记）剥掉 frontmatter 后原样写进去。下次会话一开始，唤醒门就是开着的——它不用你提醒。

**2. 技能，装进了 `~/.openclaw/skills/argo-init`**

`argo-init` 是托管技能，所有 agent 都看得见、用得上。`openclaw skills list` 里能看到它，状态是 `ready`。

**3. argo MCP server，注册进了 openclaw.json**

`mcp.servers.argo`，stdio 方式跑 `argo-mcp-server.js`，工具以 `argo__*` 暴露。`openclaw mcp probe argo` 一下，21 个工具全在。

---

## 二、一个细节，我们纠结了一阵

OpenClaw 是固定工作区宿主——它不像 VS Code 那样会主动上报当前打开的项目根目录，所以 MCP 侧没法靠"动态发现"知道该服务哪张图。

我们的解法：显式把 `ARGO_REPO_ROOT` 钉到仓库根，让 argo server 一启动就知道"我在给哪个图干活"。这样它查的就是对的数据库，而不是一个不存在的名字。

如果你同时装了多套环境，也留了后门：`-SkipOpenClaw` 可以跳过 OpenClaw 段，`-OpenClawHome` / `-OpenClawWorkspace` / `-OpenClawRepoRoot` 能指定路径。

---

## 三、装完，用起来是什么感觉

在 OpenClaw 里打开一个 ArchGraph 项目，agent 会：

1. 先在图谱里找到任务对应的架构元素；
2. 带上那个元素挂载的技能和规则；
3. 测试先行，GIVEN-WHEN-THEN 驱动实现；
4. 改完提交留证，并把 commit 回登记到图上。

每一步都有据可查。对个人助手来说，这意味着它不再"凭感觉干活"，而是**照着同一张图纸走**。

---

## 四、说句实话

这不解决所有问题。OpenClaw 的 agent 模型（隔离 agent + SOUL.md）跟 VS Code 的自定义 agent 不是一回事，我们的 agent 文件还没全量搬过去，这算遗留项。

但核心的骨架已经立住了：**规则、技能、MCP，三条腿都齐了。** 剩下的，是让更多 agent 定义也能在 OpenClaw 里跑起来。

---

如果你已经在用 OpenClaw，装上试试；如果还没有，这也许是个不错的理由开始。

**一条命令，个人 AI 助手第一次有了自己的施工图。**

源码：https://github.com/derekhu0002/archgraph
官网：https://archgraph.org
