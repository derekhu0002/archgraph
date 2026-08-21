'use strict';

// Repair the parent->child side of the sub-diagram link.
//
// The ARGO MCP view-write path maintains `view.parent_element_id` (child -> parent)
// but historically never updated the mirror field `element.subdiagram_views`
// (parent -> child). This script rebuilds every element's `subdiagram_views`
// from the canonical source of truth — the views' `parent_element_id` — so the
// two sides agree again.
//
// Modes:
//   --check   (default) dry-run: print the per-element diff, exit 1 if any drift.
//   --fix     apply the corrections. For the intent graph
//             (design/KG/SystemArchitecture.json) this writes THROUGH the ARGO MCP
//             (applySystemArchitectureMutation), never touching the file directly.
//   --direct  (with --fix) write the JSON file directly with a .bak backup. Use for
//             non-intent-graph copies (KGlibrary samples, defaults template, EA exports)
//             that may not satisfy the intent-graph validation rules.
//
// Options:
//   --path <p>             Graph JSON path (default: design/KG/SystemArchitecture.json).
//                          Relative paths resolve against --workspaceRoot.
//   --workspaceRoot <dir>  Workspace root (default: the repository root).

const fs = require('node:fs');
const path = require('node:path');

const { applyMutations, callTool } = require('./systemarchitecture-mcp-server.js');

const DEFAULT_GRAPH_PATH = 'design/KG/SystemArchitecture.json';

function parseArgs(argv) {
  const args = { check: true, fix: false, direct: false, graphPath: DEFAULT_GRAPH_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      args.check = true;
      args.fix = false;
    } else if (arg === '--fix') {
      args.fix = true;
      args.check = false;
    } else if (arg === '--direct') {
      args.direct = true;
    } else if (arg === '--path' && i + 1 < argv.length) {
      args.graphPath = argv[i + 1];
      i += 1;
    } else if (arg === '--workspaceRoot' && i + 1 < argv.length) {
      args.workspaceRoot = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function resolveGraphPath(args) {
  const workspaceRoot = path.resolve(args.workspaceRoot || path.resolve(__dirname, '..', '..'));
  const resolved = path.isAbsolute(args.graphPath)
    ? args.graphPath
    : path.resolve(workspaceRoot, args.graphPath);
  return { workspaceRoot, absolutePath: resolved, relativePath: path.relative(workspaceRoot, resolved) };
}

function readDocument(absolutePath, label) {
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function sortedEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .filter(entry => entry && typeof entry.view_id === 'string' && entry.view_id.length > 0)
    .map(entry => ({ view_id: entry.view_id, view_name: String(entry.view_name || '') }))
    .sort((a, b) => a.view_id.localeCompare(b.view_id));
}

function entriesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].view_id !== right[i].view_id || left[i].view_name !== right[i].view_name) {
      return false;
    }
  }
  return true;
}

// Map element id -> canonical [{ view_id, view_name }] derived from view.parent_element_id.
function computeDesired(document) {
  const desired = new Map();
  for (const view of document.views || []) {
    if (!view || !view.parent_element_id || !view.view_id) {
      continue;
    }
    const list = desired.get(view.parent_element_id) || [];
    if (!list.some(entry => entry.view_id === view.view_id)) {
      list.push({ view_id: view.view_id, view_name: String(view.view_name || '') });
    }
    desired.set(view.parent_element_id, list);
  }
  return desired;
}

function computeMutations(document, desired) {
  const mutations = [];
  const reports = [];
  for (const element of document.elements || []) {
    if (!element || !element.id) {
      continue;
    }
    const canonical = sortedEntries(desired.get(element.id) || []);
    const current = sortedEntries(element.subdiagram_views || []);
    if (entriesEqual(current, canonical)) {
      continue;
    }
    reports.push({
      elementId: element.id,
      elementName: element.name,
      current,
      canonical,
    });
    mutations.push({
      type: 'updateElement',
      id: element.id,
      patch: { subdiagram_views: canonical },
    });
  }
  return { mutations, reports };
}

function describeEntry(entry) {
  return `${entry.view_id}:${entry.view_name}`;
}

function printReports(reports) {
  if (reports.length === 0) {
    console.log('OK: all elements have subdiagram_views consistent with view.parent_element_id.');
    return;
  }
  console.log(`Found ${reports.length} element(s) with drifted subdiagram_views:`);
  for (const report of reports) {
    console.log(`- ${report.elementId} (${report.elementName})`);
    console.log(`    current  : [${report.current.map(describeEntry).join(', ')}]`);
    console.log(`    canonical: [${report.canonical.map(describeEntry).join(', ')}]`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { workspaceRoot, absolutePath, relativePath } = resolveGraphPath(args);
  const document = readDocument(absolutePath, relativePath);
  const desired = computeDesired(document);
  const { mutations, reports } = computeMutations(document, desired);

  if (args.check) {
    printReports(reports);
    process.exitCode = reports.length === 0 ? 0 : 1;
    return;
  }

  if (reports.length === 0) {
    console.log('Nothing to fix: subdiagram_views already consistent.');
    return;
  }

  if (args.direct) {
    const { document: fixedDocument } = applyMutations(document, mutations);
    const backupPath = `${absolutePath}.bak`;
    fs.copyFileSync(absolutePath, backupPath);
    fs.writeFileSync(absolutePath, `${JSON.stringify(fixedDocument, null, 2)}\n`, 'utf8');
    console.log(`Fixed ${reports.length} element(s) directly in ${relativePath} (backup: ${backupPath}).`);
    return;
  }

  // Intent-graph write path: go through ARGO MCP (applySystemArchitectureMutation).
  const result = await callTool(
    'applySystemArchitectureMutation',
    {
      mutations,
      workspaceRoot,
      architecturePath: relativePath,
    },
    undefined,
  );

  if (result && result.status === 'passed' && result.written === true) {
    console.log(`Fixed ${reports.length} element(s) through ARGO MCP applySystemArchitectureMutation.`);
  } else {
    console.error(`MCP repair failed: ${JSON.stringify(result, null, 2)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`MCP repair failed: ${String(error && error.stack ? error.stack : error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  computeDesired,
  computeMutations,
  parseArgs,
  sortedEntries,
};
