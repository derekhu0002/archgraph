# ArchGraph 开发者社区 — 开通指南（GitHub Discussions）

> 面向仓库管理员。用于在 ArchGraph 仓库启用 GitHub Discussions 并配置分类。
> 对应方案设计交付物第 1 项「启用 GitHub Discussions 并配置分类」。

## 1. 前置条件

- 对 ArchGraph 仓库（`github.com/derekhu0002/archgraph`）拥有 **admin（管理员）** 权限。
- 本指南为 GitHub 平台上的手动操作，不涉及代码改动。

## 2. 启用 GitHub Discussions

1. 打开仓库主页，点击右上角 **Settings**（设置）。
2. 左侧菜单选择 **General**（通用），向下滚动到 **Features**（功能）区域。
3. 勾选 **Discussions** 复选框。
4. GitHub 会自动启用 Discussions，并创建一个默认的 `General`（通用）分类。

## 3. 配置分类（Categories）

1. 打开仓库的 **Discussions** 标签页。
2. 在左侧边栏 **Categories**（分类）区域，点击 **Manage categories**（管理分类）或 `+`。
3. 按方案设计创建以下三个分类：

| 分类名 | 格式（Format） | 用途 |
| --- | --- | --- |
| 工作包分享 | General | 发布 `export-to-kg.js` 导出的子图工作包 |
| 问答讨论 | Q&A | 使用/复用问题交流（可「采纳答案」） |
| 公告 | Announcements | 社区动态（仅维护者可发帖） |

4. 为每个分类填写描述、设置 emoji 图标（可选）。

## 4. （可选）引导参与者

- 在「工作包分享」分类描述或置顶帖中，链接贡献指南 `docs/developer-community-guide.md`。
- 在分类描述里提示参与者按帖子模板（`[工作包] <名称>` + 描述 + 作者 + 子图链接）发帖，并提示发布前需做脱敏检查。

## 5. 验证

1. 在「工作包分享」分类发一个测试帖，确认分类正确显示、格式生效。
2. 确认「问答讨论」分类出现「采纳答案」按钮（Q&A 格式生效）。
3. 确认「公告」分类仅维护者可发帖。

## 6. 参与方式速览

开通后，社区参与者按 `docs/developer-community-guide.md` 参与：

- **分享**：`export-to-kg.js` 导出子图 → `node scripts/developer-community-publish.js <subgraph.json>` 脱敏 + 生成帖子模板 → 发布到 Gist/仓库 `KGlibrary/` → 在「工作包分享」发帖附链接。
- **复用**：在 Discussions 浏览/下载 → `node scripts/developer-community-validate.js <subgraph.json>` 校验格式与大小 → 导入。
- **讨论**：在帖子下评论/提问，或在「问答讨论」发 Q&A。
