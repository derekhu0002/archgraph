'use strict';

// Generic, opt-in validation extension point.
//
// The framework core knows nothing about any specific reasoning backend
// (SHACL / OWL / a project language). It discovers external validators from the
// environment and runs them at the SAME timings the core already validates:
//   * mode 'write'  — every write (preview/apply) mutation result
//   * mode 'init'   — full validation at workspace init / validateSystemArchitecture
//
// An extension is a command (argv array, shell:false) that prints a JSON object
// to stdout:
//     { "errors": ["..."], "warnings": ["..."] }
// Errors are merged into the framework's validation errors (blocking); warnings
// are surfaced but never block. It is FAIL-CLOSE by design: an extension that is
// configured but unavailable/broken is a BLOCKING error, not a silent pass. An
// advisory validator can opt out per entry with "onError":"warn".
//
// Configure with ARGO_VALIDATION_EXTENSIONS (JSON array). Example:
//   [{"name":"ontology","timings":["write","init"],"onError":"error",
//     "command":["node","/path/to/ontology-projection/cli.js",
//                "--workspace","{workspaceRoot}","--graph","{graphPath}","--mode","{mode}"]}]
// No extensions configured => a no-op (default behaviour is unchanged).

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENV_KEY = 'ARGO_VALIDATION_EXTENSIONS';

function resolveValidationExtensions(env = process.env) {
  const raw = env && env[ENV_KEY];
  if (!raw || !String(raw).trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry) => entry && Array.isArray(entry.command) && entry.command.length > 0)
    .map((entry) => ({
      name: String(entry.name || 'extension'),
      command: entry.command.map(String),
      timings: Array.isArray(entry.timings) && entry.timings.length ? entry.timings.map(String) : ['init'],
      // Fail-close by default; "warn" makes this entry's infrastructure failures advisory.
      onError: entry.onError === 'warn' ? 'warn' : 'error',
    }));
}

function substitute(value, ctx) {
  return String(value)
    .replace(/\{workspaceRoot\}/g, ctx.workspaceRoot)
    .replace(/\{graphPath\}/g, ctx.graphPath)
    .replace(/\{mode\}/g, ctx.mode);
}

function lastJsonLine(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).filter((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* keep scanning */
    }
  }
  return {};
}

function runExtension(ext, ctx) {
  const argv = ext.command.map((value) => substitute(value, ctx));
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: ctx.timeoutMs,
    env: { ...process.env, ...ctx.childEnv },
  });
  const out = { errors: [], warnings: [] };
  // Fail-close by default: a configured-but-unavailable/broken validator is a
  // BLOCKING error (no silent pass). Set onError:"warn" for advisory validators.
  const strict = ext.onError !== 'warn';
  const infra = (message) => { (strict ? out.errors : out.warnings).push(message); };
  if (result.error) {
    infra(`validation extension '${ext.name}' unavailable: ${result.error.message}`);
    return out;
  }
  const findings = lastJsonLine(result.stdout);
  const hasErrors = Array.isArray(findings.errors) && findings.errors.length > 0;
  if (result.status !== 0 && !hasErrors) {
    infra(
      `validation extension '${ext.name}' exited ${result.status}: ${String(result.stderr || '').slice(0, 500)}`,
    );
  }
  for (const message of findings.errors || []) out.errors.push(`[${ext.name}] ${message}`);
  for (const message of findings.warnings || []) out.warnings.push(`[${ext.name}] ${message}`);
  return out;
}

function runValidationExtensions({ workspaceRoot, graphPath, mode, document, touchedElementIds, touchedRelationshipIds, timeoutMs = 120000, env = process.env } = {}) {
  const extensions = resolveValidationExtensions(env).filter((ext) => ext.timings.includes(mode));
  if (extensions.length === 0) return { errors: [], warnings: [] };
  // Pass the POST-MUTATION document (not the on-disk file, which the write has
  // not persisted yet) so a write-time validator sees the change being applied.
  let documentFile = '';
  if (document && typeof document === 'object') {
    documentFile = path.join(os.tmpdir(), `argo-validation-doc-${process.pid}-${Date.now()}.json`);
    try { fs.writeFileSync(documentFile, JSON.stringify(document)); } catch { documentFile = ''; }
  }
  // Pass the touched ids so a scope-aware validator can restrict itself to the
  // write delta (bounded cost) instead of re-reasoning over the whole graph.
  const childEnv = {
    ARGO_VALIDATION_TOUCHED_ELEMENTS: JSON.stringify(touchedElementIds || []),
    ARGO_VALIDATION_TOUCHED_RELATIONSHIPS: JSON.stringify(touchedRelationshipIds || []),
    ARGO_VALIDATION_GRAPH_FILE: documentFile,
  };
  const ctx = { workspaceRoot, graphPath, mode, timeoutMs, childEnv };
  const errors = [];
  const warnings = [];
  for (const ext of extensions) {
    const result = runExtension(ext, ctx);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  return { errors, warnings };
}

module.exports = { ENV_KEY, resolveValidationExtensions, runValidationExtensions, runExtension };
