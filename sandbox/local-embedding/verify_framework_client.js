'use strict';

// Phase 1 bridge: the framework's real configuration builder + embedding client,
// pointed at the local OpenAI-compatible server via the openai-compatible profile.

const {
  buildProfileConfiguration,
} = require('../../argo/scripts/graph-rag/liveEmbeddingProviderConfig.js');
const {
  createLiveEmbeddingProviderClient,
} = require('../../argo/scripts/graph-rag/liveEmbeddingProviderClient.js');

const values = {
  ARGO_EMBEDDING_BASE_URL: process.env.EMBED_BASE_URL || 'http://127.0.0.1:8080/v1',
  ARGO_EMBEDDING_MODEL: process.env.EMBED_MODEL || 'Alibaba-NLP/gte-Qwen2-1.5B-instruct',
  ARGO_EMBEDDING_PROVIDER: 'self-hosted-openai-compatible',
  ARGO_EMBEDDING_MODEL_VERSION: 'local-2026-09-19',
  ARGO_EMBEDDING_DIMENSIONS: '1536',
};

const profile = buildProfileConfiguration(values, 'openai-compatible');
const configuration = Object.freeze({
  ...profile,
  embeddingApiKey: 'local-no-auth',
  qwenKey: 'local-no-auth',
});
const client = createLiveEmbeddingProviderClient({
  configuration,
  transport: { request: (url, options) => fetch(url, options) },
});

(async () => {
  const vector = await client.embed('The authentication component validates access tokens.');
  console.log('profile:', profile.embeddingProfile, '| base:', profile.embeddingBaseUrl);
  console.log('framework client vector length:', vector.length);
  console.log('first 3 values:', vector.slice(0, 3).map(value => value.toFixed(4)));
})().catch(error => {
  console.error('ERR', error.message);
  process.exit(1);
});
