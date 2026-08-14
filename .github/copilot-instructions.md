<Principle>
当你领取到某个Workpackage后，进行任何开发活动前，必须先完成自我武装，从该Workpackage关联的元素中，找到完成任务需要使用的SKILL、需要遵守的全局规则。
1. 对于需要的SKILL，请在.github/skills下创建一个或多个[SKILL名称]/SKILL.md;
2. 对于要遵守的全局规则，需要在.github下面增加一个或多个 *.instructions.md文件。
</Principle>

<Principle>
1. 在动手修改仓库任何内容前，你必须先在架构图谱中找到对应的架构元素。
2. 如果没有找到对应的架构元素，你必须先选择一个View，并在其中创建一个新的合理的架构元素。
3. 如果没有找到对应的View，你必须先思考应该选择哪个Viewpoint最合理，并基于这个最合理的Viewpoint创建一个新的View。
4. 如果你在动手修改前有任何逻辑不完整的地方，首先从意图架构图谱中寻找答案，无法找到时必须询问人类伙伴，不能直接在仓库中进行修改。
5. 仓库内容修改完成后，必须将改动的内容git commit提交留证，并将提交"commit id + 相关的文件路径"登记到图谱中对应的架构元素中，有必要时刷新已有描述或属性（必要时才新增属性，以最大程度保持内容紧凑）。
</Principle>

<Principle>
1. 修改任何内容前，必须首先确认该修改可能影响的架构元素的验收用例，对于评估受影响的用例，首先评估是否需要修改该用例本身，如果需要则先修改该用例。
2. 对于所有评估受影响的用例（包括修改后的用例），必须在修改完成后进行这些用例的回归测试，确保这些用例全部通过。
3. 如果发现本次修改和知识图谱中任何验收用例都无关，则说明知识图谱中验收用例缺失，需要首先补充后再实施修改。
4. 知识架构图谱中的每个验收用例必须是对该用例所挂载的元素，从外部的角度进行验证的，不能是对该元素内部实现的验证。
5. 知识图谱中所有的验收用例必须是可执行的，不能是仅仅描述性的，如果你发现知识图谱中某个验收用例无法执行，必须立即补充或修改该用例。
6. 知识图谱中所有的验收用例必须采用GIVEN-WHEN-THEN的格式进行描述和实现，以便于人类阅读同时可以自动化执行。
</Principle>

<instruction>
你必须通过ARGO MCP server提供的工具来进行意图架构的读写操作，禁止直接修改意图架构的源文件：
1. getIntentElementContext: 用于获取意图架构元素的上下文信息，包括元素的属性、关联关系等。
2. previewSystemArchitectureMutation: 用于预览意图架构的变更，确保变更不会破坏现有的架构结构。
3. applySystemArchitectureMutation: 用于应用意图架构的变更，将预览的变更正式写入意图架构中。
4. addArchitectureElement: 用于在意图架构中添加新的架构元素。
5. updateArchitectureElement: 用于更新意图架构中已有的架构元素的属性或关联关系。
6. removeArchitectureElement: 用于从意图架构中移除已有的架构元素。
7. addArchitectureRelationship: 用于在意图架构中添加新的架构元素之间的关联关系。
8. updateArchitectureRelationship: 用于更新意图架构中已有的架构元素之间的关联关系。
9. removeArchitectureRelationship: 用于从意图架构中移除已有的架构元素之间的关联关系。
10. addArchitectureView: 用于在意图架构中添加新的架构视图。
11. updateArchitectureView: 用于更新意图架构中已有的架构视图的属性或关联关系。
12. removeArchitectureView: 用于从意图架构中移除已有的架构视图。
13. validateSystemArchitecture: 用于验证意图架构的完整性和一致性，确保架构元素和关联关系符合预期。
</instruction>