'use strict';

// Rerank / hybrid evaluation harness (P3). Read-only.
//
// One pass over a sampled golden set compares four retrieval strategies with the
// same recall@1/@5/MRR metrics:
//   1. vector-only
//   2. hybrid            (vector + full-text + RRF, production weights)
//   3. rerank(vector)    (LLM listwise rerank of the vector pool)
//   4. rerank(hybrid)    (LLM listwise rerank of the fused pool)
//
// Usage: node scripts/eval-rerank.js --limit 150 [--pool 20] [--model qwen-turbo]

const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const {
  loadRepositoryArgoEnvironment,
} = require(path.join(repo, 'argo/scripts/repositoryArgoEnvironment.js'));
// Load the approved env file into process.env (same as the MCP runtime) so the
// rerank provider/model resolve from the live configuration, not just defaults.
loadRepositoryArgoEnvironment(repo);
const {
  resolveApprovedLiveConfiguration,
} = require(path.join(repo, 'argo/scripts/graph-rag/liveEmbeddingProviderConfig.js'));
const {
  createLiveEmbeddingProviderClient,
} = require(path.join(repo, 'argo/scripts/graph-rag/liveEmbeddingProviderClient.js'));
const {
  fuseChannelSeeds,
  sanitizeFulltextQuery,
  DEFAULT_VECTOR_WEIGHT,
  DEFAULT_LEXICAL_WEIGHT,
  DEFAULT_RRF_K,
  DEFAULT_HYBRID_TOP_K,
} = require(path.join(repo, 'argo/scripts/graph-rag/hybridRetrieval.js'));
const { buildGolden, CHANNELS } = require('./eval-retrieval.js');
const {
  resolveRerankProvider,
  rerankCandidates,
} = require(path.join(repo, 'argo/scripts/graph-rag/rerankRetrieval.js'));

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
function agg(rows, key) {
  const sel = rows.map(r => r[key]).filter(Boolean);
  if (sel.length === 0) return { n: 0 };
  const m = f => sel.filter(f).length / sel.length;
  return { n: sel.length, recall1: +(m(r => r.hit1) * 100).toFixed(1), recall5: +(m(r => r.hit5) * 100).toFixed(1), mrr: +(sel.reduce((a, r) => a + r.rr, 0) / sel.length).toFixed(3) };
}
function metrics(rows, key) {
  return {
    ALL: agg(rows, key),
    name: agg(rows.filter(r => r.family === 'name'), key),
    desc: agg(rows.filter(r => r.family === 'desc'), key),
    Element: agg(rows.filter(r => r.channel === 'Element'), key),
    ArchitectureRelationship: agg(rows.filter(r => r.channel === 'ArchitectureRelationship'), key),
    View: agg(rows.filter(r => r.channel === 'View'), key),
  };
}
function mergeReranked(order, pool) {
  const seen = new Set(order);
  return [...order, ...pool.filter(id => !seen.has(id))];
}

async function main() {
  const limit = Number(arg('--limit', '150'));
  const pool = Number(arg('--pool', '20'));
  const modelArg = arg('--model', '');
  if (modelArg) process.env.ARGO_RERANK_MODEL = modelArg;

  const graph = JSON.parse(fs.readFileSync(path.join(repo, 'design/KG/SystemArchitecture.json'), 'utf8'));
  const graphById = new Map();
  for (const e of graph.elements || []) graphById.set(`Element:${e.id}`, `${e.name} ${e.description || ''}`);
  for (const r of graph.relationships || []) graphById.set(`ArchitectureRelationship:${r.id}`, `${r.statement || r.name} ${r.description || ''}`);
  for (const v of graph.views || []) graphById.set(`View:${v.view_id}`, `${v.view_name} ${v.description || ''}`);

  let queries = buildGolden(graph);
  if (limit > 0 && queries.length > limit) {
    const step = queries.length / limit;
    queries = Array.from({ length: limit }, (_, i) => queries[Math.floor(i * step)]);
  }

  const evidence = await resolveApprovedLiveConfiguration({ repositoryRoot: repo, useCase: 'production-semantic-query' });
  const config = evidence.configuration;
  const client = createLiveEmbeddingProviderClient({ configuration: config, transport: { request: (url, options) => fetch(url, options) } });
  const rerankProvider = resolveRerankProvider(config, process.env);
  const transport = { request: (url, options) => fetch(url, options) };

  const neo4j = require(path.join(repo, 'node_modules', 'neo4j-driver'));
  const driver = neo4j.driver(config.neo4jDatabaseUrl, neo4j.auth.basic(config.neo4jDatabaseUsername, config.neo4jDatabasePassword));
  const session = driver.session(config.neo4jDatabase === undefined ? undefined : { database: config.neo4jDatabase });

  async function vectorIds(index, vector) {
    const res = await session.run('CALL db.index.vector.queryNodes($index, $topK, $vector) YIELD node, score RETURN node.canonicalIdentity AS id ORDER BY score DESC', { index, topK: pool, vector });
    return res.records.map(r => r.get('id'));
  }
  async function lexicalIds(index, queryText) {
    const safe = sanitizeFulltextQuery(queryText);
    if (!safe) return [];
    const res = await session.run('CALL db.index.fulltext.queryNodes($index, $queryText, { limit: $topK }) YIELD node, score RETURN node.canonicalIdentity AS id ORDER BY score DESC', { index: `${index}_fulltext`, queryText: safe, topK: Math.max(pool, DEFAULT_HYBRID_TOP_K) });
    return res.records.map(r => r.get('id'));
  }
  async function rerank(query, ids) {
    if (ids.length < 2) return ids.slice();
    const candidates = ids.map(id => ({ id, searchText: String(graphById.get(id) || id) }));
    const order = await rerankCandidates({ query, candidates, provider: rerankProvider, transport, maxReturn: 8 });
    return order === null ? null : mergeReranked(order, ids);
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
      const lIds = await lexicalIds(def.index, item.q);
      const toSeeds = list => list.map((id, i) => ({ id, score: list.length - i }));
      const fused = fuseChannelSeeds({ vectorSeeds: toSeeds(vIds), lexicalSeeds: toSeeds(lIds), k: DEFAULT_RRF_K, limit: Math.max(pool, DEFAULT_HYBRID_TOP_K), weights: [DEFAULT_VECTOR_WEIGHT, DEFAULT_LEXICAL_WEIGHT] }).map(x => x.id);

      let rerankedV = null, rerankedH = null;
      for (let attempt = 0; attempt < 3 && (rerankedV === null || rerankedH === null); attempt++) {
        if (rerankedV === null) rerankedV = await rerank(item.q, vIds);
        if (rerankedH === null) rerankedH = await rerank(item.q, fused);
        if (rerankedV === null || rerankedH === null) await sleep(400);
      }
      if (rerankedV === null || rerankedH === null) { rerankFailures++; rerankedV = rerankedV || vIds; rerankedH = rerankedH || fused; }

      rows.push({
        family: item.family, channel: item.channel,
        vector: rankOf(vIds, item.target),
        hybrid: rankOf(fused, item.target),
        rerankV: rankOf(rerankedV, item.target),
        rerankH: rankOf(rerankedH, item.target),
      });
      if (rows.length % 20 === 0) process.stderr.write(`progress ${rows.length}/${queries.length}\n`);
    }
  } finally {
    await session.close();
    await driver.close();
  }

  const vs = metrics(rows, 'vector');
  const hy = metrics(rows, 'hybrid');
  const rv = metrics(rows, 'rerankV');
  const rh = metrics(rows, 'rerankH');
  const d = (a, b) => +(a.ALL.recall1 - b.ALL.recall1).toFixed(1);
  const report = {
    config: { limit, pool, model: rerankProvider.model, provider: rerankProvider.provider, sampled: rows.length, rerankFailures },
    recall1: {
      vector: vs.ALL.recall1, hybrid: hy.ALL.recall1, rerank_vector: rv.ALL.recall1, rerank_hybrid: rh.ALL.recall1,
      name_vector: vs.name.recall1, name_rerank_hybrid: rh.name.recall1,
      element_vector: vs.Element.recall1, element_rerank_hybrid: rh.Element.recall1,
      view_vector: vs.View.recall1, view_rerank_hybrid: rh.View.recall1,
      desc_vector: vs.desc.recall1, desc_rerank_hybrid: rh.desc.recall1,
    },
    recall5: {
      vector: vs.ALL.recall5, hybrid: hy.ALL.recall5, rerank_vector: rv.ALL.recall5, rerank_hybrid: rh.ALL.recall5,
    },
    mrr: {
      vector: vs.ALL.mrr, hybrid: hy.ALL.mrr, rerank_vector: rv.ALL.mrr, rerank_hybrid: rh.ALL.mrr,
    },
    delta_recall1: {
      hybrid_vs_vector: d(hy, vs),
      rerank_vector_vs_vector: d(rv, vs),
      rerank_hybrid_vs_vector: d(rh, vs),
      rerank_hybrid_vs_rerank_vector: d(rh, rv),
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(e => { console.error('ERR', e && (e.stack || e.message || e)); process.exit(1); });
