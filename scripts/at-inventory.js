'use strict';
// Read-only inventory + classification of every mounted AT in the intent graph.
// Does NOT edit the graph — it produces a classification report used to plan the
// refresh (fix acceptanceCriteria -> executable bare paths) and removal (drop
// internal-implementation-view cases, keeping only external-view ones).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));

const testFiles = new Set(fs.readdirSync(path.join(ROOT, 'tests')).map(f => `tests/${f}`));
const scriptFiles = new Set();
function collectScripts(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) collectScripts(path.join(dir, entry.name), rel);
    else if (/\.(js|cjs|mjs|py|ps1|sh)$/.test(entry.name)) scriptFiles.add(rel);
  }
}
collectScripts(path.join(ROOT, 'scripts'), 'scripts');

// Bare executable criteria: a workspace-relative path (optionally with ::pytest selector)
function isBarePath(criteria) {
  const c = String(criteria || '').trim();
  if (!c) return false;
  if (/[\r\n]/.test(c)) return false;
  if (/[|&;<>]/.test(c)) return false;
  if (/^(?:npm|pnpm|yarn|npx|node|python|py|powershell|pwsh|cmd|bash|sh)\b/i.test(c)) return false;
  const pathPart = c.split('::')[0];
  return /^[a-zA-Z0-9_\-./]+\.(js|cjs|mjs|py|ps1|sh)$/i.test(pathPart);
}

const elements = [];
let total = 0;
let bareExec = 0;
let bareMissing = 0;
let descriptive = 0;

for (const el of graph.elements || []) {
  if (!Array.isArray(el.testcases) || el.testcases.length === 0) continue;
  const tcs = el.testcases.map(tc => {
    total += 1;
    const criteria = String(tc.acceptanceCriteria || '').trim();
    let cls;
    if (isBarePath(criteria)) {
      const file = criteria.split('::')[0];
      const exists = testFiles.has(file) || scriptFiles.has(file) || fs.existsSync(path.join(ROOT, file));
      cls = exists ? 'BARE-EXEC' : 'BARE-MISSING';
      if (exists) bareExec += 1; else bareMissing += 1;
    } else {
      cls = 'DESCRIPTIVE';
      descriptive += 1;
    }
    return { name: tc.name, cls, criteria, desc: (tc.description || '').slice(0, 90) };
  });
  elements.push({ id: el.id, name: el.name, type: el.type, tcs });
}

const output = [];
output.push(`ELEMENTS_WITH_TC=${elements.length} TOTAL_TC=${total} BARE_EXEC=${bareExec} BARE_MISSING=${bareMissing} DESCRIPTIVE=${descriptive}`);
output.push('--- BY ELEMENT ---');
for (const el of elements) {
  const clsCount = el.tcs.reduce((m, t) => (m[t.cls] = (m[t.cls] || 0) + 1, m), {});
  output.push(`\n[${el.type}] ${el.id} ${el.name} ${JSON.stringify(clsCount)}`);
  for (const t of el.tcs) {
    output.push(`   ${t.cls.padEnd(12)} ${t.name} :: ${t.criteria.slice(0, 150)}`);
  }
}
fs.writeFileSync(path.join(__dirname, 'at-inventory-report.txt'), output.join('\n'), 'utf8');
console.log(`written ${path.join(__dirname, 'at-inventory-report.txt')} (${total} testcases)`);
