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
 *   3. The MCP `roots` advertised by the client (a global server resolves the
 *      root that contains design/KG/SystemArchitecture.json when several roots
 *      are present, so it never operates on an unrelated folder).
 *   4. The embedded repo root, when the Argo installation is still inside a repo
 *      (i.e. `<argoRoot>/../design/KG/SystemArchitecture.json` exists).
 *   5. process.cwd()       — last-resort fallback when no root is available.
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

  // The client may expose several roots (a multi-root workspace). Never
  // silently operate on an unrelated folder: prefer the root that actually
  // contains the ArchGraph marker before falling back to the first root.
  const marker = path.join('design', 'KG', 'SystemArchitecture.json');
  for (const root of mcpWorkspaceRoots) {
    const rootPath = rootToPath(root);
    if (rootPath && fs.existsSync(path.join(rootPath, marker))) {
      return path.resolve(rootPath);
    }
  }

  for (const root of mcpWorkspaceRoots) {
    const rootPath = rootToPath(root);
    if (rootPath) {
      return path.resolve(rootPath);
    }
  }

  const embedded = path.resolve(getArgoRoot(), '..');
  if (fs.existsSync(path.join(embedded, marker))) {
    return embedded;
  }

  return path.resolve(process.cwd());
}

function hasStaticWorkspace() {
  const explicit = process.env.ARGO_REPO_ROOT || process.env.WORKSPACE_FOLDER;
  if (explicit && String(explicit).trim() !== '') {
    return true;
  }
  const embedded = path.resolve(getArgoRoot(), '..');
  return fs.existsSync(path.join(embedded, 'design', 'KG', 'SystemArchitecture.json'));
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

/**
 * Resolve the workspace root for one tool call.
 *
 * Defaults to the launch-directory root (`getWorkspaceRoot()`). A per-call
 * `workspaceRoot` argument (absolute path) is honored unconditionally when
 * present, so the caller decides which workspace this call operates on. This
 * powers the DeepSeek Harness bridge, which injects the current session's
 * workspace directory into every call so one dsh instance can follow the
 * workspace the user switched to.
 *
 * @param {object} [args] - tool call arguments (may carry `workspaceRoot`).
 * @returns {string} resolved absolute workspace root.
 */
function resolveCallWorkspaceRoot(args = {}) {
  const requested =
    typeof args === 'object' && args !== null && typeof args.workspaceRoot === 'string'
      ? String(args.workspaceRoot).trim()
      : '';
  if (requested === '') {
    return getWorkspaceRoot();
  }
  return path.resolve(requested);
}

module.exports = {
  getArgoRoot,
  getArgoEnvPath,
  getWorkspaceRoot,
  hasStaticWorkspace,
  normalizeRelativePath,
  resolveArgoPath,
  resolveCallWorkspaceRoot,
  resolveWorkspacePath,
  setMcpWorkspaceRoots,
};
