#!/usr/bin/env node
'use strict';

// WP2791 Node direct .qea projection CLI (no EA, no third-party deps).
//   node scripts/ea-qea-sync.js --graph <json> --qea <file.qea> --mode import|sync|export|watch
//   [--delete-confirm-file <f> | -y] [--dry-run] [--snapshot-dir <dir>] [--out <file>] [--no-backup]
//
// import/sync : project design/KG graph into the .qea (update-in-place, batch INSERT,
//               unchanged fingerprint skip, opt-in EA-only delete with confirmation).
// export      : read .qea back into graph-shaped JSON (roundtrip comparable).
// watch       : on graph JSON change, run sync (fs.watch + polling fallback).
// Every write first snapshots the target as <file>_before_sync_<ts> unless --no-backup.

const path = require('node:path');
const fs = require('node:fs');
const lib = require(path.join(__dirname, 'ea-qea-sync-lib.js'));

function parseArgs(argv) {
  const args = { mode: 'sync', graph: '', qea: '', allowDelete: false, deleteConfirmFile: '', dryRun: false, snapshotDir: '', out: '', noBackup: false, intervalMs: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : '');
    if (a === '--graph') { args.graph = next(); }
    else if (a === '--qea') { args.qea = next(); }
    else if (a === '--mode') { args.mode = next(); }
    else if (a === '--delete-confirm-file') { args.deleteConfirmFile = next(); args.allowDelete = true; }
    else if (a === '-y' || a === '--yes') { args.allowDelete = true; }
    else if (a === '--dry-run') { args.dryRun = true; }
    else if (a === '--snapshot-dir') { args.snapshotDir = next(); }
    else if (a === '--out') { args.out = next(); }
    else if (a === '--no-backup') { args.noBackup = true; }
    else if (a === '--interval') { args.intervalMs = Number(next()) || 2000; }
    else if (a.startsWith('-')) { /* ignore unknown */ }
    else if (args.modeSet === undefined) { /* positional not used */ }
  }
  return args;
}

function readGraph(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}
function confirmDelete(args) {
  if (args.allowDelete) { return true; }
  if (args.deleteConfirmFile) {
    try {
      const text = fs.readFileSync(args.deleteConfirmFile, 'utf8').trim().toLowerCase();
      return text.indexOf('delete') >= 0;
    } catch { return false; }
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const graphPath = path.resolve(cwd, args.graph || 'design/KG/SystemArchitecture.json');
  const qeaPath = path.resolve(cwd, args.qea || 'archgraph.qea');
  if (!fs.existsSync(qeaPath)) {
    console.error('qea not found: ' + qeaPath);
    process.exit(2);
  }
  if (args.mode === 'export') {
    const graph = lib.exportQeaToGraph(qeaPath);
    const text = JSON.stringify(graph, null, 2);
    if (args.out) { fs.writeFileSync(path.resolve(cwd, args.out), text, 'utf8'); console.log('export written to ' + args.out); }
    else { console.log(text); }
    return;
  }
  if (!fs.existsSync(graphPath)) {
    console.error('graph not found: ' + graphPath);
    process.exit(2);
  }
  const graph = readGraph(graphPath);
  if (args.mode === 'watch') {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      runOnce(args, graphPath, qeaPath);
      const m0 = statHash(graphPath);
      await sleep(args.intervalMs);
      const m1 = statHash(graphPath);
      if (m0 !== m1) { continue; } // changed while waiting -> immediate re-sync
    }
  } else {
    runOnce(args, graphPath, qeaPath);
  }
}
function statHash(p) {
  try { const st = fs.statSync(p); return st.size + ':' + st.mtimeMs; } catch { return 'gone'; }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function runOnce(args, graphPath, qeaPath) {
  const graph = readGraph(graphPath);
  let snapshot = null;
  if (!args.dryRun && !args.noBackup) {
    snapshot = lib.snapshotQea(qeaPath, args.snapshotDir || undefined);
  }
  const res = lib.syncGraphToQea(graph, qeaPath, { dryRun: args.dryRun, allowDelete: confirmDelete(args) });
  const mode = args.dryRun ? 'dry-run' : 'sync';
  console.log(JSON.stringify({ mode, graph: graphPath, qea: qeaPath, snapshot, result: res }, null, 2));
}

main().catch((e) => {
  console.error('ea-qea-sync failed: ' + (e && e.message));
  process.exit(1);
});
