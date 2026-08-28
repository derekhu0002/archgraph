'use strict';
/**
 * ArchGraph 导航能力评测 harness
 *
 * 依据 docs/navigation-eval-dataset.md 的 20 题（NV-01..20，4 维度：定位/可达/
 * 视角切换/边界内导航），逐题通过 ARGO MCP 读路径（queryNeo4jGraph /
 * getArchitectureViewContext / getIntentElementContext / getSystemArchitecture）
 * 在意图图上「导航」并对照 ground truth 判定 PASS/FAIL，输出按 4 维度/整体的
 * 准确率与平均时延，写入 results/navigation-eval-report.json。
 *
 * 设计要点（与 memory-eval-run.js 同源）：
 *  - 全部使用 JSON 读取工具，判定为确定性字符串/结构检查（含边界=恰好成员集）。
 *  - pick 机制：下一步检索参数可由上一步结果动态派生（真实多跳导航）。
 *  - 导航不是问答：每题 THEN 是「到达图谱中哪个 id/名称」，不含事实答案。
 *
 * 用法：
 *   node scripts/navigation-eval-run.js            # 打印表格 + 写报告
 *   node scripts/navigation-eval-run.js --json     # 机器可读汇总（测试用）
 */
const path = require('node:path');
const fs = require('node:fs');
const { callTool } = require('../argo/scripts/argo-mcp-server.js');

const ROOT = path.resolve(__dirname, '..');
process.env.ARGO_REPO_ROOT = process.env.ARGO_REPO_ROOT || ROOT;

const RESULTS_DIR = path.join(ROOT, 'results');
const REPORT_PATH = path.join(RESULTS_DIR, 'navigation-eval-report.json');

// Questions and dimensions come from the canonical evaluation SEED
// (data/eval-seeds/navigation-seed.json) — the single source of truth for the
// navigation dataset; add/edit a question in the SEED and bump its version.
const { questions: QUESTIONS, DIMENSIONS } = require('./eval-seed.js');

// 序列化检索结果（剔除 raw_json 噪音）
function serialize(result) {
  return JSON.stringify(result, (key, value) => (key === 'raw_json' ? undefined : value));
}

// 解析 pick 引用：从更早步骤的检索结果（parsed JSON）中派生本步参数值。
function resolveArg(value, texts) {
  if (value && typeof value === 'object' && value.pick) {
    const pick = value.pick;
    let parsed = null;
    try { parsed = JSON.parse(texts[pick.step] || 'null'); } catch (_) { /* null */ }
    if (!parsed) return undefined;
    if (pick.path) {
      let node = parsed;
      for (const seg of pick.path.split('.')) {
        if (node == null) return undefined;
        node = node[seg];
      }
      return node;
    }
    if (pick.find) {
      const arr = (parsed.subgraph && parsed.subgraph.elements) || parsed.elements || [];
      const el = arr.find(e => e[pick.find.by || 'id'] === pick.find.id);
      return el ? el[pick.get] : undefined;
    }
  }
  return value;
}

function resolveArgs(args, texts) {
  if (!args) return args;
  const out = {};
  for (const [key, value] of Object.entries(args)) out[key] = resolveArg(value, texts);
  return out;
}

function checkRequirement(text, requirement) {
  const s = String(text || '');
  if (requirement.type === 'contains') {
    return requirement.values.every(v => s.includes(String(v)));
  }
  if (requirement.type === 'expectAbsent') {
    return requirement.values.every(v => !s.includes(String(v)));
  }
  return false;
}

async function evaluateQuestion(question) {
  const texts = [];
  let error = null;
  const t0 = Date.now();
  try {
    for (const retrieval of question.retrieval) {
      const args = resolveArgs(retrieval.args, texts);
      const result = await callTool(retrieval.tool, args || {}, null, undefined);
      // getSystemArchitecture returns a toolResult wrapper; unwrap content[0].text
      let payload = result;
      if (result && result.content && Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === 'string') {
        try { payload = JSON.parse(result.content[0].text); } catch (_) { payload = result; }
      }
      // scope='members': serialize only the view membership (elements) so
      // boundary checks (contains/expectAbsent) apply to the actual members
      // and are not polluted by parent-context fields like subdiagram_views.
      if (retrieval.scope === 'members' && payload && Array.isArray(payload.elements)) {
        payload = { elements: payload.elements };
      }
      texts.push(serialize(payload));
    }
  } catch (e) {
    error = String((e && e.message) || e);
  }
  const latencyMs = Date.now() - t0;

  if (error) {
    return { ...question, pass: false, reason: `TOOL_ERROR: ${error}`, latencyMs };
  }

  const failures = [];
  for (const requirement of question.requirements) {
    if (!checkRequirement(texts[requirement.step] || '', requirement)) {
      failures.push(`step ${requirement.step} ${requirement.type} missing ${JSON.stringify(requirement.values)}`);
    }
  }
  return {
    ...question,
    pass: failures.length === 0,
    reason: failures.length ? failures.join('; ') : 'PASS',
    latencyMs,
  };
}

async function main() {
  const results = [];
  for (const question of QUESTIONS) {
    const r = await evaluateQuestion(question);
    results.push(r);
    console.log(`[nav] ${r.id} (${r.dimension}) ${r.pass ? 'PASS' : 'FAIL'} ${r.latencyMs}ms ${r.pass ? '' : ':: ' + r.reason}`);
  }

  const byDimension = {};
  for (const dim of DIMENSIONS) {
    const items = results.filter(r => r.dimension === dim);
    byDimension[dim] = {
      correct: items.filter(r => r.pass).length,
      total: items.length,
    };
  }
  const overall = {
    correct: results.filter(r => r.pass).length,
    total: results.length,
  };
  const avgLatencyMs = Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / results.length);

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: 'ArchGraph navigation-capability eval (NV-01..20)',
    overall,
    avgLatencyMs,
    byDimension,
    perQuestion: results.map(r => ({ id: r.id, dimension: r.dimension, pass: r.pass, latencyMs: r.latencyMs, reason: r.reason })),
  };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const dimLine = DIMENSIONS.map(d => {
    const v = byDimension[d];
    return `${d} ${v.correct}/${v.total}`;
  }).join('  ');
  console.log(`\n[nav] OVERALL ${overall.correct}/${overall.total}  avg ${avgLatencyMs}ms`);
  console.log(`[nav] ${dimLine}`);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ overall, avgLatencyMs, byDimension }));
  }
  return overall.correct === overall.total ? 0 : 1;
}

if (require.main === module) {
  main().then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { QUESTIONS, evaluateQuestion, checkRequirement, main };
