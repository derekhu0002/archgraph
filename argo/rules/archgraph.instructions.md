---
description: "ArchGraph / ARGO 全局工作流规则：动手前先在意图图谱定位架构元素、验收用例先行（可执行 GIVEN-WHEN-THEN）、通过全局 ARGO MCP 读写意图图谱、提交后登记 commit id + 文件路径。Use when working on any ArchGraph repository or with the ARGO MCP toolchain."
name: "ArchGraph ARGO Workflow Rules"
applyTo: "**"
---

<Ontology>
你的认知体系结构是基于Archimate3.2及其扩展元素构成。以下参考文件位于全局 Argo 安装根目录 ~/.argo（~ 为用户主目录，Windows 上即 %USERPROFILE%\.argo）：
1. 如果你想知道知识图谱的合法结构，请参考：~/.argo/schema/SystemArchitecture.schema.json
2. 如果你想查询某类元素或关系的定义，请参考：~/.argo/schema/archimate3.2.md
</Ontology>

<ArmingBeforeImplementation>
当你准备动手建设某个元素，你需要先查看构建这个元素所需的技能和资源，并将这些技能和资源放入你的会话记忆中，以便在动手建设时可以随时调用。
</ArmingBeforeImplementation>

<IntentArchitectureFirst>
1. 在动手修改仓库任何内容前，你必须先在架构图谱中找到对应的架构元素。
2. 如果没有找到对应的架构元素，你必须先选择一个View，并在其中创建一个新的合理的架构元素。
3. 如果没有找到对应的View，你必须先思考应该选择哪个Viewpoint最合理(可参考argo\schema\archimate3.2.md中的# **C Example Viewpoints** 章节)，并基于这个最合理的Viewpoint创建一个新的View。
4. 仓库内容修改完成后，必须将改动的内容git commit提交留证，并将提交"commit id + 相关的文件路径"通过增加“commit”属性登记到图谱中对应的架构元素中，有必要时刷新已有描述或属性（必要时才新增属性，以最大程度保持内容紧凑）。
</IntentArchitectureFirst>

<AcceptanceTestFirst>
1. 修改任何内容前，必须首先确认该修改可能影响的架构元素的验收用例，对于评估受影响的用例，首先评估是否需要修改该用例本身，如果需要则先修改该用例。
2. 对于所有评估受影响的用例（包括修改后的用例），必须在修改完成后进行这些用例的回归测试，确保这些用例全部通过。
3. 如果发现本次修改和知识图谱中任何验收用例都无关，则说明知识图谱中验收用例缺失，需要首先补充后再实施修改。
4. 知识架构图谱中的每个验收用例必须是对该用例所挂载的元素验证且必须从外部的角度进行的验证，不能是对该元素内部实现的验证。
5. 知识图谱中所有的验收用例必须是可执行的，不能是仅仅描述性的，如果你发现知识图谱中某个验收用例无法执行，必须立即补充或修改该用例。
6. 知识图谱中所有的验收用例必须采用GIVEN-WHEN-THEN的格式进行描述和实现，以便于人类阅读同时可以自动化执行。
</AcceptanceTestFirst>

<ExplorationGuideline>
1. 当你探索上下文时，采用小步探索的方式，每次查询的深度不要过大，每次查询后，你可以根据查询结果，决定下一步的探索方向。
2. 当你获得多个同类或相互冲突的信息时，请优先选择最接近你当前任务的上下文信息，避免在不相关的上下文中浪费时间。
</ExplorationGuideline>

<OrganizationGuideline>
1. `Business Actor` 元素本身就是持久化实体：一旦在意图图谱中创建，就持续存在，直到被显式删除。持久化载体是「图谱元素 + 其名下挂载的 View」。
2. 当你要调用某个 `Business Actor` 时，按其稳定身份标识（`name`或 `id` ，创建时登记）在意图图谱中查找：已存在则直接复用该元素，并读取其名下 View 恢复长期记忆；不存在则新建该 `Business Actor` 元素并登记一个全局唯一的 `name`。
3. 启动某个 `Business Actor` 前，先读取该元素的 `description`，把它作为该 agent 的定义（system prompt）加载进当前上下文，随即以该角色开始工作（不创建任何宿主级 agent 文件或进程）；每次收工前，必须把本次关键进展以结构化的方式回写到该 Actor 下挂的长期记忆 View中（如果没有则创建，可以下挂多个View，也可以在View中的元素下继续展开新的View，形成一个层次化的长期记忆系统），刷新长期记忆，防止长会话遗忘。
4. 每个 `Business Actor` 的长期记忆挂载在该元素名下的一个或多个 View 中，包含该 `Business Actor` 的所有历史工作信息。
5. 每个 `Business Actor` 工作时必须与其他 `Business Actor` 保持隔离，即各自使用独立的会话/工作上下文：调用某个 `Business Actor` 时，只加载其自己名下 View 的长期记忆，不得读取或写入其他 `Business Actor` 的 View，不同 `Business Actor` 的记忆与上下文不得混用。
6. 每个 `Business Actor` 的 `name` 必须全局唯一，不能与其他 `Business Actor` 的 `name` 冲突。
</OrganizationGuideline>

<SessionMemorySummarization>
每次会话结束（收工）前，必须执行一次短期记忆总结，并将总结写入长期记忆，防止跨会话遗忘：
1. 先读取短期（会话）记忆：查看 `/memories/session/` 下本次会话的记录；若为空，则依据本次会话的实际工作内容进行总结。
2. 生成结构化总结，至少包含：本次目标、已完成的关键进展、关键决策及其原因、遗留问题与待办、可复用的经验与教训。
3. 将总结写入长期记忆：
   - 若本次工作属于某个 `Business Actor` 的角色工作，按 `<OrganizationGuideline>` 写入该 Actor 名下挂载的长期记忆 View；
4. 总结必须简洁、去重：优先更新已有记忆文件，仅在必要时新建；禁止把会话中的冗余过程内容原文复制进长期记忆。
</SessionMemorySummarization>

<MemoryTriggerTiming>
除「会话结束」外，以下时机必须即时触发长期记忆写入，不得攒到会话结束：
1. 踩坑/纠错当场记：解决一个耗时问题、发现环境或平台限制（如编码坑、权限限制、命令陷阱）后，立即写入一条简短记录，说明「现象 + 原因 + 解法或规避方式」。
2. 关键决策当下记：做出影响后续走向的技术/架构决策时，立即记录「决策 + 理由 + 被否掉的备选方案」，保证理由在决策当下最清晰。
3. 任务/切片/里程碑完成时：每完成一个 feature、一个切片或一次 commit 后，立即登记「commit id + 文件路径 + 关键进展」，与 `<IntentArchitectureFirst>` 第4条呼应，不得攒到会话结束。
以上即时记录同样遵守 `<SessionMemorySummarization>` 第4条的简洁、去重要求。
</MemoryTriggerTiming>

<ToolsGuideline>
你必须通过ARGO MCP server提供的工具来进行意图架构的读写操作，禁止直接修改意图架构的源文件：
1. getSystemArchitecture: 语义化读取架构（推荐带 query.purpose + query.intent，而非全量读取）。
2. getIntentElementContext: 用于获取意图架构元素的上下文信息，包括元素的属性、关联关系等。
3. previewSystemArchitectureMutation: 用于预览意图架构的变更，确保变更不会破坏现有的架构结构。
4. applySystemArchitectureMutation: 用于应用意图架构的变更，将预览的变更正式写入意图架构中。
5. addArchitectureElement: 用于在意图架构中添加新的架构元素。
6. updateArchitectureElement: 用于更新意图架构中已有的架构元素的属性或关联关系。
7. removeArchitectureElement: 用于从意图架构中移除已有的架构元素。
8. addArchitectureRelationship: 用于在意图架构中添加新的架构元素之间的关联关系。
9. updateArchitectureRelationship: 用于更新意图架构中已有的架构元素之间的关联关系。
10. removeArchitectureRelationship: 用于从意图架构中移除已有的架构元素之间的关联关系。
11. getArchitectureViewContext: 用于查询意图架构中的架构视图及其包含的元素和关联关系。
12. addArchitectureView: 用于在意图架构中添加新的架构视图。
13. updateArchitectureView: 用于更新意图架构中已有的架构视图的属性或关联关系。
14. removeArchitectureView: 用于从意图架构中移除已有的架构视图。
15. validateSystemArchitecture: 用于验证意图架构的完整性和一致性，确保架构元素和关联关系符合预期。
</ToolsGuideline>
