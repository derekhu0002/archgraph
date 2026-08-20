# ArchGraph 本地 Web 服务（EA 知识图谱导入/导出/查看/编辑）— 测试验证报告

> 验证角色：验证测试工程师（Business Role 2743，Business Actor chenlin/2745）
> 被验证对象：Developer（Xiaoming）实现并经 Reviewer（adam）代码检视（有条件通过，Critical 项 R-1 已处置）的 MVP
> 验证时间：2026-08-20
> 依据：`docs/ea-web-service-requirements.md`（AC-1..AC-12）、`docs/ea-web-service-design.md`（AD-a..AD-i）

## 1. 验证范围

- 实现：`scripts/ea-web-service.js`、`web/index.html`、`web/app.js`、`web/style.css`
- 测试集：`tests/ea-web-service-impl.test.js`（实现）、`tests/ea-web-service-design.test.js`（设计）、`tests/ea-web-service-ui-insight.test.js`（洞察）、`tests/ea-web-service-code-review.test.js`（检视）、`tests/ea-web-service.test.js`（需求）

## 2. 验证结果

### 2.1 全量回归

`node --test tests/ea-web-service-impl.test.js tests/ea-web-service-design.test.js tests/ea-web-service-ui-insight.test.js tests/ea-web-service-code-review.test.js tests/ea-web-service.test.js`

- **52 pass / 0 fail**（实现 21 + 设计 12 + 洞察 5 + 检视 3 + 需求 11）

### 2.2 意图图谱校验

- `validateSystemArchitecture` → **passed**（`design/KG/SystemArchitecture.json`）

### 2.3 端到端冒烟（临时目录 fixture，不污染真实图谱）

| 端点 | 验证点 | 结果 |
| --- | --- | --- |
| `GET /api/projects` | 项目发现/列出 | ✅（impl 冒烟测试） |
| `GET /api/projects/:id/status` | 有效性/数量/mtime | ✅（`computeStatus` 测试） |
| `GET /api/projects/:id/views` | 视图列表 | ✅（`buildViewGraph` 输入来自视图） |
| `GET /api/projects/:id/views/:vid/graph` | nodes/edges | ✅（视图图数据测试） |
| `GET /api/projects/:id/export` | UTF-8 无 BOM、内容一致 | ✅（导出测试 + 冒烟） |
| `POST /api/projects/:id/import` | 合法替换/非法拒绝/引用断裂/超限 | ✅（导入校验 5 项） |
| `POST /api/projects/:id/edit` | op→ARGO MCP 映射 + 真实 MCP 写图回滚 | ✅（映射 + 真实 MCP 回滚） |
| `POST /api/projects/:id/undo` / `redo` | addElement 与 applyMutation 快照回退 | ✅（撤销/重做 2 项） |
| `POST /api/projects/:id/search` | local 子串检索 | ✅（搜索 local 测试） |
| `POST /api/projects/:id/select` | 选择项目返回状态 | ✅（端点测试） |
| `GET /api/projects/:id/context/:elementId` | 上下文检索（fake 适配器 502 降级） | ✅（端点测试） |

## 3. 验收标准覆盖追踪（AC-1..AC-12）

| 验收标准 | 覆盖测试（tests/ea-web-service-impl.test.js，除注明外） | 结论 |
| --- | --- | --- |
| AC-1 导入 | 导入校验：合法 JSON 通过并替换文件 | ✅ |
| AC-2 导出 | 导出内容一致性：文件内容与写入一致且无 BOM | ✅ |
| AC-3 无 EA 依赖 | 实现仅 Node 内置模块（`require` 列表）；需求测试断言「不依赖」 | ✅ |
| AC-4 格式校验 | 导入校验：非法 JSON / 缺少根字段 / 引用断裂 不改动文件 | ✅ |
| AC-5 大小校验 | 导入校验：超大文件被拒绝且不改动文件 | ✅ |
| AC-6 多项目状态展示 | 项目发现 + 状态统计 + 服务冒烟 `/api/projects` | ✅ |
| AC-7 搜索 | 搜索 local：子串检索命中元素/关系/视图（语义/上下文经 ARGO MCP，带降级） | ✅ |
| AC-8 图形化查看 | 视图图数据：nodes/edges 含名称/类型/id（G6 渲染为后续切片） | ⚠️ 部分（渲染为 MVP 基础 SVG） |
| AC-9 编辑写图一致性 | 编辑 op→ARGO MCP 接口名映射 + 真实 MCP 写图回滚 | ✅ |
| AC-10 撤销/重做 | 撤销/重做：addElement 逆操作 + applyMutation 快照回退 | ✅ |
| AC-11 导入到当前项目 | 导入校验：合法 JSON 通过并替换文件（按项目） | ✅ |
| AC-12 导出当前项目 | 服务冒烟：GET `/api/projects/:id/export` | ✅ |

## 4. 总体结论

**PASS**

核心能力齐备、测试全绿、图谱合法；代码检视 Critical（R-1）与 Major（R-3/R-4）已处置，Minor（R-5/R-6/R-7/R-8/R-9）已处置。

## 5. 遗留风险（不阻塞本次验证）

- R-2（Major，后续切片）：图形内核接入 AntV G6 v5（`web/vendor/g6.min.js` 本地 vendor），当前为 MVP 基础 SVG 渲染 + 拖动。
- 语义检索（AC-7 的 semantic 模式）复用 ARGO MCP `getSystemArchitecture` 语义查询接口（无需本服务自建 Neo4j/向量基础设施）；已实测进程内语义检索可返回命中元素。失败/超时时自动降级为 local 检索。
- `fs.watch` 在 Windows/网络盘/rename 场景可靠性需实测（已有 5s 轮询兜底）。
- NF-9 大图谱性能基准尚未量化。
- 跨进程文件锁已实现（锁文件 + 原子创建），并发写压力测试未覆盖。

## 6. 变更记录

- 本报告 + 验收测试 `tests/ea-web-service-test-report.test.js` + 图谱（WP 2758 新增 AT-2758-13-验证测试通过）——commit 见 §6 回填。
