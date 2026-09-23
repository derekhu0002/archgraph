'use strict';
/**
 * Agent search diagnosis (framework, zero-dependency).
 *
 * Turns ONE agent session into a self-contained diagnostic bundle so the user
 * can hand it back for analysis:
 *
 *   <workspace>/.argo/temp/diagnosis/<session-id>/
 *     ├─ diagnosis.md          human-readable summary (incl. heuristic hints)
 *     ├─ metrics.json          the numbers behind the summary
 *     ├─ session.ndjson        the raw host session (full tool input/output)
 *     ├─ cost-log.slice.ndjson the matching slice of the background cost log
 *     └─ manifest.json         file list + sizes + versions
 *
 * Data sources (user's choice: both):
 *   - PRIMARY:  the host session NDJSON (opencode export / run --format json),
 *     which carries every tool's full input/output + timestamps + tokens.
 *   - SUPPLEMENT: the framework cost log <workspace>/.argo/temp/agent-cost-log.ndjson.
 *
 * Usage:
 *   node agentSearchDiagnose.js --session <session.ndjson> [--session-id ID]
 *                               [--cost-log <path>] [--workspace <root>] [--out <dir>] [--json]
 *
 * Read-only except for writing the bundle dir. Never mutates the graph or repo.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BUNDLE_VERSION = 'temp2.2';
const SCHEMA_VERSION = 1;
const GRAPH_TOOLS = ['getSystemArchitecture', 'getIntentElementContext', 'getArchitectureViewContext', 'queryNeo4jGraph', 'memory_search'];
const GRAPH_WRITE_TOOLS = ['previewSystemArchitectureMutation', 'applySystemArchitectureMutation', 'addArchitectureElement', 'updateArchitectureElement', 'removeArchitectureElement', 'addArchitectureRelationship', 'updateArchitectureRelationship', 'removeArchitectureRelationship', 'addArchitectureView', 'updateArchitectureView', 'removeArchitectureView'];
const VALIDATOR_TOOLS = ['validateSystemArchitecture', 'runArchitectureTests', 'initializeWorkspace'];
const REPO_TOOLS = ['read', 'grep', 'glob', 'list', 'bash', 'webfetch', 'edit', 'write'];

function backendOf(tool) {
  const n = String(tool || '');
  const hit = (l) => l.some(t => n.includes(t));
  if (hit(GRAPH_WRITE_TOOLS)) return 'graph';
  if (hit(GRAPH_TOOLS)) return 'graph';
  if (hit(VALIDATOR_TOOLS)) return 'framework';
  if (hit(REPO_TOOLS)) return 'repo';
  return 'other';
}

function classifyQuery(tool, input) {
  const n = String(tool || '');
  if (n.includes('getSystemArchitecture') || n.includes('memory_search')) return 'semantic';
  if (n.includes('queryNeo4jGraph')) return 'structured-cypher';
  if (n.includes('getIntentElementContext') || n.includes('getArchitectureViewContext')) return 'structured-context';
  if (n.includes('read')) return 'file-read';
  if (n.includes('grep')) return 'grep';
  if (n.includes('glob') || n.includes('list')) return 'list';
  if (GRAPH_WRITE_TOOLS.some(t => n.includes(t))) return 'write';
  return 'other';
}

function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return cjk + Math.ceil((s.length - cjk) / 4);
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function signature(tool, input) {
  try { return crypto.createHash('sha1').update(String(tool) + '|' + stableStringify(input || {})).digest('hex').slice(0, 12); }
  catch (_) { return 'unknown'; }
}

function inputPreview(tool, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = input.query && (input.query.intent || input.query) || input.pattern || input.elementId || input.elementName || input.view_id || input.path || input.filePath || input.cypher || input.intent;
  const s = typeof pick === 'string' ? pick : (pick ? JSON.stringify(pick) : JSON.stringify(input));
  return String(s).slice(0, 160);
}

function eventTime(e) {
  const cands = [e.time, e.part && e.part.time, e.part && e.part.state && e.part.state.time];
  for (const t of cands) {
    if (!t) continue;
    if (typeof t === 'number') return t;
    if (typeof t.start === 'number' && typeof t.end === 'number') return t.end;
    if (typeof t.start === 'number') return t.start;
    if (typeof t.end === 'number') return t.end;
  }
  return typeof e.timestamp === 'number' ? e.timestamp : null;
}

function parseSession(text) {
  const raw = String(text || '');
  const toolCalls = [];
  const usages = [];
  let steps = 0; let tMin = null; let tMax = null; let cost = 0;
  const texts = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let e; try { e = JSON.parse(t); } catch (_) { continue; }
    const part = e.part || e;
    if (part && part.type === 'text' && part.text) texts.push(part.text);
    if (part && part.type === 'tool') {
      const tool = part.tool || part.name || (part.state && part.state.tool) || 'tool';
      const st = part.state || {};
      const tm = st.time || {};
      const out = st.output != null ? String(st.output) : '';
      toolCalls.push({
        tool, backend: backendOf(tool), queryClass: classifyQuery(tool, st.input),
        durationMs: (typeof tm.start === 'number' && typeof tm.end === 'number') ? Math.max(0, tm.end - tm.start) : null,
        ok: st.status ? st.status !== 'error' : true,
        error: st.error ? String(st.error).slice(0, 200) : null,
        signature: signature(tool, st.input), inputPreview: inputPreview(tool, st.input),
        outputBytes: out.length, outputTokens: estimateTokens(out),
        path: (st.input && (st.input.filePath || st.input.path || st.input.file)) || null,
      });
    }
    if (e.type === 'step_start') steps += 1;
    if (e.type === 'step_finish') {
      const fin = (e.part && e.part.finish) ? e.part.finish : (e.part || e);
      if (fin && typeof fin.cost === 'number') cost += fin.cost;
      const tk = fin && (fin.tokens || (fin.finish && fin.finish.tokens));
      if (tk) usages.push({ input: tk.input || 0, output: tk.output || 0, reasoning: tk.reasoning || 0, cacheRead: (tk.cache && tk.cache.read) || 0, cacheWrite: (tk.cache && tk.cache.write) || 0 });
    }
    const time = eventTime(e);
    if (time !== null) { tMin = tMin === null ? time : Math.min(tMin, time); tMax = tMax === null ? time : Math.max(tMax, time); }
  }
  const tokensIn = usages.reduce((a, u) => a + u.input, 0);
  const tokensOut = usages.reduce((a, u) => a + u.output, 0);
  const tokensReasoning = usages.reduce((a, u) => a + u.reasoning, 0);
  return { toolCalls, usages, texts, steps, cost, wallMs: (tMin !== null && tMax !== null && tMax >= tMin) ? tMax - tMin : null, tokensIn, tokensOut, tokensReasoning, tokens: tokensIn + tokensOut + tokensReasoning };
}

function countRoundTrips(toolCalls) {
  const seq = toolCalls.map(c => c.backend).filter(b => b === 'graph' || b === 'repo');
  let n = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) n += 1;
  return n;
}

function diagnose(session, opts = {}) {
  const tc = session.toolCalls;
  const byTool = {};
  const byBackend = { graph: { calls: 0, ms: 0 }, repo: { calls: 0, ms: 0 }, framework: { calls: 0, ms: 0 }, other: { calls: 0, ms: 0 } };
  const byQueryClass = {};
  const sigCount = {};
  const pathReads = {};
  let toolMs = 0; let errors = 0; let empty = 0;
  for (const c of tc) {
    const b = byBackend[c.backend] || (byBackend[c.backend] = { calls: 0, ms: 0 });
    b.calls += 1; b.ms += c.durationMs || 0;
    toolMs += c.durationMs || 0;
    const bt = byTool[c.tool] || (byTool[c.tool] = { calls: 0, ms: 0, tokens: 0, errors: 0 });
    bt.calls += 1; bt.ms += c.durationMs || 0; bt.tokens += c.outputTokens || 0;
    if (c.ok === false) { bt.errors += 1; errors += 1; }
    if ((c.outputBytes || 0) < 2) empty += 1;
    byQueryClass[c.queryClass] = (byQueryClass[c.queryClass] || 0) + 1;
    sigCount[c.signature] = (sigCount[c.signature] || 0) + 1;
    if (c.queryClass === 'file-read' && c.path) pathReads[c.path] = (pathReads[c.path] || 0) + 1;
  }
  const duplicates = [];
  const seen = new Set();
  for (const c of tc) {
    if (seen.has(c.signature)) continue;
    seen.add(c.signature);
    if (sigCount[c.signature] > 1) duplicates.push({ tool: c.tool, queryClass: c.queryClass, count: sigCount[c.signature], preview: c.inputPreview });
  }
  const repeatedReads = Object.entries(pathReads).filter(([, n]) => n > 1).map(([p, n]) => ({ path: p, count: n }));
  // longest no-progress streak: consecutive calls that were empty/failed/duplicate
  let streak = 0; let best = 0;
  for (const c of tc) {
    const bad = c.ok === false || (c.outputBytes || 0) < 2 || sigCount[c.signature] > 1;
    streak = bad ? streak + 1 : 0;
    if (streak > best) best = streak;
  }
  const cumulativeInput = [];
  let acc = 0;
  for (const u of session.usages) { acc += u.input; cumulativeInput.push(u.input); }
  const topByMs = [...tc].sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, 5).map(c => ({ tool: c.tool, ms: c.durationMs, ok: c.ok, preview: c.inputPreview }));
  const topByTokens = [...tc].sort((a, b) => (b.outputTokens || 0) - (a.outputTokens || 0)).slice(0, 5).map(c => ({ tool: c.tool, tokens: c.outputTokens, preview: c.inputPreview }));

  const wallMs = opts.wallMs != null ? opts.wallMs : session.wallMs;
  const modelMs = wallMs != null ? Math.max(0, wallMs - toolMs) : null;

  return {
    schemaVersion: SCHEMA_VERSION, bundleVersion: BUNDLE_VERSION, generatedAt: new Date().toISOString(),
    workspace: opts.workspace || null, sessionId: opts.sessionId || null,
    overview: {
      steps: session.steps, toolCalls: tc.length, roundTrips: countRoundTrips(tc),
      wallMs, modelMs, mcpMs: byBackend.graph.ms, repoToolMs: byBackend.repo.ms, toolMs,
      tokensIn: session.tokensIn, tokensOut: session.tokensOut, tokensReasoning: session.tokensReasoning, tokens: session.tokens,
      cost: session.cost, toolErrors: errors, emptyResults: empty,
      distinctSignatures: new Set(tc.map(c => c.signature)).size,
    },
    byTool, byBackend, byQueryClass,
    tokenGrowth: { perStepInput: cumulativeInput, steps: cumulativeInput.length },
    overSearch: {
      duplicateCalls: duplicates,
      repeatedReads,
      emptyOrError: errors + empty,
      noProgressStreak: best,
    },
    topOffendersByTime: topByMs,
    topOffendersByTokens: topByTokens,
    hints: buildHints({ toolCalls: tc.length, duplicates: duplicates.length, emptyOrError: errors + empty, repeatedReads: repeatedReads.length, noProgressStreak: best, modelMs, mcpMs: byBackend.graph.ms, repoToolMs: byBackend.repo.ms, roundTrips: countRoundTrips(tc) }),
  };
}

function buildHints(m) {
  const hints = [];
  if (m.duplicates > 0) hints.push(`重复/近似重复调用 ${m.duplicates} 组 → 考虑结果缓存或查询归一（同参不重搜）。`);
  if (m.emptyOrError > 0) hints.push(`空结果/失败 ${m.emptyOrError} 次 → 考虑改进查询构造/回退策略，避免"空手→换词→再搜"的循环。`);
  if (m.repeatedReads > 0) hints.push(`同一文件被重复读 ${m.repeatedReads} 处 → 考虑读取缓存或先摘要后精读。`);
  if (m.noProgressStreak >= 3) hints.push(`最长"无进展"连续 ${m.noProgressStreak} 次 → 缺停止判据/预算，建议显式设停止条件。`);
  if (m.roundTrips >= 2) hints.push(`图↔仓往返 ${m.roundTrips} 次 → 检查是否可在一次规划内并发取数。`);
  if (m.modelMs != null && m.modelMs > (m.mcpMs + m.repoToolMs)) hints.push(`模型耗时主导（${m.modelMs}ms > 工具 ${(m.mcpMs + m.repoToolMs)}ms）→ 考虑上下文压缩/减少轮次。`);
  if (hints.length === 0) hints.push('未发现明显过度搜索信号。');
  return hints;
}

function renderDiagnosis(m, meta) {
  const L = [];
  L.push(`# Agent 搜索诊断报告`);
  L.push('');
  L.push(`- 生成时间：${m.generatedAt}`);
  L.push(`- 会话：${m.sessionId || '(unknown)'}　工作区：${m.workspace || '(unknown)'}`);
  L.push(`- bundle 版本：${m.bundleVersion}　schema：${m.schemaVersion}`);
  L.push('');
  L.push(`## 概览`);
  L.push('');
  L.push(`| 指标 | 值 |`);
  L.push(`|---|---|`);
  L.push(`| 轮次 steps | ${m.overview.steps} |`);
  L.push(`| 工具调用 | ${m.overview.toolCalls}（去重签名 ${m.overview.distinctSignatures}） |`);
  L.push(`| 图↔仓往返 | ${m.overview.roundTrips} |`);
  L.push(`| 墙钟 | ${fmtMs(m.overview.wallMs)} = 模型 ${fmtMs(m.overview.modelMs)} + MCP ${fmtMs(m.overview.mcpMs)} + 仓 ${fmtMs(m.overview.repoToolMs)} |`);
  L.push(`| tokens | 总 ${m.overview.tokens}（in ${m.overview.tokensIn} / out ${m.overview.tokensOut} / reason ${m.overview.tokensReasoning}） |`);
  L.push(`| 工具失败 / 空结果 | ${m.overview.toolErrors} / ${m.overview.emptyResults} |`);
  L.push('');
  L.push(`## 过度搜索信号`);
  L.push('');
  L.push(`- 重复调用组：${m.overSearch.duplicateCalls.length}`);
  for (const d of m.overSearch.duplicateCalls.slice(0, 10)) L.push(`  - ×${d.count} ${d.tool} [${d.queryClass}] ${d.preview}`);
  L.push(`- 重复读同一文件：${m.overSearch.repeatedReads.length}`);
  for (const r of m.overSearch.repeatedReads.slice(0, 10)) L.push(`  - ×${r.count} ${r.path}`);
  L.push(`- 空结果/失败合计：${m.overSearch.emptyOrError}`);
  L.push(`- 最长无进展连续：${m.overSearch.noProgressStreak}`);
  L.push('');
  L.push(`## 后端 / 查询类分布`);
  L.push('');
  L.push(`- 后端：` + Object.entries(m.byBackend).map(([k, v]) => `${k}=${v.calls}`).join(' '));
  L.push(`- 查询类：` + Object.entries(m.byQueryClass).map(([k, v]) => `${k}=${v}`).join(' '));
  L.push('');
  L.push(`## 最贵调用（按耗时）`);
  L.push('');
  for (const c of m.topOffendersByTime) L.push(`- ${fmtMs(c.ms)} ${c.tool}${c.ok ? '' : ' (error)'} ${c.preview}`);
  L.push('');
  L.push(`## token 随轮次`);
  L.push('');
  L.push(`每步 input tokens（累计上下文规模）：${m.tokenGrowth.perStepInput.join(', ') || '(无)'}`);
  L.push('');
  L.push(`## 诊断建议（启发式，供 Agent 复核）`);
  L.push('');
  for (const h of m.hints) L.push(`- ${h}`);
  L.push('');
  L.push(`---`);
  L.push(`> 本报告由 agentSearchDiagnose 自动生成；请 Agent 结合 metrics.json 与会话片段复核并补充解读。`);
  L.push('');
  return L.join('\n');
}

function fmtMs(ms) {
  if (ms == null) return 'n/a';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function writeBundle(opts) {
  const workspace = opts.workspace || process.cwd();
  const sessionText = fs.readFileSync(opts.session, 'utf8');
  const session = parseSession(sessionText);
  const sessionId = opts.sessionId || inferSessionId(sessionText) || 'session';
  const outDir = opts.out || path.join(workspace, '.argo', 'temp', 'diagnosis', sessionId);
  fs.mkdirSync(outDir, { recursive: true });

  const costLogPath = opts.costLog || path.join(workspace, '.argo', 'temp', 'agent-cost-log.ndjson');
  const costLogText = readMaybe(costLogPath);

  const metrics = diagnose(session, { workspace, sessionId, wallMs: opts.wallMs });
  const files = [];
  const write = (name, body) => { const p = path.join(outDir, name); fs.writeFileSync(p, body); files.push({ path: name, bytes: Buffer.byteLength(body) }); };

  write('session.ndjson', sessionText);
  write('cost-log.slice.ndjson', sliceCostLog(costLogText, sessionId));
  write('metrics.json', JSON.stringify(metrics, null, 2) + '\n');
  write('diagnosis.md', renderDiagnosis(metrics, { costLogPath }));

  const manifest = {
    schemaVersion: SCHEMA_VERSION, bundleVersion: BUNDLE_VERSION, generatedAt: metrics.generatedAt,
    workspace, sessionId, sources: { session: path.resolve(opts.session), costLog: costLogPath },
    files,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { outDir, metrics, manifest };
}

function readMaybe(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } }

function inferSessionId(text) {
  const m = String(text).match(/"sessionID"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function sliceCostLog(text, sessionId) {
  if (!text) return '';
  const lines = text.split('\n').filter(Boolean);
  const hit = lines.filter(l => !sessionId || l.includes(sessionId));
  return (hit.length ? hit : []).join('\n') + (hit.length ? '\n' : '');
}

function parseArgs(argv) {
  const a = { session: null, sessionId: null, costLog: null, workspace: process.cwd(), out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--session') a.session = argv[++i];
    else if (k === '--session-id') a.sessionId = argv[++i];
    else if (k === '--cost-log') a.costLog = argv[++i];
    else if (k === '--workspace') a.workspace = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--json') a.json = true;
  }
  return a;
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (!args.session || !fs.existsSync(args.session)) {
    console.error('agentSearchDiagnose: --session <session.ndjson> is required');
    return 2;
  }
  const { outDir, metrics, manifest } = writeBundle(args);
  if (args.json) { console.log(JSON.stringify({ outDir, overview: metrics.overview, hints: metrics.hints }, null, 2)); return 0; }
  console.log(`diagnosis bundle -> ${outDir}`);
  console.log(`files: ${manifest.files.map(f => f.path).join(', ')}`);
  console.log(`overview: steps=${metrics.overview.steps} tools=${metrics.overview.toolCalls} roundTrips=${metrics.overview.roundTrips} tokens=${metrics.overview.tokens} model=${fmtMs(metrics.overview.modelMs)} mcp=${fmtMs(metrics.overview.mcpMs)} repo=${fmtMs(metrics.overview.repoToolMs)}`);
  for (const h of metrics.hints) console.log(`hint: ${h}`);
  return 0;
}

module.exports = { BUNDLE_VERSION, SCHEMA_VERSION, parseSession, classifyQuery, backendOf, signature, diagnose, renderDiagnosis, writeBundle, sliceCostLog, main };

if (require.main === module) process.exit(main());
