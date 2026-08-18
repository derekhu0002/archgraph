const {
  evaluateEmbeddingQualification,
} = require('../embeddingQualificationGate.js');

const CHANNELS = new Set(['Element', 'ArchitectureRelationship', 'View']);
const STRING_METADATA_FIELDS = Object.freeze([
  'canonicalIdentity',
  'canonicalVersion',
  'contentVersion',
  'indexVersion',
  'provider',
  'model',
  'modelVersion',
]);

function createProductionSemanticProjectionStore(dependencies = {}) {
  const {
    persistenceAdapter,
    canonicalAuthority,
    configuration,
    qualification,
  } = dependencies;
  requireAdapter(persistenceAdapter);
  if (!canonicalAuthority || typeof canonicalAuthority.assertProjectionOnly !== 'function') {
    throw new TypeError('canonicalAuthority.assertProjectionOnly is required');
  }

  function requireReleaseGates() {
    requireExternalConfiguration(configuration);
    const approved = evaluateEmbeddingQualification(qualification);
    canonicalAuthority.assertProjectionOnly();
    return approved;
  }

  return Object.freeze({
    async upsertRecords(records) {
      const supplied = requireArray(records, 'records');
      rejectRunIds(supplied);
      const approved = requireReleaseGates();
      const validated = supplied.map(record => validateRecord(record, approved));
      await persistenceAdapter.upsertRecords(validated);
      return Object.freeze({ count: validated.length });
    },

    async deleteTombstones(tombstones) {
      const supplied = requireArray(tombstones, 'tombstones');
      rejectRunIds(supplied);
      requireReleaseGates();
      const validated = supplied.map(validateTombstone);
      await persistenceAdapter.deleteTombstones(validated);
      return Object.freeze({ count: validated.length });
    },

    async readRecords() {
      requireReleaseGates();
      const records = await persistenceAdapter.readRecords();
      return Object.freeze((records || []).map(record => Object.freeze({
        ...record,
        ...(Array.isArray(record.vector) ? { vector: Object.freeze([...record.vector]) } : {}),
      })));
    },

    async close() {
      await persistenceAdapter.close();
    },
  });
}

function requireAdapter(adapter) {
  for (const method of ['upsertRecords', 'deleteTombstones', 'readRecords', 'close']) {
    if (!adapter || typeof adapter[method] !== 'function') {
      throw new TypeError(`persistenceAdapter.${method} is required`);
    }
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
    const value = alternatives.map(field => supplied[field]).find(isNonBlankString);
    if (value === undefined) {
      throw categoryError('EXTERNAL_CREDENTIALS_REQUIRED', alternatives[0]);
    }
  }
}

function validateRecord(record, qualification) {
  if (!record || typeof record !== 'object') {
    throw categoryError('SP02_SEMANTIC_RECORD_METADATA_INVALID', 'record');
  }
  for (const field of STRING_METADATA_FIELDS) {
    if (!isNonBlankString(record[field])) {
      throw categoryError('SP02_SEMANTIC_RECORD_METADATA_INVALID', field);
    }
  }
  if (!CHANNELS.has(record.channel)) {
    throw categoryError('SP02_SEMANTIC_RECORD_METADATA_INVALID', 'channel');
  }
  if (!Number.isInteger(record.dimensions) || record.dimensions <= 0) {
    throw categoryError('SP02_SEMANTIC_RECORD_METADATA_INVALID', 'dimensions');
  }
  if (
    !Array.isArray(record.vector)
    || record.vector.length !== record.dimensions
    || record.vector.some(value => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw categoryError('SP02_SEMANTIC_RECORD_METADATA_INVALID', 'vector');
  }
  if (
    record.provider !== qualification.provider
    || record.model !== qualification.model
    || record.modelVersion !== qualification.version
    || record.dimensions !== qualification.dimensions
  ) {
    throw categoryError('SP02_SEMANTIC_RECORD_QUALIFICATION_MISMATCH', 'qualification');
  }
  return Object.freeze({
    ...record,
    vector: Object.freeze([...record.vector]),
  });
}

function validateTombstone(tombstone) {
  if (
    !tombstone
    || !isNonBlankString(tombstone.canonicalIdentity)
    || !CHANNELS.has(tombstone.channel)
    || !isNonBlankString(tombstone.canonicalVersion)
  ) {
    throw categoryError('SP02_TOMBSTONE_METADATA_INVALID', 'tombstone');
  }
  return Object.freeze({
    canonicalIdentity: tombstone.canonicalIdentity.trim(),
    channel: tombstone.channel,
    canonicalVersion: tombstone.canonicalVersion.trim(),
  });
}

function rejectRunIds(records) {
  if (records.some(record => record && Object.prototype.hasOwnProperty.call(record, 'runId'))) {
    throw categoryError('SP02_PRODUCTION_RUNID_PROHIBITED', 'runId');
  }
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw categoryError('SP02_SEMANTIC_RECORD_METADATA_INVALID', field);
  }
  return value;
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
  createProductionSemanticProjectionStore,
};
