const SEMANTIC_LABEL = 'ArgoProductionSemanticRecord';
const CHANNEL_INDEXES = Object.freeze({
  Element: Object.freeze({
    label: 'ArgoProductionSemanticElement',
    indexName: 'argo_production_semantic_element_vector',
  }),
  ArchitectureRelationship: Object.freeze({
    label: 'ArgoProductionSemanticRelationship',
    indexName: 'argo_production_semantic_relationship_vector',
  }),
  View: Object.freeze({
    label: 'ArgoProductionSemanticView',
    indexName: 'argo_production_semantic_view_vector',
  }),
});

function createProductionSemanticNeo4jAdapter(dependencies = {}) {
  const { driver } = dependencies;
  if (!driver || (typeof driver.execute !== 'function' && typeof driver.session !== 'function')) {
    throw new TypeError('driver.execute or driver.session is required');
  }

  return Object.freeze({
    async upsertRecords(records) {
      if (typeof driver.execute === 'function') {
        return driver.execute(Object.freeze({
          kind: 'semantic-record-upsert',
          records: Object.freeze(records.map(cloneRecord)),
        }));
      }
      return withSession(driver, dependencies.configuration, async session => {
        await ensureVectorIndexes(session);
        const results = [];
        for (const [channel, definition] of Object.entries(CHANNEL_INDEXES)) {
          const channelRecords = records.filter(record => record.channel === channel).map(cloneRecord);
          if (channelRecords.length === 0) continue;
          const query = [
            'UNWIND $records AS record',
            `MERGE (semantic:${SEMANTIC_LABEL} {canonicalIdentity: record.canonicalIdentity})`,
            'SET semantic = record',
            `SET semantic:${definition.label}`,
            'RETURN count(semantic) AS count',
          ].join('\n');
          results.push(await executeWrite(session, query, { records: channelRecords }));
        }
        return results[results.length - 1] || { records: [] };
      });
    },

    async deleteTombstones(tombstones) {
      if (typeof driver.execute === 'function') {
        return driver.execute(Object.freeze({
          kind: 'semantic-record-delete-tombstones',
          tombstones: Object.freeze(tombstones.map(cloneRecord)),
        }));
      }
      return withSession(driver, dependencies.configuration, async session => {
        const query = [
          'UNWIND $canonicalIdentities AS canonicalIdentity',
          `MATCH (semantic:${SEMANTIC_LABEL} {canonicalIdentity: canonicalIdentity})`,
          'DETACH DELETE semantic',
          'RETURN count(*) AS count',
        ].join('\n');
        return executeWrite(session, query, {
          canonicalIdentities: tombstones.map(item => item.canonicalIdentity),
        });
      });
    },

    async readRecords() {
      if (typeof driver.execute === 'function') {
        const result = await driver.execute(Object.freeze({ kind: 'semantic-record-read-all' }));
        return Object.freeze((result && result.records ? result.records : []).map(cloneRecord));
      }
      return withSession(driver, dependencies.configuration, async session => {
        const result = await executeRead(
          session,
          `MATCH (semantic:${SEMANTIC_LABEL}) RETURN properties(semantic) AS record ORDER BY semantic.canonicalIdentity`,
          {},
        );
        return Object.freeze((result.records || []).map(resultRecord).map(cloneRecord));
      });
    },

    async close() {
      if (typeof driver.close === 'function') {
        await driver.close();
      }
    },
  });
}

async function ensureVectorIndexes(session) {
  for (const definition of Object.values(CHANNEL_INDEXES)) {
    await executeWrite(
      session,
      [
        `CREATE VECTOR INDEX ${definition.indexName} IF NOT EXISTS`,
        `FOR (semantic:${definition.label}) ON (semantic.vector)`,
        'OPTIONS { indexConfig: { `vector.dimensions`: 1024, `vector.similarity_function`: "cosine" } }',
      ].join('\n'),
      {},
    );
  }
}

async function withSession(driver, configuration, action) {
  const database = configuration && configuration.neo4jDatabase;
  const session = driver.session(database === undefined ? undefined : { database });
  try {
    return await action(session);
  } finally {
    if (session && typeof session.close === 'function') {
      await session.close();
    }
  }
}

function executeWrite(session, query, parameters) {
  if (typeof session.executeWrite === 'function') {
    return session.executeWrite(transaction => transaction.run(query, parameters));
  }
  return session.run(query, parameters);
}

function executeRead(session, query, parameters) {
  if (typeof session.executeRead === 'function') {
    return session.executeRead(transaction => transaction.run(query, parameters));
  }
  return session.run(query, parameters);
}

function resultRecord(record) {
  if (record && typeof record.get === 'function') {
    return record.get('record');
  }
  return record && record.record ? record.record : record;
}

function cloneRecord(record) {
  return Object.freeze({
    ...record,
    ...(Array.isArray(record && record.vector) ? { vector: Object.freeze([...record.vector]) } : {}),
  });
}

module.exports = {
  createProductionSemanticNeo4jAdapter,
};
