'use strict';

// Env-key coverage guard (AT-env-coverage-01/02).
//
// Strictness is intentionally kept: an unknown key in .env (or a secret-looking
// one) still fails closed. What this test guarantees is the OTHER direction —
// every env key that argo/scripts actually references is classified, so a key the
// code already uses can never be rejected as "unknown". A new referenced key that
// is neither a .env key, a host-only key, nor a legacy alias fails CI.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ENV_FILE_KEYS,
  HOST_ONLY_ENV_KEYS,
  ENV_FILE_LEGACY_KEYS,
} = require('../argo/scripts/graph-rag/liveEmbeddingProviderConfig.js');

const SCRIPTS_ROOT = path.resolve(__dirname, '..', 'argo', 'scripts');

function listScripts(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listScripts(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const EXACT_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g,
  /\benv\.([A-Z][A-Z0-9_]+)/g,
  /['"`]([A-Z][A-Z0-9_]{2,})['"`]/g,
];
const TEMPLATE_BASE_PATTERN = /['"`]([A-Z][A-Z0-9_]+)\$\{/g;

function extractEnvReferences() {
  const keys = new Set();
  const templateBases = new Set();
  for (const file of listScripts(SCRIPTS_ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of EXACT_PATTERNS) {
      let match;
      while ((match = pattern.exec(text))) keys.add(match[1]);
    }
    let base;
    while ((base = TEMPLATE_BASE_PATTERN.exec(text))) templateBases.add(base[1]);
  }
  const isContractKey = key => /^ARGO_[A-Z0-9_]+$/.test(key) || key === 'QWEN_KEY';
  return {
    keys: [...keys].filter(isContractKey).sort(),
    templateBases: [...templateBases].filter(isContractKey).sort(),
  };
}

const references = extractEnvReferences();
const ENV = new Set(ENV_FILE_KEYS);
const HOST = new Set(HOST_ONLY_ENV_KEYS);
const LEGACY = new Set(ENV_FILE_LEGACY_KEYS);

// AT-env-coverage-01: every env key referenced in argo/scripts is classified.
test('AT-env-coverage-01: every referenced env key is classified', () => {
  // GIVEN the env keys referenced across argo/scripts
  // WHEN each is checked against ENV_FILE_KEYS ∪ HOST_ONLY_ENV_KEYS ∪ ENV_FILE_LEGACY_KEYS
  // THEN there is no unclassified key (a key the code uses must never be "unknown")
  const classified = new Set([...ENV, ...HOST, ...LEGACY]);
  const unclassified = references.keys.filter(key => !classified.has(key));
  assert.deepEqual(
    unclassified,
    [],
    `unclassified env keys (add them to ENV_FILE_KEYS / HOST_ONLY_ENV_KEYS / ENV_FILE_LEGACY_KEYS): ${unclassified.join(', ')}`,
  );
});

// AT-env-coverage-02: template key families are covered and the two sets do not overlap.
test('AT-env-coverage-02: template families covered; env and host-only sets disjoint', () => {
  // GIVEN template-built keys like `ARGO_SEMANTIC_MEMORY_THRESHOLD_${channel}`
  // WHEN checked against the whitelist
  // THEN each family has at least one concrete .env key, and no key is both a
  //      .env key and a host-only key
  for (const base of references.templateBases) {
    const covered = ENV_FILE_KEYS.filter(key => key.startsWith(base));
    assert.ok(covered.length > 0, `template family ${base} has no concrete .env key`);
  }
  const overlap = ENV_FILE_KEYS.filter(key => HOST.has(key));
  assert.deepEqual(overlap, [], `keys both .env and host-only: ${overlap.join(', ')}`);
});
