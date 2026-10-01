'use strict';

// External-view acceptance tests for the secret `.env` preflight.
//
// Requirement: the ARGO env file is NOT ACL-hardened (OS ACL / file-mode checks
// are intentionally dropped 鈥?they caused frequent false failures). The ONLY
// guarantee kept is that the file is never committed: it must be git-ignored and
// not tracked.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  withApprovedLiveConfigurationTestComposition,
} = require('../argo/scripts/graph-rag/liveEmbeddingProviderConfig.js');

async function withTempEnvFile(run) {
  const tmpEnv = path.join(os.tmpdir(), `argo-env-guard-${process.pid}-${Math.random().toString(36).slice(2)}.env`);
  fs.writeFileSync(tmpEnv, 'ARGO_EMBEDDING_BASE_URL=https://example.invalid\n');
  const previous = process.env.ARGO_ENV_FILE;
  process.env.ARGO_ENV_FILE = tmpEnv;
  try {
    return await run(path.resolve(tmpEnv));
  } finally {
    if (previous === undefined) delete process.env.ARGO_ENV_FILE; else process.env.ARGO_ENV_FILE = previous;
    try { fs.unlinkSync(tmpEnv); } catch { /* ignore */ }
  }
}

function resolveWith(envPath, systemMetadata) {
  return withApprovedLiveConfigurationTestComposition(
    {
      sourceBehavior: { expectedFilePath: envPath, readProcessKey: () => undefined, readFileEntries: () => [] },
      adapters: { filesystem: fs, systemMetadata },
    },
    (resolve) => resolve({ repositoryRoot: process.cwd() }),
  );
}

test('AT semantic env guard: a git-TRACKED .env is rejected (never-committed kept)', async () => {
  await withTempEnvFile(async (envPath) => {
    await assert.rejects(
      resolveWith(envPath, {
        isSecretFileInsideGitRepository: () => ({ status: 0 }),
        isSecretFileIgnored: () => true,
        isSecretFileTracked: () => true,
      }),
      (error) => error.category === 'SECRET_FILE_TRACKED',
    );
  });
});

test('AT semantic env guard: a NOT-ignored .env is rejected (never-committed kept)', async () => {
  await withTempEnvFile(async (envPath) => {
    await assert.rejects(
      resolveWith(envPath, {
        isSecretFileInsideGitRepository: () => ({ status: 0 }),
        isSecretFileIgnored: () => false,
        isSecretFileTracked: () => false,
      }),
      (error) => error.category === 'SECRET_FILE_NOT_IGNORED',
    );
  });
});

test('AT semantic env guard: OS ACL / file-mode is NOT enforced', async () => {
  await withTempEnvFile(async (envPath) => {
    // GIVEN an env file whose git state is safe (ignored, not tracked)
    let category = null;
    try {
      await resolveWith(envPath, {
        isSecretFileInsideGitRepository: () => ({ status: 0 }),
        isSecretFileIgnored: () => true,
        isSecretFileTracked: () => false,
      });
    } catch (error) {
      category = error && error.category;
    }
    // THEN it is never rejected for ACL/permission reasons (it may fail later on
    // missing configuration keys, which is fine)
    assert.notEqual(category, 'SECRET_FILE_ACL_UNSAFE');
    assert.notEqual(category, 'SECRET_FILE_ACL_UNVERIFIABLE');
  });
});
