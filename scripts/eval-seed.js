'use strict';
/**
 * Evaluation-set SEED loader (single source of truth).
 *
 * The navigation evaluation dataset is archived as a versioned, structured
 * SEED (data/eval-seeds/navigation-seed.json) so it can be maintained and
 * expanded over time: add/edit a question in the SEED and bump its version;
 * every harness and acceptance test consumes this loader — no question data is
 * duplicated in scripts.
 *
 * Each seed question carries: id / dimension(+key) / label / question
 * (agent-facing prompt) / given·when·then (doc triple) / retrievalHint /
 * target {kind,id,names} / retrieval (executable tool sequence, may use pick
 * for multi-hop) / requirements (contains / expectAbsent judgment).
 *
 * Usage:
 *   const { seed, questions, DIMENSIONS, byDimension } = require('./eval-seed.js');
 *   // container run: NAV_SEED_PATH=/opt/sandbox/navigation-seed.json
 */
const fs = require('node:fs');
const path = require('node:path');

const SEED_FILE_NAME = 'navigation-seed.json';
const DEFAULT_SEED_PATH = path.join(__dirname, '..', 'data', 'eval-seeds', SEED_FILE_NAME);
const KNOWN_DIMENSIONS = ['定位', '可达', '视角切换', '边界内导航'];

function resolveSeedPath(explicit) {
  if (explicit && fs.existsSync(explicit)) return path.resolve(explicit);
  if (process.env.NAV_SEED_PATH && fs.existsSync(process.env.NAV_SEED_PATH)) {
    return path.resolve(process.env.NAV_SEED_PATH);
  }
  return DEFAULT_SEED_PATH;
}

function validateSeed(seed) {
  const errors = [];
  if (!seed || typeof seed !== 'object') return { ok: false, errors: ['seed must be an object'] };
  if (seed.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof seed.seedId !== 'string' || !seed.seedId) errors.push('seedId required');
  if (typeof seed.version !== 'string' || !seed.version) errors.push('version required');
  if (typeof seed.status !== 'string' || !seed.status) errors.push('status required');
  if (!Array.isArray(seed.dimensions) || seed.dimensions.length !== 4) errors.push('4 dimensions required');
  if (!Array.isArray(seed.questions)) errors.push('questions array required');
  for (const dim of seed.dimensions || []) {
    if (!dim || typeof dim.key !== 'string' || typeof dim.name !== 'string' || typeof dim.en !== 'string') {
      errors.push('each dimension needs key/name/en');
    }
  }
  const seen = new Set();
  const dimCount = {};
  for (const q of seed.questions || []) {
    if (!q || typeof q.id !== 'string' || !/^NV-\d{2}$/.test(q.id)) { errors.push('question id must be NV-xx'); continue; }
    if (seen.has(q.id)) errors.push(`duplicate id ${q.id}`);
    seen.add(q.id);
    for (const field of ['dimension', 'dimensionKey', 'label', 'question', 'given', 'when', 'then', 'retrievalHint']) {
      if (typeof q[field] !== 'string' || !q[field]) errors.push(`${q.id} missing ${field}`);
    }
    if (!q.target || typeof q.target.id !== 'string') errors.push(`${q.id} missing target.id`);
    if (!Array.isArray(q.target.names) || q.target.names.length === 0) errors.push(`${q.id} missing target.names`);
    if (!Array.isArray(q.retrieval) || q.retrieval.length === 0) errors.push(`${q.id} missing retrieval`);
    if (!Array.isArray(q.requirements) || q.requirements.length === 0) errors.push(`${q.id} missing requirements`);
    dimCount[q.dimension] = (dimCount[q.dimension] || 0) + 1;
  }
  if (seen.size !== 20) errors.push(`expected 20 questions, got ${seen.size}`);
  for (const dim of KNOWN_DIMENSIONS) {
    if (dimCount[dim] !== 5) errors.push(`dimension ${dim} should have 5 questions, got ${dimCount[dim] || 0}`);
  }
  return { ok: errors.length === 0, errors };
}

function loadSeed(options = {}) {
  const filePath = resolveSeedPath(options && options.path);
  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`eval-seed: failed to read ${filePath}: ${error.message}`);
  }
  const validation = validateSeed(seed);
  if (!validation.ok) {
    throw new Error(`eval-seed: invalid SEED ${filePath}\n  - ${validation.errors.join('\n  - ')}`);
  }
  return { seed, filePath };
}

const loaded = loadSeed();
const seed = loaded.seed;
const questions = seed.questions;
const DIMENSIONS = seed.dimensions.map(d => d.name);
const byDimension = {};
for (const dim of DIMENSIONS) byDimension[dim] = questions.filter(q => q.dimension === dim);

// Derive the agent-eval question form: {id, dimension, question, answer, answerAlt}
// used by the full-ArchGraph OpenCode Agent navigation eval.
function toAgentQuestion(q) {
  return {
    id: q.id,
    dimension: q.dimension,
    question: q.question,
    answer: q.target.id,
    answerAlt: [...(q.target.names || [])],
  };
}

module.exports = {
  seed,
  questions,
  DIMENSIONS,
  byDimension,
  SEED_FILE_NAME,
  DEFAULT_SEED_PATH,
  resolveSeedPath,
  validateSeed,
  loadSeed,
  toAgentQuestion,
};
