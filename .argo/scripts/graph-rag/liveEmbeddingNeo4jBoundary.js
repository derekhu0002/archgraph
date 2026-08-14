async function createApprovedNeo4jBoundary({ configuration, neo4j, logger }) {
  if (
    !configuration
    || !neo4j
    || !neo4j.auth
    || typeof neo4j.auth.basic !== 'function'
    || typeof neo4j.driver !== 'function'
  ) {
    throw safeError('LIVE_PROVIDER_NEO4J_BOUNDARY_MISSING');
  }
  const uri = requireValue(configuration, 'neo4jDatabaseUrl');
  const username = requireValue(configuration, 'neo4jDatabaseUsername');
  const password = requireValue(configuration, 'neo4jDatabasePassword');
  let driver;
  try {
    const authentication = neo4j.auth.basic(username, password);
    driver = neo4j.driver(uri, authentication);
    await driver.verifyConnectivity();
  } catch {
    if (driver && typeof driver.close === 'function') {
      try { await driver.close(); } catch {}
    }
    throw safeError('LIVE_PROVIDER_OPERATION_FAILED');
  }

  let closed = false;
  async function query(cypher, parameters) {
    if (closed) throw safeError('LIVE_PROVIDER_OPERATION_FAILED');
    const session = driver.session();
    try {
      return await session.run(cypher, parameters);
    } catch {
      throw safeError('LIVE_PROVIDER_OPERATION_FAILED');
    } finally {
      try { await session.close(); } catch {}
    }
  }

  return Object.freeze({
    async countWrites(runId) {
      const result = await query(
        'MATCH (e:ArgoLiveEmbeddingEvidence { runId: $runId }) RETURN count(e) AS count',
        { runId },
      );
      const count = result.records[0].get('count');
      return count && typeof count.toNumber === 'function' ? count.toNumber() : Number(count);
    },
    async writeEvidence(runId, evidence) {
      if (evidence === undefined) {
        evidence = runId;
        runId = evidence.runId;
      }
      const normalized = normalizeEvidence(evidence);
      await query(
        'CREATE (e:ArgoLiveEmbeddingEvidence { runId: $runId, vector: $vector, provider: $provider, model: $model, qualificationVersion: $qualificationVersion, dimensions: $dimensions, canonicalIdentity: $canonicalIdentity, canonicalVersion: $canonicalVersion, contentIdentity: $contentIdentity, contentVersion: $contentVersion, indexIdentity: $indexIdentity, indexVersion: $indexVersion })',
        { runId, ...normalized },
      );
    },
    async readEvidence(runId) {
      const result = await query(
        'MATCH (e:ArgoLiveEmbeddingEvidence { runId: $runId }) RETURN e { .runId, .provider, .model, .qualificationVersion, .dimensions, .canonicalIdentity, .canonicalVersion, .contentIdentity, .contentVersion, .indexIdentity, .indexVersion, .vector } AS evidence',
        { runId },
      );
      return result.records.map(record => normalizeNeo4jValue(record.get('evidence')));
    },
    async queryVectorEvidence(runId, vector, canonicalIdentities) {
      if (!Array.isArray(vector) || vector.length !== 1024 || !Array.isArray(canonicalIdentities)) {
        throw safeError('LIVE_PROVIDER_OPERATION_FAILED');
      }
      await query(
        'CREATE VECTOR INDEX argo_live_embedding_vector IF NOT EXISTS FOR (e:ArgoLiveEmbeddingEvidence) ON (e.vector) OPTIONS { indexConfig: { `vector.dimensions`: 1024, `vector.similarity_function`: "cosine" } }',
        {},
      );
      const result = await query(
        'CALL db.index.vector.queryNodes("argo_live_embedding_vector", $limit, $vector) YIELD node, score WHERE node.runId = $runId AND node.canonicalIdentity IN $canonicalIdentities RETURN node { .canonicalIdentity, .canonicalVersion, .contentVersion, .indexVersion, .provider, .model, .qualificationVersion, .dimensions, .vector } AS evidence, score',
        {
          runId,
          vector,
          canonicalIdentities,
          limit: Math.max(1, canonicalIdentities.length * 4),
        },
      );
      return result.records.map(record => normalizeNeo4jValue(record.get('evidence')));
    },
    async cleanup(runId) {
      await query('MATCH (e:ArgoLiveEmbeddingEvidence { runId: $runId }) DELETE e', { runId });
      return this.countWrites(runId);
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await driver.close();
      } catch {
        throw safeError('LIVE_PROVIDER_OPERATION_FAILED');
      }
    },
  });
}

function normalizeEvidence(evidence) {
  const fields = [
    'provider', 'model', 'qualificationVersion', 'dimensions', 'canonicalIdentity',
    'canonicalVersion', 'contentIdentity', 'contentVersion', 'indexIdentity', 'indexVersion', 'vector',
  ];
  if (!evidence || fields.some(field => evidence[field] === undefined)) {
    throw safeError('LIVE_PROVIDER_OPERATION_FAILED');
  }
  return Object.fromEntries(fields.map(field => [field, evidence[field]]));
}

function normalizeNeo4jValue(evidence) {
  if (!evidence) return evidence;
  const dimensions = evidence.dimensions;
  return {
    ...evidence,
    dimensions: dimensions && typeof dimensions.toNumber === 'function'
      ? dimensions.toNumber()
      : dimensions,
  };
}

function requireValue(configuration, field) {
  const value = configuration[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw safeError('LIVE_PROVIDER_NEO4J_BOUNDARY_MISSING');
  }
  return value;
}

function safeError(category) {
  const error = new Error(category);
  error.category = category;
  return error;
}

module.exports = { createApprovedNeo4jBoundary };
