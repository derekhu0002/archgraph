'use strict';

// Performance benchmark for the ontology-validation extension, run inside the
// isolated real-engine container. It measures the ADDED cost of the validation
// on the framework's normal timings, as the graph grows:
//
//   * t_off        framework validation alone (extension OFF)   -> baseline
//   * t_init       framework validation + real engine (init timing)
//   * t_write_real ontology validation, write timing, REAL engine (pySHACL+HermiT)
//   * t_write_det  ontology validation, write timing, deterministic in-process
//
// It then reports the per-size numbers and the growth ratio per doubling, so the
// scaling (linear vs super-linear) is visible.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = process.env.ARGO_REPO_DIR || '/repo';
const FIXTURE = path.join(__dirname, 'samples', 'team-graph');
const CLI = path.join(REPO, 'argo', 'scripts', 'ontology-projection', 'cli.js');
const VSA = path.join(REPO, 'argo', 'scripts', 'validateSystemArchitecture.js');
const SIZES = (process.env.BENCH_SIZES || '10,20,40,80,160').split(',').map((n) => parseInt(n, 10));

function buildGraph(n) {
  const k = Math.max(1, Math.floor(n / 2));
  const elements = [];
  const relationships = [];
  let rid = 0;
  for (let i = 0; i < k; i += 1) elements.push({ id: `team-${i}`, name: `Team ${i}`, type: 'Team Node' });
  for (let i = 0; i < k; i += 1) elements.push({ id: `svc-${i}`, name: `Service ${i}`, type: 'Service Node' });
  for (let i = 0; i < k; i += 1) {
    relationships.push({ id: `r${rid++}`, name: `team-${i} depends on svc-${i}`, type: 'Depends On', source_id: `team-${i}`, target_id: `svc-${i}`, source_name: `Team ${i}`, target_name: `Service ${i}`, statement: `Team ${i} --(Depends On)--> Service ${i}` });
  }
  for (let i = 0; i < k - 1; i += 1) {
    relationships.push({ id: `r${rid++}`, name: `team-${i} depends on team-${i + 1}`, type: 'Depends On', source_id: `team-${i}`, target_id: `team-${i + 1}`, source_name: `Team ${i}`, target_name: `Team ${i + 1}`, statement: `Team ${i} --(Depends On)--> Team ${i + 1}` });
  }
  // split into <=12-element views to respect maxElementsPerView
  const views = [];
  const per = 12;
  for (let v = 0; v * per < elements.length; v += 1) {
    const slice = elements.slice(v * per, (v + 1) * per).map((e) => e.id);
    views.push({ view_id: `view-${v}`, view_name: v === 0 ? 'SystemArchitecture' : `View ${v}`, included_elements: slice, included_relationships: [] });
  }
  return { name: `bench-${n}`, description: 'benchmark graph', elements, relationships, views };
}

function makeWorkspace(n) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `argo-bench-${n}-`));
  const schemaDir = path.join(ws, '.argo', 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of fs.readdirSync(path.join(FIXTURE, '.argo', 'schema'))) {
    fs.copyFileSync(path.join(FIXTURE, '.argo', 'schema', name), path.join(schemaDir, name));
  }
  const graphDir = path.join(ws, 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.writeFileSync(path.join(graphDir, 'SystemArchitecture.json'), JSON.stringify(buildGraph(n)));
  return ws;
}

function timeSpawn(argv, env) {
  const started = process.hrtime.bigint();
  const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, status: result.status, timedOut: result.signal === 'SIGKILL' || result.error && /ETIMEDOUT/.test(result.error.message || '') };
}

function main() {
  const extInit = JSON.stringify([
    { name: 'ontology', timings: ['init'], command: ['node', CLI, '--workspace', '{workspaceRoot}', '--graph', '{graphPath}', '--mode', '{mode}'] },
  ]);
  const rows = [];
  for (const n of SIZES) {
    const ws = makeWorkspace(n);
    const baseEnv = { ARGO_REPO_ROOT: ws };
    const off = timeSpawn(['node', VSA], baseEnv);
    const init = timeSpawn(['node', VSA], { ...baseEnv, ARGO_VALIDATION_EXTENSIONS: extInit });
    const writeReal = timeSpawn(['node', CLI, '--workspace', ws, '--graph', path.join('design', 'KG', 'SystemArchitecture.json'), '--mode', 'write', '--engine', 'real'], {});
    const writeDelta = timeSpawn(['node', CLI, '--workspace', ws, '--graph', path.join('design', 'KG', 'SystemArchitecture.json'), '--mode', 'write', '--engine', 'real', '--scope', 'delta'], { ARGO_VALIDATION_TOUCHED_RELATIONSHIPS: JSON.stringify(['r0']) });
    const writeDet = timeSpawn(['node', CLI, '--workspace', ws, '--graph', path.join('design', 'KG', 'SystemArchitecture.json'), '--mode', 'write', '--engine', 'deterministic'], {});
    rows.push({
      relationships: n,
      elements: Math.max(1, Math.floor(n / 2)) * 2,
      t_off_ms: Math.round(off.ms),
      t_init_ms: Math.round(init.ms),
      added_init_ms: Math.round(init.ms - off.ms),
      t_write_real_ms: Math.round(writeReal.ms),
      t_write_delta_ms: Math.round(writeDelta.ms),
      t_write_det_ms: Math.round(writeDet.ms),
    });
  }
  console.log('relationships | t_off | t_init | added_init | t_write_real | t_write_delta | t_write_det');
  for (const r of rows) {
    console.log(`${String(r.relationships).padStart(13)} | ${String(r.t_off_ms).padStart(5)} | ${String(r.t_init_ms).padStart(6)} | ${String(r.added_init_ms).padStart(10)} | ${String(r.t_write_real_ms).padStart(12)} | ${String(r.t_write_delta_ms).padStart(13)} | ${String(r.t_write_det_ms).padStart(11)}`);
  }
  // growth per doubling of the write-timing real engine
  console.log('\ngrowth per doubling (t_write_real):');
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1];
    const b = rows[i];
    const sizeRatio = b.relationships / a.relationships;
    const timeRatio = b.t_write_real_ms / Math.max(1, a.t_write_real_ms);
    const addedRatio = (b.added_init_ms) / Math.max(1, a.added_init_ms);
    console.log(`${a.relationships}->${b.relationships} (x${sizeRatio}): write_real x${timeRatio.toFixed(2)} | added_init x${addedRatio.toFixed(2)}`);
  }
  const out = process.env.RESULTS_DIR || '/tmp';
  fs.writeFileSync(path.join(out, 'ontology-projection-bench.json'), JSON.stringify({ sizes: SIZES, rows }, null, 2));
}

main();
