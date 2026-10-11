'use strict';
// Demo: drive the deployed argo MCP initializeWorkspace and print report.ontologyValidation.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOME = process.env.USERPROFILE || os.homedir();
const SERVER = path.join(HOME, '.argo', 'scripts', 'argo-mcp-server.js');
const SAMPLE = path.join(__dirname, 'samples', 'team-graph');

function makeWs() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-init-rep-'));
  for (const rel of ['.argo/schema', 'design/KG']) fs.mkdirSync(path.join(ws, rel), { recursive: true });
  for (const f of fs.readdirSync(path.join(SAMPLE, '.argo', 'schema'))) fs.copyFileSync(path.join(SAMPLE, '.argo', 'schema', f), path.join(ws, '.argo', 'schema', f));
  fs.copyFileSync(path.join(SAMPLE, 'graphs', 'valid.json'), path.join(ws, 'design', 'KG', 'SystemArchitecture.json'));
  return ws;
}

const ws = makeWs();
const input = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  { jsonrpc: '2.0', id: 100, method: 'tools/call', params: { name: 'initializeWorkspace', arguments: { workspaceRoot: ws } } },
].map((m) => JSON.stringify(m)).join('\n') + '\n';

const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ARGO_REPO_ROOT: ws }, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let stderr = '';
child.stdout.on('data', (d) => { buf += d.toString(); });
child.stderr.on('data', (d) => { stderr += d.toString(); });
child.on('exit', () => {
  const line = buf.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m && m.id === 100);
  if (!line) { console.log('no response; stderr=', stderr.slice(0, 400)); return; }
  const report = JSON.parse(line.result.content[0].text);
  console.log('status:', report.status);
  console.log('schemaBundle.language:', report.schemaBundle && report.schemaBundle.language);
  const o = report.ontology || {};
  if (o.status === 'ok') {
    console.log('ontology: language=', o.language, 'elementTypes=', JSON.stringify(o.elementTypes), 'relationshipTypes=', JSON.stringify(o.relationshipTypes));
    console.log('ontology.endpointMatrix keys:', Object.keys(o.endpointMatrix || {}));
    console.log('ontology.axioms keys present:', Object.keys(o.axioms || {}).filter((k) => { const v = o.axioms[k]; return Array.isArray(v) ? v.length : (typeof v === 'object' ? Object.keys(v).length : v); }));
    console.log('ontology.missing:', JSON.stringify(o.missing, null, 2));
  } else {
    console.log('ontology:', JSON.stringify(o));
  }
  console.log('ontologyValidation:', JSON.stringify(report.ontologyValidation));
});
child.stdin.write(input);
child.stdin.end();
setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 240000);
