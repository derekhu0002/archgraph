'use strict';

// Verify the WRITE-timing hook on the DEPLOYED argo MCP server (installed at
// ~/.argo) with the real ~/.argo/.env switch + the real host runtime:
//   A. valid write            -> passed  (no false block)
//   B. contradictory write    -> failed with the real engine's OWL finding
//   C. same write, switch OFF  -> passed  (control)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOME = process.env.USERPROFILE || os.homedir();
const SERVER = path.join(HOME, '.argo', 'scripts', 'argo-mcp-server.js');
const SAMPLE = path.join(__dirname, 'samples', 'team-graph');

function makeWs() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-deployed-write-'));
  for (const rel of ['.argo/schema', 'design/KG']) fs.mkdirSync(path.join(ws, rel), { recursive: true });
  for (const f of fs.readdirSync(path.join(SAMPLE, '.argo', 'schema'))) {
    fs.copyFileSync(path.join(SAMPLE, '.argo', 'schema', f), path.join(ws, '.argo', 'schema', f));
  }
  fs.copyFileSync(path.join(SAMPLE, 'graphs', 'valid.json'), path.join(ws, 'design', 'KG', 'SystemArchitecture.json'));
  return ws;
}

function mcpSession(calls, env, timeoutMs = 300000) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deployed-write', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: c.name, arguments: c.arguments } })),
  ];
  const input = `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const byId = {};
    let buffer = '';
    let stderr = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      if (error) return reject(error);
      const out = {};
      calls.forEach((c, i) => {
        const m = byId[100 + i];
        if (!m) return (out[c.key] = { __error: 'no response' });
        if (m.error) return (out[c.key] = { __error: m.error });
        try { out[c.key] = JSON.parse(m.result.content[0].text); } catch { out[c.key] = { __raw: m.result.content[0].text }; }
      });
      resolve(out);
    };
    const timer = setTimeout(() => finish(new Error(`timeout; stderr=${stderr.slice(0, 500)}`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m && typeof m.id === 'number' && m.id >= 100) byId[m.id] = m; } catch { /* ignore */ }
      }
      if (calls.every((c, i) => byId[100 + i])) finish(null);
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => finish(err));
    child.on('exit', (code) => { if (!calls.every((c, i) => byId[100 + i])) finish(new Error(`early exit code=${code}; stderr=${stderr.slice(0, 500)}`)); });
    child.stdin.on('error', () => { /* ignore */ });
    child.stdin.write(input);
  });
}

const validWrite = [
  { key: 'e', name: 'addArchitectureElement', arguments: { onConflict: 'allowDuplicate', justification: 'verification element', view_ids: ['view-root'], element: { id: 'team-b', name: 'Team B', type: 'Team Node' } } },
  { key: 'w', name: 'addArchitectureRelationship', arguments: { view_ids: ['view-root'], relationship: { id: 'rel-v', name: 'Team B depends on Service A', type: 'Depends On', source_id: 'team-b', target_id: 'svc-a', source_name: 'Team B', target_name: 'Service A', statement: 'Team B --(Depends On)--> Service A' } } },
];
const contradictionWrite = [
  { key: 'e', name: 'addArchitectureElement', arguments: { onConflict: 'allowDuplicate', justification: 'verification element', view_ids: ['view-root'], element: { id: 'team-c', name: 'Team C', type: 'Team Node' } } },
  { key: 'w', name: 'addArchitectureRelationship', arguments: { view_ids: ['view-root'], relationship: { id: 'rel-c', name: 'Agent 1 assigned to Team C', type: 'Assigned To', source_id: 'agent-1', target_id: 'team-c', source_name: 'Agent 1', target_name: 'Team C', statement: 'Agent 1 --(Assigned To)--> Team C' } } },
];

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`);
  if (!ok) failures += 1;
}
const withWs = (calls, ws) => calls.map((c) => ({ ...c, arguments: { ...c.arguments, workspaceRoot: ws } }));

async function main() {
  const ws = makeWs();
  const init = { key: 'i', name: 'initializeWorkspace', arguments: { workspaceRoot: ws } };

  const a = await mcpSession([init, ...withWs(validWrite, ws)], { ARGO_REPO_ROOT: ws });
  const rep = (a.i && (a.i.report || a.i)) || {};
  check('init ok', rep.status === 'ok', JSON.stringify(a.i).slice(0, 300));
  check('A. valid write passed (switch ON)', a.w.status === 'passed', JSON.stringify(a.w).slice(0, 400));

  const b = await mcpSession([{ ...init, arguments: { workspaceRoot: ws } }, ...withWs(contradictionWrite, ws)], { ARGO_REPO_ROOT: ws });
  check('B. contradictory write blocked by real engine (switch ON)', b.w.status === 'failed' && /OWL|ontology/i.test(JSON.stringify(b.w)), JSON.stringify(b.w).slice(0, 500));

  const c = await mcpSession([{ ...init, arguments: { workspaceRoot: ws } }, ...withWs(contradictionWrite, ws)], { ARGO_REPO_ROOT: ws, ARGO_VALIDATION_EXTENSIONS: '' });
  check('C. control: same write passed (switch OFF)', c.w.status === 'passed', JSON.stringify(c.w).slice(0, 400));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('VERIFY_FAILED:', error.message); process.exit(1); });
