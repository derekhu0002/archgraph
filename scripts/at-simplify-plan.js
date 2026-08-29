'use strict';
// Read-only plan generator: simplify the graph-mounted AT set per the user's
// principles:
//   1. keep only USER-VIEW acceptance cases (user-observable behavior);
//   2. merge cases with the SAME control point (test file) into ONE AT;
//   3. drop cases whose EXECUTION affects the host/production configs
//      (OpenClaw workspace writes, host deploys; Docker sandbox is NOT host impact).
// Outputs the per-element corrected testcases plan, applied via the ARGO MCP
// mutation tools (never edits the graph file directly).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));

const at = (name, description, file) => ({
  name,
  description,
  type: 'Acceptance Test',
  Input: file,
  acceptanceCriteria: file,
});

// Target mounted ATs: elementId -> merged user-view testcase(s).
// Elements absent from this map (but currently carrying testcases) are cleared.
const TARGET = {
  '1311': [at('AT-website-01', 'GIVEN 网站已创建并发布；WHEN 用户在浏览器打开首页；THEN 页面完整呈现项目定位与内容（导航/Hero/section），且 KGlibrary 参考库、安装部署、OpenClaw 支持、洞察报告子页等用户可见区块齐备。', 'tests/website.test.js')],
  '1321': [at('AT-readme-01', 'GIVEN README 已维护；WHEN 用户阅读 README；THEN 能看到项目定位（unified language/one model/single view）、How to use、Install（npm install -g archgraph-argo/argo-deploy/Neo4j/vector engine）与 Supported Harnesses（OpenClaw）。', 'tests/readme.test.js')],
  '1318': [at('AT-custom-domain-01', 'GIVEN DNS 与 CNAME 已配置；WHEN 用户访问自定义域名；THEN 返回与 GitHub Pages 相同的 ArchGraph 主页。', 'tests/custom-domain.test.js')],
  '1330': [at('AT-arch-diagram-01', 'GIVEN 架构图已绘制；WHEN 用户查看 README 与主页；THEN 全局架构图与核心模型图被引用且文件存在。', 'tests/architecture-diagram.test.js')],
  '1333': [at('AT-apl-01', 'GIVEN APL 规范已编写；WHEN 用户阅读规范文档或 HTML 正式版；THEN 文档与 HTML 均存在且包含词汇/语法/验收/持久化等关键内容。', 'tests/agent-programming-language.test.js')],
  '1352': [at('AT-wechat-article-01', 'GIVEN 公众号文章已撰写；WHEN 用户在公众号阅读；THEN 文章 Markdown 就绪（frontmatter title/author/digest + 主题封面），可进入发布流程。', 'tests/wechat-article.test.js')],
  '1354': [at('AT-aml-01', 'GIVEN AML 规范已制定；WHEN 用户阅读规范并查看图谱；THEN 规范文档声明 v0.1 与 ArchiMate 3.2 扩展，且图谱已建模 AML 规范 Contract。', 'tests/aml-standard.test.js')],
  '1353': [at('AT-project-name-01', 'GIVEN 项目已改名 ArchGraph；WHEN 用户浏览 README/主页/文档；THEN 品牌名统一为 ArchGraph 且不含旧名。', 'tests/project-name.test.js')],
  'archgraph-workflow-rules': [at('AT-rules-01', 'GIVEN ARGO 工作流规则已维护；WHEN Agent 阅读规则文件；THEN 规则文档登记 KG-first/语义优先检索与查询接口，Agent 可据此正确检索图谱。', 'tests/argo-rules-query.test.js')],
  'memory-eval-dataset-wp-001': [at('AT-eval-seed-01', 'GIVEN 评测集 SEED 已归档；WHEN 用户/评测 harness 加载；THEN SEED 结构有效（schema/版本/维度×题数），ground-truth 目标均在图谱中存在，harness 统一消费。', 'tests/eval-seed.test.js')],
  'subgraph-semantic-retrieval-001': [at('AT-subgraph-semantic-01', 'GIVEN getSystemArchitecture 支持 scope 子图语义检索；WHEN 用户以视图/元素作用域查询；THEN 返回被限定在作用域内的语义结果，未知作用域明确失败。', 'tests/argo-semantic-scope.test.js')],
  'self-evolution-sandbox-wp-001': [at('AT-sandbox-01', 'GIVEN Docker 隔离沙箱框架已构建；WHEN 用户运行沙箱框架检查；THEN 沙箱环境文件齐备、不发布、支持 Level B/C/D/E 能力（Docker 运行不修改宿主配置）。', 'tests/sandbox-framework.test.js')],
};

// Elements to keep UNCHANGED (already user-view, one-per-control-point).
const PRESERVE = new Set(['acceptance-guardian-001']);

const plan = [];
let cleared = 0;
let replaced = 0;
let preserved = 0;

for (const el of graph.elements || []) {
  if (!Array.isArray(el.testcases) || el.testcases.length === 0) continue;
  if (PRESERVE.has(el.id)) {
    preserved += 1;
    plan.push({ elementId: el.id, name: el.name, type: el.type, testcases: el.testcases });
    continue;
  }
  if (TARGET[el.id]) {
    replaced += 1;
    plan.push({ elementId: el.id, name: el.name, type: el.type, testcases: TARGET[el.id] });
  } else {
    cleared += 1;
    plan.push({ elementId: el.id, name: el.name, type: el.type, testcases: [] });
  }
}

const report = { summary: { cleared, replaced, preserved, planElements: plan.length }, elements: plan };
fs.writeFileSync(path.join(__dirname, 'at-simplify-plan.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`cleared=${cleared} replaced=${replaced} preserved=${preserved} planElements=${plan.length}`);
