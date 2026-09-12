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
  rerankTimeoutMs,
  resolveRerankProvider,
  resolveRerankThinkingOff,
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
// (parity guard for the default-OFF release), and a request can opt out.
test('AT-rerank-05: production retrieval gates rerank behind the switch + per-request opt-out', () => {
  const src = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/defaultSemanticRetrieval.js'), 'utf8');
  assert.match(src, /const rerank = isRerankEnabled\(\) && request\.rerank !== false/, 'switch AND per-request opt-out');
  assert.match(src, /rerankCandidates\(/);
  assert.match(src, /applyRerankOrder\(seeds, ordered, topK\)/);
});

// AT-rerank-07: the per-channel reranks run CONCURRENTLY so latency is ~one LLM
// call instead of the sum over channels; the per-call timeout is bounded so a
// slow call cannot blow the query SLA; and the candidate pool is NOT shrunk
// (it is the recall ceiling) -- with DeepSeek thinking disabled the rerank
// latency is ~flat across pool sizes, so recall must win over latency.
test('AT-rerank-07: channel reranks are concurrent, timeout bounded, pool not shrunk', () => {
  const src = fs.readFileSync(path.join(ROOT, 'argo/scripts/graph-rag/defaultSemanticRetrieval.js'), 'utf8');
  assert.match(src, /Promise\.all\(channelSeeds\.map/, 'per-channel reranks must run in parallel');
  assert.ok(DEFAULT_RERANK_POOL >= 20, 'pool is the recall ceiling and must not be shrunk below the original 20');
  assert.ok(rerankTimeoutMs({}) <= 4000, 'default rerank timeout must keep the query under ~5s');
  assert.ok(rerankTimeoutMs({ ARGO_SEMANTIC_RERANK_TIMEOUT_MS: '6000' }) === 6000, 'timeout stays env-overridable');
});

// AT-rerank-08: thinking is disabled by DEFAULT for EVERY rerank provider (not
// just deepseek) so a future model swap keeps the same fast path.
test('AT-rerank-08: rerank disables thinking by default for any provider', async () => {
  const candidates = [{ id: 'Element:a', searchText: 'A' }, { id: 'Element:b', searchText: 'B' }];
  let captured;
  const capture = { request: async (url, options) => { captured = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"order":["b","a"]}' } }] }) }; } };
  await rerankCandidates({ query: 'q', candidates, provider: { baseUrl: 'https://api.deepseek.com', apiKey: 'k', model: 'deepseek-flash', provider: 'deepseek' }, transport: capture, maxReturn: 2 });
  assert.deepEqual(captured.thinking, { type: 'disabled' }, 'deepseek rerank must disable thinking');
  captured = undefined;
  await rerankCandidates({ query: 'q', candidates, provider: { baseUrl: 'https://other/v1', apiKey: 'k', model: 'x', provider: 'qwen' }, transport: capture, maxReturn: 2 });
  assert.deepEqual(captured.thinking, { type: 'disabled' }, 'the default applies to any provider (model-agnostic)');
});

// AT-rerank-09: the thinking-off fragment is env-switchable/overridable, and a
// provider that REJECTS it is retried WITHOUT it so rerank (and thus recall) is
// never lost to an unsupported field.
test('AT-rerank-09: thinking-off is configurable and never breaks rerank on rejection', async () => {
  assert.deepEqual(resolveRerankThinkingOff({}), { thinking: { type: 'disabled' } });
  assert.equal(resolveRerankThinkingOff({ ARGO_RERANK_DISABLE_THINKING: '0' }), null, 'master switch can turn it off');
  assert.deepEqual(resolveRerankThinkingOff({ ARGO_RERANK_THINKING_PARAM: '{"reasoning_effort":"none"}' }), { reasoning_effort: 'none' }, 'custom fragment for another model');
  assert.equal(resolveRerankThinkingOff({ ARGO_RERANK_THINKING_PARAM: 'not json' }), null, 'invalid override degrades to no fragment');

  const candidates = [{ id: 'Element:a', searchText: 'A' }, { id: 'Element:b', searchText: 'B' }];
  const provider = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', provider: 'custom' };
  const seen = [];
  const rejecting = {
    request: async (url, options) => {
      const body = JSON.parse(options.body);
      seen.push('thinking' in body);
      if ('thinking' in body) return { ok: false, status: 400, json: async () => ({ error: { message: 'unknown field thinking' } }) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"order":["b","a"]}' } }] }) };
    },
  };
  const order = await rerankCandidates({ query: 'q', candidates, provider, transport: rejecting, maxReturn: 2 });
  assert.deepEqual(order, ['Element:b', 'Element:a'], 'rerank must still succeed after dropping the unsupported field');
  assert.deepEqual(seen, [true, false], 'attempt with the field, then one retry without it');
});
