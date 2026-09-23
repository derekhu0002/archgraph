'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const gain = require('../scripts/read-projection-gain.js');

// AT for the read-projection gain measurement: the reduction math is sound and
// trimming a structural read can NEVER make it larger (min reduction >= 0).

test('AT-read-projection-gain-01: reduction math is correct and never negative', () => {
  const rows = [
    { defBytes: 50, fullBytes: 200, defTokens: 10, fullTokens: 40 },   // 75%
    { defBytes: 100, fullBytes: 100, defTokens: 20, fullTokens: 20 },  // 0% (projection suppressed)
    { defBytes: 40, fullBytes: 80, defTokens: 8, fullTokens: 16 },     // 50%
  ];
  const s = gain.summarizeReduction(rows);
  assert.equal(s.calls, 3);
  assert.equal(s.totalDefBytes, 190);
  assert.equal(s.totalFullBytes, 380);
  assert.equal(s.overallReductionPct, 50);
  assert.equal(s.minPct, 0, 'no row may be negative (no cross-scenario degradation)');
  assert.equal(s.totalFullTokens - s.totalDefTokens, 38);
});

test('AT-read-projection-gain-02: token estimate is deterministic', () => {
  assert.equal(gain.estimateTokens(''), 0);
  assert.ok(gain.estimateTokens('中文中文') >= 4);
  assert.ok(gain.estimateTokens('abcdefgh') >= 2);
});
