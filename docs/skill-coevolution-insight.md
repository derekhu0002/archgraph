# SKILL 内化与个性化优化 — 洞察材料（公众号论据底稿）

> 角色：规划专家（tanwen，Business Actor 2737，Business Role 2736「规划专家」）
> 用途：作为公众号推广文章（主题：AI Agent 的 SKILL 不应照搬、而应内化与个性化优化、AGENT 与人类共同进化）的论据底稿
> 定位：业界证据汇总 + ArchGraph 做法对照，供撰稿人直接引用

## 0. 核心观点（大白话）

最近 AI 圈子里，人人都在往 Agent 里堆 SKILL——也就是那些教 Agent 怎么干活的技能文件。到处是现成的 skill 包、skill 模板、skill 市场，仿佛往配置里一放，Agent 就自动会了。可 SKILL 这东西，跟人的技能是一个道理：人在一家公司练出来的手艺，换一家公司照样水土不服。带团队的经验、对客户的理解、公司内部那些说不出口的潜规则，都嵌在你这个人身上，而不是写在一张纸上。SKILL 也一样——它是"你（Agent + 环境）"的一部分。一个 SKILL 被真正用起来，从来不是照搬，而是**内化 + 结合自身情况不断优化**的过程。抄来的 skill，顶多是个起点；能不能长在 Agent 身上，看的是后面那一轮一轮的打磨。

## 1. 业界证据

### 1.1 Anthropic：官方 skill 设计就是"按需加载"

Anthropic 官方 Agent Skills 的关键机制是 progressive disclosure（渐进披露）——启动时只预载 name/description 元数据（约 100 tokens），Agent 判断这个话题跟自己有关，才去读 SKILL.md 全文，再按需读引用的文件。官方原话：skills let Claude load information only as needed（让 Claude 只在需要时才加载信息）。

> 来源：Anthropic — Equipping agents for the real world with agent skills
> https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

官方开发指南还专门建议 "Iterate with Claude"：把跑成功的做法和踩过的常见错误，沉淀回 skill 文件本身；跑偏了，就让 Agent 自己回来读一读、自我审视。官方从一开始就没把 skill 当"一次性写好的静态文档"，而是当"要在一轮轮使用里长出来的东西"。

### 1.2 Anthropic：上下文是稀缺资源（context 工程）

Anthropic 的上下文工程文章讲得更直白：上下文窗口是注意力预算（attention budget），是有限资源。你往里塞的每一条信息，都在挤占其他信息的注意力。解法是 just-in-time 动态加载、渐进披露，还有 note-taking 记忆——把记忆放在上下文之外，需要时再拉回来。这套思路跟"把 skill 全文常驻上下文"是直接冲突的。

> 来源：Anthropic — Effective context engineering for AI agents
> https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

### 1.3 Chroma：长上下文本身就在掉智商（context rot）

Chroma 2025 年的研究更扎心：他们测了 18 个前沿模型，全部随输入长度增长而退化——输入越长，表现越差。这就是所谓 context rot（上下文腐烂）。长上下文不是免费的，塞得越满，越接近腐烂。

> 来源：Chroma — Context rot
> https://research.trychroma.com/context-rot

### 1.4 Skill Graphs：教得越多，Agent 越笨

linas 的 Skill Graphs 标题就是 "Your AI agent gets dumber the more you teach it"（你越教，你的 AI Agent 越笨）。把一个大 skill 文件整段加载进上下文，等于拿广度换盲目——什么都看了，什么都没看清。解法是把知识拆成小型、可组合的文件网络，干活时按需拉 2-3 个相关的节点。原文金句："Most knowledge stays on disk. Only what matters enters the context window."（大多数知识留在磁盘上，只有真正要紧的才进上下文窗口。）

> 来源：Skill Graphs — linas
> https://linas.substack.com/p/skill-graphs

### 1.5 AutoSkill：把转瞬即逝的经验变成能力

AutoSkill（arXiv 2603.01145）说的正是"内化"这件事：LLM Agent 常常无法跨会话积累个性化能力——今天刚学会的招，明天换个会话又不会了。AutoSkill 的思路是从交互经验里自动提炼 skill、维护、复用，支持持续自我进化，把转瞬即逝的经验变成显式可复用的能力。能力不是写进去的，是用出来的、然后被沉淀下来的。

> 来源：AutoSkill — arXiv:2603.01145
> https://arxiv.org/abs/2603.01145

### 1.6 From History to State：字面意义上的"内化"

From History to State（arXiv 2605.05413）把"内化"做到了字面上：与其反复用长长的 skill prompt 去教，不如把可复用的程序性上下文"内化"进轻量模块权重里，prompt token 减少 2-7 倍。教的内容没有消失，只是从"每次都要念一遍的台词"变成了"长在模型里的本能"。这就是内化和照搬最本质的区别：照搬是每次重新念，内化是长在身上。

> 来源：From History to State — arXiv:2605.05413
> https://arxiv.org/abs/2605.05413

### 1.7 Hermes Agent：边用边学、跨会话记得

Nous Research 的 Hermes Agent 内置了学习回路，官方描述是 "creates skills from experience, improves them during use, and remembers across sessions"（从经验里创建 skill，在使用中改进，跨会话记住）。注意这个顺序：创建 → 使用中改进 → 跨会话记住。它不是一锤子买卖，而是一个持续的循环；而且它强调加深对"你是谁"的建模——skill 跟身份绑定，不是通用的说明书。

> 来源：Nous Research — Hermes Agent
> https://hermes-agent.nousresearch.com/docs/

### 1.8 反面现象：skill 越大越蠢

反面的现象现在也有名字了：skill pollution（技能污染，微软 DevBlogs 用语）——skill 堆得越多、越大，效果反而越差。context rot 在 MindStudio 的文章里被直接叫成 "When Bigger Skill Files Make Smarter Agents Dumber"（更大的 skill 文件让更聪明的 Agent 变笨），机制是注意力稀释、lost-in-the-middle、token 预算被压缩。savestate.dev 那篇标题更直接：context rot 正在杀死你的 AI Agent。

> 来源：MindStudio — When Bigger Skill Files Make Smarter Agents Dumber
> https://www.mindstudio.ai/blog/context-rot-claude-code-skills-bloated-files
> 来源：savestate.dev — Context rot is killing your AI agent
> https://savestate.dev/blog/context-rot-killing-your-ai-agent

## 2. ArchGraph 的做法，跟上面的共识是同构的

把这些证据放一起，会发现业界的方向惊人一致：渐进披露（只加载需要的）、内化（从使用中长出来）、用中迭代（边用边改、跑偏自省）。而 ArchGraph 的做法，正好踩在同一个点上，只不过把"技能"和"工作"挂到了一起：

- **技能挂载到图谱的工作项上，而不是塞进上下文。** skill 平时躺在图谱里，不占 Agent 的注意力预算——对应渐进披露和"知识留在磁盘上"。
- **Agent 干活时按需"参考"该技能。** 做相关工作才拉起来看，对应 just-in-time 加载。
- **失败 → 总结 → 刷新技能。** 干砸了、踩坑了，把教训写回技能本身，对应 Iterate with Claude 和 Hermes 的使用中改进。
- **导出技能时，把踩过的坑也带走。** 经验跟着技能走，换环境、换 Agent 也不丢，对应"跨会话记住"和可复用能力。

一句话：别人是"渐进披露 + 内化 + 用中迭代"，ArchGraph 把"参考式挂载 + 经验回流 + 带坑导出"做成了一个闭环。skill 在 ArchGraph 里不是一份照搬来的文档，而是一个会跟着 Agent 一起长大的活物——这也正是"AGENT 与人类共同进化"最具体的落脚点。
