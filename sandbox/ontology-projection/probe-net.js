'use strict';
const net = require('node:net');
const fs = require('node:fs');
const env = Object.fromEntries(
  fs.readFileSync('/env/argo.env', 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const embedUrl = env.ARGO_EMBEDDING_BASE_URL || '';
let host = '';
try { host = new URL(embedUrl).hostname; } catch { host = ''; }
console.log('embedding host:', host || '(none)');
function probe(label, target, port) {
  return new Promise((resolve) => {
    if (!target) return resolve(console.log(label, 'NO_TARGET'));
    const s = net.connect(port, target);
    let done = false;
    const end = (msg) => { if (!done) { done = true; console.log(label, msg); s.destroy(); resolve(); } };
    s.setTimeout(8000);
    s.on('connect', () => end('TCP_OK'));
    s.on('error', (e) => end('TCP_FAIL ' + e.message));
    s.on('timeout', () => end('TCP_TIMEOUT'));
  });
}
(async () => {
  await probe('neo4j(host.docker.internal:7687)', 'host.docker.internal', 7687);
  await probe('embedding:' + host, host, 443);
})();
