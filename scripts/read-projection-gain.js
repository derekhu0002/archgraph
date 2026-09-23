'use strict';
/**
 * Measure the gain of the structural-read projection (0.26.1).
 *
 * Drives the ARGO MCP server in ONE session and, for every view and a sample of
 * elements, compares the REAL tool payload of:
 *   - default  (projected: attributes/testcases omitted, matchedSnippet on hits)
 *   - full     (includeAttributes:true, includeTestcases:true)
 * then reports byte + token reduction, distribution, and the semantic-hit
 * matchedSnippet size (the lookup that is no longer needed).
 *
 * Read-only. Report -> results/read-projection-gain.json.
 *
 * Usage: node scripts/read-projection-gain.js
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js');
const GRAPH = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));
const REPORT = path.join(ROOT, 'results', 'read-projection-gain.json');

function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return cjk + Math.ceil((s.length - cjk) / 4);
}

function callServer(requests) {
  const input = `${requests.map(r => JSON.stringify(r)).join('\n')}\n`;
  const res = spawnSync(process.execPath, [SERVER], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ARGO_REPO_ROOT: ROOT },
    input, maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`server exited ${res.status}: ${res.stderr}`);
  const byId = new Map();
  for (const line of String(res.stdout).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let e; try { e = JSON.parse(t); } catch { continue; }
    if (e.id !== undefined) byId.set(e.id, e);
  }
  return byId;
}

function textOf(response) {
  try { return response.result.content[0].text; } catch { return ''; }
}

function summarizeReduction(rows) {
  const ratios = rows.filter(r => r.fullBytes > 0).map(r => 1 - r.defBytes / r.fullBytes).sort((a, b) => a - b);
  const pct = (q) => (ratios.length ? Math.round(ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))] * 1000) / 10 : 0);
  const totalDef = rows.reduce((a, r) => a + r.defBytes, 0);
  const totalFull = rows.reduce((a, r) => a + r.fullBytes, 0);
  return {
    calls: rows.length,
    totalDefBytes: totalDef, totalFullBytes: totalFull,
    overallReductionPct: totalFull ? Math.round((1 - totalDef / totalFull) * 1000) / 10 : 0,
    totalDefTokens: rows.reduce((a, r) => a + r.defTokens, 0),
    totalFullTokens: rows.reduce((a, r) => a + r.fullTokens, 0),
    minPct: pct(0), medianPct: pct(0.5), p90Pct: pct(0.9), maxPct: pct(0.999),
  };
}

function main() {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gain', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  ];
  const ids = { viewDef: [], viewFull: [], intDef: [], intFull: [], mem: [] };
  let nextId = 10;

  const views = (GRAPH.views || []).filter(v => v.view_id);
  for (const v of views) {
    const a = nextId++; ids.viewDef.push([a, v.view_id]);
    requests.push({ jsonrpc: '2.0', id: a, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: v.view_id } } });
    const b = nextId++; ids.viewFull.push([b, v.view_id]);
    requests.push({ jsonrpc: '2.0', id: b, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id: v.view_id, includeAttributes: true, includeTestcases: true } } });
  }

  // intent-element context: sample elements that carry bookkeeping (so neighbours matter)
  const bookkept = (GRAPH.elements || [])
    .filter(e => (Array.isArray(e.attributes) && e.attributes.length) || (Array.isArray(e.testcases) && e.testcases.length))
    .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)
    .slice(0, 20);
  for (const e of bookkept) {
    const a = nextId++; ids.intDef.push([a, e.id]);
    requests.push({ jsonrpc: '2.0', id: a, method: 'tools/call', params: { name: 'getIntentElementContext', arguments: { elementId: e.id, dependencyDepth: 1, dependentDepth: 0, associationDepth: 1 } } });
    const b = nextId++; ids.intFull.push([b, e.id]);
    requests.push({ jsonrpc: '2.0', id: b, method: 'tools/call', params: { name: 'getIntentElementContext', arguments: { elementId: e.id, dependencyDepth: 1, dependentDepth: 0, associationDepth: 1, includeAttributes: true, includeTestcases: true } } });
  }

  // semantic memory hits: how many carry matchedSnippet, and its size
  const memQueries = ['项目总管 职责 默认角色', '检索召回优先 不以性能换召回', 'Agent 成本 度量 harness'];
  for (const q of memQueries) {
    const id = nextId++; ids.mem.push([id, q]);
    requests.push({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'memory_search', arguments: { query: q, top_k: 5, max_desc_len: 200 } } });
  }

  const byId = callServer(requests);

  const viewRows = ids.viewDef.map(([defId, viewId], i) => {
    const fullId = ids.viewFull[i][0];
    const def = textOf(byId.get(defId)); const full = textOf(byId.get(fullId));
    return { kind: 'view', id: viewId, defBytes: def.length, fullBytes: full.length, defTokens: estimateTokens(def), fullTokens: estimateTokens(full) };
  });
  const intRows = ids.intDef.map(([defId, elementId], i) => {
    const fullId = ids.intFull[i][0];
    const def = textOf(byId.get(defId)); const full = textOf(byId.get(fullId));
    return { kind: 'intent', id: elementId, defBytes: def.length, fullBytes: full.length, defTokens: estimateTokens(def), fullTokens: estimateTokens(full) };
  });

  let mem = { queries: 0, hits: 0, hitsWithSnippet: 0, snippetTokens: 0, avgSnippetTokens: 0 };
  for (const [id] of ids.mem) {
    let payload; try { payload = JSON.parse(textOf(byId.get(id))); } catch { continue; }
    mem.queries += 1;
    for (const hit of payload.hits || []) {
      mem.hits += 1;
      if (typeof hit.matchedSnippet === 'string' && hit.matchedSnippet) {
        mem.hitsWithSnippet += 1;
        mem.snippetTokens += estimateTokens(hit.matchedSnippet);
      }
    }
  }
  mem.avgSnippetTokens = mem.hitsWithSnippet ? Math.round(mem.snippetTokens / mem.hitsWithSnippet) : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    views: { ...summarizeReduction(viewRows), worst: viewRows.slice().sort((a, b) => (a.fullBytes - a.defBytes) - (b.fullBytes - b.defBytes)).slice(-3) },
    intent: { ...summarizeReduction(intRows) },
    combined: summarizeReduction([...viewRows, ...intRows]),
    matchedSnippet: mem,
    rows: { views: viewRows, intent: intRows },
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  console.log('=== read-projection gain (default vs full) ===');
  for (const k of ['views', 'intent', 'combined']) {
    const s = report[k];
    console.log(`${k}: calls=${s.calls} bytes ${s.totalDefBytes} -> ${s.totalFullBytes}  reduction ${s.overallReductionPct}%  (min ${s.minPct} / med ${s.medianPct} / p90 ${s.p90Pct} / max ${s.maxPct})`);
    console.log(`        tokens ${s.totalDefTokens} vs ${s.totalFullTokens}  saved ${s.totalFullTokens - s.totalDefTokens}`);
  }
  console.log(`matchedSnippet: hits ${mem.hitsWithSnippet}/${mem.hits} carry a snippet; avg ${mem.avgSnippetTokens} tokens each (the extra getIntentElementContext they replace is the "intent" full read above).`);
  console.log(`report: ${REPORT}`);
  return 0;
}

module.exports = { estimateTokens, summarizeReduction };

if (require.main === module) process.exit(main());
