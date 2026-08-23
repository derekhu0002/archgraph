# 媒体艺术家 Actor 可移植包

将「媒体艺术家」Business Actor（负责图片/视频生成）从源项目导出，供目标 ARGO 项目导入。

## 包内容

| 路径 | 说明 |
|---|---|
| `media-artist.package.json` | 图谱片段（4 元素 + 3 关系 + 1 视图），目标图谱合并源 |
| `argo/agents/media-artist.agent.md` | Agent 定义（VS Code custom agent） |
| `argo/skills/dashscope-media-generator/SKILL.md` | 图像生成 Skill |
| `argo/skills/qwen3-vl-visual-inspection/SKILL.md` | 视觉验收 Skill |
| `tests/media-artist-actor.test.js` | 验收测试（GIVEN-WHEN-THEN 可执行） |

## 图谱片段包含

- 元素：
  - 媒体艺术家、图片视频生成、dashscope-media-generator、qwen3-vl-visual-inspection
- 关系：媒体艺术家 --(Assignment)--> 图片视频生成；图片视频生成 --(Association)--> dashscope-media-generator；图片视频生成 --(Association)--> qwen3-vl-visual-inspection
- 视图：媒体创作团队（view_id=media-team-001）

## 前置条件（目标项目图谱必须已有）

- `AgentOrganization`（id=1962）Grouping 元素——Actor/Role 挂载点。
- `Implementation and Migration Viewpoint`（id=1249）Grouping 元素——Skill 挂载点。
  若目标项目 id 不同，请按目标项目实际 id 替换 package.json 中元素的 `parent` 与视图的 `parent_element_id`。

## 导入步骤

### 1. 复制文件
```powershell
# 将 agent 与 skills 复制到目标项目
Copy-Item -Recurse argoagentsmedia-artist.agent.md      <目标>/argo/agents/
Copy-Item -Recurse argoskillsdashscope-media-generator  <目标>/argo/skills/
Copy-Item -Recurse argoskillsqwen3-vl-visual-inspection <目标>/argo/skills/
Copy-Item testsmedia-artist-actor.test.js                 <目标>/tests/
```

### 2. 合并图谱片段（通过 ARGO MCP，禁止直接编辑 JSON）
在目标项目中，通过 ARGO MCP 依次执行：

```
addArchitectureView {
  view: {
    view_id: "media-team-001",
    view_name: "媒体创作团队",
    parent_element_id: "1962",
    description: "负责图片与视频生成任务的团队视图。"
  }
}

addArchitectureElement { element: <package.json.elements[0]>, view_ids: ["media-team-001"] }
addArchitectureElement { element: <package.json.elements[1]>, view_ids: ["media-team-001"] }
addArchitectureElement { element: <package.json.elements[2]>, view_ids: ["media-team-001"] }
addArchitectureElement { element: <package.json.elements[3]>, view_ids: ["media-team-001"] }

addArchitectureRelationship { relationship: <package.json.relationships[0]>, view_ids: ["media-team-001"] }
addArchitectureRelationship { relationship: <package.json.relationships[1]>, view_ids: ["media-team-001"] }
addArchitectureRelationship { relationship: <package.json.relationships[2]>, view_ids: ["media-team-001"] }
```

或用 `applySystemArchitectureMutation` 一次性原子提交全部 mutation。

> 若目标项目已有同名元素/关系/视图（id 冲突），请先删除或改 id。

### 3. 登记 agent 属性
```
updateArchitectureElement {
  id: "media-artist-001",
  patch: { attributes: [{ name: "agent", value: "media-artist" }] }
}
```

### 4. 运行验收测试
```powershell
node --test tests/media-artist-actor.test.js
```

### 5. 校验图谱
```
validateSystemArchitecture
```

## 凭据说明
图像生成与视觉验收均需 `argo/.env` 中的 `QWEN_KEY`（阿里云 DashScope）。目标项目需自行配置，包内不含任何密钥。
