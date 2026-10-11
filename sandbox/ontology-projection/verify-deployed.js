'use strict';

// Verify the DEPLOYED argo MCP server (installed at ~/.argo) loads ~/.argo/.env
// and runs the ontology-validation extension at the init timing:
//   ON  (switch set in ~/.argo/.env)  -> a contradicting graph FAILS validation
//   OFF (ARGO_VALIDATION_EXTENSIONS='' override) -> the same graph PASSES
//   valid graph (ON) -> PASSES
// Uses the deployed engine (python3 + pyshacl + owlready2) on the host.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOME = process.env.USERPROFILE || os.homedir();
const SERVER = path.join(HOME, '.argo', 'scripts', 'argo-mcp-server.js');
const SAMPLE = path.join(__dirname, 'samples', 'team-graph');

function makeWs(graph) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-deployed-'));
  for (const rel of ['.argo/schema', 'design/KG']) fs.mkdirSync(path.join(ws, rel), { recursive: true });
  for (const f of fs.readdirSync(path.join(SAMPLE, '.argo', 'schema'))) {
    fs.copyFileSync(path.join(SAMPLE, '.argo', 'schema', f), path.join(ws, '.argo', 'schema', f));
  }
  fs.copyFileSync(path.join(SAMPLE, 'graphs', graph), path.join(ws, 'design', 'KG', 'SystemArchitecture.json'));
  return ws;
}

function mcpSession(calls, env, timeoutMs = 120000) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deployed-verify', version: '1' } } },
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
    const timer = setTimeout(() => finish(new Error(`timeout; stderr=${stderr.slice(0, 400)}`)), timeoutMs);
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
    child.on('exit', (code) => { if (!calls.every((c, i) => byId[100 + i])) finish(new Error(`early exit code=${code}; stderr=${stderr.slice(0, 400)}`)); });
    child.stdin.on('write', () => {});
    child.stdin.on('error', () => { /* ignore */ });
    child.stdin.write(input);
  });
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`);
  if (!ok) failures += 1;
}

const validate = { key: 'v', name: 'validateSystemArchitecture', arguments: {} };

async function main() {
  const wsBad = makeWs('axiom-contradiction.json');
  const wsGood = makeWs('valid.json');

  const on = await mcpSession([{ ...validate, arguments: { workspaceRoot: wsBad } }], { ARGO_REPO_ROOT: wsBad });
  const onBlob = JSON.stringify(on.v);
  check('ON  (switch in ~/.argo/.env): contradiction graph FAILS', on.v.status === 'failed' && /OWL|ontology/i.test(onBlob), JSON.stringify(on.v).slice(0, 400));

  const off = await mcpSession([{ ...validate, arguments: { workspaceRoot: wsBad } }], { ARGO_REPO_ROOT: wsBad, ARGO_VALIDATION_EXTENSIONS: '' });
  check('OFF (ARGO_VALIDATION_EXTENSIONS=""): same graph PASSES', off.v.status === 'passed', JSON.stringify(off.v).slice(0, 400));

  const good = await mcpSession([{ ...validate, arguments: { workspaceRoot: wsGood } }], { ARGO_REPO_ROOT: wsGood });
  check('ON  valid graph: PASSES', good.v.status === 'passed', JSON.stringify(good.v).slice(0, 400));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('VERIFY_FAILED:', error.message); process.exit(1); });
