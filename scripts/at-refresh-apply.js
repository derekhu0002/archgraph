'use strict';
// Apply the AT refresh plan through the ARGO MCP mutation tool path (never edits
// the graph file directly). Reads scripts/at-refresh-plan.json, then calls
// callTool('applySystemArchitectureMutation', ...) in-process for each element
// (batched), so every mounted AT gets an executable bare acceptanceCriteria and
// internal-view/redundant ATs are dropped. Idempotent and re-runnable.
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const systemArchitectureMcp = require(path.join(ROOT, 'argo', 'scripts', 'systemarchitecture-mcp-server.js'));
const plan = require('./at-refresh-plan.json');

// Elements whose testcases were fully removed (need explicit empty testcases).
const EMPTY_TESTCASES_IDS = ['2100'];

const mutations = [];
for (const el of plan.elements) {
  mutations.push({ type: 'updateElement', id: el.elementId, patch: { testcases: el.testcases } });
}
for (const id of EMPTY_TESTCASES_IDS) {
  mutations.push({ type: 'updateElement', id, patch: { testcases: [] } });
}

const BATCH = 8;
const results = [];
(async () => {
  for (let i = 0; i < mutations.length; i += BATCH) {
    const slice = mutations.slice(i, i + BATCH);
    try {
      const r = await systemArchitectureMcp.callTool('applySystemArchitectureMutation', { mutations: slice });
      const payload = typeof r === 'string' ? JSON.parse(r) : (r && r.text ? JSON.parse(r.text) : r);
      const ok = payload && payload.status === 'passed' && payload.written === true;
      results.push(`${ok ? 'OK  ' : 'FAIL'} batch ${Math.floor(i / BATCH) + 1}: ${slice.map(m => m.id).join(', ')}`);
      if (!ok) results.push(`     -> ${JSON.stringify(payload && (payload.errors || payload.error)).slice(0, 300)}`);
    } catch (error) {
      results.push(`ERR  batch ${Math.floor(i / BATCH) + 1}: ${slice.map(m => m.id).join(', ')} -> ${error.message}`);
    }
  }
  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL') || r.startsWith('ERR'));
  console.log(`\nDONE mutations=${mutations.length} batches=${Math.ceil(mutations.length / BATCH)} failed=${fails.length}`);
  process.exit(fails.length ? 1 : 0);
})();
