const { evaluateEmbeddingQualification } = require('./embeddingQualificationGate.js');
const { createLiveEmbeddingProviderClient } = require('./liveEmbeddingProviderClient.js');

const IDENTITY_FIELDS = Object.freeze([
  'canonicalIdentity',
  'canonicalVersion',
  'contentIdentity',
  'contentVersion',
  'indexIdentity',
  'indexVersion',
]);

function buildSemanticIndexEvidenceRecord(input = {}) {
  const qualification = input.qualification && typeof input.qualification === 'object'
    ? input.qualification
    : {};
  const objectType = input.objectType || 'Element';
  const objectId = input.objectId || input.id || `${objectType.toLowerCase()}-record`;
  const indexVersion = input.indexVersion || incrementVersion(input.contentVersion || input.canonicalVersion);
  return Object.freeze({
    objectType,
    objectId,
    channel: input.channel || channelForObjectType(objectType),
    canonicalVersion: input.canonicalVersion || 'canonical-v1',
    contentVersion: input.contentVersion || 'content-v1',
    indexVersion,
    provider: input.provider || qualification.provider || 'approved-test-provider',
    model: input.model || qualification.model || 'approved-test-model',
    version: input.version || input.modelVersion || qualification.version || '2026-07-24',
    modelVersion: input.modelVersion || qualification.version || '2026-07-24',
    dimensions: input.dimensions || qualification.dimensions || 1536,
    ...(Array.isArray(input.vector) ? { vector: [...input.vector] } : {}),
  });
}

function createLiveEmbeddingIndexGate(dependencies = {}) {
  const { configuration, transport, indexBoundary } = dependencies;
  if (!configuration || !indexBoundary || typeof indexBoundary.writeEvidence !== 'function') {
    throw safeError('LIVE_PROVIDER_E2E_BOUNDARY_MISSING');
  }
  const client = createLiveEmbeddingProviderClient({ configuration, transport });
  return Object.freeze({
    async executeApprovedEmbedding(input) {
      const qualification = evaluateEmbeddingQualification(input && input.qualification);
      requireApprovedConfiguration(configuration, qualification);
      requireInput(input);
      const vector = await client.embed(input.input);
      if (
        vector.length !== 1024
        || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))
      ) {
        throw safeError('LIVE_PROVIDER_RESPONSE_INVALID');
      }
      const evidence = {
        provider: qualification.provider,
        model: qualification.model,
        qualificationVersion: qualification.version,
        dimensions: qualification.dimensions,
        ...Object.fromEntries(IDENTITY_FIELDS.map(field => [field, input[field]])),
        vector,
      };
      try {
        await indexBoundary.writeEvidence(evidence);
      } catch {
        throw safeError('LIVE_PROVIDER_INDEX_WRITE_PROHIBITED');
      }
      return Object.freeze({
        qualification: Object.freeze({ ...qualification }),
        vector,
        evidence: Object.freeze(evidence),
      });
    },
  });
}

function requireApprovedConfiguration(configuration, qualification) {
  if (
    qualification.provider !== configuration.embeddingProvider
    || qualification.model !== configuration.embeddingModel
    || qualification.version !== configuration.embeddingModelVersion
    || qualification.dimensions !== configuration.embeddingDimensions
    || qualification.dimensions !== 1024
  ) {
    throw safeError('LIVE_PROVIDER_INDEX_WRITE_PROHIBITED');
  }
}

function requireInput(input) {
  if (!input || typeof input.input !== 'string' || input.input.trim() === '') {
    throw safeError('LIVE_PROVIDER_INDEX_WRITE_PROHIBITED');
  }
  for (const field of IDENTITY_FIELDS) {
    if (typeof input[field] !== 'string' || input[field].trim() === '') {
      throw safeError('LIVE_PROVIDER_INDEX_WRITE_PROHIBITED');
    }
  }
}

function safeError(category) {
  const error = new Error(category);
  error.category = category;
  return error;
}

function channelForObjectType(objectType) {
  if (objectType === 'ArchitectureRelationship') {
    return 'relationships';
  }
  if (objectType === 'View') {
    return 'views';
  }
  return 'elements';
}

function incrementVersion(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'index-v1';
  }
  const numericSuffix = value.match(/^(.*?)(\d+)$/);
  if (!numericSuffix) {
    return `${value}-indexed`;
  }
  return `${numericSuffix[1]}${Number(numericSuffix[2]) + 1}`;
}

module.exports = {
  buildSemanticIndexEvidenceRecord,
  createLiveEmbeddingIndexGate,
};
