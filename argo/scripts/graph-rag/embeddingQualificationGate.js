function evaluateEmbeddingQualification(qualification) {
  const supplied = qualification && typeof qualification === 'object'
    ? qualification
    : {};

  if (supplied.approvedByHuman !== true) {
    throw blockingError(
      'EMBEDDING_QUALIFICATION_REQUIRED',
      'Embedding configuration requires explicit human approval',
      'approvedByHuman',
    );
  }

  if (supplied.source === 'implicit-default') {
    throw blockingError(
      'IMPLICIT_EMBEDDING_DEFAULT_PROHIBITED',
      'Implicit embedding defaults cannot qualify index delivery',
      'source',
    );
  }

  for (const field of ['provider', 'model', 'version']) {
    if (typeof supplied[field] !== 'string' || supplied[field].trim().length === 0) {
      throw blockingError(
        'EMBEDDING_CONFIGURATION_REQUIRED',
        `${field} must be explicitly supplied`,
        field,
      );
    }
  }

  if (!Number.isInteger(supplied.dimensions) || supplied.dimensions <= 0) {
    throw blockingError(
      'EMBEDDING_CONFIGURATION_REQUIRED',
      'dimensions must be an explicitly supplied positive integer',
      'dimensions',
    );
  }

  return {
    status: 'approved',
    approvedByHuman: true,
    provider: supplied.provider.trim(),
    model: supplied.model.trim(),
    version: supplied.version.trim(),
    dimensions: supplied.dimensions,
  };
}

function blockingError(category, message, field) {
  const error = new Error(message);
  error.category = category;
  error.field = field;
  return error;
}

module.exports = {
  evaluateEmbeddingQualification,
};
