'use strict';

// Phase 2: recall A/B — local self-hosted embeddings vs the approved cloud model.
//
// Same canonical graph, same golden set (scripts/eval-retrieval.js buildGolden),
// same curated embedding text (buildSemanticRecordText), same per-channel cosine
// ranking as the Neo4j vector index (exact for this corpus size). Read-only:
// nothing is written to Neo4j or to the graph.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const { buildGolden } = require(path.join(repo, 'scripts/eval-retrieval.js'));
const { buildSemanticRecordText } = require(path.join(repo, 'argo/scripts/graph-rag/semanticRecordText.js'));

const QUERY_INSTRUCTION = 'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ';
const DIMENSIONS = 1536;
const BATCH = 16;
const TOP_K = 8;
const PROVIDERS_WANTED = (process.env.PROVIDERS || 'cloud,local').split(',').map(item => item.trim());
const REPORT_PATH = path.join(__dirname, 'eval-report.json');

function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    out[line.slice(0, index).trim()] = line.slice(index + 1);
  }
  return out;
}

const env = parseEnv(fs.readFileSync(path.join(os.homedir(), '.argo', '.env'), 'utf8'));

const PROVIDERS = {
  cloud: {
    label: 'cloud qwen3.7',
    baseUrl: env.ARGO_EMBEDDING_BASE_URL,
    model: env.ARGO_EMBEDDING_MODEL,
    apiKey: env.QWEN_KEY,
    instruction: '',
  },
  local: {
    label: 'local gte-Qwen2-1.5B',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'Alibaba-NLP/gte-Qwen2-1.5B-instruct',
    apiKey: 'local',
    instruction: QUERY_INSTRUCTION,
  },
};

async function embedOnce(provider, input) {
  const base = provider.baseUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({ model: provider.model, input, dimensions: DIMENSIONS }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${provider.label} HTTP ${response.status} ${body.slice(0, 120)}`);
  }
  const payload = await response.json();
  return payload.data.slice().sort((a, b) => a.index - b.index).map(item => item.embedding);
}

async function embed(provider, texts) {
  // Batch by similar length so short texts are not padded to the longest record
  // in the batch (embeddings are batch-independent, so order does not matter).
  const order = texts.map((_, index) => index).sort((a, b) => texts[a].length - texts[b].length);
  const sorted = order.map(index => texts[index]);
  const vectors = new Array(texts.length);
  const chunks = Math.ceil(sorted.length / BATCH);
  for (let i = 0; i < sorted.length; i += BATCH) {
    const chunk = sorted.slice(i, i + BATCH);
    let chunkVectors;
    try {
      chunkVectors = await embedOnce(provider, chunk);
    } catch (error) {
      if (chunk.length === 1) throw error;
      chunkVectors = [];
      for (const one of chunk) {
        chunkVectors.push((await embedOnce(provider, [one]))[0]);
      }
    }
    if (chunkVectors.length !== chunk.length) {
      throw new Error(`${provider.label} returned ${chunkVectors.length}/${chunk.length}`);
    }
    chunkVectors.forEach((vector, offset) => { vectors[order[i + offset]] = vector; });
    const done = Math.floor(i / BATCH) + 1;
    if (done % 5 === 0 || done === chunks) {
      process.stderr.write(`  ${provider.label}: ${done}/${chunks} batches\n`);
    }
  }
  return vectors;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

function rankOf(ids, target) {
  const rank = ids.indexOf(target);
  return { hit1: rank === 0, hit5: rank >= 0 && rank < 5, rr: rank >= 0 ? 1 / (rank + 1) : 0 };
}

function agg(rows) {
  if (rows.length === 0) return { n: 0, recall1: 0, recall5: 0, mrr: 0 };
  const rate = predicate => rows.filter(predicate).length / rows.length;
  return {
    n: rows.length,
    recall1: +(rate(r => r.hit1) * 100).toFixed(1),
    recall5: +(rate(r => r.hit5) * 100).toFixed(1),
    mrr: +(rows.reduce((sum, r) => sum + r.rr, 0) / rows.length).toFixed(3),
  };
}

(async () => {
  const graph = JSON.parse(fs.readFileSync(path.join(repo, 'design/KG/SystemArchitecture.json'), 'utf8'));
  const queries = buildGolden(graph);

  const corpus = [];
  const channels = [
    ['Element', 'elements', object => object.id],
    ['ArchitectureRelationship', 'relationships', object => object.id],
    ['View', 'views', object => object.view_id],
  ];
  for (const [channel, property, idOf] of channels) {
    for (const object of (graph[property] || [])) {
      const id = idOf(object);
      if (!id) continue;
      const text = buildSemanticRecordText(channel, object);
      if (!text || !text.trim()) continue;
      corpus.push({ channel, id: `${channel}:${id}`, text });
    }
  }
  console.log(`corpus=${corpus.length} queries=${queries.length}`);

  const reports = {};
  for (const key of ['cloud', 'local']) {
    if (!PROVIDERS_WANTED.includes(key)) continue;
    const provider = PROVIDERS[key];
    if (!provider.baseUrl || !provider.apiKey) {
      console.log(`\n[${provider.label}] SKIP (missing config)`);
      continue;
    }
    const started = Date.now();
    const corpusVectors = await embed(provider, corpus.map(item => item.text));
    corpus.forEach((item, index) => { item.vector = corpusVectors[index]; });
    const queryVectors = await embed(provider, queries.map(item => provider.instruction + item.q));

    const rows = [];
    queries.forEach((query, queryIndex) => {
      const candidates = corpus.filter(item => item.channel === query.channel);
      const scored = candidates
        .map(item => ({ id: item.id, score: cosine(queryVectors[queryIndex], item.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K)
        .map(item => item.id);
      rows.push({ ...rankOf(scored, query.target), family: query.family, channel: query.channel });
    });

    const report = {
      ALL: agg(rows),
      name: agg(rows.filter(r => r.family === 'name')),
      desc: agg(rows.filter(r => r.family === 'desc')),
      Element: agg(rows.filter(r => r.channel === 'Element')),
      ArchitectureRelationship: agg(rows.filter(r => r.channel === 'ArchitectureRelationship')),
      View: agg(rows.filter(r => r.channel === 'View')),
    };
    console.log(`\n[${provider.label}] ${((Date.now() - started) / 1000).toFixed(0)}s`);
    console.log(JSON.stringify(report, null, 2));
    reports[key] = { label: provider.label, seconds: +((Date.now() - started) / 1000).toFixed(0), ...report };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(reports, null, 2));
  }
  console.error(`report written: ${REPORT_PATH}`);
})().catch(error => {
  console.error('ERR', error.stack || error.message);
  process.exit(1);
});
