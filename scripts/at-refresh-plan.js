'use strict';
// Read-only plan generator: transform every mounted AT so acceptanceCriteria is
// a bare executable workspace-relative path, and drop internal-view / redundant
// testcases. Outputs the per-element corrected testcases plan (JSON) that is then
// applied through the ARGO MCP mutation tools (never by editing the graph file).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));

// Element ids whose testcases are internal-implementation-view (white-box source
// inspection) or redundant meta-checks -> remove from the graph mount.
const REMOVE_TC_BY_ELEMENT = {
  '2100': new Set(['AT-2100-01-不保留原ID按新元素导入', 'AT-2100-02-必须由用户提供导入文件路径', 'AT-2100-03-导入期间关闭UI刷新且完成后仅刷新一次目录树', 'AT-2100-04-导入完成后不自动打开任何视图', 'AT-2100-05-导入过程中不逐个打开视图']),
  '2767': new Set(['AT-2767-06-无回归']),
};

// Extract the bare workspace-relative test/script path from the prose wrapper.
function extractBarePath(criteria) {
  const c = String(criteria || '').trim();
  const m = c.match(/(?:tests|scripts|sandbox|argo\/scripts)\/[a-zA-Z0-9_./-]+\.(?:js|cjs|mjs|py|ps1|sh)\b/);
  if (m) {
    const file = m[0].replace(/\\/g, '/');
    return file.split('::')[0];
  }
  return null;
}

const plan = [];
let fixed = 0;
let kept = 0;
let removed = 0;
let total = 0;

for (const el of graph.elements || []) {
  if (!Array.isArray(el.testcases) || el.testcases.length === 0) continue;
  const drop = REMOVE_TC_BY_ELEMENT[el.id] || new Set();
  const normalized = [];
  for (const tc of el.testcases) {
    total += 1;
    const name = String(tc.name || '');
    if (drop.has(name)) {
      removed += 1;
      continue;
    }
    const criteria = String(tc.acceptanceCriteria || '').trim();
    const bare = /^[a-zA-Z0-9_./-]+\.(?:js|cjs|mjs|py|ps1|sh)$/i.test(criteria.split('::')[0])
      ? criteria.split('::')[0]
      : extractBarePath(criteria);
    const file = bare || (Array.isArray(tc.Input) ? null : tc.Input) || null;
    if (!file) {
      // No executable file could be resolved -> drop (cannot be executed).
      removed += 1;
      continue;
    }
    normalized.push({
      name,
      description: String(tc.description || tc.name || ''),
      type: 'Acceptance Test',
      Input: file,
      acceptanceCriteria: file,
    });
    if (bare && bare === criteria.split('::')[0] && /^[a-zA-Z0-9_./-]+\.(?:js|cjs|mjs|py|ps1|sh)$/i.test(criteria.split('::')[0])) {
      kept += 1;
    } else {
      fixed += 1;
    }
  }
  if (normalized.length > 0) {
    plan.push({ elementId: el.id, name: el.name, type: el.type, testcases: normalized });
  }
}

const report = { summary: { total, kept, fixed, removed }, elements: plan };
fs.writeFileSync(path.join(__dirname, 'at-refresh-plan.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`total=${total} kept=${kept} fixed=${fixed} removed=${removed} elementsInPlan=${plan.length}`);
