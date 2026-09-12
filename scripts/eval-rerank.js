'use strict';

// Rerank evaluation harness (P3). Read-only.
//
// Two-stage: vector retrieval produces a candidate pool (top-N), then an LLM
// listwise reranker reorders that pool by relevance to the query. We compare
// vector-only ranking vs reranked ranking on the SAME sampled golden queries,
// with the same recall@1/@5/MRR metrics as scripts/eval-retrieval.js.
//
// Usage:
//   node scripts/eval-rerank.js --limit 150 [--topn 20] [--model qwen-turbo]
//
// Env: ARGO_SEMANTIC_TOP_K (vector pool default via --topn).

const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const {
  resolveApprovedLiveConfiguration,
} = require(path.join(repo, 'argo/scripts/graph-rag/liveEmbeddingProviderConfig.js'));
const {
  createLiveEmbeddingProviderClient,
} = require(path.join(repo, 'argo/scripts/graph-rag/liveEmbeddingProviderClient.js'));
const { buildGolden, CHANNELS } = require('./eval-retrieval.js');

function arg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function rankOf(ids, target) {
  const rank = ids.indexOf(target);
  return { rank, hit1: rank === 0, hit5: rank >= 0 && rank < 5, rr: rank >= 0 ? 1 / (rank + 1) : 0 };
}
function agg(rows, pick) {
  const sel = rows.map(pick).filter(Boolean);
  if (sel.length === 0) return { n: 0 };
  const m = f => sel.filter(f).length / sel.length;
  return { n: sel.length, recall1: +(m(r => r.hit1) * 100).toFixed(1), recall5: +(m(r => r.hit5) * 100).toFixed(1), mrr: +(sel.reduce((a, r) => a + r.rr, 0) / sel.length).toFixed(3) };
}
function metrics(rows, key) {
  return {
    ALL: agg(rows, r => r[key]),
    name: agg(rows.filter(r => r.family === 'name'), r => r[key]),
    desc: agg(rows.filter(r => r.family === 'desc'), r => r[key]),
    byChannel: {
      Element: agg(rows.filter(r => r.channel === 'Element'), r => r[key]),
      ArchitectureRelationship: agg(rows.filter(r => r.channel === 'ArchitectureRelationship'), r => r[key]),
      View: agg(rows.filter(r => r.channel === 'View'), r => r[key]),
    },
  };
}

function indexGraph(graph) {
  const byId = new Map();
  for (const e of graph.elements || []) byId.set(`Element:${e.id}`, { name: e.name, type: e.type, text: e.description || '' });
  for (const r of graph.relationships || []) byId.set(`ArchitectureRelationship:${r.id}`, { name: r.statement || r.name, type: r.type, text: r.description || '' });
  for (const v of graph.views || []) byId.set(`View:${v.view_id}`, { name: v.view_name, type: 'View', text: v.description || '' });
  return byId;
}

async function main() {
  const limit = Number(arg('--limit', '150'));
  const topN = Number(arg('--topn', '20'));
  const model = arg('--model', 'qwen-turbo');

  const graph = JSON.parse(fs.readFileSync(path.join(repo, 'design/KG/SystemArchitecture.json'), 'utf8'));
  const graphById = indexGraph(graph);
  let queries = buildGolden(graph);
  // Stratified sample: keep a share of each family/channel, deterministic order.
  if (limit > 0 && queries.length > limit) {
    const step = queries.length / limit;
    queries = Array.from({ length: limit }, (_, i) => queries[Math.floor(i * step)]);
  }

  const evidence = await resolveApprovedLiveConfiguration({ repositoryRoot: repo, useCase: 'production-semantic-query' });
  const config = evidence.configuration;
  const client = createLiveEmbeddingProviderClient({ configuration: config, transport: { request: (url, options) => fetch(url, options) } });

  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(config.neo4jDatabaseUrl, neo4j.auth.basic(config.neo4jDatabaseUsername, config.neo4jDatabasePassword));
  const session = driver.session(config.neo4jDatabase === undefined ? undefined : { database: config.neo4jDatabase });

  async function vectorIds(index, vector) {
    const res = await session.run(
      'CALL db.index.vector.queryNodes($index, $topK, $vector) YIELD node, score RETURN node.canonicalIdentity AS id ORDER BY score DESC',
      { index, topK: topN, vector },
    );
    return res.records.map(r => r.get('id'));
  }

  async function rerank(query, ids) {
    const lines = ids.map(id => {
      const g = graphById.get(id) || { name: id, type: '', text: '' };
      const snippet = String(g.text).replace(/\s+/g, ' ').slice(0, 120);
      return `${id}\t${String(g.name || '').slice(0, 80)}\t(${g.type || ''})\t${snippet}`;
    }).join('\n');
    const body = {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You rank architecture elements by relevance to a query. Return ONLY JSON: {"order":[ids best-first]} using ONLY ids from the candidate list. If none are relevant return {"order":[]}.' },
        { role: 'user', content: `Query: ${query}\n\nCandidates (id\\tname\\t(type)\\tsnippet):\n${lines}\n\nReturn up to ${Math.min(8, ids.length)} ids best-first.` },
      ],
    };
    const res = await fetch(`${config.embeddingBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.qwenKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`chat ${res.status}`);
    const json = await res.json();
    const text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    const parsed = JSON.parse(text);
    const raw = Array.isArray(parsed && parsed.order) ? parsed.order : [];
    // Accept the canonical id or its bare/suffix form (models often drop the channel prefix).
    const byKey = new Map();
    for (const id of ids) {
      const textId = String(id);
      byKey.set(textId, id);
      byKey.set(textId.split(':').slice(1).join(':'), id);
      byKey.set(textId.split(':').pop(), id);
    }
    const seen = new Set();
    const order = [];
    for (const value of raw) {
      const canonical = byKey.get(String(value));
      if (canonical && !seen.has(canonical)) { seen.add(canonical); order.push(canonical); }
    }
    return order;
  }

  const rows = [];
  let rerankFailures = 0;
  try {
    for (const item of queries) {
      const def = CHANNELS.find(c => c.channel === item.channel);
      let vector;
      try { vector = await client.embed(item.q); } catch { continue; }
      if (!Array.isArray(vector)) continue;
      const vIds = await vectorIds(def.index, vector);
      let order = null;
      for (let attempt = 0; attempt < 3 && order === null; attempt++) {
        try { order = await rerank(item.q, vIds); } catch { await sleep(400); }
      }
      let rerankedIds;
      if (order === null) { rerankFailures++; rerankedIds = vIds; }
      else {
        // append any vector candidates the reranker omitted, preserving vector order
        const seen = new Set(order);
        rerankedIds = [...order, ...vIds.filter(id => !seen.has(id))];
      }
      rows.push({ family: item.family, channel: item.channel, vector: rankOf(vIds, item.target), rerank: rankOf(rerankedIds, item.target) });
    }
  } finally {
    await session.close();
    await driver.close();
  }

  const report = { config: { limit, topN, model }, sampled: rows.length, rerankFailures, vectorOnly: metrics(rows, 'vector'), rerank: metrics(rows, 'rerank') };
  report.delta = {
    all_recall1: +(report.rerank.ALL.recall1 - report.vectorOnly.ALL.recall1).toFixed(1),
    name_recall1: +(report.rerank.name.recall1 - report.vectorOnly.name.recall1).toFixed(1),
    desc_recall1: +(report.rerank.desc.recall1 - report.vectorOnly.desc.recall1).toFixed(1),
    element_recall1: +(report.rerank.byChannel.Element.recall1 - report.vectorOnly.byChannel.Element.recall1).toFixed(1),
    view_recall1: +(report.rerank.byChannel.View.recall1 - report.vectorOnly.byChannel.View.recall1).toFixed(1),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(e => { console.error('ERR', e && (e.stack || e.message || e)); process.exit(1); });
