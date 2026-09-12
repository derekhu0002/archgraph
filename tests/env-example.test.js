'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ENV_FILE_KEYS,
  ENV_FILE_SECRET_KEYS,
} = require('../argo/scripts/graph-rag/liveEmbeddingProviderConfig.js');

const EXAMPLE_PATH = path.resolve(__dirname, '..', 'argo', '.env.example');

// Keys the installer writes into the deployed ~/.argo/.env. The example MUST
// document at least these (the deployed-.env contract the human partner asked
// for), and every one of them must be an approved .env key.
const DEPLOYED_ENV_KEYS = [
  'ARGO_EMBEDDING_BASE_URL',
  'ARGO_EMBEDDING_MODEL',
  'ARGO_EMBEDDING_PROVIDER',
  'ARGO_EMBEDDING_MODEL_VERSION',
  'ARGO_EMBEDDING_DIMENSIONS',
  'ARGO_NEO4J_DATABASE_URL',
  'ARGO_NEO4J_DATABASE_USERNAME',
  'ARGO_NEO4J_DATABASE_PASSWORD',
  'QWEN_KEY',
  'ARGO_LIVE_PROVIDER_E2E',
  'ARGO_W31_LIVE_MUTATION_VECTOR_E2E',
];

// Host/process-level keys that must be documented (as comments) but never set
// inside .env. Kept here as the completeness checklist for the example.
const HOST_ONLY_ENV_KEYS = [
  'ARGO_ENV_FILE',
  'ARGO_REPO_ROOT',
  'ARGO_EA_QEA',
  'ARGO_WORKSPACE_ROOTS',
  'ARGO_SERVER_PATH',
  'GRAPH_MCP_URL',
  'EA_QEA_DEBUG',
  'ARGO_TEST_TIMEOUT_MS',
  'ARGO_MCP_MUTATION_RESPONSE_DEBUG',
  'ARGO_MCP_SEMANTIC_DEDUP',
  'ARGO_MCP_SEMANTIC_DEDUP_THRESHOLD',
  'ARGO_SEMANTIC_DEDUP_THRESHOLD',
];

function parseExample(text) {
  const lines = String(text).split(/\r?\n/);
  const active = [];
  const commented = new Set();
  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('#')) {
      const match = trimmed.replace(/^#+\s*/, '').match(/^([A-Z][A-Z0-9_]*)\s*=/);
      if (match) commented.add(match[1]);
      return;
    }
    if (trimmed === '') return;
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match) active.push({ key: match[1], value: match[2], index });
  });
  return { lines, active, commented };
}

function documentedByComment(lines, index) {
  for (let i = index - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === '') continue;
    return trimmed.startsWith('#');
  }
  return false;
}

const example = parseExample(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
const activeKeys = new Set(example.active.map(entry => entry.key));

test('AT-env-example-01: example documents every supported .env key and nothing else', () => {
  // GIVEN the committed argo/.env.example
  // WHEN its active (uncommented) assignment keys are compared to the
  //      authoritative approved .env allowlist
  // THEN every supported key is present and no unknown key is present (an
  //      unknown key would make the secret-file preflight reject .env)
  for (const key of ENV_FILE_KEYS) {
    assert.ok(activeKeys.has(key), `${key} must be documented as an active key`);
  }
  for (const key of activeKeys) {
    assert.ok(ENV_FILE_KEYS.includes(key), `${key} is not an approved .env key (would fail preflight)`);
  }
});

test('AT-env-example-02: example covers every deployed .env key', () => {
  // GIVEN the keys install-argo.ps1 writes into the deployed ~/.argo/.env
  // WHEN checked against the example
  // THEN all of them appear (the deployed-.env contract)
  for (const key of DEPLOYED_ENV_KEYS) {
    assert.ok(activeKeys.has(key), `deployed key ${key} must be documented in .env.example`);
  }
});

test('AT-env-example-03: every active key is explained by a comment', () => {
  // GIVEN the committed example
  // WHEN each active key is inspected
  // THEN the nearest preceding non-blank line is a comment describing it
  for (const entry of example.active) {
    assert.ok(
      documentedByComment(example.lines, entry.index),
      `${entry.key} must have a comment line directly above it`,
    );
  }
});

test('AT-env-example-04: example carries no real values and lists secrets empty', () => {
  // GIVEN the committed example (must be safe to commit)
  // WHEN its active values are inspected
  // THEN every value is empty (no leaked secrets/defaults) and each secret key
  //      is present
  for (const entry of example.active) {
    assert.equal(entry.value, '', `${entry.key} must have an empty placeholder value`);
  }
  for (const key of ENV_FILE_SECRET_KEYS) {
    assert.ok(activeKeys.has(key), `secret ${key} must be present as an active key`);
  }
});

test('AT-env-example-05: host/process-level keys are documented as comments only', () => {
  // GIVEN the host/process-level keys that .env must NOT contain
  // WHEN checked against the example
  // THEN each appears as a commented entry and never as an active assignment
  for (const key of HOST_ONLY_ENV_KEYS) {
    assert.ok(example.commented.has(key), `host-level ${key} must be documented as a comment`);
    assert.ok(!activeKeys.has(key), `host-level ${key} must not be an active .env key`);
  }
});

test('AT-env-example-06: example has no duplicate active keys', () => {
  // GIVEN the committed example
  // WHEN scanned for repeated active assignments
  // THEN there are none (duplicates are rejected by the preflight)
  assert.equal(activeKeys.size, example.active.length, '.env.example must not repeat a key');
});
