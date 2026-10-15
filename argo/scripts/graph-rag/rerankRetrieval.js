'use strict';

// Two-stage rerank (P3): after the (vector, or hybrid) candidate pool is
// retrieved, a reranker reorders it by relevance to the query. Two transports:
// 'chat' (default) = LLM listwise over /chat/completions; 'native' = a real
// cross-encoder rerank service (DashScope text-rerank contract, e.g.
// qwen3.7-text-rerank). Additive and fail-open: when disabled nothing runs;
// any error returns null so the caller keeps the original ordering. Pure
// helpers are exported for tests.

const DEFAULT_RERANK_MODEL = 'qwen-turbo';
// Candidate pool size. The pool is the recall CEILING: a target the seed stage
// ranks outside the pool can never be recovered by rerank, so it must NOT be
// shrunk for speed. Keep the original 20 (measured with rerank thinking
// disabled and with native cross-encoder calls, latency is ~flat across
// candidate counts), so a larger pool costs ~nothing -- never trade recall
// for latency here.
const DEFAULT_RERANK_POOL = 20;
const DEFAULT_RERANK_RETURN = 8;
// Per-call timeout. Channel reranks run concurrently, so the end-to-end rerank
// cost is ~one timeout, not N. 3.5s keeps the whole semantic query under ~5s
// while still letting typical calls (1-4s) complete; slower calls fail open to
// the pre-rerank (fused) order. Overridable via ARGO_SEMANTIC_RERANK_TIMEOUT_MS.
const DEFAULT_RERANK_TIMEOUT_MS = 3500;

function rerankTimeoutMs(env = process.env) {
  const value = Number(env && env.ARGO_SEMANTIC_RERANK_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RERANK_TIMEOUT_MS;
}

function isRerankEnabled(env = process.env) {
  return String((env && env.ARGO_SEMANTIC_RERANK) || '') === '1';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

// Rerank transport selection: 'chat' (default) = listwise LLM via
// /chat/completions; 'native' = cross-encoder rerank service (DashScope
// text-rerank contract). Unset/unknown = 'chat' (backward compatible).
function resolveRerankTransport(env = process.env) {
  const value = firstNonEmpty(env && env.ARGO_RERANK_TRANSPORT).toLowerCase();
  return value === 'native' ? 'native' : 'chat';
}

// DashScope native text-rerank endpoint path, appended when the configured
// base URL is a bare origin; a full endpoint URL (already carrying
// /services/rerank/) is used verbatim.
const NATIVE_RERANK_PATH = '/api/v1/services/rerank/text-rerank/text-rerank';

function nativeRerankEndpoint(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (trimmed.includes('/services/rerank/')) return trimmed;
  return `${trimmed}${NATIVE_RERANK_PATH}`;
}

// Map the native rerank payload ({output.results:[{index,relevance_score}]})
// to canonical candidate ids, best-first — the same shape parseRerankOrder
// produces, so applyRerankOrder downstream is transport-agnostic.
function parseNativeRerankOrder(payload, candidateIds) {
  const results = payload && payload.output && Array.isArray(payload.output.results)
    ? payload.output.results
    : [];
  const scored = [];
  for (const entry of results) {
    const index = entry && Number.isInteger(entry.index) ? entry.index : -1;
    const score = entry && Number(entry.relevance_score);
    if (index >= 0 && index < candidateIds.length && Number.isFinite(score)) {
      scored.push({ index, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const order = [];
  for (const { index } of scored) {
    const id = candidateIds[index];
    if (id && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  return order;
}

// Rerank provider resolution, DECOUPLED from the embedding provider:
// - dedicated keys (ARGO_RERANK_BASE_URL / ARGO_RERANK_API_KEY / ARGO_RERANK_PROVIDER
//   / ARGO_RERANK_MODEL) win when set, so a different provider/model can be used;
// - otherwise it falls back to the embedding configuration (qwen by default).
// - transportMode (ARGO_RERANK_TRANSPORT) selects the wire contract per provider.
function resolveRerankProvider(configuration = {}, env = process.env) {
  const baseUrl = firstNonEmpty(env.ARGO_RERANK_BASE_URL, configuration.embeddingBaseUrl);
  const apiKey = firstNonEmpty(env.ARGO_RERANK_API_KEY, configuration.qwenKey);
  const model = firstNonEmpty(env.ARGO_RERANK_MODEL, env.ARGO_SEMANTIC_RERANK_MODEL, DEFAULT_RERANK_MODEL);
  const provider = firstNonEmpty(env.ARGO_RERANK_PROVIDER, configuration.embeddingProvider, 'qwen');
  const transportMode = resolveRerankTransport(env);
  return { baseUrl, apiKey, model, provider, transportMode };
}

function rerankConfig(env = process.env) {
  const model = (env && typeof env.ARGO_SEMANTIC_RERANK_MODEL === 'string' && env.ARGO_SEMANTIC_RERANK_MODEL.trim())
    ? env.ARGO_SEMANTIC_RERANK_MODEL.trim()
    : DEFAULT_RERANK_MODEL;
  const pool = Number(env && env.ARGO_SEMANTIC_RERANK_POOL);
  const maxReturn = Number(env && env.ARGO_SEMANTIC_RERANK_RETURN);
  return {
    model,
    poolSize: Number.isInteger(pool) && pool > 0 ? pool : DEFAULT_RERANK_POOL,
    maxReturn: Number.isInteger(maxReturn) && maxReturn > 0 ? maxReturn : DEFAULT_RERANK_RETURN,
  };
}

// Model-agnostic "disable thinking/reasoning" body fragment. Reasoning models
// spend seconds on hidden reasoning tokens for a simple listwise ranking with no
// accuracy gain, so disable it by default for EVERY rerank provider (not just
// deepseek), so switching models keeps the same behaviour. Providers use
// different field names, so it is fully overridable:
//   ARGO_RERANK_DISABLE_THINKING=0      -> send nothing
//   ARGO_RERANK_THINKING_PARAM='{...}'  -> send this exact JSON fragment
// rerankCandidates retries WITHOUT the fragment if the provider rejects it, so an
// unsupported field can never break rerank (recall-first: never lose rerank to a
// 400).
const DEFAULT_RERANK_THINKING_OFF = Object.freeze({ thinking: { type: 'disabled' } });

function resolveRerankThinkingOff(env = process.env) {
  if (String((env && env.ARGO_RERANK_DISABLE_THINKING) || '') === '0') return null;
  const raw = env && env.ARGO_RERANK_THINKING_PARAM;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return DEFAULT_RERANK_THINKING_OFF;
}

function candidateText(record) {
  const raw = record && (record.searchText || record.description || record.name || '');
  return String(raw).replace(/\s+/g, ' ').slice(0, 160);
}

// Accept the canonical id or its bare/suffix form (models often drop the
// channel prefix), dedupe, ignore anything not in the candidate set.
function parseRerankOrder(content, candidateIds) {
  let parsed;
  try { parsed = JSON.parse(content); } catch { return []; }
  const raw = Array.isArray(parsed && parsed.order) ? parsed.order : [];
  const byKey = new Map();
  for (const id of candidateIds) {
    const text = String(id);
    byKey.set(text, id);
    byKey.set(text.split(':').slice(1).join(':'), id);
    byKey.set(text.split(':').pop(), id);
  }
  const seen = new Set();
  const order = [];
  for (const value of raw) {
    const canonical = byKey.get(String(value));
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      order.push(canonical);
    }
  }
  return order;
}

// Reorder seeds by the model's order, then append any seeds the model omitted
// (nothing is lost), bounded by `limit`.
function applyRerankOrder(seeds, orderedIds, limit) {
  const list = Array.isArray(seeds) ? seeds.filter(Boolean) : [];
  const byId = new Map(list.map(seed => [seed.id, seed]));
  const out = [];
  const seen = new Set();
  for (const id of (Array.isArray(orderedIds) ? orderedIds : [])) {
    const seed = byId.get(id);
    if (seed && !seen.has(id)) { seen.add(id); out.push(seed); }
  }
  for (const seed of list) {
    if (!seen.has(seed.id)) { seen.add(seed.id); out.push(seed); }
  }
  return Number.isInteger(limit) && limit > 0 ? out.slice(0, limit) : out;
}

async function rerankCandidates({ query, candidates, provider, transport, maxReturn, timeoutMs } = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(candidate => candidate && candidate.id) : [];
  if (list.length < 2 || typeof query !== 'string' || query.trim() === '') return null;
  if (!provider || !transport || typeof transport.request !== 'function') return null;
  const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl : '';
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : '';
  if (baseUrl === '' || apiKey === '') return null;
  const model = provider.model || DEFAULT_RERANK_MODEL;
  const timeout = timeoutMs || rerankTimeoutMs();
  const topN = Math.min(maxReturn || DEFAULT_RERANK_RETURN, list.length);
  // Native cross-encoder transport: dedicated rerank service contract
  // (input.query/documents + parameters), no chat prompt, no thinking fields.
  if (provider.transportMode === 'native') {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const response = await transport.request(nativeRerankEndpoint(baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: { query, documents: list.map(candidateText) },
          parameters: { return_documents: false, top_n: topN },
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response || response.ok !== true || typeof response.json !== 'function') return null;
      const payload = await response.json();
      return parseNativeRerankOrder(payload, list.map(candidate => candidate.id));
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const thinkingOff = resolveRerankThinkingOff();
  const baseBody = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You rank architecture elements by relevance to a query. Return ONLY JSON {"order":[ids best-first]} using only the candidate ids.' },
      { role: 'user', content: `Query: ${query}\n\nCandidates (id\\ttext):\n${list.map(candidate => `${candidate.id}\t${candidateText(candidate)}`).join('\n')}\n\nReturn up to ${topN} ids best-first.` },
    ],
  };
  const send = async (extra) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      return await transport.request(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...baseBody, ...extra }),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    let response = await send(thinkingOff || {});
    // A provider may reject the thinking-off fragment (unknown field -> 400).
    // Retry WITHOUT it so rerank still works: never lose rerank/recall to a 400.
    if ((!response || response.ok !== true) && thinkingOff) {
      response = await send({});
    }
    if (!response || response.ok !== true || typeof response.json !== 'function') return null;
    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    return parseRerankOrder(content, list.map(candidate => candidate.id));
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_RERANK_MODEL,
  DEFAULT_RERANK_POOL,
  DEFAULT_RERANK_RETURN,
  DEFAULT_RERANK_TIMEOUT_MS,
  NATIVE_RERANK_PATH,
  isRerankEnabled,
  rerankConfig,
  rerankTimeoutMs,
  resolveRerankTransport,
  nativeRerankEndpoint,
  parseNativeRerankOrder,
  resolveRerankProvider,
  resolveRerankThinkingOff,
  DEFAULT_RERANK_THINKING_OFF,
  parseRerankOrder,
  applyRerankOrder,
  rerankCandidates,
};
