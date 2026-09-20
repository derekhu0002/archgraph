'use strict';

// Maps profile-aware configuration evidence (from resolveApprovedLiveConfiguration)
// into the shape the canonical semantic-init / backfill runtime consumes.
//
// This is the single place that turns "which embedding profile" into the init
// backfill's configuration, so argo init embeds through the SAME provider the
// retrieval path uses (approved cloud by default, or a self-hosted endpoint via
// ARGO_EMBEDDING_PROFILE=openai-compatible) — instead of a hardcoded profile.

function buildDefaultSemanticConfiguration(evidence) {
  const configuration = evidence && typeof evidence === 'object' && evidence.configuration
    ? evidence.configuration
    : evidence;
  if (!configuration || typeof configuration !== 'object') {
    throw new TypeError('resolved configuration evidence is required');
  }
  return Object.freeze({
    ...configuration,
    embeddingCredential: configuration.embeddingApiKey || configuration.qwenKey,
  });
}

module.exports = { buildDefaultSemanticConfiguration };
