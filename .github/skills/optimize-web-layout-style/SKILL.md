---
name: optimize-web-layout-style
description: "For the project website (index.html), apply a tech-simple, clean layout and visual style referencing https://www.deepseek.com/, and render a Reference Library (KGlibrary) area that surfaces the reference projects under KGlibrary/. Use when the user asks to optimize/redesign the home website layout or style, or to add a KGlibrary projects section to the site."
argument-hint: site-root
disable-model-invocation: true
---

# OPTIMIZE WEB LAYOUT AND STYLE

`optimize-web-layout-style` 负责把本项目主页（`index.html`）优化为「科技简洁」的布局与风格，并在页面中呈现 KGlibrary 参考库里的其他项目信息。

- 视觉参考：https://www.deepseek.com/ —— 深色科技主题、留白充足、克制的边框、单一主强调色（蓝）、卡片化内容分区。
- 页面是纯静态 GitHub Pages 站点：保持 `index.html` 单文件、可离线打开、不依赖服务端语言。
- KGlibrary 参考库：`KGlibrary/<project>/info.md` 使用 YAML frontmatter 描述项目（见 `.github/kglibrary.instructions.md`）。

## Rules

- **MUST** 保持纯静态、单文件 `index.html`，不引入构建步骤或运行时依赖（CDN 字体/图标除外，且需可降级）。
- **MUST** 采用科技简洁风格：深色背景 + 单一蓝色主强调色，顶部固定导航栏，Hero 首屏，正文卡片化分区。
- **MUST** 在页面中提供 `id="kglibrary"` 的 Reference Library 区域，列出 KGlibrary 中每个参考项目的 `name`、`description` 与 `repo` 链接。
- **MUST** 给 `<html>`（或 `<body>`）标注 `data-theme="dark"`，作为深色科技主题的可验证标记。
- **MUST** 页面内容与 `KGlibrary/*/info.md` 保持同步；修改 KGlibrary 后需同步刷新该区域。
- **MUST NOT** 在站点中暴露密钥、token 等敏感信息（Pages 站点公开可访问）。

## Workflow

### 1. Inventory KGlibrary Projects

读取 `KGlibrary/*/info.md` 的 frontmatter（`name`、`description`、`repo`、`branch`、`commit_id`），得到需要展示的项目列表。

### 2. Redesign The Layout

在 `index.html` 中按「科技简洁」风格组织内容：

1. 顶部固定导航栏（项目名 + 锚点链接 + GitHub 仓库链接）。
2. Hero 首屏：项目名、一句话标语、行动按钮（GitHub / Reference Library）。
3. 正文分区：What is this? / Core principles（卡片）/ Repository map / Reference Library（`#kglibrary`）/ Links。
4. 页脚。

### 3. Render The Reference Library Area

在 `#kglibrary` 区域内，为每个 KGlibrary 项目生成一张卡片：项目名、描述、仓库链接（`repo`）、分支与 commit 短哈希（若 frontmatter 提供）。

### 4. Verify

- 本地：用静态服务器或直接打开 `index.html`，确认导航、Hero、各分区与 KGlibrary 区域渲染正常。
- 自动化：运行 `node --test tests/website.test.js`，确保 `layout-style` 与 `kglibrary-area` 两个验收用例全部通过。

### 5. Commit And Register

`git add` 变更文件并提交，然后把「commit id + 相关文件路径」回登记到意图架构图谱中对应的 Work Package（本任务为 1317）。

## Output

- 重写后的 `index.html` 路径
- KGlibrary 区域展示的项目清单
- 验收测试运行结果
- commit id 与回登记结果
