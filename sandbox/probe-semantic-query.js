'use strict';
// Host-side probe: run getSystemArchitecture (implementation-design memory
// retrieval) and print the retrieved elements with their semanticScore.
const path = require('node:path');
const fs = require('node:fs');

process.env.ARGO_REPO_ROOT = process.env.ARGO_REPO_ROOT || 'd:/Projects/archgraph';
// load approved env from ~/.argo/.env into process.env (host deployment)
const envPath = process.env.ARGO_ENV_FILE || path.join(process.env.USERPROFILE || process.env.HOME, '.argo', '.env');
try {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch (_) { /* ignore */ }

const { callTool } = require('C:/Users/admin/.argo/scripts/argo-mcp-server.js');

const intent = process.argv[2] || '长期记忆评测基线';
const purpose = process.argv[3] || 'implementation-design';

(async () => {
  const s = await callTool('getSystemArchitecture', {
    query: { purpose, intent },
    workspaceRoot: 'd:/Projects/archgraph',
  }, null, undefined);
  let payload = s;
  if (s && s.content && Array.isArray(s.content) && s.content[0] && typeof s.content[0].text === 'string') {
    try { payload = JSON.parse(s.content[0].text); } catch (_) { /* keep */ }
  }
  const doc = payload && payload.document;
  const elements = (doc && doc.elements) || [];
  console.log(`purpose=${purpose} intent="${intent}" status=${payload && payload.status} elements=${elements.length}`);
  for (const e of elements.slice(0, 8)) {
    console.log('  -', e.id, `score=${typeof e.semanticScore === 'number' ? e.semanticScore.toFixed(3) : '(none)'}`, String(e.name || '').slice(0, 40));
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
