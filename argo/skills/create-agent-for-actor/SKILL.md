---
name: create-agent-for-actor
description: "为某个 Business Actor 创建对应的 Agent 定义文件（argo/agents/<agent-id>.agent.md），并在意图图谱中该 Actor 元素下登记 agent 属性。Use when the user asks to create an agent for a Business Actor, 为角色创建 agent, 登记 agent 属性。"
argument-hint: actor-name-or-id
disable-model-invocation: true
---

# CREATE AGENT FOR ACTOR

`create-agent-for-actor` 负责为某个 Business Actor 创建对应的 Agent 定义文件，并在意图图谱中把 `agent` 属性登记到该 Actor 元素下。目标 Actor 必须是图谱中 `type=Business Actor` 的元素，通过 `name`（全局唯一）或 `id` 定位。

- Agent 定义文件写为 `argo/agents/<agent-id>.agent.md`，其中 `agent-id` 是 kebab-case 稳定标识（例如「公众号发布员」→ `wechat-publisher`）。
- 创建完成后，通过 ARGO MCP 的 `updateArchitectureElement` 在该 Actor 元素的 `attributes` 中新增（或更新）`agent` 属性：`{"name":"agent","value":"<agent-id>"}`。
- Actor 的 `description` 是 agent system prompt 的来源；其被 `Assignment` 指派的 Business Role 的 `description` 一并纳入职责范围。

## Rules

- **MUST** 先通过 `getIntentElementContext`（或 `getSystemArchitecture` 语义查询）定位目标 Business Actor，确认其 `name` 全局唯一、`description` 非空。
- **MUST** 将 agent 定义文件写到 `argo/agents/<agent-id>.agent.md`，frontmatter 至少含 `name`（Actor 显示名）、`description`、`model`、`tools`（如 `[read, edit, search, execute]`）。
- **MUST** 仅通过 ARGO MCP 的 `updateArchitectureElement` 写回图谱的 `agent` 属性；禁止直接编辑 `design/KG/SystemArchitecture.json`。
- **MUST** 写回图谱后 `git commit`，并把「commit id + 相关文件路径」登记到该 Actor 的 `commit` 属性。
- **MUST NOT** 在 agent 文件或图谱中暴露 secret/token 等敏感信息。

## Workflow

### 1. Locate The Actor

在意图图谱中定位目标 Business Actor（按 `name` 或 `id`），读取其 `description` 与通过 `Assignment` 指派的 Business Role：

```
getIntentElementContext { elementId: "<actor-id>" }
```

确认该 Actor 尚未登记 `agent` 属性（若已存在，则本次为更新 agent）。

### 2. Derive The Agent Id

根据 Actor 名称/角色职责，确定一个稳定的 kebab-case `agent-id`（如「公众号发布员」→ `wechat-publisher`），并确认 `argo/agents/<agent-id>.agent.md` 尚未被占用。

### 3. Write The Agent Definition File

创建 `argo/agents/<agent-id>.agent.md`，frontmatter 参照既有 agent（如 `argo/agents/wechat-publisher.agent.md`）：

```yaml
---
description: "<Actor 职责描述，作为 agent 定位用>"
name: "<Actor 显示名>"
model: "<模型，如 deepseek/deepseek-v4-pro 或 alibaba-cn/qwen3.7-plus>"
tools: [read, edit, search, execute]
user-invocable: true
argument-hint: "<调用提示>"
---
```

正文写清：职责、约束、工作方法、输出格式（以 Actor 的 `description` 与指派 Business Role 的 `description` 为依据）。

### 4. Register The Agent Attribute

通过 ARGO MCP 写回图谱，在目标 Actor 元素上新增/更新 `agent` 属性：

```
updateArchitectureElement {
  id: "<actor-id>",
  patch: {
    attributes: [
      { "name": "agent", "value": "<agent-id>" },
      { "name": "commit", "value": "<commit-id>", "description": "<相关文件路径>" }
    ]
  }
}
```

### 5. Commit And Register

`git add` 变更文件（agent 定义文件、`design/KG/SystemArchitecture.json`）并提交，然后把「commit id + 相关文件路径」回登记到该 Actor 的 `commit` 属性。

## Output

- 目标 Business Actor 的 name/id 与定位结果
- 生成的 agent 定义文件路径（`argo/agents/<agent-id>.agent.md`）
- 写回的 `agent` 属性值与图谱回登记结果
- commit id 与相关文件路径
