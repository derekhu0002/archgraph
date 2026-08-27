'use strict';
const fs = require('node:fs');
const path = require('node:path');
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', 'argo', '.env'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const m = require('C:/Users/admin/.argo/node_modules/neo4j-driver');
const driver = m.driver('neo4j://localhost:7687', m.auth.basic(env.ARGO_NEO4J_DATABASE_USERNAME, env.ARGO_NEO4J_DATABASE_PASSWORD));
(async () => {
  for (const db of [process.argv[2] || 'archgraph']) {
    const s = driver.session({ database: db });
    const r = await s.run("SHOW INDEXES YIELD name, type, options WHERE type = 'VECTOR' RETURN name, options AS opts");
    console.log(`[${db}]`);
    for (const rec of r.records) {
      const o = rec.get('opts') || {};
      console.log(' ', rec.get('name'), 'dim=', o.indexConfig && o.indexConfig['vector.dimensions']);
    }
    await s.close();
  }
  await driver.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
