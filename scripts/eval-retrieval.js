'use strict';

// Retrieval evaluation harness (P0/P2). Read-only.
//
// Measures vector-only vs hybrid (vector + full-text + RRF) retrieval quality
// against a golden set derived from the canonical graph. It talks to the SAME
// Neo4j indexes and embedding model the production retrieval uses, without the
// closure/assembly layer — isolating the recall/precision of the seed stage.
//
// Usage:
//   node scripts/eval-retrieval.js            # compare vector-only vs hybrid
//
// Env (optional): ARGO_SEMANTIC_TOP_K (default 8), ARGO_SEMANTIC_HYBRID_TOP_K,
// ARGO_SEMANTIC_HYBRID_RRF_K, ARGO_SEMANTIC_HYBRID_VECTOR_WEIGHT,
// ARGO_SEMANTIC_HYBRID_LEXICAL_WEIGHT.

const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const {
  resolveApprovedLiveConfiguration,
} = require(path.join(repo, 'argo/scripts/graph-rag/liveEmbeddingProviderConfig.js'));
const {
  createLiveEmbeddingProviderClient,
} = require(path.join(repo, 'argo/scripts/graph-rag/liveEmbeddingProviderClient.js'));
const {
  rrfFuse,
  sanitizeFulltextQuery,
  DEFAULT_RRF_K,
  DEFAULT_HYBRID_TOP_K,
  DEFAULT_VECTOR_WEIGHT,
  DEFAULT_LEXICAL_WEIGHT,
} = require(path.join(repo, 'argo/scripts/graph-rag/hybridRetrieval.js'));

const CHANNELS = [
  { channel: 'Element', idField: 'id', index: 'argo_production_semantic_element_vector' },
  { channel: 'ArchitectureRelationship', idField: 'id', index: 'argo_production_semantic_relationship_vector' },
  { channel: 'View', idField: 'view_id', index: 'argo_production_semantic_view_vector' },
];

function topK() {
  const k = Number(process.env.ARGO_SEMANTIC_TOP_K);
  return Number.isInteger(k) && k > 0 ? k : 8;
}
function lexicalTopK() {
  const k = Number(process.env.ARGO_SEMANTIC_HYBRID_TOP_K);
  return Number.isInteger(k) && k > 0 ? k : DEFAULT_HYBRID_TOP_K;
}
function fusionK() {
  const k = Number(process.env.ARGO_SEMANTIC_HYBRID_RRF_K);
  return Number.isFinite(k) && k > 0 ? k : DEFAULT_RRF_K;
}
function weight(name, fallback) {
  const w = Number(process.env[name]);
  return Number.isFinite(w) && w >= 0 ? w : fallback;
}

function buildGolden(graph) {
  const queries = [];
  for (const def of CHANNELS) {
    const entries = def.channel === 'View'
      ? (graph.views || [])
      : def.channel === 'Element'
        ? (graph.elements || [])
        : (graph.relationships || []);
    for (const obj of entries) {
      const id = def.channel === 'View' ? obj.view_id : obj.id;
      if (!id) continue;
      const target = `${def.channel}:${id}`;
      const name = def.channel === 'View' ? obj.view_name : (def.channel === 'ArchitectureRelationship' ? obj.statement : obj.name);
      const desc = obj.description;
      if (typeof name === 'string' && name.trim()) queries.push({ q: name, target, family: 'name', channel: def.channel });
      if (typeof desc === 'string' && desc.trim().length >= 24) queries.push({ q: desc, target, family: 'desc', channel: def.channel });
    }
  }
  return queries;
}

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

function rankOf(ids, target) {
  const rank = ids.indexOf(target);
  return { rank, hit1: rank === 0, hit5: rank >= 0 && rank < 5, rr: rank >= 0 ? 1 / (rank + 1) : 0 };
}

function agg(rows, pick) {
  const sel = rows.map(pick).filter(Boolean);
  if (sel.length === 0) return { n: 0 };
  const m = f => sel.filter(f).length / sel.length;
  return {
    n: sel.length,
    recall1: +(m(r => r.hit1) * 100).toFixed(1),
    recall5: +(m(r => r.hit5) * 100).toFixed(1),
    mrr: +(sel.reduce((a, r) => a + r.rr, 0) / sel.length).toFixed(3),
  };
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

async function main() {
  const graph = JSON.parse(fs.readFileSync(path.join(repo, 'design/KG/SystemArchitecture.json'), 'utf8'));
  const queries = buildGolden(graph);
  const k = topK();
  const lexK = lexicalTopK();
  const fK = fusionK();
  const vectorWeight = weight('ARGO_SEMANTIC_HYBRID_VECTOR_WEIGHT', DEFAULT_VECTOR_WEIGHT);
  const lexicalWeight = weight('ARGO_SEMANTIC_HYBRID_LEXICAL_WEIGHT', DEFAULT_LEXICAL_WEIGHT);

  const evidence = await resolveApprovedLiveConfiguration({ repositoryRoot: repo, useCase: 'production-semantic-query' });
  const config = evidence.configuration;
  const client = createLiveEmbeddingProviderClient({
    configuration: config,
    transport: { request: (url, options) => fetch(url, options) },
  });

  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(
    config.neo4jDatabaseUrl,
    neo4j.auth.basic(config.neo4jDatabaseUsername, config.neo4jDatabasePassword),
  );
  const session = driver.session(config.neo4jDatabase === undefined ? undefined : { database: config.neo4jDatabase });

  async function vectorIds(index, vector) {
    const res = await session.run(
      'CALL db.index.vector.queryNodes($index, $topK, $vector) YIELD node, score RETURN node.canonicalIdentity AS id, score ORDER BY score DESC',
      { index, topK: k, vector },
    );
    return res.records.map(r => r.get('id'));
  }
  async function lexicalIds(index, queryText) {
    const safe = sanitizeFulltextQuery(queryText);
    if (!safe) return [];
    const res = await session.run(
      'CALL db.index.fulltext.queryNodes($index, $queryText, { limit: $topK }) YIELD node, score RETURN node.canonicalIdentity AS id, score ORDER BY score DESC',
      { index: `${index}_fulltext`, queryText: safe, topK: lexK },
    );
    return res.records.map(r => r.get('id'));
  }

  const rows = [];
  try {
    for (const item of queries) {
      const def = CHANNELS.find(c => c.channel === item.channel);
      let vector;
      try { vector = await client.embed(item.q); } catch { continue; }
      if (!Array.isArray(vector)) continue;
      const vIds = await vectorIds(def.index, vector);
      const lIds = await lexicalIds(def.index, item.q);
      const toSeeds = list => list.map((id, i) => ({ id, score: list.length - i }));
      const fused = rrfFuse([toSeeds(vIds), toSeeds(lIds)], { k: fK, weights: [vectorWeight, lexicalWeight] })
        .slice(0, lexK)
        .map(x => x.id);
      rows.push({
        family: item.family,
        channel: item.channel,
        vector: rankOf(vIds, item.target),
        hybrid: rankOf(fused, item.target),
      });
    }
  } finally {
    await session.close();
    await driver.close();
  }

  const report = {
    config: { topK: k, lexicalTopK: lexK, rrfK: fK, vectorWeight, lexicalWeight },
    vectorOnly: metrics(rows, 'vector'),
    hybrid: metrics(rows, 'hybrid'),
  };
  report.delta = {
    all_recall1: +(report.hybrid.ALL.recall1 - report.vectorOnly.ALL.recall1).toFixed(1),
    name_recall1: +(report.hybrid.name.recall1 - report.vectorOnly.name.recall1).toFixed(1),
    desc_recall1: +(report.hybrid.desc.recall1 - report.vectorOnly.desc.recall1).toFixed(1),
    element_recall1: +(report.hybrid.byChannel.Element.recall1 - report.vectorOnly.byChannel.Element.recall1).toFixed(1),
    view_recall1: +(report.hybrid.byChannel.View.recall1 - report.vectorOnly.byChannel.View.recall1).toFixed(1),
  };
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch(e => { console.error('ERR', e && (e.stack || e.message || e)); process.exit(1); });
}

module.exports = { buildGolden, cosine, CHANNELS, topK };
