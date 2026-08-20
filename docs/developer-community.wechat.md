---
title: "开源｜ArchGraph 开发者社区：用 GitHub Discussions 分享你的知识图谱工作包"
author: "derek"
digest: "ArchGraph 开发者社区上线，依托 GitHub Discussions，零成本、零运维。在这里分享、浏览与复用你的知识图谱工作包。"
banner_path: "diagrams/developer-community-banner.png"
open_comment: 1
source_url: "https://github.com/derekhu0002/archgraph/discussions"
---

# 开源｜ArchGraph 开发者社区：用 GitHub Discussions 分享你的知识图谱工作包

今天，**ArchGraph 开发者社区**正式对开发者开放。

我们不造论坛、不写前端后端，而是把社区直接建在 **GitHub Discussions** 上——零成本、零运维、就在 GitHub 生态里。你的知识图谱「工作包」，可以从这里被更多人看见、下载与复用。

---

## 一、为什么是 GitHub Discussions

对于一个开源项目来说，社区最重要的是**门槛低、可持续、离代码近**：

- **零成本、零运维**：不自研社区系统，GitHub 托管，随仓库存在；
- **在 GitHub 生态内**：浏览仓库、提 Issue、看 Discussion，一站完成；
- **可自动化**：Discussions 提供 GraphQL API 与 `discussion` / `discussion_comment` 事件，后续可用 Actions 自动校验帖子内容。

一句话：**把精力留给工作包本身，而不是社区基础设施。**

---

## 二、社区里分享什么：知识图谱「工作包」

ArchGraph 用一张 **意图架构图谱** 表达项目。通过 `export-to-kg.js`，你可以把自己认为有价值的**子图**导出为 JSON——这就是一个「工作包」。

一个工作包可以是：

- 一套多 Agent 协作流程的架构模型；
- 一个可复用的行业知识图谱；
- 一组带验收用例的业务建模范式。

**导出 → 脱敏 → 发布 → 分享链接**，别人就能浏览、下载、复用你的沉淀。

---

## 三、三个分区，各司其职

社区按用途分为三类：

| 分区 | 用途 |
| --- | --- |
| 工作包分享 | 发布 `export-to-kg.js` 导出的子图工作包 |
| 问答讨论 | 使用 / 复用中的问题交流 |
| 公告 | 社区动态 |

发布工作包时，按统一模板填写：

```text
标题：[工作包] <名称>

描述：<子图用途简介，说明它解决什么问题、可复用的场景>

作者：<你的 GitHub 账号>

子图链接：<Gist 或仓库文件链接，指向 export-to-kg.js 导出的 JSON>
```

---

## 四、发布前，请先脱敏

导出的子图 JSON 是知识图谱快照，可能携带敏感信息。发布前**务必逐项清理**：

- 密钥 / token / 密码；
- 内部绝对路径；
- commit id、分支等提交详情；
- 邮箱、手机号等个人信息；
- 未公开的内部备注。

> 子图超过 Gist 单文件约 10MB 上限时，改为提交到仓库 `KGlibrary/` 目录承载。

---

## 五、下载与导入

下载他人工作包用于导入时，子图 JSON 须满足：

- **格式**：符合 `export-to-kg.js` 的导出格式（含 `elements` / `relationships` / `views` 结构）；
- **大小**：不超过约定上限（超过 Gist 单文件约 10MB 的工作包应由仓库文件承载）。

不满足前置条件的子图会被拒绝导入，避免恶意或损坏数据。

---

## 六、欢迎加入

社区地址：**https://github.com/derekhu0002/archgraph/discussions**

如果你也相信「Agent 工程可以可观测、可验证、可复用」，欢迎来社区：

1. 浏览别人的工作包，看看大家怎么建模；
2. 发布你的第一个工作包，让沉淀被看见；
3. 在问答分区提问、交流、共同演进。

一起把 Agent 工程，从「玄学」变成「工程」。
