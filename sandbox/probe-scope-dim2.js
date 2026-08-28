#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const envFile = process.env.USERPROFILE + '/.argo/.env';
const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq <= 0) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}
const neo4j = require(path.join(process.env.USERPROFILE, '.argo/node_modules/neo4j-driver'));
const driver = neo4j.driver(env.ARGO_NEO4J_DATABASE_URL, neo4j.auth.basic(env.ARGO_NEO4J_DATABASE_USERNAME, env.ARGO_NEO4J_DATABASE_PASSWORD));
(async () => {
  const s = driver.session({ database: 'archgraph' });
  // sample actual canonicalIdentity values (any element records)
  const r = await s.run("MATCH (n:ArgoProductionSemanticElement) RETURN n.canonicalIdentity AS id LIMIT 10");
  console.log('element record ids:', JSON.stringify(r.records.map(x => x.toObject())));
  // how does the backfill construct canonicalIdentity? look for any with Element: prefix
  const p = await s.run("MATCH (n:ArgoProductionSemanticElement) WHERE n.canonicalIdentity CONTAINS 'memory-eval' RETURN n.canonicalIdentity AS id, n.channel AS ch LIMIT 20");
  console.log('memory-eval element records:', JSON.stringify(p.records.map(x => x.toObject())));
  await s.close();
  await driver.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
