'use strict';
// Probe: embed the LongMemEval question with the approved QWEN embedding model and
// query the sandbox vector index to see the actual similarity scores for Elements.
const fs = require('node:fs');
const path = require('node:path');

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', 'argo', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const base = (env.ARGO_EMBEDDING_BASE_URL || '').replace(/\/$/, '');
const question = process.argv[2] || 'What was the first issue I had with my new car after its first service?';
const db = process.argv[3] || 'sandbox';

(async () => {
  const resp = await fetch(base + '/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.QWEN_KEY },
    body: JSON.stringify({ model: env.ARGO_EMBEDDING_MODEL, input: question, dimensions: Number(env.ARGO_EMBEDDING_DIMENSIONS || 1536) }),
  });
  const j = await resp.json();
  const vec = j.data[0].embedding;
  console.log('question:', question, '| vec dim:', vec.length);

  const m = require('C:/Users/admin/.argo/node_modules/neo4j-driver');
  const driver = m.driver('neo4j://localhost:7687', m.auth.basic(env.ARGO_NEO4J_DATABASE_USERNAME, env.ARGO_NEO4J_DATABASE_PASSWORD));
  const session = driver.session({ database: db });
  for (const ch of ['Element', 'View', 'ArchitectureRelationship']) {
    const idx = ch === 'Element' ? 'argo_production_semantic_element_vector'
      : ch === 'View' ? 'argo_production_semantic_view_vector'
        : 'argo_production_semantic_relationship_vector';
    const r = await session.run(
      'CALL db.index.vector.queryNodes($idx, $k, $v) YIELD node, score WHERE node.channel = $ch RETURN node.canonicalIdentity AS id, score ORDER BY score DESC',
      { idx, k: 10, v: vec, ch },
    );
    console.log(`\n[${ch}]`);
    for (const rec of r.records) console.log('  ', JSON.stringify(rec.toObject()));
  }
  await session.close();
  await driver.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
