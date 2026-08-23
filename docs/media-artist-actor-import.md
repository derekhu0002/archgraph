# 媒体艺术家 Business Actor 导入接口文档

> 本文件是「媒体艺术家」（负责图片/视频生成）Actor 的**可移植导出接口**。
> 目标项目为 ARGO 项目（有意图图谱 design/KG/SystemArchitecture.json）。
> 导入通过 **ARGO MCP** 合并图谱片段完成，不依赖独立 SKILL 文件——ARCHGRAPH 的 Skill 能力一律通过图谱中 `type=Skill` 的元素（其 `description` 承载）提供。

## 1. 前置条件

目标项目图谱中必须已存在以下挂载点元素：

| 目标 id | 元素名 | 用途 |
|---|---|---|
| `1962` | AgentOrganization (Grouping) | Business Actor / Business Role 挂载点 |
| `1249` | Implementation and Migration Viewpoint (Grouping) | Skill 元素挂载点 |

若目标项目 id 不同，请将下文 JSON 片段中元素的 `parent` 与视图的 `parent_element_id` 替换为目标项目实际 id。

## 2. 图谱片段（通过 ARGO MCP 导入）

> 不要在目标项目直接编辑 JSON 文件。请通过 ARGO MCP 的 `addArchitectureView` /
> `addArchitectureElement` / `addArchitectureRelationship`（或 `applySystemArchitectureMutation` 原子合并）写入。

### 2.1 视图

```json
{
  "view_id": "media-team-001",
  "view_name": "媒体创作团队",
  "parent_element_id": "1962",
  "parent_element_name": "AgentOrganization",
  "description": "负责 ArchGraph 项目图片与视频生成任务的团队视图：媒体艺术家 Actor 被指派为图片视频生成 Business Role，并使用 dashscope-media-generator Skill 完成创作。",
  "included_elements": ["media-artist-001", "media-role-001", "media-skill-001", "media-vl-skill-001"],
  "included_relationships": ["media-assign-001", "media-use-skill-001", "media-use-vl-001"]
}
```

### 2.2 元素

```json
[
  {
    "id": "media-artist-001",
    "name": "媒体艺术家",
    "type": "Business Actor",
    "parent": "1962",
    "description": "负责 ArchGraph 项目的图片与视频生成任务的 Business Actor。接收创作需求（描述图片/视频主题、风格、用途），通过 dashscope-media-generator Skill 调用阿里云 DashScope 图像生成接口（qwen-image / qwen-image-plus，原生 text2image API）生成写实图片，并根据需要调用视觉模型（qwen3-vl-plus）验收画面内容与角色标注定位；视频生成类任务按项目当前可用能力（DashScope 视频生成接口）执行或说明限制。对最终图片/视频交付的可视质量负责。创作须符合仓库文档上下文，不得凭空捏造画面事实。",
    "attributes": [{ "name": "agent", "value": "media-artist" }]
  },
  {
    "id": "media-role-001",
    "name": "图片视频生成",
    "type": "Business Role",
    "parent": "1962",
    "description": "负责将创作需求（主题、风格、用途、数量、尺寸）转化为可交付的图片/视频。包含：需求解析与画面设计（场景、构图、角色位置规划）；调用图像生成模型产出草稿；使用视觉模型验收并迭代（检查画面元素完整性、标注位置准确性、文字遮挡）；输出最终图片文件（PNG）至 docs/diagrams/。视频生成受平台能力与配额限制，生成前先确认可用模型并如实说明。"
  },
  {
    "id": "media-skill-001",
    "name": "dashscope-media-generator",
    "type": "Skill",
    "parent": "1249",
    "description": "使用阿里云 DashScope 原生图像生成接口生成图片的 Skill。接口：POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis（X-DashScope-Async: enable），模型 qwen-image / qwen-image-plus（注意：原生接口仅这两个模型名可用，其他如 qwen-image-2.0/3.0、wan2.7-image 在原生接口返回 400）；异步任务轮询 GET https://dashscope.aliyuncs.com/api/v1/tasks/<task_id>，SUCCEEDED 后取 output.results[0].url 下载图片。标准 OpenAI 兼容端点（/compatible-mode/v1/images/generations）不支持图片生成（404）。凭据从 argo/.env 的 QWEN_KEY 读取（禁止写入文件）。"
  },
  {
    "id": "media-vl-skill-001",
    "name": "qwen3-vl-visual-inspection",
    "type": "Skill",
    "parent": "1249",
    "description": "使用 qwen3-vl-plus 视觉模型查看图片并输出画面元素与百分比坐标的 Skill。接口：POST https://llm-clids9mqc5o1mbvb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions，model=qwen3-vl-plus，消息 content 含 image_url（data:image/png;base64）与 text 提问。用途：在无图像输入能力的 Agent 无法直接看图时，作为代理验收生成图片——检查画面元素完整性、定位角色标注坐标、确认标注无遮挡/无重叠。凭据从 argo/.env 的 QWEN_KEY 读取。"
  }
]
```

### 2.3 关系

```json
[
  {
    "id": "media-assign-001",
    "name": "Assignment",
    "statement": "媒体艺术家 --(Assignment)--> 图片视频生成",
    "type": "Assignment",
    "source_id": "media-artist-001",
    "target_id": "media-role-001",
    "source_name": "媒体艺术家",
    "target_name": "图片视频生成"
  },
  {
    "id": "media-use-skill-001",
    "name": "uses",
    "statement": "图片视频生成 --(Association)--> dashscope-media-generator",
    "type": "Association",
    "source_id": "media-role-001",
    "target_id": "media-skill-001",
    "source_name": "图片视频生成",
    "target_name": "dashscope-media-generator"
  },
  {
    "id": "media-use-vl-001",
    "name": "uses",
    "statement": "图片视频生成 --(Association)--> qwen3-vl-visual-inspection",
    "type": "Association",
    "source_id": "media-role-001",
    "target_id": "media-vl-skill-001",
    "source_name": "图片视频生成",
    "target_name": "qwen3-vl-visual-inspection"
  }
]
```

## 3. 附带文件（复制到目标项目）

以下文件需随图谱片段一并复制到目标项目（Agent 定义与验收测试）：

- `argo/agents/media-artist.agent.md` —— Agent 定义（VS Code custom agent），frontmatter 含 `name: 媒体艺术家`、`model`、`tools`；正文含 DashScope text2image 接口、qwen-image 模型约束、qwen3-vl-plus 视觉验收与 QWEN_KEY 约束。
- `tests/media-artist-actor.test.js` —— 验收测试（GIVEN-WHEN-THEN 可执行），覆盖：Actor 注册、Assignment 关系、Skill 关联、视图成员、Agent 文件就绪。

> Skill 能力**不**以独立 SKILL.md 文件提供，全部内联在上述 `type=Skill` 元素的 `description` 中，与 ARCHGRAPH 的既有方式一致。

## 4. 导入步骤（目标项目内执行）

1. 复制 `argo/agents/media-artist.agent.md` 与 `tests/media-artist-actor.test.js` 到目标项目对应目录。
2. 通过 ARGO MCP 依次（或 `applySystemArchitectureMutation` 原子）写入第 2 节的视图、元素、关系。
3. 若目标项目 id 冲突（已有同名元素/视图），先删除旧项或改写 id。
4. `updateArchitectureElement { id: "media-artist-001", patch: { attributes: [{ name: "agent", value: "media-artist" }] } }` 登记 agent 属性。
5. 运行 `node --test tests/media-artist-actor.test.js`，执行 `validateSystemArchitecture`。
6. 配置凭据：目标项目 `argo/.env` 需有 `QWEN_KEY`（阿里云 DashScope）。本接口文档不包含任何密钥。

## 5. 验收用例（随 Actor 携带）

- **AT-media-artist-01-媒体艺术家角色就绪**：GIVEN 意图图谱已登记 AgentOrganization 团队；WHEN 查找专门负责图片视频生成的 Business Actor；THEN 图谱中存在全局唯一 name 为「媒体艺术家」的 Business Actor，挂载于 AgentOrganization(1962)，有非空 description，并通过 Assignment 指派给「图片视频生成」Role，均包含于「媒体创作团队」视图(media-team-001)。
- **AT-media-artist-02-媒体艺术家Agent文件就绪**：GIVEN 媒体艺术家需要以 VS Code 自定义 agent 方式被调用；WHEN 查找其 agent 定义文件；THEN 工作区 `argo/agents/media-artist.agent.md` 存在，frontmatter 含 name=媒体艺术家、model 与 tools，正文含 text2image 端点、qwen-image 模型、qwen3-vl-plus 与 QWEN_KEY 约束。

## 6. 源仓库信息

- 导出自：`archgraph` 仓库，commit `b0ae5a9`（Actor 创建）/ `fb03893`（导出登记，后按 ARCHGRAPH Skill 规范回退为图谱内联方式）。
- 图谱文件：`design/KG/SystemArchitecture.json`。
