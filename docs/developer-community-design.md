# ArchGraph 开发者社区 — 方案设计

> 工作包：开发者社区开发交付（2751）
> 角色：系统设计师（caoyang）
> 输入：需求分析 `docs/developer-community-requirements.md`

## 1. 设计目标

基于需求，为「ArchGraph 开发者社区」给出可落地的技术方案，约束为：**零成本、零运维、GitHub 生态内**。

## 2. 总体方案

采用 **GitHub Discussions**（在 ArchGraph 仓库启用）作为社区载体，**不自研前端/后端服务**。

### 2.1 架构映射

- `ArchGraph开发者社区`（应用组件 2748）由 `GitHub Discussions`（应用服务）提供支撑；
- 原规划的 `开发者社区WEB前端`（2749）与 `开发者社区后端服务`（2750）**不再自研**（架构变更，移除）。

## 3. 社区结构设计

### 3.1 分类（Categories）

| 分类 | 用途 |
| --- | --- |
| 工作包分享 | 发布 `export-to-kg.js` 导出的子图工作包 |
| 问答讨论 | 使用/复用问题交流 |
| 公告 | 社区动态 |

### 3.2 工作包帖子模板

每个「工作包分享」帖需包含：

- 标题：`[工作包] <名称>`
- 描述：子图用途简介
- 作者：GitHub 账号
- 子图链接：Gist 或仓库文件（`export-to-kg.js` 导出的 JSON）

## 4. 工作包发布流程

1. 开发者运行 `eatool/EA-jsscript/export-to-kg.js` 导出子图 JSON；
2. 将子图 JSON 发布为 GitHub Gist（或提交到仓库 `KGlibrary/` 目录）；
3. 在 Discussions「工作包分享」分类按模板发帖，附子图链接。

## 5. 验收映射

| 验收 | 实现方式 |
| --- | --- |
| AC-1 浏览 | Discussions 讨论区列表 |
| AC-2 发布 | 发帖 + Gist/仓库文件链接 |
| AC-3 详情 | 帖子详情 |
| AC-4 下载 | 通过 Gist/仓库链接获取子图 JSON |
| AC-5 讨论 | 帖子回复 |

## 6. 交付物清单

1. 启用 ArchGraph 仓库 GitHub Discussions 并配置分类；
2. 工作包帖子模板（贡献指南文档 `docs/developer-community-guide.md`）；
3. （可选）发布辅助脚本：导出子图后生成帖子模板。

## 7. 架构变更

- 新增 `GitHub Discussions`（Application Service），`Serving` `ArchGraph开发者社区`（2748）；
- 移除自研组件 `开发者社区WEB前端`（2749）、`开发者社区后端服务`（2750）及关系 1964。
