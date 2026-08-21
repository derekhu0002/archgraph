const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveExternalProductionConfig,
} = require('./graph-rag/externalProductionConfig.js');
const {
  getWorkspaceRoot,
} = require('./argo-paths.js');

const DEFAULT_GRAPH_PATH = 'design/KG/SystemArchitecture.json';
const SYNC_STATE_RELATIVE_PATH = '.argo/temp/neo4j-system-architecture-sync-state.json';
const LEGACY_NEO4J_ENV_KEYS = Object.freeze([
  'ARGO_NEO4J_URI',
  'ARGO_NEO4J_USERNAME',
  'ARGO_NEO4J_PASSWORD',
]);
const APPROVED_NEO4J_CONFIG = Symbol('approvedNeo4jConfig');
const DISALLOWED_RUNTIME_OVERRIDE_FIELDS = Object.freeze([
  'uri',
  'username',
  'password',
  'neo4jUri',
  'neo4jUsername',
  'neo4jPassword',
  'embeddingCredential',
]);

let neo4jDriverModule;
function requireNeo4jDriver() {
  if (!neo4jDriverModule) {
    neo4jDriverModule = require('neo4j-driver');
  }
  return neo4jDriverModule;
}

function getRepoRoot(workspaceRoot) {
  return workspaceRoot && typeof workspaceRoot === 'string' && workspaceRoot.trim() !== ''
    ? path.resolve(workspaceRoot)
    : getWorkspaceRoot();
}

function resolveArchitecturePath(architecturePath = DEFAULT_GRAPH_PATH, workspaceRoot) {
  return path.join(getRepoRoot(workspaceRoot), architecturePath);
}

function resolveSyncStatePath(workspaceRoot) {
  return path.join(getRepoRoot(workspaceRoot), SYNC_STATE_RELATIVE_PATH);
}

function getDefaultNeo4jDatabaseName(workspaceRoot) {
  const repoName = path.basename(getRepoRoot(workspaceRoot));
  const normalized = String(repoName)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-');
  const safe = normalized || 'workspace';
  const prefixed = /^[a-z]/.test(safe) ? safe : `db-${safe}`;
  return prefixed.slice(0, 63);
}

function getNeo4jConfig(overrides = {}) {
  if (overrides && overrides[APPROVED_NEO4J_CONFIG] === true) {
    return overrides;
  }

  rejectLegacyNeo4jEnvironment();
  rejectRuntimeConfigurationOverrides(overrides);
  const external = resolveExternalProductionConfig({
    neo4jUri: process.env.ARGO_NEO4J_DATABASE_URL,
    neo4jUsername: process.env.ARGO_NEO4J_DATABASE_USERNAME,
    neo4jPassword: process.env.ARGO_NEO4J_DATABASE_PASSWORD,
    embeddingCredential: process.env.QWEN_KEY,
  }, {
    operation: 'start',
    sourceKeys: new Map([
      ['neo4jUri', 'ARGO_NEO4J_DATABASE_URL'],
      ['neo4jUsername', 'ARGO_NEO4J_DATABASE_USERNAME'],
      ['neo4jPassword', 'ARGO_NEO4J_DATABASE_PASSWORD'],
      ['embeddingCredential', 'QWEN_KEY'],
    ]),
  });
  return {
    [APPROVED_NEO4J_CONFIG]: true,
    uri: external.neo4jUri,
    username: external.neo4jUsername,
    password: external.neo4jPassword,
    database: overrides.database || process.env.ARGO_NEO4J_DATABASE || getDefaultNeo4jDatabaseName(overrides.workspaceRoot),
  };
}

function rejectLegacyNeo4jEnvironment() {
  const legacyKey = LEGACY_NEO4J_ENV_KEYS.find(key => {
    const value = process.env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
  if (!legacyKey) {
    return;
  }

  const error = new Error(`${legacyKey} is not an approved Neo4j configuration source`);
  error.category = 'UNSUPPORTED_LEGACY_NEO4J_ENV_ALIAS';
  error.field = legacyKey;
  throw error;
}

function rejectRuntimeConfigurationOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') {
    return;
  }

  const field = DISALLOWED_RUNTIME_OVERRIDE_FIELDS.find(candidate => (
    Object.prototype.hasOwnProperty.call(overrides, candidate)
      && overrides[candidate] !== undefined
  ));
  if (!field) {
    return;
  }

  const error = new Error(`${field} is not an approved runtime configuration source`);
  error.category = 'UNAPPROVED_RUNTIME_CONFIG_SOURCE';
  error.field = field;
  throw error;
}

function createDriver(config = {}) {
  const resolved = getNeo4jConfig(config);
  const neo4j = requireNeo4jDriver();
  return neo4j.driver(
    resolved.uri,
    neo4j.auth.basic(resolved.username, resolved.password),
  );
}

function readArchitectureDocument(architecturePath = DEFAULT_GRAPH_PATH, workspaceRoot) {
  const absolutePath = resolveArchitecturePath(architecturePath, workspaceRoot);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`System architecture file is missing at ${architecturePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${architecturePath}: ${String(error)}`);
  }
}

function digestCanonicalArchitecture(architecturePath = DEFAULT_GRAPH_PATH, workspaceRoot) {
  const absolutePath = resolveArchitecturePath(architecturePath, workspaceRoot);
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
  } catch {
    return null;
  }
}

function isNeo4jGraphSyncStale(syncState, currentDigest) {
  if (!syncState || typeof syncState !== 'object') return false;
  if (!currentDigest || typeof currentDigest !== 'string') return false;
  const hasDigest = typeof syncState.canonicalDigest === 'string' && syncState.canonicalDigest.length > 0;
  if (hasDigest) return syncState.canonicalDigest !== currentDigest;
  return typeof syncState.lastSuccessAt === 'string' && syncState.lastSuccessAt.length > 0;
}

function sanitizeProps(properties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  );
}

function asJson(value) {
  return value === undefined ? null : JSON.stringify(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildGraphKey(architecturePath = DEFAULT_GRAPH_PATH) {
  return architecturePath.replace(/\\/g, '/');
}

function createEmptySyncState() {
  return {
    version: 1,
    graphs: {},
  };
}

function readNeo4jSyncState(workspaceRoot) {
  const statePath = resolveSyncStatePath(workspaceRoot);
  if (!fs.existsSync(statePath)) {
    return createEmptySyncState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.graphs !== 'object') {
      return createEmptySyncState();
    }
    return parsed;
  } catch {
    return createEmptySyncState();
  }
}

function writeNeo4jSyncState(state, workspaceRoot) {
  const statePath = resolveSyncStatePath(workspaceRoot);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getNeo4jGraphSyncState(architecturePath = DEFAULT_GRAPH_PATH, workspaceRoot) {
  const graphKey = buildGraphKey(architecturePath);
  const state = readNeo4jSyncState(workspaceRoot);
  return {
    graphKey,
    dirty: false,
    ...(state.graphs[graphKey] || {}),
  };
}

function updateNeo4jGraphSyncState(architecturePath, patch, workspaceRoot) {
  const graphKey = buildGraphKey(architecturePath);
  const state = readNeo4jSyncState(workspaceRoot);
  state.graphs[graphKey] = {
    graphKey,
    dirty: false,
    ...(state.graphs[graphKey] || {}),
    ...patch,
  };
  writeNeo4jSyncState(state, workspaceRoot);
  return state.graphs[graphKey];
}

function markNeo4jSyncDirty(architecturePath, error, workspaceRoot) {
  return updateNeo4jGraphSyncState(architecturePath, {
    dirty: true,
    lastError: String(error && error.message ? error.message : error),
    lastFailureAt: new Date().toISOString(),
  }, workspaceRoot);
}

function markNeo4jSyncClean(architecturePath, verification, workspaceRoot) {
  const current = getNeo4jGraphSyncState(architecturePath, workspaceRoot);
  const canonicalDigest = digestCanonicalArchitecture(architecturePath, workspaceRoot);
  return updateNeo4jGraphSyncState(architecturePath, {
    dirty: false,
    lastError: undefined,
    lastRecoveredAt: current.dirty ? new Date().toISOString() : current.lastRecoveredAt,
    lastSuccessAt: new Date().toISOString(),
    lastVerifiedCounts: verification ? verification.actual : current.lastVerifiedCounts,
    canonicalDigest,
  }, workspaceRoot);
}

function isCanonicalArchitecturePath(architecturePath = DEFAULT_GRAPH_PATH) {
  return buildGraphKey(architecturePath) === buildGraphKey(DEFAULT_GRAPH_PATH);
}

function buildGraphRecord(document, graphKey) {
  return sanitizeProps({
    graphKey,
    source_path: graphKey,
    name: document.name,
    description: document.description,
    attributes_json: asJson(document.attributes || []),
    raw_json: asJson(document),
    element_count: asArray(document.elements).length,
    relationship_count: asArray(document.relationships).length,
    view_count: asArray(document.views).length,
  });
}

function buildElementRecord(graphKey, element) {
  return sanitizeProps({
    graphKey,
    id: element.id,
    name: element.name,
    type: element.type,
    parent: element.parent,
    alias: element.alias,
    classifier: element.classifier,
    description: element.description,
    attributes_json: asJson(element.attributes || []),
    subdiagram_views_json: asJson(element.subdiagram_views || []),
    testcases_json: asJson(element.testcases || []),
    raw_json: asJson(element),
  });
}

function buildRelationshipRecord(graphKey, relationship) {
  return sanitizeProps({
    graphKey,
    id: relationship.id,
    name: relationship.name,
    type: relationship.type,
    statement: relationship.statement,
    description: relationship.description,
    document: relationship.document,
    attributes_json: asJson(relationship.attributes || []),
    source_id: relationship.source_id,
    source_name: relationship.source_name,
    target_id: relationship.target_id,
    target_name: relationship.target_name,
    raw_json: asJson(relationship),
  });
}

function buildViewRecord(graphKey, view) {
  return sanitizeProps({
    graphKey,
    view_id: view.view_id,
    view_name: view.view_name,
    parent_element_id: view.parent_element_id,
    parent_element_name: view.parent_element_name,
    description: view.description,
    included_elements_json: asJson(view.included_elements || []),
    included_relationships_json: asJson(view.included_relationships || []),
    raw_json: asJson(view),
  });
}

async function ensureConstraints(driver, database) {
  const session = driver.session({ database });
  try {
    await session.run('CREATE CONSTRAINT argo_architecture_graph_key IF NOT EXISTS FOR (g:ArchitectureGraph) REQUIRE g.graphKey IS UNIQUE');
    await session.run('CREATE CONSTRAINT argo_architecture_element_key IF NOT EXISTS FOR (e:Element) REQUIRE (e.graphKey, e.id) IS UNIQUE');
    await session.run('CREATE CONSTRAINT argo_architecture_relationship_key IF NOT EXISTS FOR (r:ArchitectureRelationship) REQUIRE (r.graphKey, r.id) IS UNIQUE');
    await session.run('CREATE CONSTRAINT argo_architecture_view_key IF NOT EXISTS FOR (v:View) REQUIRE (v.graphKey, v.view_id) IS UNIQUE');
  } finally {
    await session.close();
  }
}

function escapeNeo4jIdentifier(value) {
  return String(value).replace(/`/g, '``');
}

async function ensureDatabaseExists(driver, database) {
  const systemSession = driver.session({ database: 'system' });
  try {
    const existingResult = await systemSession.run(
      'SHOW DATABASES YIELD name WHERE name = $database RETURN name',
      { database },
    );
    if (existingResult.records.length > 0) {
      return {
        database,
        existed: true,
        created: false,
      };
    }

    await systemSession.run(`CREATE DATABASE \`${escapeNeo4jIdentifier(database)}\` IF NOT EXISTS`);
    return {
      database,
      existed: false,
      created: true,
    };
  } finally {
    await systemSession.close();
  }
}

async function waitForDatabaseOnline(driver, database, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const pollIntervalMs = options.pollIntervalMs || 250;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const systemSession = driver.session({ database: 'system' });
    try {
      const result = await systemSession.run(
        [
          'SHOW DATABASES YIELD name, currentStatus, requestedStatus',
          'WHERE name = $database',
          'RETURN currentStatus, requestedStatus',
        ].join('\n'),
        { database },
      );
      if (result.records.length > 0) {
        const currentStatus = String(result.records[0].get('currentStatus') || '').toLowerCase();
        const requestedStatus = String(result.records[0].get('requestedStatus') || '').toLowerCase();
        if (currentStatus === 'online' && requestedStatus === 'online') {
          return {
            database,
            currentStatus,
            requestedStatus,
          };
        }
      }
    } finally {
      await systemSession.close();
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Neo4j database '${database}' did not reach online status within ${timeoutMs}ms`);
}

async function clearGraph(tx, graphKey) {
  await tx.run('MATCH (n {graphKey: $graphKey}) DETACH DELETE n', { graphKey });
}

async function writeGraphMetadata(tx, graphRecord) {
  await tx.run(
    [
      'MERGE (g:ArchitectureGraph {graphKey: $graph.graphKey})',
      'SET g += $graph',
      'SET g.synced_at = datetime()',
    ].join('\n'),
    { graph: graphRecord },
  );
}

async function writeElements(tx, graphKey, elements) {
  if (elements.length === 0) {
    return;
  }

  await tx.run(
    [
      'UNWIND $rows AS row',
      'MATCH (g:ArchitectureGraph {graphKey: $graphKey})',
      'CREATE (e:Element)',
      'SET e += row',
      'MERGE (g)-[:OWNS_ELEMENT]->(e)',
    ].join('\n'),
    { graphKey, rows: elements },
  );
}

async function writeRelationships(tx, graphKey, relationships) {
  if (relationships.length === 0) {
    return;
  }

  await tx.run(
    [
      'UNWIND $rows AS row',
      'MATCH (g:ArchitectureGraph {graphKey: $graphKey})',
      'MATCH (source:Element {graphKey: $graphKey, id: row.source_id})',
      'MATCH (target:Element {graphKey: $graphKey, id: row.target_id})',
      'CREATE (rel:ArchitectureRelationship)',
      'SET rel += row',
      'MERGE (g)-[:OWNS_RELATIONSHIP]->(rel)',
      'MERGE (rel)-[:RELATIONSHIP_SOURCE]->(source)',
      'MERGE (rel)-[:RELATIONSHIP_TARGET]->(target)',
      'MERGE (source)-[edge:ARCHIMATE_RELATES {graphKey: $graphKey, relationship_id: row.id}]->(target)',
      'SET edge.relationship_type = row.type,',
      '    edge.name = row.name,',
      '    edge.statement = row.statement,',
      '    edge.source_name = row.source_name,',
      '    edge.target_name = row.target_name',
    ].join('\n'),
    { graphKey, rows: relationships },
  );
}

async function writeViews(tx, graphKey, views) {
  if (views.length === 0) {
    return;
  }

  await tx.run(
    [
      'UNWIND $rows AS row',
      'MATCH (g:ArchitectureGraph {graphKey: $graphKey})',
      'CREATE (view:View)',
      'SET view += row',
      'MERGE (g)-[:OWNS_VIEW]->(view)',
      'WITH view, row',
      'OPTIONAL MATCH (parent:Element {graphKey: $graphKey, id: row.parent_element_id})',
      'FOREACH (_ IN CASE WHEN parent IS NULL THEN [] ELSE [1] END | MERGE (view)-[:VIEW_OF]->(parent))',
    ].join('\n'),
    { graphKey, rows: views },
  );
}

async function writeViewMemberships(tx, graphKey, views) {
  const elementMemberships = [];
  const relationshipMemberships = [];

  for (const view of views) {
    for (const [index, elementId] of asArray(view.included_elements).entries()) {
      elementMemberships.push({ view_id: view.view_id, element_id: elementId, order: index });
    }
    for (const [index, relationshipId] of asArray(view.included_relationships).entries()) {
      relationshipMemberships.push({ view_id: view.view_id, relationship_id: relationshipId, order: index });
    }
  }

  if (elementMemberships.length > 0) {
    await tx.run(
      [
        'UNWIND $rows AS row',
        'MATCH (view:View {graphKey: $graphKey, view_id: row.view_id})',
        'MATCH (element:Element {graphKey: $graphKey, id: row.element_id})',
        'MERGE (view)-[membership:INCLUDES_ELEMENT {order: row.order}]->(element)',
      ].join('\n'),
      { graphKey, rows: elementMemberships },
    );
  }

  if (relationshipMemberships.length > 0) {
    await tx.run(
      [
        'UNWIND $rows AS row',
        'MATCH (view:View {graphKey: $graphKey, view_id: row.view_id})',
        'MATCH (relationship:ArchitectureRelationship {graphKey: $graphKey, id: row.relationship_id})',
        'MERGE (view)-[membership:INCLUDES_RELATIONSHIP {order: row.order}]->(relationship)',
      ].join('\n'),
      { graphKey, rows: relationshipMemberships },
    );
  }
}

async function writeSubdiagramLinks(tx, graphKey, elements) {
  const rows = [];

  for (const element of elements) {
    for (const subdiagramView of asArray(element.subdiagram_views)) {
      rows.push({ element_id: element.id, view_id: subdiagramView.view_id });
    }
  }

  if (rows.length === 0) {
    return;
  }

  await tx.run(
    [
      'UNWIND $rows AS row',
      'MATCH (element:Element {graphKey: $graphKey, id: row.element_id})',
      'MATCH (view:View {graphKey: $graphKey, view_id: row.view_id})',
      'MERGE (element)-[:HAS_SUBDIAGRAM]->(view)',
    ].join('\n'),
    { graphKey, rows },
  );
}

async function syncArchitectureToNeo4j(options = {}) {
  const architecturePath = options.architecturePath || DEFAULT_GRAPH_PATH;
  const workspaceRoot = options.workspaceRoot;
  const graphKey = buildGraphKey(architecturePath);
  const document = options.document || readArchitectureDocument(architecturePath, workspaceRoot);
  const config = getNeo4jConfig(options);
  const driver = options.driver || createDriver(config);
  const ownDriver = !options.driver;

  try {
    await driver.verifyConnectivity();
    const databaseProvision = await ensureDatabaseExists(driver, config.database);
    const databaseStatus = await waitForDatabaseOnline(driver, config.database);
    await ensureConstraints(driver, config.database);

    const session = driver.session({ database: config.database });
    try {
      await session.executeWrite(async tx => {
        await clearGraph(tx, graphKey);
        await writeGraphMetadata(tx, buildGraphRecord(document, graphKey));
        await writeElements(tx, graphKey, asArray(document.elements).map(element => buildElementRecord(graphKey, element)));
        await writeRelationships(tx, graphKey, asArray(document.relationships).map(relationship => buildRelationshipRecord(graphKey, relationship)));
        await writeViews(tx, graphKey, asArray(document.views).map(view => buildViewRecord(graphKey, view)));
        await writeViewMemberships(tx, graphKey, asArray(document.views));
        await writeSubdiagramLinks(tx, graphKey, asArray(document.elements));
      });
    } finally {
      await session.close();
    }

    const verification = await verifyArchitectureSync({
      architecturePath,
      document,
      driver,
      ...config,
    });

    if (!verification.matches) {
      throw new Error(`Neo4j sync verification mismatch for ${graphKey}`);
    }

    if (isCanonicalArchitecturePath(architecturePath)) {
      markNeo4jSyncClean(architecturePath, verification, workspaceRoot);
    }

    return {
      architecturePath,
      graphKey,
      databaseProvision: {
        ...databaseProvision,
        ...databaseStatus,
      },
      counts: verification.expected,
      verification,
    };
  } catch (error) {
    if (isCanonicalArchitecturePath(architecturePath)) {
      markNeo4jSyncDirty(architecturePath, error, workspaceRoot);
    }
    throw error;
  } finally {
    if (ownDriver) {
      await driver.close();
    }
  }
}

async function recoverNeo4jSyncIfNeeded(options = {}) {
  const architecturePath = options.architecturePath || DEFAULT_GRAPH_PATH;
  const workspaceRoot = options.workspaceRoot;
  if (!isCanonicalArchitecturePath(architecturePath)) {
    return {
      attempted: false,
      eligible: false,
      dirty: false,
    };
  }

  const syncState = getNeo4jGraphSyncState(architecturePath, workspaceRoot);
  const stale = isNeo4jGraphSyncStale(syncState, digestCanonicalArchitecture(architecturePath, workspaceRoot));
  if (!syncState.dirty && !stale) {
    return {
      attempted: false,
      eligible: true,
      dirty: false,
      stale: false,
    };
  }

  try {
    const result = await syncArchitectureToNeo4j(options);
    return {
      attempted: true,
      eligible: true,
      dirty: false,
      stale: false,
      status: 'passed',
      graphKey: result.graphKey,
      databaseProvision: result.databaseProvision,
      counts: result.counts,
      previousFailure: syncState.lastError,
    };
  } catch (error) {
    return {
      attempted: true,
      eligible: true,
      dirty: true,
      stale: false,
      status: 'failed',
      graphKey: syncState.graphKey,
      previousFailure: syncState.lastError,
      error: String(error && error.message ? error.message : error),
    };
  }
}

async function verifyArchitectureSync(options = {}) {
  const architecturePath = options.architecturePath || DEFAULT_GRAPH_PATH;
  const workspaceRoot = options.workspaceRoot;
  const graphKey = buildGraphKey(architecturePath);
  const document = options.document || readArchitectureDocument(architecturePath, workspaceRoot);
  const config = getNeo4jConfig(options);
  const driver = options.driver || createDriver(config);
  const ownDriver = !options.driver;

  try {
    await driver.verifyConnectivity();
    const databaseProvision = await ensureDatabaseExists(driver, config.database);
    const databaseStatus = await waitForDatabaseOnline(driver, config.database);
    const session = driver.session({ database: config.database });
    try {
      const countsResult = await session.executeRead(tx => tx.run(
        [
          'MATCH (g:ArchitectureGraph {graphKey: $graphKey})',
          'RETURN',
          '  g.name AS name,',
          '  g.description AS description,',
          '  g.element_count AS declaredElementCount,',
          '  g.relationship_count AS declaredRelationshipCount,',
          '  g.view_count AS declaredViewCount,',
          '  COUNT { (g)-[:OWNS_ELEMENT]->() } AS elementCount,',
          '  COUNT { (g)-[:OWNS_RELATIONSHIP]->() } AS relationshipCount,',
          '  COUNT { (g)-[:OWNS_VIEW]->() } AS viewCount',
        ].join('\n'),
        { graphKey },
      ));

      if (countsResult.records.length === 0) {
        throw new Error(`No ArchitectureGraph node found for ${graphKey}`);
      }

      const idResult = await session.executeRead(tx => tx.run(
        [
          'CALL {',
          '  MATCH (e:Element {graphKey: $graphKey})',
          '  RETURN collect(e.id) AS elementIds',
          '}',
          'CALL {',
          '  MATCH (r:ArchitectureRelationship {graphKey: $graphKey})',
          '  RETURN collect(r.id) AS relationshipIds',
          '}',
          'CALL {',
          '  MATCH (v:View {graphKey: $graphKey})',
          '  RETURN collect(v.view_id) AS viewIds',
          '}',
          'RETURN elementIds, relationshipIds, viewIds',
        ].join('\n'),
        { graphKey },
      ));

      const countsRecord = countsResult.records[0];
      const idsRecord = idResult.records[0];
      const expected = buildExpectedCounts(document);
      const actual = {
        elements: toNumber(countsRecord.get('elementCount')),
        relationships: toNumber(countsRecord.get('relationshipCount')),
        views: toNumber(countsRecord.get('viewCount')),
      };

      const actualIds = {
        elements: sortStrings(idsRecord.get('elementIds')),
        relationships: sortStrings(idsRecord.get('relationshipIds')),
        views: sortStrings(idsRecord.get('viewIds')),
      };
      const expectedIds = {
        elements: sortStrings(asArray(document.elements).map(element => element.id)),
        relationships: sortStrings(asArray(document.relationships).map(relationship => relationship.id)),
        views: sortStrings(asArray(document.views).map(view => view.view_id)),
      };

      return {
        graphKey,
        databaseProvision: {
          ...databaseProvision,
          ...databaseStatus,
        },
        expected,
        actual,
        matches: (
          expected.elements === actual.elements
          && expected.relationships === actual.relationships
          && expected.views === actual.views
          && arraysEqual(expectedIds.elements, actualIds.elements)
          && arraysEqual(expectedIds.relationships, actualIds.relationships)
          && arraysEqual(expectedIds.views, actualIds.views)
        ),
        expectedIds,
        actualIds,
      };
    } finally {
      await session.close();
    }
  } finally {
    if (ownDriver) {
      await driver.close();
    }
  }
}

function buildExpectedCounts(document) {
  return {
    elements: asArray(document.elements).length,
    relationships: asArray(document.relationships).length,
    views: asArray(document.views).length,
  };
}

function sortStrings(values) {
  return asArray(values).map(value => String(value)).sort();
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toNumber(value) {
  if (requireNeo4jDriver().isInt(value)) {
    return value.toNumber();
  }
  return Number(value);
}

// --- Read-only Cypher query + structural projection schema -------------------

const FORBIDDEN_CYPHER_CLAUSES = Object.freeze([
  'CREATE',
  'MERGE',
  'DELETE',
  'SET',
  'REMOVE',
  'DROP',
  'LOAD CSV',
  'FOREACH',
  'IN TRANSACTIONS',
]);

function stripCypherNoise(cypher) {
  let result = String(cypher);
  // Block comments.
  result = result.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Line comments.
  result = result.replace(/\/\/[^\r\n]*/g, ' ');
  // Single-quoted string literals.
  result = result.replace(/'(?:[^'\\]|\\.)*'/g, ' ');
  // Double-quoted identifiers/literals.
  result = result.replace(/"(?:[^"\\]|\\.)*"/g, ' ');
  // Backtick-escaped identifiers.
  result = result.replace(/`(?:[^`\\]|\\.)*`/g, ' ');
  return result;
}

function assertReadOnlyCypher(cypher) {
  if (typeof cypher !== 'string' || cypher.trim().length === 0) {
    const error = new Error('cypher must be a non-empty string');
    error.category = 'CYPHER_QUERY_REQUIRED';
    throw error;
  }
  if (cypher.length > 20000) {
    const error = new Error('cypher exceeds the 20000 character limit');
    error.category = 'CYPHER_QUERY_TOO_LONG';
    throw error;
  }

  const normalized = stripCypherNoise(cypher).toUpperCase();
  const found = FORBIDDEN_CYPHER_CLAUSES.find(clause => {
    const escaped = clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(normalized);
  });
  if (found) {
    const error = new Error(`Cypher write clause '${found}' is not allowed; the Neo4j graph query interface is read-only`);
    error.category = 'READ_ONLY_CYPHER_REQUIRED';
    error.clause = found;
    throw error;
  }
  return true;
}

function serializeNeo4jValue(value) {
  if (value === null || value === undefined) {
    return value === undefined ? null : value;
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  let neo4j = null;
  try {
    neo4j = requireNeo4jDriver();
  } catch {
    neo4j = null;
  }

  if (neo4j && typeof neo4j.isInt === 'function' && neo4j.isInt(value)) {
    if (typeof value.inSafeRange === 'function' && value.inSafeRange()) {
      return value.toNumber();
    }
    return value.toString();
  }
  if (neo4j && typeof neo4j.isNode === 'function' && neo4j.isNode(value)) {
    return {
      $node: {
        identity: value.identity ? String(value.identity) : null,
        labels: Array.isArray(value.labels) ? value.labels : [],
        properties: serializeNeo4jValue(value.properties),
      },
    };
  }
  if (neo4j && typeof neo4j.isRelationship === 'function' && neo4j.isRelationship(value)) {
    return {
      $relationship: {
        identity: value.identity ? String(value.identity) : null,
        type: value.type,
        start: value.start ? String(value.start) : null,
        end: value.end ? String(value.end) : null,
        properties: serializeNeo4jValue(value.properties),
      },
    };
  }
  if (neo4j && typeof neo4j.isPath === 'function' && neo4j.isPath(value)) {
    return {
      $path: {
        start: serializeNeo4jValue(value.start),
        end: serializeNeo4jValue(value.end),
        length: serializeNeo4jValue(value.length),
        segments: Array.isArray(value.segments) ? value.segments.map(serializeNeo4jValue) : [],
      },
    };
  }
  if (Array.isArray(value)) {
    return value.map(serializeNeo4jValue);
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = serializeNeo4jValue(item);
    }
    return result;
  }
  return String(value);
}

function buildNeo4jGraphSchema(architecturePath = DEFAULT_GRAPH_PATH) {
  return {
    graphKey: buildGraphKey(architecturePath),
    nodeLabels: {
      ArchitectureGraph: {
        description: 'One node per canonical graph document; identified by graphKey.',
        properties: [
          'graphKey',
          'source_path',
          'name',
          'description',
          'attributes_json',
          'raw_json',
          'element_count',
          'relationship_count',
          'view_count',
        ],
      },
      Element: {
        description: 'Canonical architecture elements. Element.type holds the ArchiMate element type.',
        properties: [
          'graphKey',
          'id',
          'name',
          'type',
          'parent',
          'alias',
          'classifier',
          'description',
          'attributes_json',
          'subdiagram_views_json',
          'testcases_json',
          'raw_json',
        ],
      },
      ArchitectureRelationship: {
        description: 'Canonical architecture relationships. type holds the ArchiMate relationship type; source_id/target_id reference Element.id.',
        properties: [
          'graphKey',
          'id',
          'name',
          'type',
          'statement',
          'description',
          'document',
          'attributes_json',
          'source_id',
          'source_name',
          'target_id',
          'target_name',
          'raw_json',
        ],
      },
      View: {
        description: 'Canonical views; identified by view_id.',
        properties: [
          'graphKey',
          'view_id',
          'view_name',
          'parent_element_id',
          'parent_element_name',
          'description',
          'included_elements_json',
          'included_relationships_json',
          'raw_json',
        ],
      },
    },
    relationshipTypes: {
      OWNS_ELEMENT: { from: 'ArchitectureGraph', to: 'Element' },
      OWNS_RELATIONSHIP: { from: 'ArchitectureGraph', to: 'ArchitectureRelationship' },
      OWNS_VIEW: { from: 'ArchitectureGraph', to: 'View' },
      RELATIONSHIP_SOURCE: { from: 'ArchitectureRelationship', to: 'Element', description: 'Source endpoint element of a relationship record.' },
      RELATIONSHIP_TARGET: { from: 'ArchitectureRelationship', to: 'Element', description: 'Target endpoint element of a relationship record.' },
      ARCHIMATE_RELATES: { from: 'Element', to: 'Element', properties: ['graphKey', 'relationship_id'], description: 'Direct ArchiMate semantic edge between two elements.' },
      VIEW_OF: { from: 'View', to: 'Element', description: 'Parent element of a sub-view.' },
      INCLUDES_ELEMENT: { from: 'View', to: 'Element', properties: ['order'] },
      INCLUDES_RELATIONSHIP: { from: 'View', to: 'ArchitectureRelationship', properties: ['order'] },
      HAS_SUBDIAGRAM: { from: 'Element', to: 'View' },
    },
  };
}

async function runNeo4jCypherQuery(options = {}) {
  const architecturePath = options.architecturePath || DEFAULT_GRAPH_PATH;
  const cypher = options.cypher;
  assertReadOnlyCypher(cypher);

  const graphKey = buildGraphKey(architecturePath);
  const config = getNeo4jConfig(options);
  const driver = options.driver || createDriver(config);
  const ownDriver = !options.driver;
  const session = driver.session({ database: config.database });

  try {
    const result = await session.executeRead(tx => tx.run(cypher, { graphKey }));
    const records = result.records.map(record => {
      const entry = {};
      for (const key of record.keys) {
        entry[key] = serializeNeo4jValue(record.get(key));
      }
      return entry;
    });

    const summary = result.summary;
    const queriedDatabase = summary && summary.database ? summary.database.name : null;
    if (queriedDatabase && queriedDatabase !== config.database) {
      const error = new Error(`Neo4j query ran against database '${queriedDatabase}', but this repository expects '${config.database}'`);
      error.category = 'NEO4J_DATABASE_MISMATCH';
      error.queriedDatabase = queriedDatabase;
      error.expectedDatabase = config.database;
      throw error;
    }
    const database = queriedDatabase || config.database;
    return {
      architecturePath,
      graphKey,
      database,
      records,
      summary: {
        queryType: summary ? summary.queryType : null,
        database,
        containsUpdates: summary && summary.counters && typeof summary.counters.containsUpdates === 'function'
          ? summary.counters.containsUpdates()
          : null,
      },
    };
  } finally {
    await session.close();
    if (ownDriver) {
      await driver.close();
    }
  }
}

module.exports = {
  DEFAULT_GRAPH_PATH,
  assertReadOnlyCypher,
  buildGraphKey,
  buildNeo4jGraphSchema,
  createDriver,
  digestCanonicalArchitecture,
  ensureDatabaseExists,
  getNeo4jGraphSyncState,
  getNeo4jConfig,
  getDefaultNeo4jDatabaseName,
  isCanonicalArchitecturePath,
  isNeo4jGraphSyncStale,
  markNeo4jSyncDirty,
  readArchitectureDocument,
  readNeo4jSyncState,
  recoverNeo4jSyncIfNeeded,
  resolveArchitecturePath,
  runNeo4jCypherQuery,
  serializeNeo4jValue,
  syncArchitectureToNeo4j,
  verifyArchitectureSync,
  waitForDatabaseOnline,
};