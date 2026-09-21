'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  memoryThresholdFor,
  auditThresholdFor,
  resolveTopK,
  isSeedAboveThreshold,
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

test('AT semantic threshold: calibrated 0.70 memory threshold rejects unrelated noise and preserves relevant recall', () => {
  // GIVEN the calibrated memory seed threshold actually configured at runtime
  //   (ARGO_SEMANTIC_MEMORY_THRESHOLD=0.70 in ~/.argo/.env, 2026-09-21), and the
  //   measured TRUE-cosine calibration of the live embedding model
  //   (qwen3.7-text-embedding) over this canonical graph:
  //     - 8 unrelated probes x 3 channels: every top-1 score stays BELOW 0.70
  //       (measured ceiling 0.6852) -> the 0.55 legacy default filters NOTHING;
  //     - 8 relevant element probes: every target scores ABOVE 0.70
  //       (measured floor 0.8325) -> recall must not drop.
  const CALIBRATED_THRESHOLD = 0.70;
  const UNRELATED_TOP1 = [
    0.6672, 0.6543, 0.6381, 0.6545, 0.6706, 0.6573, 0.6592, 0.6281, // Element
    0.6676, 0.6425, 0.6345, 0.6505, 0.6472, 0.6852, 0.6421, 0.6346, // ArchitectureRelationship
    0.6590, 0.6419, 0.6401, 0.6475, 0.6568, 0.6440, 0.6348, 0.6392, // View
  ];
  const RELEVANT_TARGETS = [0.8325, 0.9082, 0.9077, 0.8876, 0.9115, 0.9072, 0.8846, 0.8646];

  // WHEN the production seed gate is applied to the unrelated probes
  const unrelatedHits = UNRELATED_TOP1.filter(score => isSeedAboveThreshold(score, CALIBRATED_THRESHOLD));
  // THEN no unrelated probe yields any hit
  assert.equal(unrelatedHits.length, 0, 'unrelated probes must yield zero hits at 0.70');

  // AND WHEN the same gate is applied to the relevant targets
  const relevantHits = RELEVANT_TARGETS.filter(score => isSeedAboveThreshold(score, CALIBRATED_THRESHOLD));
  // THEN recall is not reduced (every relevant target is retained)
  assert.equal(relevantHits.length, RELEVANT_TARGETS.length, 'relevant recall must not drop at 0.70');

  // AND the threshold sits above the noise ceiling and at/below the relevant floor
  assert.ok(CALIBRATED_THRESHOLD > Math.max(...UNRELATED_TOP1), 'threshold must clear the unrelated noise ceiling');
  assert.ok(CALIBRATED_THRESHOLD <= Math.min(...RELEVANT_TARGETS), 'threshold must stay at/below the relevant floor');

  // AND the legacy 0.55 default is below the noise floor, so it filters nothing
  // (this is the regression narrative the calibration fixes)
  assert.ok(UNRELATED_TOP1.every(score => isSeedAboveThreshold(score, 0.55)), '0.55 must be shown inefficacious');
});
