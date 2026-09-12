'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_RERANK_MODEL,
  DEFAULT_RERANK_POOL,
  DEFAULT_RERANK_RETURN,
  isRerankEnabled,
  rerankConfig,
  resolveRerankProvider,
  parseRerankOrder,
  applyRerankOrder,
  rerankCandidates,
} = require('../argo/scripts/graph-rag/rerankRetrieval.js');

const ROOT = path.resolve(__dirname, '..');

// AT-rerank-01: rerank is OFF by default (zero behavior change) and env-gated.
test('AT-rerank-01: rerank switch defaults OFF (env-gated, kill switch)', () => {
  assert.equal(isRerankEnabled({}), false, 'default must be OFF');
  assert.equal(isRerankEnabled({ ARGO_SEMANTIC_RERANK: '0' }), false);
  assert.equal(isRerankEnabled({ ARGO_SEMANTIC_RERANK: '1' }), true);
  assert.deepEqual(rerankConfig({}), { model: DEFAULT_RERANK_MODEL, poolSize: DEFAULT_RERANK_POOL, maxReturn: DEFAULT_RERANK_RETURN });
  assert.equal(rerankConfig({ ARGO_SEMANTIC_RERANK_MODEL: 'qwen-plus' }).model, 'qwen-plus');
  assert.equal(rerankConfig({ ARGO_SEMANTIC_RERANK_POOL: '30' }).poolSize, 30);
  assert.equal(rerankConfig({ ARGO_SEMANTIC_RERANK_RETURN: '5' }).maxReturn, 5);
});

// AT-rerank-02: parse the model's order, accepting canonical/bare/suffix ids.
test('AT-rerank-02: parseRerankOrder accepts bare/suffix ids and ignores unknowns', () => {
  const ids = ['Element:1240', 'Element:1334', 'View:298'];
  assert.deepEqual(parseRerankOrder('{"order":["Element:1334","Element:1240"]}', ids), ['Element:1334', 'Element:1240']);
  assert.deepEqual(parseRerankOrder('{"order":[1334,1240]}', ids), ['Element:1334', 'Element:1240']); // bare numbers
  assert.deepEqual(parseRerankOrder('{"order":["298","View:298"]}', ids), ['View:298']); // dedupe + suffix
  assert.deepEqual(parseRerankOrder('{"order":["nope"]}', ids), []);
  assert.deepEqual(parseRerankOrder('not json', ids), []);
});

// AT-rerank-03: applyRerankOrder reorders, appends omitted seeds, respects limit,
// and is fail-open when the reranker produced no order.
test('AT-rerank-03: applyRerankOrder reorders + appends + limits (fail-open)', () => {
  const seeds = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(applyRerankOrder(seeds, ['c', 'a'], 3).map(s => s.id), ['c', 'a', 'b']);
  assert.deepEqual(applyRerankOrder(seeds, ['c'], 2).map(s => s.id), ['c', 'a']);
  // fail-open: null order => original order (the write gate sees unchanged candidates)
  assert.deepEqual(applyRerankOrder(seeds, null, 3).map(s => s.id), ['a', 'b', 'c']);
  assert.deepEqual(applyRerankOrder(seeds, [], 3).map(s => s.id), ['a', 'b', 'c']);
});

// AT-rerank-04: the chat reranker returns the parsed order, and fails open to
// null on any error (never throws).
test('AT-rerank-04: rerankCandidates parses the chat response and fails open', async () => {
  const candidates = [{ id: 'Element:a', searchText: 'A' }, { id: 'Element:b', searchText: 'B' }];
  const provider = { baseUrl: 'https://example/v1', apiKey: 'k', model: 'qwen-turbo' };
  const okTransport = { request: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"order":["b","a"]}' } }] }) }) };
  assert.deepEqual(await rerankCandidates({ query: 'q', candidates, provider, transport: okTransport, maxReturn: 2 }), ['Element:b', 'Element:a']);

  const badTransport = { request: async () => ({ ok: false }) };
  assert.equal(await rerankCandidates({ query: 'q', candidates, provider, transport: badTransport }), null);
  const throwTransport = { request: async () => { throw new Error('boom'); } };
  assert.equal(await rerankCandidates({ query: 'q', candidates, provider, transport: throwTransport }), null);
  // trivial / misconfigured inputs short-circuit
  assert.equal(await rerankCandidates({ query: 'q', candidates: [candidates[0]], provider, transport: okTransport }), null);
  assert.equal(await rerankCandidates({ query: 'q', candidates, provider: null, transport: okTransport }), null);
  assert.equal(await rerankCandidates({ query: 'q', candidates, provider: { baseUrl: '', apiKey: '' }, transport: okTransport }), null);
});

// AT-rerank-06: the rerank provider/model is decoupled from the embedding
// provider — dedicated ARGO_RERANK_* keys win; otherwise it falls back to the
// embedding configuration (qwen by default).
test('AT-rerank-06: rerank provider is independent of embedding (qwen fallback + overrides)', () => {
  const embedding = { embeddingBaseUrl: 'https://emb/v1', qwenKey: 'EK', embeddingProvider: 'aliyun' };
  assert.deepEqual(resolveRerankProvider(embedding, {}), { baseUrl: 'https://emb/v1', apiKey: 'EK', model: DEFAULT_RERANK_MODEL, provider: 'aliyun' });
  assert.deepEqual(
    resolveRerankProvider(embedding, { ARGO_RERANK_BASE_URL: 'https://other/v1', ARGO_RERANK_API_KEY: 'OK', ARGO_RERANK_MODEL: 'qwen-plus', ARGO_RERANK_PROVIDER: 'other' }),
    { baseUrl: 'https://other/v1', apiKey: 'OK', model: 'qwen-plus', provider: 'other' },
  );
  // model-only override keeps the embedding provider/endpoint
  const modelOnly = resolveRerankProvider(embedding, { ARGO_SEMANTIC_RERANK_MODEL: 'qwen-max' });
  assert.equal(modelOnly.model, 'qwen-max');
  assert.equal(modelOnly.baseUrl, 'https://emb/v1');
  assert.equal(modelOnly.apiKey, 'EK');
});

// AT-rerank-05: the production retrieval only reranks when the switch is on
// (parity guard for the default-OFF release).
test('AT-rerank-05: production retrieval gates rerank behind the switch', () => {
  const src = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/defaultSemanticRetrieval.js'), 'utf8');
  assert.match(src, /const rerank = isRerankEnabled\(\)/);
  assert.match(src, /if \(rerank && seeds\.length > 1\)/);
  assert.match(src, /applyRerankOrder\(seeds, ordered, topK\)/);
  assert.match(src, /rerankCandidates\(/);
});
