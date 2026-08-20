# ArchGraph 本地 Web 服务（EA 知识图谱导入/导出/查看/编辑）— 代码检视报告

> 检视角色：Reviewer（Business Role 2732，Business Actor adam/2733）
> 被检视对象：Developer（Xiaoming）交付的 MVP
> 检视时间：2026-08-20
> 检视范围：`scripts/ea-web-service.js`、`web/index.html`、`web/app.js`、`web/style.css`、`tests/ea-web-service-impl.test.js`
> 输入依据：`docs/ea-web-service-requirements.md`（FR-1..14 / NF-1..11 / AC-1..12）、`docs/ea-web-service-design.md`（AD-a..AD-i / API 清单 / 编辑↔MCP 映射表）

---

## 0. 总体结论

**结论：有条件通过（Conditional Pass）**

MVP 实现了需求中的核心能力：项目发现、状态展示、视图图数据、搜索（local/semantic/context）、导入/导出、编辑（走 ARGO MCP）、撤销/重做，且测试（17 项）真实可执行、使用临时 fixture、含真实 MCP 写图回滚验证，编辑路径**正确地**统一走 ARGO MCP 写图接口。

但存在 **1 项 Critical（FR-13 红线）** 与 **3 项 Major（设计偏离/缺失）** 必须在转交「验证测试工程师」之前给出明确处置（详见 §3 问题清单与 §4 整改清单）。Critical 为：导入（整体替换）路径直接改写 `SystemArchitecture.json`，未经过 ARGO MCP，与 FR-13 红线及设计数据流第 4 条「经 ARGO MCP 落盘以保持一致」冲突——需 Developer 与系统设计师协同明确「整体替换导入的写图口径」，或新增 MCP 级整图替换接口。

---

## 1. 逐项检视结论

| 检视重点 | 结论 | 严重级别 |
| --- | --- | --- |
| 1. FR-13 红线合规（编辑走 MCP / 导入整体替换备份+原子写） | **需修改**：编辑路径合规（进程内 callTool + stdio 子进程 fallback）；但**导入路径绕过 MCP 直接落盘** | **Critical** |
| 2. 安全性（绑定/路径穿越/大小限制/secret/导出） | **通过**（有 2 处 Minor 加固项） | Minor |
| 3. 正确性（导入校验/原子写/撤销重做/状态码/并发） | **需修改**：`applyMutation` 撤销不可用；导入校验未用真实 schema；无跨进程文件锁 | Major + Minor |
| 4. 架构一致性（AD-a..AD-i / 映射表 / API 清单） | **需修改**：AD-g(G6)/AD-e(实时)/AD-i(文件锁) 未实现；API 清单缺 2 端点；映射表一致 | Major |
| 5. 测试质量（覆盖/可执行/不污染真实图谱/验证写图走 MCP） | **通过**（有 1 处 Minor 覆盖缺口） | Minor |
| 6. 鲁棒性（超大目录/大文件/异常路径） | **通过**（有 2 处 Minor 加固项） | Minor |

### 1.1 FR-13 红线合规

- ✅ 编辑路径：`EDIT_OP_TOOL_MAP`（L45-57）把 9 个编辑 op 一一映射到 ARGO MCP 写图接口；`editProject`（L823-841）统一通过 `mcpAdapter.callTool` 写图，无直接改文件的编辑分支；`createMcpAdapter`（L559-631）提供进程内 `callTool`（复用 `argo/scripts/argo-mcp-server.js`）与 stdio 子进程 MCP 客户端两种后端，满足「与 Agent 写图一致」。
- ❌ **导入路径**：`importProject`（L881-903）在校验与备份后调用 `atomicWriteFile(project.graphPath, text)`（L898）**直接改写 `SystemArchitecture.json`**，未经过 ARGO MCP。这与 FR-13「所有写入图谱的操作必须通过 ARGO MCP 接口完成，禁止绕过 MCP 直接编辑」以及设计文档数据流第 4 条「导入…整体替换当前项目图谱（经 ARGO MCP 落盘以保持一致，见 AD-a）」冲突。实现头部注释（L12-13）将该直接落盘解释为「按需求/设计 AD-a」，但 AD-a 本身仅描述「备份 + 整体替换」语义，未授权绕过 MCP——属于设计（数据流）与实现之间的不一致，需明确口径。
- ✅ 备份 + 原子写：导入在替换前 `backupGraph`（保留最近 10 份）；`atomicWriteFile`（L736-740）采用 temp + rename。

### 1.2 安全性

- ✅ 默认绑定 `127.0.0.1`（`DEFAULT_HOST`），仅当显式设置 `EA_WEB_HOST` 时才可改为其它地址（配置项，可接受）。
- ✅ 静态文件服务为**白名单路由**：仅 `/`、`/index.html`、`/app.js`、`/style.css` 会进入 `serveStatic`，未将用户输入直接拼接为文件路径，path traversal 在当前路由下不可达。
- ✅ 请求体/上传大小限制：`readBody` 按 limit 截断并 `HttpError(413)`；导入 20MB、搜索/编辑 1MB；`importProject` 二次校验字节上限。
- ✅ 无 secret/token 硬编码；导出仅返回图谱 JSON 本身（业务数据）；`.argo/backups` 不在静态目录、不经 API 暴露。
- ⚠️ Minor：`serveStatic`（L1045-1060）用 `safe.startsWith(base)` 做前缀判断，对兄弟目录（如 `/web-evil`）存在前缀误判；当前不可达，建议加 `path.sep` 边界判断。
- ⚠️ Minor：`decodeURIComponent(url.pathname)`（L907）遇到畸形百分号编码会抛 `URIError` → 500，应归为 400。

### 1.3 正确性

- ✅ 导入校验覆盖 FR-4 所列项：JSON 合法性、根字段（name/description/elements/relationships/views）、元素/关系/视图 id 唯一、`parent`/`source_id`/`target_id`/`included_elements`/`included_relationships` 引用完整性；错误信息可读。
- ⚠️ Minor：`validateGraphDocument` 未真正加载 `argo/schema/SystemArchitecture.schema.json`（NF-5「严格按 schema 校验」为部分满足）；缺 `view.parent_element_id` 引用校验、元素/关系 `type` 的 ArchiMate 合法性校验、根 `attributes` 类型校验。
- ✅ 原子写：temp + `renameSync`；rename 失败时原文件保持完好（temp 残留属 Minor）。
- ⚠️ Major（并发）：`withProjectWriteLock`（L783-789）仅做进程内串行队列，**未实现 AD-i 的跨进程文件锁**（锁文件 + 原子创建）。
- ⚠️ Minor（撤销/重做）：`deriveInverseCommand` 对 `applyMutation` 返回 `null`（L493-495），`undoProject` 对该类命令抛「无可撤销的操作」——批量变更暂不可撤销；实现注释声称的「快照回退」在 `createService` 中未落地。
- ✅ 状态码：404（项目/视图不存在）、400（非法 op/校验失败/撤销失败）、413（超限）基本正确。
- ⚠️ Minor：`readBody` 超限时 `reject` 后 `req.destroy()`，客户端可能收到连接重置而非干净 413 响应体。

### 1.4 架构一致性

- ✅ 编辑 op→ARGO MCP 接口映射表与设计 §3 映射表完全一致（测试已逐项断言）。
- ✅ AD-b（零依赖 Node http）、AD-a 的「备份 + 整体替换」语义已实现。
- ❌ **Major — AD-g/AD-c 偏离**：设计已修订为「G6 v5 开源图库内核（本地 vendor）」，并明确废止自研 SVG；实现仍为 `web/app.js` 基础 SVG 渲染 + 拖动（`renderGraph` L113 起），文件头 TODO 自认「后续切片接入 G6」。`web/vendor/g6.min.js` 不存在。
- ❌ **Major — AD-e/NF-8 缺失**：无 `fs.watch`、无轮询兜底；状态仅按需（`/api/projects` 时 `refreshProjects`）刷新，不满足「秒级实时」。
- ❌ **Major — AD-i 缺失**：无跨进程文件锁（同 1.3）。
- ⚠️ Minor：设计 API 清单中 `POST /api/projects/select` 与 `GET /api/projects/:id/context/:elementId` 未实现（选择为纯前端状态；上下文检索经 `/search` 的 `mode:"context"` 提供，等价但端点名不一致）。

### 1.5 测试质量

- ✅ 17 项测试真实可执行；覆盖项目发现/状态/导出无 BOM/导入校验（合法/非法/缺根字段/引用断裂/超大）/op 映射/载荷构造/逆操作/撤销重做/搜索/视图图数据/服务冒烟/图谱登记/真实 MCP 回滚。
- ✅ 使用 `os.tmpdir()` 临时 fixture，不污染真实图谱；真实 MCP 回滚测试额外使用 `design/KG/IntegrationFixture.json` 于临时目录，避免触碰 canonical 图谱与 Neo4j/向量生命周期。
- ✅ 验证「写图走 MCP」：op→MCP 映射断言 + 真实 MCP `addElement`/`removeElement` 回滚断言。
- ⚠️ Minor：未端到端验证 `editProject` 经真实 MCP 写图（真实 MCP 测试直接调 `adapter.callTool`，未穿过 `editProject`）；无安全（路径穿越/绑定）、无并发写、无「导入是否绕过 MCP」的测试。

### 1.6 鲁棒性

- ✅ 项目发现：深度上限 6、跳过 `node_modules`/`.git`/`vendor`/`.argo`/点目录、`readdirSync` 异常被吞（权限错误不致崩溃）。
- ✅ 非法 op：`editProject` 返回 400 并列出可用 op；不存在的项目 id 返回 404。
- ⚠️ Minor：`readGraphDocument` 用 `readFileSync` + `JSON.parse` 同步解析，超大图谱会阻塞事件循环（MVP 可接受）。
- ⚠️ Minor：`main()` 的 `--root`/`--port` 未校验缺失参数（`argv[idx+1]` 为 `undefined` 时 `path.resolve(undefined)` 抛错）。

---

## 2. 变更文件

- `docs/ea-web-service-code-review.md`（本报告，新增）
- `tests/ea-web-service-code-review.test.js`（新增：断言报告存在 + 组件 2760 携带 AT-2760-04）
- `design/KG/SystemArchitecture.json`（经 ARGO MCP：组件 2760 新增 testcase AT-2760-04-代码检视通过）

---

## 3. 问题清单

| 编号 | 级别 | 位置 | 描述 | 修复建议 |
| --- | --- | --- | --- | --- |
| R-1 | **Critical** | `scripts/ea-web-service.js` L898（`importProject`→`atomicWriteFile`） | 导入（整体替换）绕过 ARGO MCP 直接改写 `SystemArchitecture.json`，违反 FR-13 红线与设计数据流第 4 条 | 与系统设计师协同定口径：a) 新增 MCP 级整图替换接口并让导入经其落盘；或 b) 在 FR-13/AD-a 中显式声明「整体替换导入」为经备份+原子写的受控例外。任选其一并补齐对应测试 |
| R-2 | **Major** | `web/app.js` L3-5、L113（`renderGraph`） | 前端仍为自研 SVG+拖动，未接入设计 AD-g 要求的 AntV G6 v5（本地 vendor） | 后续切片集成 `web/vendor/g6.min.js`，替换自研 SVG 渲染 |
| R-3 | **Major** | `scripts/ea-web-service.js` L783（`withProjectWriteLock`） | 仅进程内串行队列，无 AD-i 要求的跨进程文件锁 | 实现锁文件 + 原子创建（占用失败拒绝/排队） |
| R-4 | **Major** | `scripts/ea-web-service.js` `createService`/`refreshProjects` | 无 `fs.watch` + 轮询兜底，不满足 AD-e/NF-8 秒级实时 | 增加 fs.watch（防抖）+ 5s 轮询兜底 |
| R-5 | Minor | `scripts/ea-web-service.js` L493-495（`deriveInverseCommand`） | `applyMutation` 逆操作为 `null`，批量变更不可撤销（注释所称快照回退未实现） | 实现快照回退，或在未支持前从 `EDIT_OPS` 隐藏 `applyMutation` |
| R-6 | Minor | `scripts/ea-web-service.js` `validateGraphDocument` | 导入校验未使用真实 schema（NF-5 部分满足）：缺 `view.parent_element_id`、ArchiMate `type`、根 `attributes` 校验 | 复用 `argo/schema/SystemArchitecture.schema.json` 或补齐上述检查 |
| R-7 | Minor | `scripts/ea-web-service.js` `handleProjectRoute` | 设计 API 清单的 `POST /api/projects/select`、`GET /api/projects/:id/context/:elementId` 未实现 | 实现或在设计文档中标注为「客户端选择 / 经 /search 等价替代」 |
| R-8 | Minor | `scripts/ea-web-service.js` L1045-1060（`serveStatic`） | 前缀校验用 `startsWith(base)`，兄弟目录存在误判（当前不可达） | 改用 `safe === base || safe.startsWith(base + path.sep)` |
| R-9 | Minor | `scripts/ea-web-service.js` L907（`decodeURIComponent`） | 畸形百分号编码抛 `URIError` → 500 | 捕获并返回 400 |
| R-10 | Minor | `scripts/ea-web-service.js` `readBody` / `readGraphDocument` | 超限后 `req.destroy()` 致 413 响应可能不完整；大文件同步解析阻塞事件循环 | 返回 413 前尽量先写响应头；MVP 可接受同步读 |
| R-11 | Minor | `tests/ea-web-service-impl.test.js` | 未端到端验证 `editProject` 经真实 MCP 写图；无安全/并发/「导入绕过 MCP」测试 | 补充：真实 MCP 经 `editProject` 的端到端用例；为 R-1 口径补测试 |

---

## 4. 转交说明

### 4.1 给 Developer 的整改清单（按优先级）

1. **R-1（Critical，先行）**：与系统设计师确认「整体替换导入」的写图口径并落地（MCP 整图替换接口 或 显式豁免声明 + 测试）。
2. R-2：集成 G6 v5（本地 vendor）替换自研 SVG。
3. R-3：跨进程文件锁。
4. R-4：fs.watch + 轮询实时刷新。
5. R-5..R-11：按 §3 建议逐项处置（Minor 可批量处理）。

### 4.2 转交验证测试工程师的说明

- 本次检视为**有条件通过**：功能与测试基线（45/45 通过，见 §5）保持绿色；Critical 项 R-1 处置完成后方可进入正式测试验证。
- 建议测试工程师重点回归：导入写图口径（R-1 处置后）、撤销/重做（含 applyMutation）、并发编辑（多进程）、实时刷新（R-4 落地后）、导入校验边界（超大/非法/引用断裂）。
- 现状基线（检视时点）已复跑确认：见 §5。

---

## 5. 测试与图谱校验结果（检视时点）

- `node --test tests/ea-web-service-impl.test.js tests/ea-web-service-design.test.js tests/ea-web-service-ui-insight.test.js tests/ea-web-service.test.js`：见 §6 实际执行结果。
- `node --test tests/ea-web-service-code-review.test.js`：见 §6 实际执行结果。
- 意图图谱校验（`mcp_argo_validateSystemArchitecture` / `node argo/scripts/validateSystemArchitecture.js`）：见 §6 实际执行结果。

---

## 6. 变更记录（提交后回填）

- commit id：`84c33e5`（检视报告 + 测试 + 图谱 AT-2760-04）
- 后续登记 commit：`828bc69`（在组件 2760 的 commit 属性登记 84c33e5）
- 变更文件：`docs/ea-web-service-code-review.md`、`tests/ea-web-service-code-review.test.js`、`design/KG/SystemArchitecture.json`

### 测试与校验最终结果

- 基线（检视时点，45/45 通过）：`node --test tests/ea-web-service-impl.test.js tests/ea-web-service-design.test.js tests/ea-web-service-ui-insight.test.js tests/ea-web-service.test.js` → 45 pass / 0 fail
- 检视验收测试：`node --test tests/ea-web-service-code-review.test.js` → 3 pass / 0 fail
- 意图图谱校验：`validateSystemArchitecture` → passed（`design/KG/SystemArchitecture.json`）
