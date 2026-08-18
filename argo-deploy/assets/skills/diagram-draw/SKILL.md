---
name: diagram-draw
description: "Draw architecture diagrams as Excalidraw JSON and render them to SVG for embedding in the README. Use when the user asks to draw or insert a diagram (e.g. a Layered Viewpoint architecture diagram) into documentation. Reference: https://github.com/coleam00/excalidraw-diagram-skill"
argument-hint: viewpoint-or-topic
disable-model-invocation: true
---

# DIAGRAM DRAW

`diagram-draw` 负责用 Excalidraw 格式绘制架构图，并通过仓库原生的 SVG 渲染器导出为可嵌入 README 的 SVG 图片。方法论源自 [excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill)。

- 图要「论证」而不是「陈列」：形状、分层与箭头要表达关系与因果，而不是一排等宽卡片。
- 采用 ArchiMate 的 **Layered Viewpoint**：按 Actor/Role、Business/Process、Application、Technology 等专用层组织，层与层之间用箭头表达 realize/serve/use 关系。
- 每一层是一个横向 band（虚线框 + 层标题），层内放置对应元素，层间用带箭头的连线表达关系。

## Rules

- **MUST** 先确定要表达的元素与关系，再决定坐标；每张图至少覆盖 Actor/Role、Application、Technology 三个专用层。
- **MUST** 使用语义色区分元素类别：Actor（蓝）、Process/AGENT（绿）、Application（橙）、Technology/Data（紫）、标准/约束（灰），不随意新造颜色。
- **MUST** 将可编辑源文件保存为 `docs/diagrams/<name>.excalidraw`（Excalidraw JSON v2）。
- **MUST** 用仓库原生渲染器导出 SVG：`node .github/skills/diagram-draw/renderExcalidrawSvg.js docs/diagrams/<name>.excalidraw docs/diagrams/<name>.svg`，并将 SVG 嵌入 README。
- **MUST** 元素 ID 使用可读的 `snake_case`，文本 `text` 只包含可读文字。
- **MUST NOT** 在图中暴露密钥或敏感信息。

## Workflow

### 1. Plan the layers and relationships

列出要表达的元素（如 人类、AGENT、ARGO MCP、graph、ArchiMate 3.2、EA），把它们归入 Layered Viewpoint 的专用层，并写出每一条关系（谁作用于谁、方向如何）。

### 2. Author the Excalidraw source

在 `docs/diagrams/<name>.excalidraw` 中手写 Excalidraw JSON v2，元素类型仅用：

- `rectangle` — 层 band 与元素框
- `ellipse` — 起止点/外部系统
- `diamond` — 决策
- `text` — 层标题、框内标签、箭头旁注释
- `arrow` — 层间关系（`points` 为相对 `x,y` 的偏移）

常用属性：`roughness: 0`、`opacity: 100`、`strokeStyle: "solid"|"dashed"`、`fontFamily: 3`。

### 3. Render to SVG

```powershell
node .github/skills/diagram-draw/renderExcalidrawSvg.js docs/diagrams/<name>.excalidraw docs/diagrams/<name>.svg
```

### 4. Embed in README

在 README 中新增 Architecture 章节，用 Markdown 图片语法引用 SVG，并保留 `.excalidraw` 源文件链接：

```markdown
![<名称>](docs/diagrams/<name>.svg)

Editable source: [`docs/diagrams/<name>.excalidraw`](docs/diagrams/<name>.excalidraw)
```

### 5. Verify

```powershell
node --test
```

## Output

- `.excalidraw` 源文件路径
- 生成的 `.svg` 路径
- README 中嵌入的章节
- 验收测试运行结果
- commit id 与回登记结果
