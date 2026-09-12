'use strict';

// Hybrid retrieval fusion (P2). Pure, dependency-free helpers so the fusion
// logic is fully unit-testable and the production retrieval path can stay
// additive: when hybrid is OFF nothing here is invoked.
//
// Design:
// - vector (dense) and lexical (full-text/BM25) ranked lists are fused with
//   Reciprocal Rank Fusion: score(id) = sum over lists of 1/(k + rank).
// - RRF needs no score normalization between the two very different score
//   scales, and guarantees the union is retained (recall can only increase).

const DEFAULT_RRF_K = 60;
const DEFAULT_HYBRID_TOP_K = 16;
// Vector-first weighting: the dense channel is the stronger signal on this
// graph, so lexical only nudges the ranking and rescues misses.
const DEFAULT_VECTOR_WEIGHT = 3;
const DEFAULT_LEXICAL_WEIGHT = 1;

function isHybridEnabled(env = process.env) {
  return String((env && env.ARGO_SEMANTIC_HYBRID) || '') === '1';
}

function hybridWeights(env = process.env) {
  const vector = Number(env && env.ARGO_SEMANTIC_HYBRID_VECTOR_WEIGHT);
  const lexical = Number(env && env.ARGO_SEMANTIC_HYBRID_LEXICAL_WEIGHT);
  return [
    Number.isFinite(vector) && vector >= 0 ? vector : DEFAULT_VECTOR_WEIGHT,
    Number.isFinite(lexical) && lexical >= 0 ? lexical : DEFAULT_LEXICAL_WEIGHT,
  ];
}

function hybridTopK(env = process.env) {
  const value = Number(env && env.ARGO_SEMANTIC_HYBRID_TOP_K);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_HYBRID_TOP_K;
}

function rrfK(env = process.env) {
  const value = Number(env && env.ARGO_SEMANTIC_HYBRID_RRF_K);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RRF_K;
}

// Lucene full-text queries reject raw punctuation (e.g. "A --(Flow)--> B") and
// blow the maxClauseCount on very long text (long Chinese descriptions become
// hundreds of single-character clauses). Truncate first, then escape the
// reserved query-syntax characters so any intent/name/statement is literal.
// Returns '' for blank input (caller skips).
const MAX_FULLTEXT_QUERY_LENGTH = 256;

function sanitizeFulltextQuery(text) {
  const value = String(text === undefined || text === null ? '' : text)
    .trim()
    .slice(0, MAX_FULLTEXT_QUERY_LENGTH);
  if (!value) return '';
  return value
    .replace(/&&/g, '\\&\\&')
    .replace(/\|\|/g, '\\|\\|')
    .replace(/([+\-!(){}[\]^"~*?:\\/])/g, '\\$1');
}

// Fuse ranked record lists by id (canonicalIdentity). Each list is expected to be
// already sorted best-first. Returns records carrying the fused `score`, with
// the first-seen record object preserved (so downstream keeps its fields).
function rrfFuse(lists, options = {}) {
  const k = Number.isFinite(options.k) && options.k > 0 ? options.k : DEFAULT_RRF_K;
  const weights = Array.isArray(options.weights) ? options.weights : [];
  const byId = new Map();
  (Array.isArray(lists) ? lists : []).forEach((list, listIndex) => {
    const weight = Number.isFinite(weights[listIndex]) && weights[listIndex] >= 0 ? weights[listIndex] : 1;
    (Array.isArray(list) ? list : []).forEach((record, rank) => {
      if (!record || !record.id) return;
      const entry = byId.get(record.id) || { id: record.id, record, score: 0, matchedLists: 0 };
      entry.score += weight / (k + rank + 1);
      entry.matchedLists += 1;
      if (!entry.record) entry.record = record;
      byId.set(record.id, entry);
    });
  });
  return [...byId.values()]
    .sort((left, right) => (right.score - left.score) || String(left.id).localeCompare(String(right.id)))
    .map(entry => Object.freeze({
      ...entry.record,
      id: entry.id,
      canonicalIdentity: entry.id,
      score: entry.score,
      rrfScore: entry.score,
      matchedLists: entry.matchedLists,
    }));
}

// Fuse the two per-channel seed lists. With an empty lexical list this preserves
// the vector ordering (RRF on a single list is order-preserving) — which is what
// makes "hybrid ON but no lexical hit" behave like the vector-only baseline.
function fuseChannelSeeds({ vectorSeeds = [], lexicalSeeds = [], k = DEFAULT_RRF_K, limit, weights } = {}) {
  const fused = rrfFuse([
    Array.isArray(vectorSeeds) ? vectorSeeds.filter(Boolean) : [],
    Array.isArray(lexicalSeeds) ? lexicalSeeds.filter(Boolean) : [],
  ], { k, ...(Array.isArray(weights) ? { weights } : {}) });
  return Number.isInteger(limit) && limit > 0 ? fused.slice(0, limit) : fused;
}

module.exports = {
  DEFAULT_RRF_K,
  DEFAULT_HYBRID_TOP_K,
  DEFAULT_VECTOR_WEIGHT,
  DEFAULT_LEXICAL_WEIGHT,
  isHybridEnabled,
  hybridTopK,
  hybridWeights,
  rrfK,
  rrfFuse,
  fuseChannelSeeds,
  sanitizeFulltextQuery,
};
