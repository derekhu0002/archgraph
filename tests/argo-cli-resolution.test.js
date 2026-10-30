'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RESOLVER = path.join(ROOT, 'argo', 'scripts', 'resolveArgoCli.js');
const RUNNER = path.join(ROOT, 'sandbox', 'lib', 'argo-init-cli.js');

// Acceptance tests for PATH-free argo-init entry resolution (GitHub issue #17):
// a non-interactive control plane (Paperclip over SSH on WSL, CI) spawns agents
// with a PATH that lacks the global npm bin directory, and the old probes died
// with a bare ENOENT that named neither the candidates nor a remedy.

function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `argo-cli-${label}-`));
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function withEnv(vars, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function freshResolver() {
  delete require.cache[require.resolve(RESOLVER)];
  // eslint-disable-next-line global-require
  return require(RESOLVER);
}

test('AT-argo-init-resolution-01: a deployed ~/.argo/bin entry resolves without PATH', () => {
  // GIVEN a deployed install root whose bin/ holds argo-init.js (the layout the
  //       deployer writes) and a PATH that does NOT contain any node/npm bin dir
  const root = tmpdir('deployed');
  const emptyPathDir = tmpdir('emptypath');
  const cli = writeFile(path.join(root, 'bin', 'argo-init.js'), "'use strict';\n");
  const { resolveArgoCli } = freshResolver();
  try {
    // WHEN the CLI is resolved (as the sandbox runner / control plane does)
    const resolved = withEnv(
      { ARGO_INSTALL_ROOT: root, ARGO_CLI_PATH: undefined, PATH: emptyPathDir },
      () => resolveArgoCli('argo-init'),
    );
    // THEN it yields an absolute, spawnable entry without consulting PATH
    assert.equal(resolved.source, 'install-root');
    assert.equal(resolved.cmd, process.execPath);
    assert.deepEqual(resolved.args, [cli]);
    assert.ok(path.isAbsolute(resolved.file));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(emptyPathDir, { recursive: true, force: true });
  }
});

test('AT-argo-init-resolution-02: the package bin map wins over hardcoded file layout', () => {
  // GIVEN an install root whose manifest points the CLI at a NON-conventional
  //       layout (dist/, not bin/argo-init.js)
  const root = tmpdir('binmap');
  const cli = writeFile(path.join(root, 'dist', 'cli.js'), "'use strict';\n");
  writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'some-argo-package', bin: { 'argo-init': 'dist/cli.js' } }),
  );
  const { resolveArgoCli } = freshResolver();
  try {
    // WHEN it is resolved
    const resolved = withEnv(
      { ARGO_INSTALL_ROOT: root, ARGO_CLI_PATH: undefined },
      () => resolveArgoCli('argo-init'),
    );
    // THEN the manifest (authoritative) decides — no code change needed for a
    // future layout or file extension
    assert.equal(resolved.file, cli);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AT-argo-init-resolution-03: ARGO_CLI_PATH overrides every probe', () => {
  // GIVEN both an install root and an explicit CLI path
  const root = tmpdir('override-root');
  writeFile(path.join(root, 'bin', 'argo-init.js'), "'use strict';\n");
  const explicit = writeFile(path.join(tmpdir('override'), 'custom-cli.js'), "'use strict';\n");
  const { resolveArgoCli } = freshResolver();
  try {
    // WHEN resolved with ARGO_CLI_PATH set
    const resolved = withEnv(
      { ARGO_CLI_PATH: explicit, ARGO_INSTALL_ROOT: root },
      () => resolveArgoCli('argo-init'),
    );
    // THEN the explicit path wins
    assert.equal(resolved.source, 'ARGO_CLI_PATH');
    assert.equal(resolved.file, explicit);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.dirname(explicit), { recursive: true, force: true });
  }
});

test('AT-argo-init-resolution-04: no candidate fails with the tried paths and a remedy', () => {
  // GIVEN an empty install root and no CLI anywhere
  const root = tmpdir('missing');
  const emptyPathDir = tmpdir('missing-path');
  const { resolveArgoCli } = freshResolver();
  try {
    // WHEN resolution fails (only the empty root is offered, PATH is empty)
    let error = null;
    try {
      withEnv(
        { ARGO_CLI_PATH: undefined, PATH: emptyPathDir },
        () => resolveArgoCli('argo-init', { roots: [root] }),
      );
    } catch (caught) {
      error = caught;
    }
    // THEN the error names every absolute candidate and how to fix it
    assert.ok(error, 'resolution must fail loudly');
    assert.equal(error.name, 'ArgoCliResolutionError');
    assert.ok(error.tried.every((entry) => path.isAbsolute(entry)), 'candidates must be absolute');
    assert.ok(error.tried.some((entry) => entry.startsWith(root)), 'the given root must be listed');
    assert.match(error.message, /ARGO_CLI_PATH/);
    assert.match(error.message, /ARGO_INSTALL_ROOT/);
    assert.match(error.message, /argo-deploy/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(emptyPathDir, { recursive: true, force: true });
  }
});

test('AT-argo-init-resolution-05: the sandbox runner executes the resolved entry (no PATH)', () => {
  // GIVEN a deployed root whose argo-init prints a JSON report
  const root = tmpdir('runner-root');
  const report = { status: 'ok', marker: 'resolved-without-path' };
  writeFile(
    path.join(root, 'bin', 'argo-init.js'),
    `process.stdout.write(${JSON.stringify(JSON.stringify(report))});\n`,
  );
  const workspace = tmpdir('runner-ws');
  const emptyPathDir = tmpdir('runner-path');
  delete require.cache[require.resolve(RUNNER)];
  // eslint-disable-next-line global-require
  const { runArgoInitCli } = require(RUNNER);
  try {
    // WHEN the programmatic caller runs argo-init with an unusable PATH
    const parsed = withEnv(
      {
        ARGO_INSTALL_ROOT: root,
        ARGO_CLI_PATH: undefined,
        ARGO_REPO_ROOT: path.join(workspace, 'no-repo-here'),
        PATH: emptyPathDir,
      },
      () => runArgoInitCli(workspace),
    );
    // THEN it parses the report — proving the entry was found without PATH
    assert.deepEqual(parsed, report);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(emptyPathDir, { recursive: true, force: true });
  }
});

test('AT-argo-init-resolution-06: a checkout still resolves through <repo>/bin first', () => {
  // GIVEN a repository checkout (the Docker sandbox layout: repo root carries bin/)
  const repo = tmpdir('repo-checkout');
  const report = { status: 'ok', marker: 'repo-first' };
  writeFile(
    path.join(repo, 'bin', 'argo-init.js'),
    `process.stdout.write(${JSON.stringify(JSON.stringify(report))});\n`,
  );
  const workspace = tmpdir('repo-ws');
  delete require.cache[require.resolve(RUNNER)];
  // eslint-disable-next-line global-require
  const { runArgoInitCli } = require(RUNNER);
  try {
    // WHEN the runner executes with ARGO_REPO_ROOT pointing at the checkout
    const parsed = withEnv(
      { ARGO_REPO_ROOT: repo, ARGO_INSTALL_ROOT: undefined, ARGO_CLI_PATH: undefined },
      () => runArgoInitCli(workspace),
    );
    // THEN existing sandbox behaviour is byte-identical (repo probe wins)
    assert.deepEqual(parsed, report);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
