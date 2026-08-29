'use strict';
// Apply the AT simplification plan through the ARGO MCP mutation tool path.
// Reads scripts/at-simplify-plan.json and calls
// callTool('applySystemArchitectureMutation', ...) per element (batched).
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const systemArchitectureMcp = require(path.join(ROOT, 'argo', 'scripts', 'systemarchitecture-mcp-server.js'));
const plan = require('./at-simplify-plan.json');

const mutations = plan.elements.map(el => ({ type: 'updateElement', id: el.elementId, patch: { testcases: el.testcases } }));
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
