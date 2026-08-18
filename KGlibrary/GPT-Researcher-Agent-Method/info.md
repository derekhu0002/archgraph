---
name: gpt-researcher Agent 探索方法
description: "AML model of gpt-researcher Agent behavior: single-agent GPTResearcher orchestration plus multi-agent LangGraph research workflow"
repo: https://github.com/derekhu0002/deepresearch
branch: main
commit_id: fad1372ef5f9bc01f0bd701c5610576a6c64ef90
---

Read [](file:///d%3A/Projects/archgraph/KGlibrary/GPT-Researcher-Agent-Method/gpt-researcher_Agent_探索方法.json#1-1)

Summary of `gpt-researcher_Agent_探索方法.json` (52 elements, 29 relationships, 7 views):

## 单智能体 (GPTResearcher 单智能体研究方法, parent 2011)
- Orchestrator **GPTResearcher**: choose_agent → conduct_research → write_report（含 deep_research 分支）。
- Skills: ResearchConductor / ReportGenerator / SourceCurator / ContextManager / DeepResearchSkill / BrowserManager / ImageGenerator。
- Data: 研究上下文 / 研究来源 / 报告 / 子主题。Services: LLM 提供商 / 检索器 / 文档加载器。

## 多智能体 (多智能体协作系统研究方法, LangGraph, parent 2012)
- Roles: ChiefEditorAgent / EditorAgent / ResearchAgent / WriterAgent / ReviewerAgent / ReviserAgent / FactCheckerAgent / HumanAgent / VisualizerAgent / PublisherAgent。
- Workflow: browser(initial_research) → planner(plan_research) → human(review_plan) → researcher(parallel) → writer → fact_checker → visualizer → publisher，章节草稿经 review/revise 循环。

## Views (7)
根视图 236「gpt-researcher Agent 探索方法」+ 单智能体三视图（核心组件/行为函数/数据与服务）+ 多智能体三视图（核心组件/行为函数/数据与流程）。
