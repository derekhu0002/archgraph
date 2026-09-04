# ArchGraph 图谱挂载验收用例清单

> 本清单介绍意图图谱（`design/KG/SystemArchitecture.json`）中**当前挂载**的全部验收用例（22 个 / 13 个元素）。
> 每个用例给出：**控制点**（用例驱动/控制的输入面——测试文件与被检验主题）与**观察点**（用户可观察的断言输出面）。
>
> 精简原则（2026-08-29 确立）：
> 1. 只保留**用户视角**验收用例；
> 2. **控制点相同、仅观测点不同**的用例合并为一个；
> 3. 用例执行**不得影响生产环境/宿主配置**（跑 Docker 不算影响宿主）。
>
> 执行方式：`acceptanceCriteria` 均为裸 workspace-relative 测试文件路径，可由
> `runArchitectureTests`（ARGO MCP 工具）或 `node --test` 直接执行。

## 分组 A — ARGO MCP 接口看护（10 个）

挂载元素：`acceptance-guardian-001`「验收看护服务」（Application Service）

| 用例 | 控制点 | 观察点 |
|---|---|---|
| **AT-acceptance-guardian-01**<br>`tests/acceptance-guardian.test.js` | 验收看护注册表驱动：全量功能覆盖检查 | 每个 MCP 接口与框架交付件都有可执行功能测试；图谱挂载 AT 均为裸可执行路径；`runArchitectureTests` 执行器可处理裸路径、拒绝描述性句子 |
| **AT-acceptance-guardian-02**<br>`tests/mcp-interface-behavior.test.js` | `getIntentElementContext` 接口：进程内真实调用稳定元素 / 未知元素 | 稳定元素返回焦点语义子图（含 `subgraph`/`boundary`）；未知元素明确失败 |
| **AT-acceptance-guardian-03**<br>`tests/argo-mcp-tools.test.js` | `getSystemArchitecture` 工具面契约：无 query / 非法 purpose / `tools/list` | 无 query→`QUERY_REQUIRED`；`graph-tidy` 与旧内部类别→`QUERY_PURPOSE_INVALID`；保留工具仍在 `tools/list` |
| **AT-acceptance-guardian-04**<br>`tests/neo4j-cypher-query.test.js` | `queryNeo4jGraph` 只读 Cypher：schema 模式 / 写查询 / 空查询 / 脏投影 | schema 模式返回投影 schema；写查询被拒；空查询被拒；脏投影触发恢复 |
| **AT-acceptance-guardian-05**<br>`tests/semantic-memory-search.test.js` | `memory_search` 语义记忆检索：工具注册 / 无 query / 结果形态 | 注册于工具列表；返回紧凑摘要卡片（`max_desc_len` 默认 800）；无 query 明确失败；符合 MCP `content` 数组契约 |
| **AT-acceptance-guardian-06**<br>`tests/argo-init-interface.test.js` | `argo-init` SKILL 功能：skill 如何驱动确定性初始化 | 通过 `initializeWorkspace` MCP 接口驱动初始化；不执行 WORKSPACE 外脚本；`buildHarnessReport` 供进程内复用 |
| **AT-acceptance-guardian-07**<br>`tests/argo-rules-query.test.js` | RULE 交付件：规则文档行为语义 | 规则保持 KG-first / 语义优先检索等既定功能语义 |
| **AT-acceptance-guardian-08**<br>`tests/architecture-view-context.test.js` | `getArchitectureViewContext`：已知 / 未知 / 含子视图 / 可选 EA 几何场景 | 返回视图完整成员；未知视图明确失败；子视图可按需展开；显式 `includeEaGeometry=true` 时返回按 schema id 对齐的 `geometry`（元素 rect + 连线路径），缺 EA 模型/图时 `present=false` 不报错；默认不开启则不触碰 EA、不返回 `geometry` |
| **AT-acceptance-guardian-09**<br>`tests/ea-web-service-impl.test.js` | ARGO MCP 写接口族：add/update/remove + preview/apply + undo/redo | 写入生效；undo/redo 回退到真实文件状态；embedding 生命周期一致 |
| **AT-acceptance-guardian-10**<br>`tests/argo-global-install.test.js` | 仓库外全局安装 + `validateSystemArchitecture` 校验器 | `tools/list` 暴露核心工具；`getSystemArchitecture` 无 query→`QUERY_REQUIRED`；校验通过 |

## 分组 B — 用户面交付件（12 个）

| 用例 | 挂载元素 | 控制点 | 观察点 |
|---|---|---|---|
| **AT-website-01**<br>`tests/website.test.js` | 1311 创建网站（WP） | 解析 `index.html` 各用户可见区块 | 首页呈现导航 / Hero / section；KGlibrary 参考库、安装部署、OpenClaw 支持、洞察子页齐备 |
| **AT-custom-domain-01**<br>`tests/custom-domain.test.js` | 1318 网站（Application Component） | CNAME 文件 + DNS A 解析 | 自定义域名返回与 GitHub Pages 相同的 ArchGraph 主页 |
| **AT-readme-01**<br>`tests/readme.test.js` | 1321 更新 README（WP） | 解析 README 章节内容 | 用户可见项目定位、How to use、Install（含命令与 Neo4j/向量依赖）、Supported Harnesses（OpenClaw） |
| **AT-arch-diagram-01**<br>`tests/architecture-diagram.test.js` | 1330 全局架构图（WP） | README / 主页中的图引用 | 全局架构图与核心模型图被引用且文件存在 |
| **AT-apl-01**<br>`tests/agent-programming-language.test.js` | 1333 APL 规范（WP） | 规范 Markdown 与 HTML 正式版 | 文档与 HTML 均存在且含词汇 / 语法 / 验收 / 持久化等关键内容 |
| **AT-wechat-article-01**<br>`tests/wechat-article.test.js` | 1352 公众号文章（WP） | 文章 Markdown frontmatter 与主题封面 | 文章就绪（title / author / digest + 封面）可进入发布流程 |
| **AT-project-name-01**<br>`tests/project-name.test.js` | 1353 改名 ArchGraph（WP） | README / 主页 / 文档品牌名 | 品牌名统一为 ArchGraph 且不含旧名 |
| **AT-aml-01**<br>`tests/aml-standard.test.js` | 1354 AML 规范（Contract） | 规范文档 + 图谱建模 | 文档声明 v0.1 与 ArchiMate 3.2 扩展；图谱已建模 AML 规范 Contract |
| **AT-rules-01**<br>`tests/argo-rules-query.test.js` | archgraph-workflow-rules（Rule） | 规则文件内容 | 规则登记 KG-first / 语义优先检索与查询接口，Agent 可据此正确检索图谱 |
| **AT-eval-seed-01**<br>`tests/eval-seed.test.js` | memory-eval-dataset-wp-001（WP） | 加载评测集 SEED | SEED 结构有效（schema / 版本 / 维度×题数）；ground-truth 目标在图谱中存在；harness 统一消费 |
| **AT-subgraph-semantic-01**<br>`tests/argo-semantic-scope.test.js` | subgraph-semantic-retrieval-001（Application Service） | `getSystemArchitecture` scope 子图语义查询 | 返回被限定在作用域内的语义结果；未知作用域明确失败 |
| **AT-sandbox-01**<br>`tests/sandbox-framework.test.js` | self-evolution-sandbox-wp-001（WP） | 运行沙箱框架检查 | 沙箱环境文件齐备、不发布、支持 Level B/C/D/E 能力（Docker 运行不修改宿主配置） |

## 统计

| 项 | 值 |
|---|---|
| 挂载 AT 总数 | 22 |
| 挂载元素数 | 13 |
| 分组 A：MCP 接口看护 | 10 |
| 分组 B：用户面交付件 | 12 |
| 可执行（裸路径） | 22 / 22 |
| 执行入口 | `runArchitectureTests` / `node --test tests/<file>` |

> 说明：分组 B 中同一测试文件被多个历史用例引用时，已按「控制点相同合并」原则收敛为每个控制点一个用例（如 `tests/website.test.js` 承载网站全部用户可见区块）。
