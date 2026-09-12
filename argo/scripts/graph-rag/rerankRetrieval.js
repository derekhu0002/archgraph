'use strict';

// Two-stage rerank (P3): after the (vector, or hybrid) candidate pool is
// retrieved, an LLM listwise reranker reorders it by relevance to the query.
// Additive and fail-open: when disabled nothing runs; any error returns null so
// the caller keeps the original ordering. Pure helpers are exported for tests.

const DEFAULT_RERANK_MODEL = 'qwen-turbo';
const DEFAULT_RERANK_POOL = 20;
const DEFAULT_RERANK_RETURN = 8;
const DEFAULT_RERANK_TIMEOUT_MS = 8000;

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

// Rerank provider resolution, DECOUPLED from the embedding provider:
// - dedicated keys (ARGO_RERANK_BASE_URL / ARGO_RERANK_API_KEY / ARGO_RERANK_PROVIDER
//   / ARGO_RERANK_MODEL) win when set, so a different provider/model can be used;
// - otherwise it falls back to the embedding configuration (qwen by default).
function resolveRerankProvider(configuration = {}, env = process.env) {
  const baseUrl = firstNonEmpty(env.ARGO_RERANK_BASE_URL, configuration.embeddingBaseUrl);
  const apiKey = firstNonEmpty(env.ARGO_RERANK_API_KEY, configuration.qwenKey);
  const model = firstNonEmpty(env.ARGO_RERANK_MODEL, env.ARGO_SEMANTIC_RERANK_MODEL, DEFAULT_RERANK_MODEL);
  const provider = firstNonEmpty(env.ARGO_RERANK_PROVIDER, configuration.embeddingProvider, 'qwen');
  return { baseUrl, apiKey, model, provider };
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
  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You rank architecture elements by relevance to a query. Return ONLY JSON {"order":[ids best-first]} using only the candidate ids.' },
      { role: 'user', content: `Query: ${query}\n\nCandidates (id\\ttext):\n${list.map(candidate => `${candidate.id}\t${candidateText(candidate)}`).join('\n')}\n\nReturn up to ${Math.min(maxReturn || DEFAULT_RERANK_RETURN, list.length)} ids best-first.` },
    ],
  };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs || rerankTimeoutMs()) : null;
  try {
    const response = await transport.request(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response || response.ok !== true || typeof response.json !== 'function') return null;
    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    return parseRerankOrder(content, list.map(candidate => candidate.id));
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_RERANK_MODEL,
  DEFAULT_RERANK_POOL,
  DEFAULT_RERANK_RETURN,
  DEFAULT_RERANK_TIMEOUT_MS,
  isRerankEnabled,
  rerankConfig,
  rerankTimeoutMs,
  resolveRerankProvider,
  parseRerankOrder,
  applyRerankOrder,
  rerankCandidates,
};
