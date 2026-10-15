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

function resolveArgoMcp() {
  const deployed = path.join(os.homedir(), '.argo', 'scripts', 'argo-mcp-server.js');
  if (fs.existsSync(deployed)) return deployed;
  return path.join(__dirname, '..', 'argo', 'scripts', 'argo-mcp-server.js');
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
