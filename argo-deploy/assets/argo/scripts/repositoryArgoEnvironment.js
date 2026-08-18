const fs = require('node:fs');
const path = require('node:path');

const {
  getArgoEnvPath,
} = require('./argo-paths.js');

function loadRepositoryArgoEnvironment(workspaceRoot) {
  const argoEnvPath = getArgoEnvPath();
  const workspaceEnvPath = path.join(workspaceRoot, '.argo', '.env');
  const result = {
    status: 'missing',
    path: normalizeRelativePath(path.relative(workspaceRoot, argoEnvPath)),
    loadedBeforeProjection: true,
    assignedCount: 0,
    preservedProcessCount: 0,
    sourcePaths: [],
  };

  const candidatePaths = [argoEnvPath];
  if (workspaceEnvPath !== argoEnvPath) {
    candidatePaths.push(workspaceEnvPath);
  }

  const merged = new Map();
  const loadedPaths = [];
  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    for (const [key, value] of parseRepositoryEnvFile(fs.readFileSync(envPath, 'utf8'))) {
      merged.set(key, value);
    }
    loadedPaths.push(envPath);
  }

  if (loadedPaths.length === 0) {
    return result;
  }

  result.status = 'loaded';
  result.sourcePaths = loadedPaths.map(
    envPath => normalizeRelativePath(path.relative(workspaceRoot, envPath)),
  );

  for (const [key, value] of merged) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      result.assignedCount += 1;
    } else {
      result.preservedProcessCount += 1;
    }
  }

  return result;
}

function parseRepositoryEnvFile(content) {
  const entries = [];
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    const value = parseRepositoryEnvValue(line.slice(separatorIndex + 1).trim());
    entries.push([key, value]);
  }
  return entries;
}

function parseRepositoryEnvValue(value) {
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
      const inner = value.slice(1, -1);
      return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : inner;
    }
  }
  const commentIndex = value.search(/\s#/);
  return commentIndex >= 0 ? value.slice(0, commentIndex).trimEnd() : value;
}

function normalizeRelativePath(value) {
  return String(value).replace(/\\/g, '/');
}

module.exports = {
  loadRepositoryArgoEnvironment,
  parseRepositoryEnvFile,
};
