const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

/**
 * Shared path resolution for the Argo toolchain.
 *
 * The Argo installation can live in one of two layouts:
 *   1. Embedded  — `<repository>/.argo` (the historical layout).
 *   2. Global    — `<user-home>/.argo` (a machine-wide MCP installation).
 *
 * Every path in the toolchain is therefore either:
 *   - an *installation asset* (scripts, schema, test-executors, .env): resolved
 *     relative to the Argo root (the `.argo` directory that contains this file), or
 *   - a *workspace asset* (design/KG, tests, .argo/temp, handoff files): resolved
 *     relative to the active workspace root.
 *
 * The workspace root is resolved from, in priority order:
 *   1. ARGO_REPO_ROOT      — explicit override (set by MCP client configs).
 *   2. WORKSPACE_FOLDER    — set by some hosts.
 *   3. The embedded repo root, when the Argo installation is still inside a repo
 *      (i.e. `<argoRoot>/../design/KG/SystemArchitecture.json` exists).
 *   4. process.cwd()       — the MCP client must launch the server with its cwd
 *      set to the target workspace root.
 */

function getArgoRoot() {
  // This module lives at <argoRoot>/scripts/argo-paths.js.
  return path.resolve(__dirname, '..');
}

let mcpWorkspaceRoots = [];

function setMcpWorkspaceRoots(roots) {
  mcpWorkspaceRoots = Array.isArray(roots) ? roots : [];
}

function rootToPath(root) {
  if (!root) {
    return null;
  }
  const uri = typeof root === 'string' ? root : root.uri;
  if (typeof uri !== 'string' || uri.trim() === '') {
    return null;
  }
  if (uri.startsWith('file://')) {
    try {
      return fileURLToPath(uri);
    } catch {
      return null;
    }
  }
  return uri;
}

function getWorkspaceRoot() {
  const explicit = process.env.ARGO_REPO_ROOT || process.env.WORKSPACE_FOLDER;
  if (explicit && String(explicit).trim() !== '') {
    return path.resolve(explicit);
  }

  for (const root of mcpWorkspaceRoots) {
    const rootPath = rootToPath(root);
    if (rootPath) {
      return path.resolve(rootPath);
    }
  }

  const embedded = path.resolve(getArgoRoot(), '..');
  if (fs.existsSync(path.join(embedded, 'design', 'KG', 'SystemArchitecture.json'))) {
    return embedded;
  }

  return path.resolve(process.cwd());
}

function resolveArgoPath(...segments) {
  return path.resolve(getArgoRoot(), ...segments);
}

function resolveWorkspacePath(...segments) {
  return path.resolve(getWorkspaceRoot(), ...segments);
}

function getArgoEnvPath() {
  if (process.env.ARGO_ENV_FILE && String(process.env.ARGO_ENV_FILE).trim() !== '') {
    return path.resolve(process.env.ARGO_ENV_FILE);
  }

  const globalPath = path.join(getArgoRoot(), '.env');
  if (fs.existsSync(globalPath)) {
    return globalPath;
  }

  return path.join(getWorkspaceRoot(), '.argo', '.env');
}

function normalizeRelativePath(value) {
  return String(value == null ? '' : value).replace(/\\/g, '/').replace(/^\/+/, '');
}

module.exports = {
  getArgoRoot,
  getArgoEnvPath,
  getWorkspaceRoot,
  normalizeRelativePath,
  resolveArgoPath,
  resolveWorkspacePath,
  setMcpWorkspaceRoots,
};
