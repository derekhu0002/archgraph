const CHECKPOINT_LABEL = 'ArgoProductionSemanticCheckpoint';

function createProductionSemanticCheckpointStore(dependencies = {}) {
  const { driver } = dependencies;
  if (!driver || (typeof driver.execute !== 'function' && typeof driver.session !== 'function')) {
    throw new TypeError('driver.execute or driver.session is required');
  }

  return Object.freeze({
    async readCheckpoint(channel) {
      if (typeof driver.execute === 'function') {
        const result = await driver.execute(Object.freeze({
          kind: 'semantic-checkpoint-read',
          channel,
        }));
        return result && result.checkpoint ? cloneCheckpoint(result.checkpoint) : undefined;
      }
      return withSession(driver, dependencies.configuration, async session => {
        const result = await executeRead(
          session,
          `MATCH (checkpoint:${CHECKPOINT_LABEL} {channel: $channel}) RETURN checkpoint.payload AS payload`,
          { channel },
        );
        const record = result.records && result.records[0];
        const payload = record && typeof record.get === 'function' ? record.get('payload') : record && record.payload;
        return typeof payload === 'string' ? cloneCheckpoint(JSON.parse(payload)) : undefined;
      });
    },

    async writeCheckpoint(checkpoint) {
      const durableCheckpoint = cloneCheckpoint(checkpoint);
      if (typeof driver.execute === 'function') {
        const result = await driver.execute(Object.freeze({
          kind: 'semantic-checkpoint-write',
          checkpoint: durableCheckpoint,
        }));
        return result && result.checkpoint ? cloneCheckpoint(result.checkpoint) : durableCheckpoint;
      }
      await withSession(driver, dependencies.configuration, session => executeWrite(
        session,
        [
          `MERGE (checkpoint:${CHECKPOINT_LABEL} {channel: $channel})`,
          'SET checkpoint.canonicalVersion = $canonicalVersion, checkpoint.payload = $payload',
          'RETURN checkpoint.payload AS payload',
        ].join('\n'),
        {
          channel: durableCheckpoint.channel,
          canonicalVersion: durableCheckpoint.canonicalVersion,
          payload: JSON.stringify(durableCheckpoint),
        },
      ));
      return durableCheckpoint;
    },

    async close() {
      if (typeof driver.close === 'function') {
        await driver.close();
      }
    },
  });
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

function cloneCheckpoint(checkpoint) {
  return Object.freeze({
    ...checkpoint,
    completedCanonicalIdentities: Object.freeze([...(checkpoint.completedCanonicalIdentities || [])]),
    isolatedFailures: Object.freeze((checkpoint.isolatedFailures || []).map(failure => Object.freeze({ ...failure }))),
  });
}

module.exports = {
  createProductionSemanticCheckpointStore,
};
