'use strict';

// Single source of truth for locating the ARGO toolchain and its CLI entries.
//
// Why this module exists: `argo-init` used to be resolved by three copy-pasted
// path probes (`bin/argo-init.js`, `sandbox/lib/argo-init-cli.js`, generated
// config). Under a non-interactive control plane (Paperclip over SSH on WSL) the
// global npm bin directory is NOT on PATH, so every probe missed and the caller
// died with a bare ENOENT that named no candidate and no remedy.
//
// Design rules:
//   - Resolution NEVER depends on PATH being correct; PATH is only the last
//     fallback. An install root is discovered from an explicit override, the
//     deployed `~/.argo` root, the npm global prefix derived from
//     `process.execPath` (no `npm` invocation), or this package's own root.
//   - The package manifest's `bin` map is authoritative: a CLI is located through
//     it first, so a future layout / file extension does not need new code.
//   - Nothing here knows about a modeling language, ontology, or consuming
//     project; it only knows "an install root holds a manifest and a scripts dir".
//   - A failure is actionable: it lists every absolute path tried and the ways to
//     fix it, because the caller is often an agent with no interactive shell.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEPLOYED_ROOT_DIR = '.argo';
const SERVER_MARKERS = [
  path.join('scripts', 'argo-mcp-server.js'),
  path.join('argo', 'scripts', 'argo-mcp-server.js'),
];
const JS_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function packageManifest() {
  return readJson(path.join(__dirname, '..', '..', 'package.json')) || {};
}

function splitRoots(value) {
  if (!value) return [];
  return String(value)
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniquePaths(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (!entry) continue;
    const resolved = path.resolve(entry);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

// Install-root candidates, highest precedence first.
function installedRootCandidates() {
  const candidates = [];
  // 1) Explicit override (a control plane knows where it installed the bundle).
  candidates.push(...splitRoots(process.env.ARGO_INSTALL_ROOT));
  // 2) The deployed toolchain the MCP server runs from.
  candidates.push(path.join(homeDir(), DEPLOYED_ROOT_DIR));
  // 3) The npm global prefix, derived from the running node binary.
  const manifest = packageManifest();
  const execDir = path.dirname(process.execPath);
  if (manifest.name) {
    candidates.push(path.join(execDir, '..', 'lib', 'node_modules', manifest.name));
    candidates.push(path.join(execDir, '..', 'node_modules', manifest.name));
    candidates.push(path.join(execDir, 'node_modules', manifest.name));
  }
  // 4) This package's own root (a checkout: <root>/argo/scripts/...).
  candidates.push(path.resolve(__dirname, '..', '..'));
  return uniquePaths(candidates);
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// Turn a located file into a spawn invocation, or null when it cannot be run
// directly (e.g. an extensionless POSIX script on Windows needs a shell).
function toInvocation(file) {
  if (!isFile(file)) return null;
  const extension = path.extname(file).toLowerCase();
  if (JS_EXTENSIONS.has(extension)) return { cmd: process.execPath, args: [file] };
  if (process.platform === 'win32') return null;
  return { cmd: file, args: [] };
}

function binMapEntry(root, name) {
  const manifest = readJson(path.join(root, 'package.json'));
  if (!manifest || !manifest.bin) return null;
  if (typeof manifest.bin === 'string') return manifest.bin;
  if (typeof manifest.bin === 'object' && typeof manifest.bin[name] === 'string') {
    return manifest.bin[name];
  }
  return null;
}

// Files inside one install root that could provide `name`, most authoritative first.
function cliCandidatesInRoot(root, name) {
  const candidates = [];
  const mapped = binMapEntry(root, name);
  if (mapped) candidates.push(path.join(root, mapped));
  // Deployed shim layout written by argo-deploy.
  candidates.push(path.join(root, 'bin', `${name}.js`));
  // A POSIX / Windows wrapper (extensionless) as written by argo-deploy.
  candidates.push(path.join(root, 'bin', name));
  // A locally installed package bin.
  candidates.push(path.join(root, 'node_modules', '.bin', name));
  return candidates;
}

function cliCandidatesOnPath(name) {
  const entries = [];
  for (const dir of splitRoots(process.env.PATH)) {
    entries.push(path.join(dir, `${name}.js`));
    entries.push(path.join(dir, name));
  }
  return entries;
}

class ArgoCliResolutionError extends Error {
  constructor(name, tried) {
    const manifest = packageManifest();
    const pkg = manifest.name || 'the ARGO package';
    super([
      `ARGO CLI "${name}" could not be located (no PATH dependency was assumed).`,
      `Tried (absolute paths):`,
      ...tried.map((entry) => `  - ${entry}`),
      `Fix one of:`,
      `  - install the framework: npm i -g ${pkg}@latest`,
      `  - run the deployer so ~/.argo/bin is populated: argo-deploy -SkipEnv`,
      `  - point at the install root: ARGO_INSTALL_ROOT=<path to the installed package>`,
      `  - point at the CLI file: ARGO_CLI_PATH=<path to the ${name} entry file>`,
    ].join('\n'));
    this.name = 'ArgoCliResolutionError';
    this.cliName = name;
    this.tried = tried;
  }
}

// Resolve a CLI entry (e.g. "argo-init") to a spawnable invocation.
// Returns { name, cmd, args, file, source } where source names the winning probe.
function resolveArgoCli(name, options = {}) {
  const tried = [];
  const roots = options.roots ? uniquePaths(options.roots) : installedRootCandidates();

  // 1) An explicit CLI path: either the entry file or an install root.
  const explicit = process.env.ARGO_CLI_PATH;
  if (explicit) {
    const resolved = path.resolve(explicit);
    tried.push(resolved);
    const invocation = toInvocation(resolved);
    if (invocation) return { name, ...invocation, file: resolved, source: 'ARGO_CLI_PATH' };
    if (fs.existsSync(resolved)) {
      for (const candidate of cliCandidatesInRoot(resolved, name)) {
        tried.push(candidate);
        const found = toInvocation(candidate);
        if (found) return { name, ...found, file: candidate, source: 'ARGO_CLI_PATH' };
      }
    }
  }

  // 2) Install roots: manifest `bin` map first, then the deployed shim layout.
  for (const root of roots) {
    for (const candidate of cliCandidatesInRoot(root, name)) {
      tried.push(candidate);
      const found = toInvocation(candidate);
      if (found) return { name, ...found, file: candidate, source: 'install-root' };
    }
  }

  // 3) Last resort only: PATH, exactly like a shell would.
  for (const candidate of cliCandidatesOnPath(name)) {
    tried.push(candidate);
    const found = toInvocation(candidate);
    if (found) return { name, ...found, file: candidate, source: 'PATH' };
  }

  throw new ArgoCliResolutionError(name, tried);
}

// Resolve the install root that actually carries the MCP server (the code the
// deployed toolchain runs), independent of PATH.
function resolveArgoRoot(options = {}) {
  const roots = options.roots ? uniquePaths(options.roots) : installedRootCandidates();
  for (const root of roots) {
    for (const marker of SERVER_MARKERS) {
      if (isFile(path.join(root, marker))) return root;
    }
  }
  return null;
}

function resolveArgoServer(options = {}) {
  const root = resolveArgoRoot(options);
  if (!root) return null;
  for (const marker of SERVER_MARKERS) {
    const file = path.join(root, marker);
    if (isFile(file)) return file;
  }
  return null;
}

module.exports = {
  ArgoCliResolutionError,
  DEPLOYED_ROOT_DIR,
  installedRootCandidates,
  resolveArgoCli,
  resolveArgoRoot,
  resolveArgoServer,
  splitRoots,
};
