'use strict';

// Retrieval evaluation harness (P0). Read-only.
//
// Measures vector-only retrieval quality against a golden set derived from the
// canonical graph, so the hybrid-retrieval work (P2) can be compared
// apples-to-apples. It talks to the SAME Neo4j vector indexes and the SAME
// embedding model the production retrieval uses, without the closure/assembly
// layer — isolating the recall/precision of the seed stage.
//
// Usage:
//   node scripts/eval-retrieval.js            # report
//   node scripts/eval-retrieval.js --json     # machine-readable
//
// Env (optional): ARGO_SEMANTIC_TOP_K (default 8).

const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const {
  resolveApprovedLiveConfiguration,
} = require(path.join(repo, 'argo/scripts/graph-rag/liveEmbeddingProviderConfig.js'));
const {
  createLiveEmbeddingProviderClient,
} = require(path.join(repo, 'argo/scripts/graph-rag/liveEmbeddingProviderClient.js'));

const CHANNELS = [
  { channel: 'Element', idField: 'id', index: 'argo_production_semantic_element_vector' },
  { channel: 'ArchitectureRelationship', idField: 'id', index: 'argo_production_semantic_relationship_vector' },
  { channel: 'View', idField: 'view_id', index: 'argo_production_semantic_view_vector' },
];

function topK() {
  const k = Number(process.env.ARGO_SEMANTIC_TOP_K);
  return Number.isInteger(k) && k > 0 ? k : 8;
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

async function main() {
  const json = process.argv.includes('--json');
  const graph = JSON.parse(fs.readFileSync(path.join(repo, 'design/KG/SystemArchitecture.json'), 'utf8'));
  const queries = buildGolden(graph);
  const k = topK();

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

  async function topIds(index, vector) {
    const res = await session.run(
      'CALL db.index.vector.queryNodes($index, $topK, $vector) YIELD node, score RETURN node.canonicalIdentity AS id, score ORDER BY score DESC',
      { index, topK: k, vector },
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
      const ids = await topIds(def.index, vector);
      const rank = ids.indexOf(item.target);
      rows.push({ family: item.family, channel: item.channel, rank, hit1: rank === 0, hit5: rank >= 0 && rank < 5, rr: rank >= 0 ? 1 / (rank + 1) : 0 });
    }
  } finally {
    await session.close();
    await driver.close();
  }

  function agg(filter) {
    const sel = rows.filter(filter);
    if (sel.length === 0) return { n: 0 };
    const m = f => sel.filter(f).length / sel.length;
    return {
      n: sel.length,
      recall1: +(m(r => r.hit1) * 100).toFixed(1),
      recall5: +(m(r => r.hit5) * 100).toFixed(1),
      mrr: +(sel.reduce((a, r) => a + r.rr, 0) / sel.length).toFixed(3),
    };
  }

  const report = {
    mode: 'vector-only',
    topK: k,
    ALL: agg(() => true),
    name: agg(r => r.family === 'name'),
    desc: agg(r => r.family === 'desc'),
    byChannel: {
      Element: agg(r => r.channel === 'Element'),
      ArchitectureRelationship: agg(r => r.channel === 'ArchitectureRelationship'),
      View: agg(r => r.channel === 'View'),
    },
  };

  console.log(JSON.stringify(report, null, json ? 2 : 2));
}

if (require.main === module) {
  main().catch(e => { console.error('ERR', e && (e.stack || e.message || e)); process.exit(1); });
}

module.exports = { buildGolden, cosine, CHANNELS, topK };
