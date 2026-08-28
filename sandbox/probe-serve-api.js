#!/usr/bin/env node
'use strict';
// Probe: confirm the opencode serve HTTP API shape (web UI reachable + session
// endpoints) so the navigation-agent-eval runner can drive agent sessions via
// the server and the user can watch them in the browser.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOME = process.env.USERPROFILE || process.env.HOME || '/root';
const WORKSPACE = process.env.ARGO_REPO_ROOT || '/workspace';
const ENV_FILE = process.env.ENV_FILE || '/env/argo.env';

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k) process.env[k] = v;
  }
}
loadEnvFile(ENV_FILE);
if (!process.env.ARGO_NEO4J_DATABASE) process.env.ARGO_NEO4J_DATABASE = 'sandbox';
process.env.ARGO_NEO4J_DATABASE_URL = (process.env.ARGO_NEO4J_DATABASE_URL || 'neo4j://127.0.0.1:7687')
  .replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');
process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
process.env.OPENCODE_MODEL = process.env.OPENCODE_MODEL || `deepseek-sandbox/${process.env.DEEPSEEK_MODEL || 'deepseek-chat'}`;

// configure opencode with the deepseek provider + argo mcp (same as nav-agent)
function configureArgoOnly() {
  const configPath = path.join(HOME, '.config/opencode/opencode.json');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  if (!baseURL || !process.env.DEEPSEEK_API_KEY) return false;
  const cfg = (() => { try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) { return {}; } })();
  cfg.provider = cfg.provider || {};
  cfg.provider['deepseek-sandbox'] = {
    npm: '@ai-sdk/openai-compatible', name: 'DeepSeek (sandbox)',
    options: { baseURL, apiKey: process.env.DEEPSEEK_API_KEY },
    models: { [model]: { name: model } },
  };
  cfg.mcp = { argo: { type: 'local', command: ['node', path.join(HOME, '.argo/scripts/argo-mcp-server.js')], enabled: true } };
  cfg.model = `deepseek-sandbox/${model}`;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  return true;
}

async function main() {
  configureArgoOnly();
  console.log('[serve-probe] opencode configured (deepseek + argo mcp)');

  // start `opencode serve` in the background, capture logs
  const port = process.env.SERVE_PORT || '3456';
  const child = spawnSync('opencode', ['serve', '--port', port, '--hostname', '0.0.0.0', '--print-logs'], {
    env: process.env, cwd: WORKSPACE, encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024,
  });
  // spawnSync with timeout returns after timeout with status null; logs captured
  console.log('[serve-probe] serve exited code=' + child.status);
  console.log('[serve-probe] serve stdout head:', String(child.stdout || '').slice(0, 1500));
  console.log('[serve-probe] serve stderr head:', String(child.stderr || '').slice(0, 1500));
}

main().catch(e => { console.error('[serve-probe] ERR', e.message); process.exit(1); });
