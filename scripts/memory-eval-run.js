'use strict';
/**
 * ArchGraph 长期记忆评测 harness v1
 *
 * 依据 docs/memory-eval-dataset.md 的 23 题，逐题通过 ARGO MCP 读路径
 * （getArchitectureViewContext / getIntentElementContext / getSystemArchitecture）
 * 检索记忆并对照 ground truth 判定 PASS/FAIL，输出按 5 维度/整体/拒答的
 * 准确率与平均时延，写入 results/memory-eval-report.json。
 *
 * 设计要点：
 *  - 全部使用 JSON 读取工具，零 Neo4j 运行时依赖，稳健可复现。
 *  - 判定为确定性字符串/结构检查（含顺序、子视图数、拒答=不应出现）。
 *
 * 用法：
 *   node scripts/memory-eval-run.js            # 打印表格 + 写报告
 *   node scripts/memory-eval-run.js --json     # 打印机器可读汇总（测试用）
 */

const path = require('node:path');
const fs = require('node:fs');
const { callTool } = require('../argo/scripts/argo-mcp-server.js');

const ROOT = path.resolve(__dirname, '..');
process.env.ARGO_REPO_ROOT = process.env.ARGO_REPO_ROOT || ROOT;

const RESULTS_DIR = path.join(ROOT, 'results');
const REPORT_PATH = path.join(RESULTS_DIR, 'memory-eval-report.json');

const DIMENSIONS = ['信息抽取', '多会话推理', '时间推理', '知识更新', '拒答'];

/**
 * 23 题评测规格：retrieval = 一次或多次 MCP 读调用；requirements = 判定条件，
 * 每项针对某一步检索结果（step 从 0 开始）：
 *   - contains: 全部须出现
 *   - expectAbsent: 全部须不出现（拒答）
 *   - order: 须按给定顺序出现（时间推理）
 *   - childViewCount: 视图 childViews 数量须等于 value
 */
const QUESTIONS = [
  // ── 维度 1：信息抽取 ──
  {
    id: 'MQ-01', dimension: '信息抽取', label: '谁是项目总管 Business Actor？',
    retrieval: [{ tool: 'getArchitectureViewContext', args: { view_id: '299' } }],
    requirements: [{ step: 0, type: 'contains', values: ['项目总管', 'project-overseer-001'] }],
  },
  {
    id: 'MQ-02', dimension: '信息抽取', label: '项目总管长期记忆子视图 id？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'project-overseer-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['overseer-ltm-001', '项目总管工作记录'] }],
  },
  {
    id: 'MQ-03', dimension: '信息抽取', label: '愿景三要素中「目标」是什么？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['读写的极致'] }],
  },
  {
    id: 'MQ-04', dimension: '信息抽取', label: '业界公认的三大记忆基准？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'memory-eval-bench-wp-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['LongMemEval', 'LOCOMO', 'BEAM'] }],
  },
  {
    id: 'MQ-05', dimension: '信息抽取', label: '视频制作流程几个 Business Actor？',
    retrieval: [{ tool: 'getArchitectureViewContext', args: { view_id: 'video-team-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['视频制作', '视频审核', '视频制作Leader'] }],
  },
  // ── 维度 2：多会话推理 ──
  {
    id: 'MQ-06', dimension: '多会话推理', label: '愿景固化在图内哪层记忆？',
    retrieval: [{ tool: 'getArchitectureViewContext', args: { view_id: 'overseer-ltm-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['overseer-vision-001', '项目愿景'] }],
  },
  {
    id: 'MQ-07', dimension: '多会话推理', label: 'AgentOrganization 下有几类专项团队？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: '1962' } }],
    requirements: [{ step: 0, type: 'contains', values: ['DevelopmentTeam', '公众号发布团队', '媒体创作团队', '视频创作团队'] }],
  },
  {
    id: 'MQ-08', dimension: '多会话推理', label: '为什么说 ArchiMate 是手段？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-archimate-role-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['编目规则', '手段'] }],
  },
  {
    id: 'MQ-09', dimension: '多会话推理', label: '长期记忆评测已登记元素有哪些？',
    retrieval: [{ tool: 'getArchitectureViewContext', args: { view_id: 'memory-eval-view-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['memory-eval-bench-wp-001', 'memory-eval-dataset-wp-001'] }],
  },
  {
    id: 'MQ-10', dimension: '多会话推理', label: '人类角色与专项 Agent 角色各一例？',
    retrieval: [
      { tool: 'getArchitectureViewContext', args: { view_id: '299' } },
      { tool: 'getArchitectureViewContext', args: { view_id: '433' } },
    ],
    requirements: [
      { step: 0, type: 'contains', values: ['John'] },
      { step: 1, type: 'contains', values: ['公众号发布员'] },
    ],
  },
  // ── 维度 3：时间推理 ──
  {
    id: 'MQ-11', dimension: '时间推理', label: '升格为总纲 vs 概念校正哪个先？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } }],
    requirements: [{ step: 0, type: 'order', values: ['67ae3f1', 'b2324c9'] }],
  },
  {
    id: 'MQ-12', dimension: '时间推理', label: 'Actor 与愿景元素哪个先创建？',
    retrieval: [
      { tool: 'getIntentElementContext', args: { elementId: 'project-overseer-001' } },
      { tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } },
    ],
    requirements: [
      { step: 0, type: 'contains', values: ['4ae5c1a'] },
      { step: 1, type: 'contains', values: ['16cea7f'] },
    ],
  },
  {
    id: 'MQ-13', dimension: '时间推理', label: 'Terminal-Bench 与记忆评测哪个先完成？',
    retrieval: [
      { tool: 'getIntentElementContext', args: { elementId: 'tb-eval-guide-001' } },
      { tool: 'getIntentElementContext', args: { elementId: 'memory-eval-bench-wp-001' } },
    ],
    requirements: [
      { step: 0, type: 'contains', values: ['8ae5cee'] },
      { step: 1, type: 'contains', values: ['49b2366'] },
    ],
  },
  {
    id: 'MQ-14', dimension: '时间推理', label: '图书馆类比在校正之前还是之后？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } }],
    requirements: [{ step: 0, type: 'order', values: ['b2324c9', 'f3c5bb2'] }],
  },
  {
    id: 'MQ-15', dimension: '时间推理', label: '愿景描述演进 commit 顺序？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } }],
    requirements: [{ step: 0, type: 'order', values: ['16cea7f', '67ae3f1', 'b2324c9', 'f3c5bb2'] }],
  },
  // ── 维度 4：知识更新 ──
  {
    id: 'MQ-16', dimension: '知识更新', label: '愿景最新表述的关键要素？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['世界级最优秀', '手段而非目标', '图书馆'] }],
  },
  {
    id: 'MQ-17', dimension: '知识更新', label: 'view 429 当前多少子视图？',
    retrieval: [{ tool: 'getArchitectureViewContext', args: { view_id: '429', includeChildViews: true } }],
    requirements: [
      { step: 0, type: 'childViewCount', value: 14 },
      { step: 0, type: 'contains', values: ['tb-eval-view-001', 'memory-eval-view-001'] },
    ],
  },
  {
    id: 'MQ-18', dimension: '知识更新', label: '结构在愿景中的地位如何修正？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['手段而非目标'] }],
  },
  {
    id: 'MQ-19', dimension: '知识更新', label: '总纲是哪次 commit 加入？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['67ae3f1'] }],
  },
  {
    id: 'MQ-20', dimension: '知识更新', label: '愿景最新描述以哪个 commit 为准？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } }],
    requirements: [{ step: 0, type: 'contains', values: ['f3c5bb2'] }],
  },
  // ── 维度 5：拒答 ──
  {
    id: 'MQ-21', dimension: '拒答', label: '图谱是否记录 XYZ 长期记忆系统？',
    retrieval: [{ tool: 'getArchitectureViewContext', args: { view_id: '299' } }],
    requirements: [{ step: 0, type: 'expectAbsent', values: ['XYZ 长期记忆系统'] }],
  },
  {
    id: 'MQ-22', dimension: '拒答', label: '主管 LTM 是否有 2026-07-01 细节？',
    retrieval: [{ tool: 'getArchitectureViewContext', args: { view_id: 'overseer-ltm-001' } }],
    requirements: [{ step: 0, type: 'expectAbsent', values: ['2026-07-01'] }],
  },
  {
    id: 'MQ-23', dimension: '拒答', label: '愿景元素是否有无关配色信息？',
    retrieval: [{ tool: 'getIntentElementContext', args: { elementId: 'overseer-vision-001' } }],
    requirements: [{ step: 0, type: 'expectAbsent', values: ['配色', '界面偏好'] }],
  },
];

// 序列化检索结果（剔除 raw_json 噪音）
function serialize(result) {
  return JSON.stringify(result, (key, value) => (key === 'raw_json' ? undefined : value));
}

async function evaluateQuestion(question) {
  const texts = [];
  let error = null;
  const t0 = Date.now();
  try {
    for (const retrieval of question.retrieval) {
      const result = await callTool(retrieval.tool, retrieval.args || {}, null, undefined);
      texts.push(serialize(result));
    }
  } catch (e) {
    error = String((e && e.message) || e);
  }
  const latencyMs = Date.now() - t0;

  if (error) {
    return { ...question, pass: false, reason: `TOOL_ERROR: ${error}`, latencyMs, texts };
  }

  const failures = [];
  for (const requirement of question.requirements) {
    const text = texts[requirement.step] || '';
    if (requirement.type === 'contains') {
      const missing = requirement.values.filter(value => !text.includes(value));
      if (missing.length) failures.push(`step${requirement.step} 缺少 ${missing.join(',')}`);
    } else if (requirement.type === 'expectAbsent') {
      const found = requirement.values.filter(value => text.includes(value));
      if (found.length) failures.push(`step${requirement.step} 意外出现 ${found.join(',')}`);
    } else if (requirement.type === 'order') {
      const indices = requirement.values.map(value => text.indexOf(value));
      const absent = requirement.values.filter((value, i) => indices[i] < 0);
      if (absent.length) failures.push(`step${requirement.step} 缺 ${absent.join(',')}`);
      else if (indices.some((value, i) => i > 0 && indices[i - 1] > value)) failures.push('顺序错误');
    } else if (requirement.type === 'childViewCount') {
      let count = -1;
      try {
        const parsed = JSON.parse(text);
        count = (parsed.childViews || []).length;
      } catch (_) { /* keep -1 */ }
      if (count !== requirement.value) failures.push(`子视图数 ${count} != ${requirement.value}`);
    }
  }

  return {
    ...question,
    pass: failures.length === 0,
    reason: failures.length ? failures.join('; ') : 'ok',
    latencyMs,
    texts,
  };
}

function aggregate(results) {
  const dimStats = DIMENSIONS.map(dimension => {
    const items = results.filter(result => result.dimension === dimension);
    const pass = items.filter(item => item.pass).length;
    return { dimension, total: items.length, pass, accuracy: items.length ? pass / items.length : 0 };
  });
  const abstention = dimStats.find(stat => stat.dimension === '拒答') || null;
  return {
    generatedAt: new Date().toISOString(),
    totalQuestions: results.length,
    passed: results.filter(result => result.pass).length,
    failed: results.filter(result => !result.pass).length,
    overallAccuracy: results.length ? results.filter(result => result.pass).length / results.length : 0,
    dimStats,
    abstention: abstention ? { dimension: abstention.dimension, accuracy: abstention.accuracy, pass: abstention.pass, total: abstention.total } : null,
    avgLatencyMs: results.length ? results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length : 0,
  };
}

async function main() {
  const results = [];
  for (const question of QUESTIONS) {
    results.push(await evaluateQuestion(question));
  }
  const summary = aggregate(results);
  const report = {
    ...summary,
    results: results.map(({ id, dimension, label, pass, reason, latencyMs }) => ({ id, dimension, label, pass, reason, latencyMs })),
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(summary));
    return;
  }

  console.log('\nArchGraph 长期记忆评测基线 v1');
  console.log('====================================');
  for (const result of results) {
    const mark = result.pass ? '✓' : '✗';
    console.log(`${mark} ${result.id} [${result.dimension}] ${result.label} (${result.latencyMs}ms)${result.pass ? '' : `  ← ${result.reason}`}`);
  }
  console.log('------------------------------------');
  for (const stat of summary.dimStats) {
    console.log(`${stat.dimension}: ${stat.pass}/${stat.total} (${(stat.accuracy * 100).toFixed(1)}%)`);
  }
  console.log(`整体: ${summary.passed}/${summary.totalQuestions} (${(summary.overallAccuracy * 100).toFixed(1)}%)`);
  console.log(`拒答: ${summary.abstention ? summary.abstention.pass + '/' + summary.abstention.total : 'n/a'}`);
  console.log(`平均时延: ${summary.avgLatencyMs.toFixed(1)}ms`);
  console.log(`报告: ${REPORT_PATH}`);
}

module.exports = { QUESTIONS, DIMENSIONS, evaluateQuestion, aggregate, serialize, REPORT_PATH };

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
