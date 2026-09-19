'use strict';

// Embedding provider profile (ArchGraph ARGO).
//
// The semantic-retrieval embedding backend is either the human-approved cloud
// profile (`approved`, the default, byte-for-byte unchanged) or a self-hosted
// OpenAI-compatible endpoint (`openai-compatible`) for intranet / offline
// deployments. This module owns the profile vocabulary, the dimension contract,
// and the query-side instruction composition so the live configuration resolver
// and the retrieval runtime share one implementation.

const PROFILE_KEY = 'ARGO_EMBEDDING_PROFILE';
const QUERY_INSTRUCTION_KEY = 'ARGO_EMBEDDING_QUERY_INSTRUCTION';
const API_KEY = 'ARGO_EMBEDDING_API_KEY';
const PROFILE_APPROVED = 'approved';
const PROFILE_OPENAI_COMPATIBLE = 'openai-compatible';
const SUPPORTED_EMBEDDING_PROFILES = Object.freeze([PROFILE_APPROVED, PROFILE_OPENAI_COMPATIBLE]);
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

function resolveEmbeddingProfile(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === '' ? PROFILE_APPROVED : normalized;
}

function isApprovedEmbeddingProfile(value) {
  return resolveEmbeddingProfile(value) === PROFILE_APPROVED;
}

function requireSupportedEmbeddingProfile(value) {
  const profile = resolveEmbeddingProfile(value);
  if (!SUPPORTED_EMBEDDING_PROFILES.includes(profile)) {
    throw profileError('EMBEDDING_PROFILE_UNSUPPORTED');
  }
  return profile;
}

function resolveEmbeddingDimensions(value, fallback = DEFAULT_EMBEDDING_DIMENSIONS) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requireEmbeddingDimensions(value) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw profileError('EMBEDDING_DIMENSIONS_INVALID');
  }
  return parsed;
}

// The query-side input may carry an instruction prefix (e.g. gte-Qwen2's
// "Instruct: <task>\nQuery: <query>"); document-side input stays raw so stored
// vectors are never polluted by a query-only prefix. The prefix commonly comes
// from a single-line `.env` value, so `\n`/`\r`/`\t` escapes are decoded here.
function normalizeInstruction(instruction) {
  if (typeof instruction !== 'string') return '';
  return instruction
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function composeQueryEmbeddingInput(text, instruction) {
  const query = text == null ? '' : String(text);
  const prefix = normalizeInstruction(instruction);
  return prefix === '' ? query : `${prefix}${query}`;
}

function profileError(category) {
  const error = new Error(category);
  error.category = category;
  return error;
}

module.exports = {
  PROFILE_KEY,
  QUERY_INSTRUCTION_KEY,
  API_KEY,
  PROFILE_APPROVED,
  PROFILE_OPENAI_COMPATIBLE,
  SUPPORTED_EMBEDDING_PROFILES,
  DEFAULT_EMBEDDING_DIMENSIONS,
  resolveEmbeddingProfile,
  isApprovedEmbeddingProfile,
  requireSupportedEmbeddingProfile,
  resolveEmbeddingDimensions,
  requireEmbeddingDimensions,
  composeQueryEmbeddingInput,
};
