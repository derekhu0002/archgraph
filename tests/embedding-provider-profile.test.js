'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PROFILE_APPROVED,
  PROFILE_OPENAI_COMPATIBLE,
  resolveEmbeddingProfile,
  requireSupportedEmbeddingProfile,
  requireEmbeddingDimensions,
  composeQueryEmbeddingInput,
} = require('../argo/scripts/graph-rag/embeddingProviderProfile.js');

const {
  buildProfileConfiguration,
  APPROVED_EMBEDDING_VALUES,
} = require('../argo/scripts/graph-rag/liveEmbeddingProviderConfig.js');

const {
  createLiveEmbeddingProviderClient,
} = require('../argo/scripts/graph-rag/liveEmbeddingProviderClient.js');

const {
  createProductionSemanticNeo4jAdapter,
  resolveEmbeddingDimensions,
} = require('../argo/scripts/graph-rag/semantic-persistence/productionSemanticNeo4jAdapter.js');

const {
  buildDefaultSemanticConfiguration,
} = require('../argo/scripts/graph-rag/semanticInitConfiguration.js');

const ROOT = path.resolve(__dirname, '..');

const OPENAI_COMPATIBLE_VALUES = Object.freeze({
  ARGO_EMBEDDING_BASE_URL: 'http://localhost:8080/v1',
  ARGO_EMBEDDING_MODEL: 'gte-Qwen2-1.5B-instruct',
  ARGO_EMBEDDING_PROVIDER: 'self-hosted-openai-compatible',
  ARGO_EMBEDDING_MODEL_VERSION: 'local-2026-09-19',
  ARGO_EMBEDDING_DIMENSIONS: '1536',
});

// AT-embed-profile-01: `approved` is the default and stays byte-for-byte
// unchanged; any deviation (or an unknown profile) fails closed.
test('AT-embed-profile-01: approved profile is the default and unchanged', () => {
  assert.equal(resolveEmbeddingProfile(undefined), PROFILE_APPROVED);
  assert.equal(resolveEmbeddingProfile(''), PROFILE_APPROVED);
  assert.equal(resolveEmbeddingProfile('approved'), PROFILE_APPROVED);
  assert.equal(requireSupportedEmbeddingProfile(undefined), PROFILE_APPROVED);

  const approved = buildProfileConfiguration({ ...APPROVED_EMBEDDING_VALUES }, PROFILE_APPROVED);
  assert.equal(approved.embeddingProfile, PROFILE_APPROVED);
  assert.equal(approved.embeddingBaseUrl, APPROVED_EMBEDDING_VALUES.ARGO_EMBEDDING_BASE_URL);
  assert.equal(approved.embeddingModel, APPROVED_EMBEDDING_VALUES.ARGO_EMBEDDING_MODEL);
  assert.equal(approved.embeddingProvider, APPROVED_EMBEDDING_VALUES.ARGO_EMBEDDING_PROVIDER);
  assert.equal(approved.embeddingModelVersion, APPROVED_EMBEDDING_VALUES.ARGO_EMBEDDING_MODEL_VERSION);
  assert.equal(approved.embeddingDimensions, 1536);

  assert.throws(
    () => buildProfileConfiguration(
      { ...APPROVED_EMBEDDING_VALUES, ARGO_EMBEDDING_BASE_URL: 'http://localhost:8080/v1' },
      PROFILE_APPROVED,
    ),
    error => error.category === 'LIVE_PROVIDER_CONFIGURATION_REQUIRED',
    'approved profile must reject a non-approved endpoint',
  );
  assert.throws(
    () => requireSupportedEmbeddingProfile('ollama'),
    error => error.category === 'EMBEDDING_PROFILE_UNSUPPORTED',
    'unknown profile must fail closed',
  );
});

// AT-embed-profile-02: `openai-compatible` accepts a self-hosted endpoint
// verbatim (no equality gate) and returns the env-driven identity.
test('AT-embed-profile-02: openai-compatible profile resolves the self-hosted endpoint', () => {
  const resolved = buildProfileConfiguration({ ...OPENAI_COMPATIBLE_VALUES }, PROFILE_OPENAI_COMPATIBLE);
  assert.deepEqual(resolved, {
    embeddingProfile: PROFILE_OPENAI_COMPATIBLE,
    embeddingBaseUrl: OPENAI_COMPATIBLE_VALUES.ARGO_EMBEDDING_BASE_URL,
    embeddingModel: OPENAI_COMPATIBLE_VALUES.ARGO_EMBEDDING_MODEL,
    embeddingProvider: OPENAI_COMPATIBLE_VALUES.ARGO_EMBEDDING_PROVIDER,
    embeddingModelVersion: OPENAI_COMPATIBLE_VALUES.ARGO_EMBEDDING_MODEL_VERSION,
    embeddingDimensions: 1536,
  });
});

// AT-embed-profile-03: `openai-compatible` still fails closed on a missing
// required key or an invalid dimension (no implicit default).
test('AT-embed-profile-03: openai-compatible fails closed on missing/invalid config', () => {
  for (const key of [
    'ARGO_EMBEDDING_BASE_URL',
    'ARGO_EMBEDDING_MODEL',
    'ARGO_EMBEDDING_PROVIDER',
    'ARGO_EMBEDDING_MODEL_VERSION',
  ]) {
    assert.throws(
      () => buildProfileConfiguration({ ...OPENAI_COMPATIBLE_VALUES, [key]: '' }, PROFILE_OPENAI_COMPATIBLE),
      error => error.category === 'LIVE_PROVIDER_CONFIGURATION_REQUIRED' && error.field === key,
      `${key} must fail closed`,
    );
  }
  assert.throws(
    () => buildProfileConfiguration({ ...OPENAI_COMPATIBLE_VALUES, ARGO_EMBEDDING_DIMENSIONS: '' }, PROFILE_OPENAI_COMPATIBLE),
    error => error.category === 'EMBEDDING_DIMENSIONS_INVALID',
    'a missing/invalid dimension must fail closed',
  );
  assert.throws(
    () => requireEmbeddingDimensions('0'),
    error => error.category === 'EMBEDDING_DIMENSIONS_INVALID',
  );
});

// AT-embed-profile-04: the configured dimension drives the persistent vector
// index (default 1536), and the resolver falls back safely.
test('AT-embed-profile-04: configured dimension drives the vector index', async () => {
  assert.equal(resolveEmbeddingDimensions({ embeddingDimensions: 1536 }), 1536);
  assert.equal(resolveEmbeddingDimensions({}), 1536);
  assert.equal(requireEmbeddingDimensions('1024'), 1024);

  const queries = [];
  const session = {
    async executeWrite(action) {
      return action({ run: async cypher => { queries.push(cypher); return { records: [] }; } });
    },
    async executeRead(action) {
      return action({ run: async () => ({ records: [] }) });
    },
    async close() {},
  };
  const adapter = createProductionSemanticNeo4jAdapter({
    driver: { session: () => session },
    configuration: { embeddingDimensions: 1536, neo4jDatabase: 'test' },
  });
  await adapter.upsertRecords([]);
  const vectorIndexes = queries.filter(query => query.includes('CREATE VECTOR INDEX'));
  assert.equal(vectorIndexes.length, 3, 'one vector index per channel');
  for (const query of vectorIndexes) {
    assert.match(query, /`vector\.dimensions`: 1536/);
  }
});

// AT-embed-profile-05: the query instruction prefix is applied to the query side
// only; stored documents never receive it.
test('AT-embed-profile-05: query instruction applies to the query side only', () => {
  const prefix = 'Instruct: retrieve architecture\nQuery: ';
  assert.equal(composeQueryEmbeddingInput('find the auth element', prefix), `${prefix}find the auth element`);
  assert.equal(composeQueryEmbeddingInput('find the auth element', ''), 'find the auth element');
  assert.equal(composeQueryEmbeddingInput('find the auth element', undefined), 'find the auth element');
  assert.equal(
    composeQueryEmbeddingInput('find the auth element', 'Instruct: retrieve architecture\\nQuery: '),
    `${prefix}find the auth element`,
    'single-line .env escapes must decode to real newlines',
  );

  const src = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/defaultSemanticRetrieval.js'), 'utf8');
  assert.match(
    src,
    /composeQueryEmbeddingInput\(\s*\n?\s*request\.intent/,
    'the query-side intent must be wrapped by composeQueryEmbeddingInput',
  );
});

// AT-embed-profile-06: ARGO_EMBEDDING_API_KEY overrides QWEN_KEY as the Bearer
// token; absent it falls back to QWEN_KEY.
test('AT-embed-profile-06: embedding API key overrides QWEN_KEY for the Bearer token', async () => {
  let captured;
  const transport = {
    request: async (url, options) => {
      captured = options.headers.Authorization;
      return { ok: true, json: async () => ({ data: [{ embedding: [0, 1, 2] }] }) };
    },
  };
  const withKey = createLiveEmbeddingProviderClient({
    configuration: { embeddingBaseUrl: 'http://localhost:8080/v1', embeddingApiKey: 'LOCAL_KEY', qwenKey: 'QWEN_KEY' },
    transport,
  });
  await withKey.embed('x');
  assert.equal(captured, 'Bearer LOCAL_KEY');

  const fallback = createLiveEmbeddingProviderClient({
    configuration: { embeddingBaseUrl: 'http://localhost:8080/v1', qwenKey: 'QWEN_KEY' },
    transport,
  });
  await fallback.embed('x');
  assert.equal(captured, 'Bearer QWEN_KEY');
});

// AT-embed-profile-07: the canonical semantic-init / backfill path must resolve
// the SAME profile-aware configuration the retrieval path uses — argo init must
// not force the hardcoded cloud profile.
test('AT-embed-profile-07: argo init / backfill uses the configured embedding profile', () => {
  const evidence = {
    configuration: {
      embeddingProfile: PROFILE_OPENAI_COMPATIBLE,
      embeddingBaseUrl: 'http://localhost:8080/v1',
      embeddingModel: 'Alibaba-NLP/gte-Qwen2-1.5B-instruct',
      embeddingProvider: 'self-hosted-openai-compatible',
      embeddingModelVersion: 'local-2026-09-19',
      embeddingDimensions: 1536,
      embeddingApiKey: 'LOCAL_KEY',
      qwenKey: 'QWEN_KEY',
      neo4jDatabaseUrl: 'neo4j://127.0.0.1:7687',
      neo4jDatabaseUsername: 'neo4j',
      neo4jDatabasePassword: 'p',
    },
  };
  const config = buildDefaultSemanticConfiguration(evidence);
  assert.equal(config.embeddingBaseUrl, 'http://localhost:8080/v1');
  assert.equal(config.embeddingModel, 'Alibaba-NLP/gte-Qwen2-1.5B-instruct');
  assert.equal(config.embeddingProvider, 'self-hosted-openai-compatible');
  assert.equal(config.embeddingDimensions, 1536);
  assert.equal(config.embeddingCredential, 'LOCAL_KEY', 'dedicated embedding key wins');
  assert.equal(
    buildDefaultSemanticConfiguration({
      configuration: { ...evidence.configuration, embeddingApiKey: undefined },
    }).embeddingCredential,
    'QWEN_KEY',
    'falls back to QWEN_KEY',
  );

  // source guard: the init resolver must delegate to the profile-aware resolver
  // and must not source embedding fields from the hardcoded approved profile.
  const src = fs.readFileSync(path.join(ROOT, 'argo/scripts/systemarchitecture-mcp-server.js'), 'utf8');
  const start = src.indexOf('async function resolveDefaultSemanticConfiguration');
  assert.ok(start > 0, 'resolveDefaultSemanticConfiguration should exist');
  const end = src.indexOf('\n}', start);
  const body = src.slice(start, end);
  assert.match(body, /resolveApprovedLiveConfiguration\(/, 'init must resolve via the profile-aware resolver');
  assert.doesNotMatch(body, /W31_APPROVED_PROFILE/, 'init must not hardcode the approved cloud profile');
});
