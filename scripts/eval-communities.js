'use strict';

// P0 read-only community probe (component community-index-001). READ-ONLY.
//
// Answers ONE question before any product work: on the current canonical graph
// (Element nodes + ARCHIMATE_RELATES edges in the per-graphKey Neo4j projection),
// is there real community structure worth exposing as a global-retrieval view?
//
// It uses Neo4j GDS (Louvain) on an IN-MEMORY Cypher-projected graph scoped to
// the current graphKey, then drops it. It never writes canonical JSON, never
// writes persistent projection properties, and uses only *.stream/*.stats.
//
// Determinism: this GDS build has no Louvain seed config key (neither
// `randomSeed` nor `seed`), so the probe pins `concurrency: 1` and is verified
// deterministic by running it twice and comparing the partition signature.
//
// Usage:
//   node scripts/eval-communities.js
//
// Env: ARGO_NEO4J_DATABASE_URL / _USERNAME / _PASSWORD (via ~/.argo/.env).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GRAPH_KEY = 'design/KG/SystemArchitecture.json';
const DEFAULT_ALGORITHM = 'louvain';
const GRAPH_NAME_PREFIX = 'argo-community-probe';
const DETERMINISM_CONCURRENCY = 1;

function graphNameFor(graphKey) {
  const hash = crypto.createHash('sha256').update(String(graphKey)).digest('hex').slice(0, 8);
  return `${GRAPH_NAME_PREFIX}-${hash}`;
}

function quoteCypherString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function buildProjectionStatement(graphKey) {
  const graphName = graphNameFor(graphKey);
  const key = quoteCypherString(graphKey);
  // GDS in-memory graphs do not support String node properties, so the node
  // query returns only the (numeric) internal id. GraphKey scoping is inlined
  // as an escaped literal: this GDS build rejects Cypher-parameterized
  // procedure arguments, and the value is a constant so no input is injected.
  const nodeQuery =
    `MATCH (e:Element) WHERE e.graphKey = ${key} RETURN id(e) AS id`;
  const relQuery =
    'MATCH (a:Element)-[r:ARCHIMATE_RELATES]->(b:Element) ' +
    `WHERE a.graphKey = ${key} AND b.graphKey = ${key} ` +
    'RETURN id(a) AS source, id(b) AS target';
  return {
    kind: 'project',
    cypher:
      `CALL gds.graph.project.cypher(${quoteCypherString(graphName)}, ` +
      `${quoteCypherString(nodeQuery)}, ${quoteCypherString(relQuery)}) ` +
      'YIELD graphName, nodeCount, relationshipCount RETURN graphName, nodeCount, relationshipCount',
    params: {
      graphName,
      nodeQuery,
      relQuery,
      graphKey,
    },
  };
}

function buildLouvainStatement(graphName) {
  return {
    kind: 'algorithm',
    algorithm: DEFAULT_ALGORITHM,
    cypher:
      `CALL gds.louvain.stream(${quoteCypherString(graphName)}, ` +
      `{ concurrency: ${DETERMINISM_CONCURRENCY} }) ` +
      'YIELD nodeId, communityId ' +
      'WITH gds.util.asNode(nodeId) AS e, communityId ' +
      'RETURN e.id AS id, communityId',
    params: { graphName },
  };
}

function buildLouvainStatsStatement(graphName) {
  return {
    kind: 'stats',
    cypher:
      `CALL gds.louvain.stats(${quoteCypherString(graphName)}, ` +
      `{ concurrency: ${DETERMINISM_CONCURRENCY} }) ` +
      'YIELD modularity RETURN modularity',
    params: { graphName },
  };
}

function buildDropStatement(graphName) {
  return {
    kind: 'drop',
    cypher:
      `CALL gds.graph.drop(${quoteCypherString(graphName)}, false) ` +
      'YIELD graphName RETURN graphName',
    params: { graphName },
  };
}

function buildProbePlan({ graphKey = GRAPH_KEY } = {}) {
  const project = buildProjectionStatement(graphKey);
  const graphName = project.params.graphName;
  return {
    graphKey,
    graphName,
    algorithm: DEFAULT_ALGORITHM,
    determinism: { concurrency: DETERMINISM_CONCURRENCY },
    readOnly: true,
    steps: [
      project,
      buildLouvainStatement(graphName),
      buildLouvainStatsStatement(graphName),
      buildDropStatement(graphName),
    ],
  };
}

function toNumber(value) {
  if (value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

function canonicalizePartition(rows) {
  return (rows || [])
    .filter(row => row && row.id !== undefined && row.id !== null)
    .map(row => ({ id: String(row.id), communityId: toNumber(row.communityId) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function partitionSignature(rows) {
  return JSON.stringify(canonicalizePartition(rows));
}

function summarizePartition(rows) {
  const canonical = canonicalizePartition(rows);
  const members = {};
  for (const row of canonical) {
    const key = String(row.communityId);
    if (!members[key]) members[key] = [];
    members[key].push(row.id);
  }
  const sizes = {};
  let singletonCount = 0;
  for (const key of Object.keys(members)) {
    members[key].sort();
    sizes[key] = members[key].length;
    if (members[key].length === 1) singletonCount += 1;
  }
  return {
    communityCount: Object.keys(members).length,
    memberCount: canonical.length,
    singletonCount,
    singletonNodeRatio: canonical.length > 0 ? +(singletonCount / canonical.length).toFixed(3) : 0,
    sizes,
    members,
  };
}

function viewCommunityOverlap(rows, views) {
  const communityById = new Map(canonicalizePartition(rows).map(row => [row.id, row.communityId]));
  const result = [];
  for (const view of views || []) {
    const members = Array.isArray(view.included_elements) ? view.included_elements : [];
    const counts = new Map();
    let classified = 0;
    for (const id of members) {
      const key = String(id);
      if (!communityById.has(key)) continue;
      const cid = communityById.get(key);
      counts.set(cid, (counts.get(cid) || 0) + 1);
      classified += 1;
    }
    let dominantCommunity = null;
    let dominantCount = 0;
    for (const [cid, count] of counts) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantCommunity = cid;
      }
    }
    result.push({
      view_id: view.view_id,
      view_name: view.view_name,
      memberCount: members.length,
      classifiedMemberCount: classified,
      dominantCommunity,
      dominantCount,
      purity: classified > 0 ? +(dominantCount / classified).toFixed(3) : null,
    });
  }
  return result;
}

function stopVerdict({
  communityCount = 0,
  memberCount = 0,
  singletonNodeRatio = 0,
  modularity = null,
} = {}) {
  const reasons = [];
  if (memberCount === 0) reasons.push('no-members');
  if (communityCount <= 1) reasons.push('degenerate-single-community');
  if (memberCount > 0 && communityCount / memberCount >= 0.8) reasons.push('fragmented');
  if (singletonNodeRatio >= 0.5) reasons.push('singleton-dominated');
  if (typeof modularity === 'number' && modularity < 0.1) reasons.push('weak-modularity');
  return { stop: reasons.length > 0, reasons };
}

function buildReport({
  graphKey,
  algorithm,
  determinism,
  partition,
  elements,
  views,
  modularity = null,
  nodeCount = null,
  relationshipCount = null,
  sampleSize = 8,
} = {}) {
  const summary = summarizePartition(partition);
  const nameById = new Map((elements || []).map(element => [String(element.id), element.name]));
  const communities = Object.entries(summary.members)
    .map(([cid, ids]) => ({
      communityId: Number(cid),
      size: ids.length,
      sample: ids.slice(0, sampleSize).map(id => nameById.get(id) || id),
    }))
    .sort((a, b) => b.size - a.size);
  const viewOverlap = viewCommunityOverlap(partition, views)
    .filter(view => view.classifiedMemberCount > 0)
    .sort((a, b) => b.classifiedMemberCount - a.classifiedMemberCount);
  const verdict = stopVerdict({ ...summary, modularity });
  const signature = partitionSignature(partition);
  return {
    graphKey,
    algorithm,
    determinism,
    nodeCount,
    relationshipCount,
    communityCount: summary.communityCount,
    memberCount: summary.memberCount,
    singletonCount: summary.singletonCount,
    singletonNodeRatio: summary.singletonNodeRatio,
    modularity,
    sizes: summary.sizes,
    communities,
    viewOverlap,
    verdict,
    partitionSignature: signature,
    partitionSignatureHash: partitionSignatureHash(signature),
  };
}

function partitionSignatureHash(signature) {
  return crypto.createHash('sha256').update(String(signature)).digest('hex');
}

function sizeHistogram(sizes) {
  return Object.values(sizes || {}).reduce((histogram, size) => {
    histogram[size] = (histogram[size] || 0) + 1;
    return histogram;
  }, {});
}

function buildSummary(report, topN = 10) {
  return {
    graphKey: report.graphKey,
    algorithm: report.algorithm,
    determinism: report.determinism,
    nodeCount: report.nodeCount,
    relationshipCount: report.relationshipCount,
    communityCount: report.communityCount,
    memberCount: report.memberCount,
    singletonCount: report.singletonCount,
    singletonNodeRatio: report.singletonNodeRatio,
    modularity: report.modularity,
    sizeHistogram: sizeHistogram(report.sizes),
    viewOverlapTop: (report.viewOverlap || []).slice(0, topN),
    verdict: report.verdict,
    partitionSignatureHash: report.partitionSignatureHash,
  };
}

async function main() {
  const repo = path.resolve(__dirname, '..');
  const graphPath = path.join(repo, 'design', 'KG', 'SystemArchitecture.json');
  const before = fs.readFileSync(graphPath);
  const graph = JSON.parse(before.toString('utf8'));

  const {
    loadRepositoryArgoEnvironment,
  } = require(path.join(repo, 'argo', 'scripts', 'repositoryArgoEnvironment.js'));
  loadRepositoryArgoEnvironment(repo);
  const {
    getNeo4jConfig,
  } = require(path.join(repo, 'argo', 'scripts', 'neo4j-system-architecture-store.js'));
  const config = getNeo4jConfig({ workspaceRoot: repo });

  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
  const session = driver.session({ database: config.database });

  const plan = buildProbePlan({ graphKey: GRAPH_KEY });
  const project = plan.steps.find(step => step.kind === 'project');
  const algorithm = plan.steps.find(step => step.kind === 'algorithm');
  const stats = plan.steps.find(step => step.kind === 'stats');
  const drop = plan.steps.find(step => step.kind === 'drop');

  let partition = [];
  let modularity = null;
  let nodeCount = null;
  let relationshipCount = null;

  try {
    const projectResult = await session.run(project.cypher);
    if (projectResult.records[0]) {
      nodeCount = toNumber(projectResult.records[0].get('nodeCount'));
      relationshipCount = toNumber(projectResult.records[0].get('relationshipCount'));
    }
    const streamResult = await session.run(algorithm.cypher);
    partition = streamResult.records.map(record => ({
      id: record.get('id'),
      communityId: toNumber(record.get('communityId')),
    }));
    try {
      const statsResult = await session.run(stats.cypher);
      if (statsResult.records[0]) {
        modularity = toNumber(statsResult.records[0].get('modularity'));
      }
    } catch (error) {
      console.error('[argo] louvain stats unavailable:', error && error.message);
    }
  } finally {
    try {
      await session.run(drop.cypher);
    } catch (error) {
      console.error('[argo] gds.graph.drop failed:', error && error.message);
    }
    await session.close();
    await driver.close();
  }

  const report = buildReport({
    graphKey: GRAPH_KEY,
    algorithm: plan.algorithm,
    determinism: plan.determinism,
    partition,
    elements: graph.elements || [],
    views: graph.views || [],
    modularity,
    nodeCount,
    relationshipCount,
  });
  const summaryOnly = process.argv.includes('--summary');
  console.log(JSON.stringify(summaryOnly ? buildSummary(report) : report, null, 2));

  const after = fs.readFileSync(graphPath);
  if (!before.equals(after)) {
    throw new Error('READ_ONLY_VIOLATION: canonical graph changed during community probe');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('ERR', error && (error.stack || error.message || error));
    process.exit(1);
  });
}

module.exports = {
  GRAPH_KEY,
  DEFAULT_ALGORITHM,
  DETERMINISM_CONCURRENCY,
  graphNameFor,
  quoteCypherString,
  buildProjectionStatement,
  buildLouvainStatement,
  buildLouvainStatsStatement,
  buildDropStatement,
  buildProbePlan,
  toNumber,
  canonicalizePartition,
  partitionSignature,
  partitionSignatureHash,
  summarizePartition,
  viewCommunityOverlap,
  stopVerdict,
  buildReport,
  sizeHistogram,
  buildSummary,
  main,
};
