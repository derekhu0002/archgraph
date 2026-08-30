# 导航评测用例：宿主视角场景描述

> 视角：**宿主 = 真实使用者**。宿主在 OpenCode 里操作运行中的 AGENT（AGENT 经 ARGO MCP 工具导航意图图）。
> 每个用例给出三要素：**宿主指令**（宿主说什么）/ **预期结果**（AGENT 应回报什么）/ **AGENT 视角可能行为**（AGENT 如何用工具到达）。
> 数据源：`data/eval-seeds/navigation-seed.json`（SEED v1.2.0，7 维度 × 28 题）。可执行检索与判定见 SEED 的 `retrieval` / `requirements`。

## 定位（NV-01..05）——宿主查某个资产在哪幅图

| 用例 | 宿主指令 | 预期结果 | AGENT 视角可能行为 |
|---|---|---|---|
| **NV-01** | 找到组织元素 AgentOrganization，报它的 id 和类型。 | `1962` / Grouping（AgentOrganization） | inspect 工具列表后，用 `argo_queryNeo4jGraph` 按 `name='AgentOrganization'` 匹配，读到 id=1962、type=Grouping，直接回报。 |
| **NV-02** | 帮我找代表项目愿景的元素——为 AGENT 提供长期记忆系统。 | `overseer-vision-001`（项目愿景） | 用 `argo_getSystemArchitecture` 语义检索（purpose=general），按「愿景/长期记忆系统」语义命中并回报 id。 |
| **NV-03** | 长期记忆评测的视图是哪个？报视图 id。 | `memory-eval-view-001` | 用 `argo_queryNeo4jGraph` 按 `view_name='长期记忆评测'` 匹配，回报 view_id。 |
| **NV-04** | 项目总管这个角色在图里是哪个元素？ | `project-overseer-001`（项目总管，Business Actor） | 用 `argo_getArchitectureViewContext(299)` 取组织视图成员，找 type=Business Actor 且名「项目总管」。 |
| **NV-05** | ArchiMate 在愿景里被定位成什么？找到对应元素。 | `overseer-archimate-role-001` | 用 `argo_getSystemArchitecture` 语义检索「ArchiMate 在长期记忆中的定位」，命中后回报 id。 |

## 可达（NV-06..10）——宿主让 AGENT 沿图走关系/父链

| 用例 | 宿主指令 | 预期结果 | AGENT 视角可能行为 |
|---|---|---|---|
| **NV-06** | 项目总管属于哪个组织？ | `1962` AgentOrganization | 用 `argo_getIntentElementContext(project-overseer-001)` 读 parent，沿父链上溯到 1962。 |
| **NV-07** | 长期记忆评测视图挂在哪个顶层分组下？ | `1249` Implementation and Migration Viewpoint | 用 `argo_getArchitectureViewContext(memory-eval-view-001)` 读 parentElement.id，回报。 |
| **NV-08** | 公众号发布团队视图是哪个？ | `433`（公众号发布团队） | 用 `argo_getIntentElementContext(1962)` 读 subdiagram_views，找 view_name 含「公众号」。 |
| **NV-09** | EA Tooling 视图在哪？ | `1800` | 先取评测视图 parent=1249，再从 1249 的 subdiagram_views 找「EA Tooling」。 |
| **NV-10** | 自进化 Docker 沙箱视图在哪？ | `self-evolution-sandbox-view-001` | 先取评测视图 parent=1249，再从 1249 子视图找沙箱视图。 |

## 视角切换（NV-11..15）——宿主按不同视角让 AGENT 换图册

| 用例 | 宿主指令 | 预期结果 | AGENT 视角可能行为 |
|---|---|---|---|
| **NV-11** | 从业务组织视角看，AgentOrganization 在哪幅图？ | 视图 `299`（AgentOrganization） | 遍历 1249 子视图，找包含元素 1962 的那幅。 |
| **NV-12** | 媒体创作体系里，视频创作团队视图是哪个？ | `video-team-001` | 用 `argo_getIntentElementContext(1962)` 读子视图，找视频创作团队。 |
| **NV-13** | EA 工具链在哪幅图？ | `1800` | 从 1249 子视图里找 view_name 含「EA」。 |
| **NV-14** | 内容发布相关在哪幅图？ | `180` Content Publication and Announcement | 用 `argo_getArchitectureViewContext(180)` 定位内容发布视图。 |
| **NV-15** | 工程验证用的 Docker 沙箱视图在哪？ | `self-evolution-sandbox-view-001` | 从 1249 子视图按「工程/验证」语义定位。 |

## 边界内导航（NV-16..20）——宿主要 AGENT 在给定边界内找全且不越界

| 用例 | 宿主指令 | 预期结果 | AGENT 视角可能行为 |
|---|---|---|---|
| **NV-16** | 长期记忆评测视图下都有哪些工作包？ | bench/dataset/run WP + navigation-eval-wp-001 | 用 `argo_getArchitectureViewContext(memory-eval-view-001)` 列全 included_elements。 |
| **NV-17** | 项目总管的工作记录里有哪些记忆元素？ | overseer-vision-001、overseer-wiki-eval-001 等（全部 overseer-*） | 用 `argo_getArchitectureViewContext(overseer-ltm-001)` 列全成员，确认都在 LTM 边界内。 |
| **NV-18** | AgentOrganization 下直属哪些团队视图？ | 430/433/media-team-001/video-team-001 | 用 `argo_getIntentElementContext(1962)` 读 subdiagram_views，且与 1249 直属视图区分。 |
| **NV-19** | 确认评测视图只含评测工作包，不含 EA Tooling 等越界元素。 | 恰含 3 个评测 WP，不含 2760/EA Tooling/video-team-001 | 取视图成员做 contains + expectAbsent 双重校验。 |
| **NV-20** | 确认 EA Tooling 视图含本地 Web 服务元素，不含记忆/评测视图。 | 含 2758/2760，不含 memory-eval-view-001/overseer-ltm-001 | 同上 contains + expectAbsent 校验。 |

## 验收用例定位（CA-01..03）——编码工作流：改前先找验收门

| 用例 | 宿主指令 | 预期结果 | AGENT 视角可能行为 |
|---|---|---|---|
| **CA-01** | 我要改工作流规则，先告诉我 archgraph-workflow-rules 的验收用例和测试文件。 | `AT-rules-01` → `tests/argo-rules-query.test.js` | 用 `argo_getIntentElementContext(archgraph-workflow-rules)` 读 testcases，报 name + acceptanceCriteria。 |
| **CA-02** | 我要动 MCP 接口，验收看护服务上挂了哪些看护用例？ | 含 `AT-acceptance-guardian-01` → `tests/acceptance-guardian.test.js` | 读 acceptance-guardian-001 的 testcases，报首例。 |
| **CA-03** | 验收看护服务一共挂了几个 MCP 接口看护用例？全列出来。 | 10 个（AT-acceptance-guardian-01..10） | 枚举 testcases 数组全部，报首尾证明全枚举。 |

## 提交登记（CR-01..02）——编码工作流：改完把账记回图

| 用例 | 宿主指令 | 预期结果 | AGENT 视角可能行为 |
|---|---|---|---|
| **CR-01** | 我改完代码了，确认 commit 已回登到 archgraph-workflow-rules，并看交付状态。 | 台账含 `f904aa2`，deliveryStatus=`delivered` | 读 attributes 里的 commit/deliveryStatus，确认登记完整。 |
| **CR-02** | 确认导航评测工作包的 commit 台账里有 SEED 归档和修复提交。 | 含 `be47829` 与 `c726508` | 读 navigation-eval-wp-001 的 commit 属性，核对两条提交。 |

## 变更影响（CI-01..03）——编码工作流：改前评估影响

| 用例 | 宿主指令 | 预期结果 | AGENT 视角可能行为 |
|---|---|---|---|
| **CI-01** | 我要改验收看护服务，先看它的交付状态。 | deliveryStatus=`delivered` | 读 acceptance-guardian-001 的 deliveryStatus，报基线。 |
| **CI-02** | 验收看护服务挂在哪个 Actor 名下？改它归谁管？ | `project-overseer-001`（项目总管） | 用 `argo_getIntentElementContext(acceptance-guardian-001)` 读 parent，回报归属 Actor。 |
| **CI-03** | 会话结束，把这次的记忆写到项目总管的哪幅子视图？ | `overseer-ltm-001`（项目总管工作记录） | 用 `argo_getIntentElementContext(project-overseer-001)` 读 subdiagram_views，找 LTM 子视图。 |

## 说明

- 本视图描述是 SEED v1.2.0 的 `hostScenarios` 字段的文档化呈现（单一事实源仍为 SEED）。
- 执行口径：直接 harness 与 AGENT 评测统一从 SEED 取题（`retrieval`/`requirements`），宿主视角描述不参与执行判定，仅供人读理解「真实使用场景」。
- 实测基线：直接 harness 28/28；完整 AGENT（OpenCode + DeepSeek + 完整 argo MCP + 真实 RULE 在场）28/28（avg ~14.8s）。
