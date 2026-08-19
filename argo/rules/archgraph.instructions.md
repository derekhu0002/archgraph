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
1. `Business Actor` 的会话进程由宿主系统（当前运行模型的运行环境）在会话开始时创建，并由系统分配一个全局唯一的 `sessionId`。`sessionId` 是系统分配的真实标识，模型**禁止自行生成、编造或随机产生** `sessionId`。
2. 当你要调用某个 `Business Actor` 时，先读取当前会话系统分配的真实 `sessionId`（优先从宿主环境变量或系统接口读取，例如 `SESSION_ID`、`OPENCODE_SESSION_ID` 等，以当前宿主工具实际暴露的名称为准），再据此在历史会话进程中查找：已存在则直接复用该会话进程；不存在则新建该 `Business Actor`，并将系统分配的真实 `sessionId` 登记到其 `sessionId` 属性。若当前宿主未暴露真实 `sessionId`，则不得伪造随机值，应将该属性标记为未知，并在描述中说明该值需由系统提供。
3. 每个 `Business Actor` 要形成自己的长期记忆，该长期记忆是挂载在该 `Business Actor` 元素下的一个或多个View，包含了该 `Business Actor` 的所有历史工作信息。
4. 每个 `Business Actor` 的 `sessionId` 必须来自系统分配的真实值且全局唯一，不能与其他 `Business Actor` 的 `sessionId` 冲突；任何由模型自行生成的 ID 一律视为无效。
</OrganizationGuideline>

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
