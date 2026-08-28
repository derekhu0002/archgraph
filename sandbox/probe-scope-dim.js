#!/usr/bin/env node
'use strict';
// Probe: inspect how semantic records store canonicalIdentity (bare id vs
// prefixed), to diagnose why getSystemArchitecture scope filtering returns empty.
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
  // 1. what labels do semantic records carry?
  const labels = await s.run('MATCH (n) WHERE n.canonicalIdentity IS NOT NULL RETURN DISTINCT labels(n) AS labels, n.channel AS channel LIMIT 20');
  console.log('semantic node labels:', JSON.stringify(labels.records.map(x => x.toObject())));
  // 2. canonicalIdentity values for the memory-eval work packages
  const ids = ['memory-eval-bench-wp-001', 'memory-eval-dataset-wp-001', 'memory-eval-run-wp-001'];
  const rec = await s.run('MATCH (n) WHERE n.canonicalIdentity IN $ids RETURN n.canonicalIdentity AS id, n.channel AS channel, n.canonicalVersion AS ver LIMIT 20', { ids });
  console.log('records for wp ids:', JSON.stringify(rec.records.map(x => x.toObject())));
  // 3. do any records exist with these bare ids at all (any label)?
  const any = await s.run('MATCH (n) WHERE n.canonicalIdentity IN $ids RETURN count(*) AS c', { ids });
  console.log('count bare-id matches:', JSON.stringify(any.records.map(x => x.toObject())));
  await s.close();
  await driver.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
