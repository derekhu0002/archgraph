const crypto = require('node:crypto');
const {
  evaluateEmbeddingQualification,
} = require('../embeddingQualificationGate.js');

const CHANNELS = Object.freeze(['Element', 'ArchitectureRelationship', 'View']);
const CHANNEL_SOURCES = Object.freeze({
  Element: Object.freeze({ property: 'elements', identity: record => record.id }),
  ArchitectureRelationship: Object.freeze({ property: 'relationships', identity: record => record.id }),
  View: Object.freeze({ property: 'views', identity: record => record.view_id }),
});

function createProductionSemanticBackfill(dependencies = {}) {
  requireBoundary(dependencies.canonicalSource, 'readSnapshot', 'canonicalSource');
  requireBoundary(dependencies.structuralProjection, 'requireComplete', 'structuralProjection');
  requireBoundary(dependencies.embeddingProvider, 'embedBatch', 'embeddingProvider');
  requireBoundary(dependencies.projectionStore, 'upsertRecords', 'projectionStore');
  requireBoundary(dependencies.checkpointStore, 'readCheckpoint', 'checkpointStore');
  requireBoundary(dependencies.checkpointStore, 'writeCheckpoint', 'checkpointStore');
  const batchSize = dependencies.batchSize;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw categoryError('SP01_POSITIVE_BATCH_SIZE_REQUIRED', 'batchSize');
  }

  return Object.freeze({
    async execute(request = {}) {
      if (request.explicitOptIn !== true) {
        throw categoryError('SP01_EXPLICIT_OPT_IN_REQUIRED', 'explicitOptIn');
      }
      requireExternalConfiguration(dependencies.configuration);
      const qualification = evaluateEmbeddingQualification(dependencies.qualification);

      const structural = await dependencies.structuralProjection.requireComplete();
      const snapshot = await dependencies.canonicalSource.readSnapshot();
      const canonicalVersion = snapshot && snapshot.version;
      if (
        !structural
        || structural.status !== 'complete'
        || !isNonBlankString(structural.canonicalVersion)
        || structural.canonicalVersion !== canonicalVersion
      ) {
        throw categoryError('SP01_STRUCTURAL_VERSION_MISMATCH', 'canonicalVersion');
      }

      const channels = {};
      for (const channel of CHANNELS) {
        channels[channel] = await processChannel({
          channel,
          snapshot,
          canonicalVersion,
          qualification,
          batchSize,
          embeddingProvider: dependencies.embeddingProvider,
          projectionStore: dependencies.projectionStore,
          checkpointStore: dependencies.checkpointStore,
        });
      }
      const aligned = CHANNELS.every(channel => (
        channels[channel].status === 'complete'
        && channels[channel].canonicalVersion === canonicalVersion
      ));
      return Object.freeze({
        status: aligned ? 'passed' : 'partial',
        canonicalVersion,
        alignmentState: aligned ? 'Aligned' : 'Updating',
        channels: Object.freeze(channels),
      });
    },
  });
}

async function processChannel(options) {
  const source = CHANNEL_SOURCES[options.channel];
  const canonicalRecords = (options.snapshot[source.property] || []).map(record => Object.freeze({
    canonicalIdentity: `${options.channel}:${source.identity(record)}`,
    channel: options.channel,
    canonicalObject: record,
  }));
  const stored = await options.checkpointStore.readCheckpoint(options.channel);
  const checkpoint = stored && stored.canonicalVersion === options.canonicalVersion
    ? mutableCheckpoint(stored, canonicalRecords.length)
    : emptyCheckpoint(options.channel, options.canonicalVersion, canonicalRecords.length);
  const attempts = new Map();

  while (checkpoint.completedCanonicalIdentities.length < canonicalRecords.length) {
    const completed = new Set(checkpoint.completedCanonicalIdentities);
    const pending = canonicalRecords.filter(record => (
      !completed.has(record.canonicalIdentity)
      && (attempts.get(record.canonicalIdentity) || 0) < 2
    ));
    if (pending.length === 0) {
      break;
    }
    const batch = pending.slice(0, options.batchSize);
    for (const record of batch) {
      attempts.set(record.canonicalIdentity, (attempts.get(record.canonicalIdentity) || 0) + 1);
    }

    const providerResult = await options.embeddingProvider.embedBatch(Object.freeze(batch));
    const vectors = new Map((providerResult && providerResult.vectors ? providerResult.vectors : [])
      .map(result => [result.canonicalIdentity, result.vector]));
    const providerFailures = providerResult && Array.isArray(providerResult.failures)
      ? providerResult.failures
      : [];
    const successfulRecords = [];
    const currentFailures = [];

    for (const record of batch) {
      const vector = vectors.get(record.canonicalIdentity);
      if (Array.isArray(vector)) {
        successfulRecords.push(buildSemanticRecord(record, vector, options));
        completed.add(record.canonicalIdentity);
        continue;
      }
      const observed = providerFailures.find(failure => failure.canonicalIdentity === record.canonicalIdentity);
      currentFailures.push(Object.freeze({
        canonicalIdentity: record.canonicalIdentity,
        category: observed && observed.category ? observed.category : 'PROVIDER_RECORD_FAILED',
      }));
    }

    if (successfulRecords.length > 0) {
      await options.projectionStore.upsertRecords(successfulRecords);
    }
    checkpoint.completedCanonicalIdentities = [...completed];
    checkpoint.completedCount = completed.size;
    checkpoint.cursor = completed.size;
    checkpoint.retries += currentFailures.length;
    checkpoint.isolatedFailures = mergeFailures(checkpoint.isolatedFailures, currentFailures);
    checkpoint.status = completed.size === canonicalRecords.length ? 'complete' : 'partial';
    await options.checkpointStore.writeCheckpoint(freezeCheckpoint(checkpoint));
  }

  return Object.freeze({
    status: checkpoint.completedCanonicalIdentities.length === canonicalRecords.length ? 'complete' : 'partial',
    canonicalVersion: options.canonicalVersion,
    total: canonicalRecords.length,
    completedCount: checkpoint.completedCanonicalIdentities.length,
    cursor: checkpoint.cursor,
    retries: checkpoint.retries,
    isolatedFailures: Object.freeze(checkpoint.isolatedFailures.map(failure => Object.freeze({ ...failure }))),
  });
}

function buildSemanticRecord(record, vector, options) {
  const contentHash = crypto.createHash('sha256')
    .update(JSON.stringify(record.canonicalObject))
    .digest('hex');
  return Object.freeze({
    canonicalIdentity: record.canonicalIdentity,
    channel: record.channel,
    canonicalVersion: options.canonicalVersion,
    contentVersion: `content:${contentHash}`,
    indexVersion: `index:${contentHash}`,
    provider: options.qualification.provider,
    model: options.qualification.model,
    modelVersion: options.qualification.version,
    dimensions: options.qualification.dimensions,
    vector: Object.freeze([...vector]),
  });
}

function emptyCheckpoint(channel, canonicalVersion, total) {
  return {
    channel,
    canonicalVersion,
    total,
    completedCount: 0,
    cursor: 0,
    retries: 0,
    completedCanonicalIdentities: [],
    isolatedFailures: [],
    status: total === 0 ? 'complete' : 'pending',
  };
}

function mutableCheckpoint(checkpoint, total) {
  return {
    channel: checkpoint.channel,
    canonicalVersion: checkpoint.canonicalVersion,
    total,
    completedCount: checkpoint.completedCount || 0,
    cursor: checkpoint.cursor || 0,
    retries: checkpoint.retries || 0,
    completedCanonicalIdentities: [...(checkpoint.completedCanonicalIdentities || [])],
    isolatedFailures: [...(checkpoint.isolatedFailures || [])],
    status: checkpoint.status || 'pending',
  };
}

function freezeCheckpoint(checkpoint) {
  return Object.freeze({
    ...checkpoint,
    completedCanonicalIdentities: Object.freeze([...checkpoint.completedCanonicalIdentities]),
    isolatedFailures: Object.freeze(checkpoint.isolatedFailures.map(failure => Object.freeze({ ...failure }))),
  });
}

function mergeFailures(existing, current) {
  const merged = new Map(existing.map(failure => [failure.canonicalIdentity, failure]));
  for (const failure of current) {
    merged.set(failure.canonicalIdentity, failure);
  }
  return [...merged.values()];
}

function requireBoundary(boundary, method, name) {
  if (!boundary || typeof boundary[method] !== 'function') {
    throw new TypeError(`${name}.${method} is required`);
  }
}

function requireExternalConfiguration(configuration) {
  const supplied = configuration && typeof configuration === 'object' ? configuration : {};
  const required = [
    ['neo4jDatabaseUrl', 'neo4jUri'],
    ['neo4jDatabaseUsername', 'neo4jUsername'],
    ['neo4jDatabasePassword', 'neo4jPassword'],
    ['embeddingCredential'],
  ];
  for (const alternatives of required) {
    if (alternatives.map(field => supplied[field]).find(isNonBlankString) === undefined) {
      throw categoryError('EXTERNAL_CREDENTIALS_REQUIRED', alternatives[0]);
    }
  }
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function categoryError(category, field) {
  const error = new Error(category);
  error.category = category;
  error.field = field;
  return error;
}

module.exports = {
  createProductionSemanticBackfill,
};
