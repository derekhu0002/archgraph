function semanticOperatorErrorPayload(error) {
  return Object.freeze({
    category: typeof error.category === 'string' ? error.category : 'SEMANTIC_OPERATOR_ERROR',
    state: typeof error.state === 'string' ? error.state : null,
    verified: error.verified === true,
    canonicalVersion: typeof error.canonicalVersion === 'string' ? error.canonicalVersion : null,
    contentVersion: typeof error.contentVersion === 'string' ? error.contentVersion : null,
    indexVersion: typeof error.indexVersion === 'string' ? error.indexVersion : null,
    completedChannels: Array.isArray(error.completedChannels) ? [...error.completedChannels] : [],
    missingChannels: Array.isArray(error.missingChannels) ? [...error.missingChannels] : [],
    mismatchedChannels: Array.isArray(error.mismatchedChannels) ? [...error.mismatchedChannels] : [],
    fullSnapshotFallback: false,
    action: typeof error.action === 'string' ? error.action : 'Correct readiness and retry',
    ...(typeof error.field === 'string' ? { field: error.field } : {}),
  });
}

function semanticOperatorErrorResult(error) {
  const payload = Object.freeze({
    status: 'failed',
    error: semanticOperatorErrorPayload(error),
  });
  return Object.freeze({
    ...payload,
    content: Object.freeze([
      Object.freeze({
        type: 'text',
        text: JSON.stringify(payload),
      }),
    ]),
    isError: true,
  });
}

module.exports = {
  semanticOperatorErrorPayload,
  semanticOperatorErrorResult,
};
