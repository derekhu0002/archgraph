'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  posixModeIsSecretSafe,
} = require('../argo/scripts/graph-rag/liveEmbeddingProviderConfig.js');

// External-view acceptance tests for the POSIX secret-file ACL preflight that the
// semantic lifecycle uses when resolving the approved embedding configuration on
// Linux. The env file must be owner-only (no group/other access) and owner rw, so
// argo-init's semantic lifecycle works on Linux instead of failing on icacls
// (a Windows-only command).

test('AT semantic lifecycle posix env ACL: 0600 owner-only is safe', () => {
  // GIVEN an env file mode of 0600 (owner rw, no group/other access)
  // WHEN the POSIX ACL predicate evaluates the mode
  // THEN it is considered safe
  assert.equal(posixModeIsSecretSafe(0o600), true);
});

test('AT semantic lifecycle posix env ACL: group/other read bits are rejected', () => {
  // GIVEN modes with group/other read (0644/0664)
  // THEN they are rejected — the secret env must not be group/world readable
  assert.equal(posixModeIsSecretSafe(0o644), false);
  assert.equal(posixModeIsSecretSafe(0o664), false);
});

test('AT semantic lifecycle posix env ACL: owner must retain read+write', () => {
  // GIVEN a mode where the owner lacks write (0400)
  // THEN it is rejected — the framework still needs to read the env file
  assert.equal(posixModeIsSecretSafe(0o400), false);
});

test('AT semantic lifecycle posix env ACL: owner-only variants 0700/0600 are safe', () => {
  // GIVEN owner-only modes (0700 / 0600)
  // THEN they are considered safe
  assert.equal(posixModeIsSecretSafe(0o700), true);
  assert.equal(posixModeIsSecretSafe(0o600), true);
});
