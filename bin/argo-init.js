#!/usr/bin/env node
'use strict';

// `argo-init` — CLI for deterministic workspace initialization.
//
// Runs the SAME report as the former `initializeWorkspace` MCP tool
// (initializeWorkspaceReport): workspace bootstrap (starter graph + .qea),
// Neo4j structural sync, .qea full projection, semantic lifecycle init,
// canonical validation, ontology + ontologyValidation, subdiagram_views
// consistency. It is a CLI (not an MCP tool) because init is slow and
// human/skill-triggered, and long inits caused MCP client timeouts.
//
// Usage:  argo-init [--workspace <dir>] [--json]
//   default : concise, human-readable summary (a few lines). The FULL report is
//             always written to .argo/temp/argo-harness-init-report.json.
//   --json  : print the full report as JSON (machine-readable; also --verbose).
//
// Prefers the DEPLOYED framework at ~/.argo (the same code the MCP server runs);
// falls back to the package's own argo/scripts when not deployed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function workspaceFromArgs() {
  const index = process.argv.indexOf('--workspace');
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return process.cwd();
}

function wantsFullJson() {
  return process.argv.includes('--json') || process.argv.includes('--verbose');
}

// The shared resolver ships next to the deployed scripts (and inside this
// package). A deployed copy of this file lives at <root>/bin/argo-init.js, so the
// same relative path is tried in both layouts; older mixed installs keep working
// through the legacy probe below.
function loadResolver() {
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'resolveArgoCli.js'),
    path.join(__dirname, '..', 'argo', 'scripts', 'resolveArgoCli.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return require(candidate); // eslint-disable-line global-require
  }
  return null;
}

function resolveArgoMcp() {
  const resolver = loadResolver();
  if (resolver) {
    const server = resolver.resolveArgoServer();
    if (server) return server;
  }
  const deployed = path.join(os.homedir(), '.argo', 'scripts', 'argo-mcp-server.js');
  if (fs.existsSync(deployed)) return deployed;
  const local = path.join(__dirname, '..', 'argo', 'scripts', 'argo-mcp-server.js');
  if (fs.existsSync(local)) return local;
  throw new Error(
    'argo-init cannot locate the deployed ARGO toolchain (argo-mcp-server.js). '
    + 'Run `argo-deploy -SkipEnv` to deploy it, or set ARGO_INSTALL_ROOT to the installed package root.',
  );
}

async function main() {
  const workspaceRoot = path.resolve(workspaceFromArgs());
  const mcpPath = resolveArgoMcp();
  // eslint-disable-next-line global-require
  const mcp = require(mcpPath);
  // The summary renderer ships next to the resolved argo-mcp-server.js (deployed
  // ~/.argo/scripts, or the package's own argo/scripts).
  // eslint-disable-next-line global-require
  const { renderInitSummary } = require(path.join(path.dirname(mcpPath), 'argoInitSummary.js'));

  const report = await mcp.initializeWorkspaceReport(workspaceRoot);
  if (wantsFullJson()) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderInitSummary(report));
  }
  process.exit(report.status === 'ok' ? 0 : 1);
}

main().catch((error) => {
  console.error('argo-init failed:', error && error.message ? error.message : error);
  process.exit(1);
});
