'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  memoryThresholdFor,
  auditThresholdFor,
  resolveTopK,
  AUDIT_PURPOSES,
} = require('../argo/scripts/graph-rag/defaultSemanticRetrieval.js');

const ELEMENT = { channel: 'Element' };
const RELATIONSHIP = { channel: 'ArchitectureRelationship' };

// External-view acceptance tests for purpose-aware, env-configurable semantic
// retrieval thresholds + bounded top-K recall:
//   - memory retrieval purposes (implementation-design / intent-decision /
//     coding-repair) use the loose threshold so relevant-but-paraphrased memory
//     is recalled;
//   - audit keeps the strict threshold (precision);
//   - thresholds and the top-K bound are overridable via ARGO_SEMANTIC_* env.

test('AT semantic threshold: memory purposes use the loose default threshold', () => {
  // GIVEN no env override
  // WHEN the memory threshold for the Element channel is resolved
  // THEN it is the loose default (0.55) so paraphrased memory is recalled
  assert.equal(memoryThresholdFor(ELEMENT), 0.55);
  assert.equal(memoryThresholdFor(RELATIONSHIP), 0.55);
});

test('AT semantic threshold: audit keeps the strict default threshold', () => {
  // GIVEN no env override
  // WHEN the audit threshold for the Element channel is resolved
  // THEN it is the strict default (0.8) preserving precision
  assert.equal(auditThresholdFor(ELEMENT), 0.8);
  assert.equal(auditThresholdFor(RELATIONSHIP), 0.8);
});

test('AT semantic threshold: ARGO_SEMANTIC_MEMORY_THRESHOLD env override applies', () => {
  // GIVEN an env override for the memory threshold
  process.env.ARGO_SEMANTIC_MEMORY_THRESHOLD = '0.6';
  try {
    // WHEN the memory threshold is resolved
    // THEN the override is used
    assert.equal(memoryThresholdFor(ELEMENT), 0.6);
  } finally {
    delete process.env.ARGO_SEMANTIC_MEMORY_THRESHOLD;
  }
});

test('AT semantic threshold: per-channel env override wins over the base', () => {
  // GIVEN a per-channel override that differs from the base
  process.env.ARGO_SEMANTIC_MEMORY_THRESHOLD = '0.6';
  process.env.ARGO_SEMANTIC_MEMORY_THRESHOLD_ELEMENT = '0.5';
  try {
    // WHEN the Element channel threshold is resolved
    // THEN the per-channel override wins
    assert.equal(memoryThresholdFor(ELEMENT), 0.5);
    // AND the base applies to other channels
    assert.equal(memoryThresholdFor(RELATIONSHIP), 0.6);
  } finally {
    delete process.env.ARGO_SEMANTIC_MEMORY_THRESHOLD;
    delete process.env.ARGO_SEMANTIC_MEMORY_THRESHOLD_ELEMENT;
  }
});

test('AT semantic threshold: audit purpose is the only strict purpose', () => {
  // GIVEN the purpose set
  // THEN only audit is strict (memory/design purposes are loose)
  assert.ok(AUDIT_PURPOSES.has('audit'));
  assert.equal(AUDIT_PURPOSES.has('implementation-design'), false);
  assert.equal(AUDIT_PURPOSES.has('intent-decision'), false);
  assert.equal(AUDIT_PURPOSES.has('coding-repair'), false);
});

test('AT semantic threshold: top-K bound defaults to 8 and is env-overridable', () => {
  // GIVEN no env override
  // THEN the top-K bound is 8 (bounded noise)
  assert.equal(resolveTopK(), 8);
  // GIVEN an env override
  process.env.ARGO_SEMANTIC_TOP_K = '5';
  try {
    assert.equal(resolveTopK(), 5);
  } finally {
    delete process.env.ARGO_SEMANTIC_TOP_K;
  }
});
