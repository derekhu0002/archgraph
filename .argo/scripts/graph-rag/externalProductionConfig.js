const REQUIRED_FIELDS = [
  'neo4jUri',
  'neo4jUsername',
  'neo4jPassword',
  'embeddingCredential',
];
const APPROVED_SOURCE_KEYS = new Map([
  ['neo4jUri', 'ARGO_NEO4J_DATABASE_URL'],
  ['neo4jUsername', 'ARGO_NEO4J_DATABASE_USERNAME'],
  ['neo4jPassword', 'ARGO_NEO4J_DATABASE_PASSWORD'],
  ['embeddingCredential', 'QWEN_KEY'],
]);

function resolveExternalProductionConfig(configuration, context = {}) {
  const supplied = configuration && typeof configuration === 'object'
    ? configuration
    : {};
  validateApprovedSourceKeys(context.sourceKeys);

  for (const field of REQUIRED_FIELDS) {
    const value = supplied[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw blockingError(
        'EXTERNAL_CREDENTIALS_REQUIRED',
        `${field} is required for ${context.operation || 'production operation'}`,
        field,
      );
    }
  }

  return {
    neo4jUri: supplied.neo4jUri.trim(),
    neo4jUsername: supplied.neo4jUsername.trim(),
    neo4jPassword: supplied.neo4jPassword,
    embeddingCredential: supplied.embeddingCredential,
    ...(supplied.neo4jDatabase === undefined
      ? {}
      : { neo4jDatabase: supplied.neo4jDatabase }),
  };
}

function validateApprovedSourceKeys(sourceKeys) {
  if (sourceKeys === undefined) {
    return;
  }
  if (!(sourceKeys instanceof Map)) {
    throw blockingError(
      'UNAPPROVED_RUNTIME_CONFIG_SOURCE',
      'runtime configuration source provenance is invalid',
      'sourceKeys',
    );
  }

  for (const field of REQUIRED_FIELDS) {
    if (sourceKeys.get(field) !== APPROVED_SOURCE_KEYS.get(field)) {
      throw blockingError(
        'UNAPPROVED_RUNTIME_CONFIG_SOURCE',
        `${field} is not resolved from its approved source`,
        field,
      );
    }
  }
}

function blockingError(category, message, field) {
  const error = new Error(message);
  error.category = category;
  error.field = field;
  return error;
}

module.exports = {
  resolveExternalProductionConfig,
};
