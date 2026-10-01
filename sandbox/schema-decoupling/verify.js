'use strict';

// In-container verification for the schema/ontology decoupling.
//
// Runs entirely inside the disposable Docker image (Node + OpenCode). It:
//   1. builds a clean copy of the mounted repo (/repo -> /work, no node_modules),
//   2. installs the toolchain the way argo-deploy does (~/.argo) and its
//      neo4j-driver runtime dependency (from the vendored tarball),
//   3. runs the new schema acceptance tests + MCP/graph-semantics regressions,
//   4. exercises the DEPLOYED (~/.argo) MCP server against a workspace with its
//      own .argo/schema bundle and against the default bundle,
//   5. verifies the OpenCode runtime loads that same MCP server (`opencode mcp list`).
//
// It writes results/schema-decoupling-report.json and exits non-zero on failure.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = process.env.HOME || '/root';
const ARGO = path.join(HOME, '.argo');
const WORK = '/work';
const WS_CUSTOM = '/ws-custom';
const WS_DEFAULT = '/ws-default';
const RESULTS_DIR = fs.existsSync('/results') ? '/results' : '/tmp';
const REPORT_PATH = path.join(RESULTS_DIR, 'schema-decoupling-report.json');

const steps = [];

function record(name, fn) {
  const started = Date.now();
  console.log(`RUN   ${name}`);
  try {
    const detail = fn();
    steps.push({ name, status: 'passed', ms: Date.now() - started, detail: detail === undefined ? null : detail });
    console.log(`PASS  ${name}`);
  } catch (error) {
    steps.push({ name, status: 'failed', ms: Date.now() - started, error: String(error && error.message ? error.message : error).slice(0, 2000) });
    console.log(`FAIL  ${name}: ${error && error.message ? error.message : error}`);
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, killSignal: 'SIGKILL', ...opts });
  if (result.error) {
    const tail = String(result.stdout || '') + String(result.stderr || '');
    throw new Error(`${cmd} ${args.join(' ')} failed to run: ${result.error.message}${tail ? `\n${tail.slice(-1200)}` : ''}`);
  }
  return result;
}

function mustRun(cmd, args, opts = {}) {
  const result = run(cmd, args, opts);
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}\n${String(result.stderr || result.stdout || '').slice(0, 1500)}`);
  }
  return result;
}

// --- MCP JSON-RPC probe -------------------------------------------------------

function mcpCall(serverPath, calls, env) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'schema-verify', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...calls.map((call, index) => ({ jsonrpc: '2.0', id: 100 + index, method: 'tools/call', params: { name: call.name, arguments: call.arguments } })),
  ];
  const input = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [serverPath], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000,
    killSignal: 'SIGKILL',
  });
  if (result.error) {
    throw new Error(`MCP server run error: ${result.error.message}\n${String(result.stderr || '').slice(0, 1200)}`);
  }
  if (result.status !== 0) {
    throw new Error(`MCP server exited ${result.status}: ${String(result.stderr || '').slice(0, 1200)}`);
  }
  const byId = {};
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message && message.id !== undefined && message.id !== null) byId[message.id] = message;
  }
  return calls.map((call, index) => {
    const message = byId[100 + index];
    if (!message || !message.result || !Array.isArray(message.result.content)) {
      throw new Error(`no result for ${call.name}`);
    }
    return JSON.parse(message.result.content[0].text);
  });
}

// --- Fixtures -----------------------------------------------------------------

function patchCustomSchema() {
  const base = JSON.parse(fs.readFileSync(path.join(WORK, 'argo', 'schema', 'SystemArchitecture.schema.json'), 'utf8'));
  base.$defs.archimateElementType.enum = ['Team Node', 'Service Node'];
  base.$defs.archimateRelationshipType.enum = ['Depends On'];
  const dir = path.join(WS_CUSTOM, '.argo', 'schema');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SystemArchitecture.schema.json'), JSON.stringify(base, null, 2));
  fs.writeFileSync(path.join(dir, 'schema-bundle.config.json'), JSON.stringify({
    language: 'TeamA Ontology',
    actorElementType: 'Team Node',
    invariants: { statementGrammar: true, endpointMatrix: false, rootViewName: 'SystemArchitecture', maxElementsPerView: 15 },
  }, null, 2));

  const graph = {
    name: 'TeamA',
    description: 'TeamA custom-schema graph',
    elements: [
      { id: 'team-a', name: 'Team A', type: 'Team Node' },
      { id: 'svc-a', name: 'Service A', type: 'Service Node' },
    ],
    relationships: [
      { id: 'rel-a', name: 'Team A depends on Service A', type: 'Depends On', source_id: 'team-a', target_id: 'svc-a', source_name: 'Team A', target_name: 'Service A', statement: 'Team A --(Depends On)--> Service A' },
    ],
    views: [
      { view_id: 'view-root', view_name: 'SystemArchitecture', included_elements: ['team-a', 'svc-a'], included_relationships: ['rel-a'] },
    ],
  };
  const graphDir = path.join(WS_CUSTOM, 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.writeFileSync(path.join(graphDir, 'SystemArchitecture.json'), JSON.stringify(graph, null, 2));
}

function writeDefaultWorkspace() {
  const graphDir = path.join(WS_DEFAULT, 'design', 'KG');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.copyFileSync(
    path.join(WORK, 'argo', 'defaults', 'design', 'KG', 'SystemArchitecture.json'),
    path.join(graphDir, 'SystemArchitecture.json'),
  );
}

// --- Main ---------------------------------------------------------------------

function main() {
  const container = {
    node: String(run('node', ['--version']).stdout || '').trim(),
    opencode: String(run('opencode', ['--version']).stdout || '').trim(),
    host: `${os.platform()} ${os.release()}`,
  };

  record('copy repo to /work (code subset only; no node_modules/.git/.venv/.qea/.env)', () => {
    // tar with an explicit subset + exclude -- never read the ACL-restricted
    // argo/.env (it must not be deployed anyway).
    mustRun('sh', ['-c', `rm -rf ${WORK} && mkdir -p ${WORK} && cd /repo && tar --exclude=argo/.env -cf - argo tests scripts design docs dsh-argo-wakeup dsh-argo-workspace custom-schema install-argo.ps1 cordis.patch.yml package.json vendor | tar -xf - -C ${WORK}`]);
    if (!fs.existsSync(path.join(WORK, 'argo', 'scripts', 'schema-bundle.js'))) {
      throw new Error('schema-bundle.js missing from the copied repo (branch not mounted?)');
    }
    return { work: WORK };
  });

  record('install toolchain to ~/.argo (argo-deploy layout) + vendored neo4j-driver', () => {
    mustRun('sh', ['-c', `rm -rf ${ARGO} && mkdir -p ${ARGO} && cp -r ${WORK}/argo/. ${ARGO}/`]);
    const vendor = path.join(WORK, 'vendor', 'neo4j-driver-6.2.0.tgz');
    if (!fs.existsSync(vendor)) {
      throw new Error('vendored neo4j-driver tarball missing');
    }
    mustRun('npm', ['install', '--no-audit', '--no-fund', '--no-save', vendor], { cwd: ARGO });
    if (!fs.existsSync(path.join(ARGO, 'node_modules', 'neo4j-driver'))) {
      throw new Error('neo4j-driver did not install');
    }
    return { argoRoot: ARGO };
  });

  const testEnv = { ...process.env, NODE_PATH: path.join(ARGO, 'node_modules'), ARGO_REPO_ROOT: WORK };

  record('acceptance: schema-bundle tests + MCP/graph-semantics regressions', () => {
    const files = [
      'tests/schema-bundle.test.js',
      'tests/argo-mcp-tools.test.js',
      'tests/neo4j-cypher-query.test.js',
      'tests/mcp-interface-behavior.test.js',
      'tests/default-project-manager-actor.test.js',
      'tests/dsh-plugin-single-source.test.js',
      'tests/argo-rules-critical-reasoning.test.js',
    ];
    const result = run('node', ['--test', ...files], { cwd: WORK, env: testEnv });
    const tail = String(result.stdout || '').split(/\r?\n/).filter((l) => /tests \d|pass \d|fail \d|skipped \d/.test(l)).join(' | ');
    if (result.status !== 0) {
      throw new Error(`tests failed (exit ${result.status}). ${tail}\n${String(result.stderr || '').slice(0, 1200)}`);
    }
    return tail;
  });

  record('deployed MCP validates a workspace with its own .argo/schema (custom ontology)', () => {
    patchCustomSchema();
    const server = path.join(ARGO, 'scripts', 'argo-mcp-server.js');
    const [schema, validate] = mcpCall(server, [
      { name: 'queryNeo4jGraph', arguments: { schema: true, workspaceRoot: WS_CUSTOM } },
      { name: 'validateSystemArchitecture', arguments: { workspaceRoot: WS_CUSTOM } },
    ], { ARGO_REPO_ROOT: WS_CUSTOM, NODE_PATH: path.join(ARGO, 'node_modules') });
    const enums = (schema.schema && schema.schema.archimateElementTypes) || [];
    if (schema.schema.schemaKind !== 'workspace') throw new Error(`expected schemaKind=workspace, got ${schema.schema.schemaKind}`);
    if (schema.schema.schemaLanguage !== 'TeamA Ontology') throw new Error(`expected TeamA Ontology, got ${schema.schema.schemaLanguage}`);
    if (!(enums.includes('Team Node') && enums.includes('Service Node')) || enums.includes('Business Actor')) {
      throw new Error(`custom enums not in effect: ${JSON.stringify(enums)}`);
    }
    if (schema.schema.actorElementType !== 'Team Node') throw new Error(`expected actorElementType=Team Node, got ${schema.schema.actorElementType}`);
    if (!schema.schema.bundleValidation || schema.schema.bundleValidation.status !== 'passed') {
      throw new Error(`bundle validation not passed: ${JSON.stringify(schema.schema.bundleValidation)}`);
    }
    if (validate.status !== 'passed') throw new Error(`validate status=${validate.status}: ${JSON.stringify(validate).slice(0, 500)}`);
    return { schemaKind: schema.schema.schemaKind, language: schema.schema.schemaLanguage, elementTypes: enums, actorElementType: schema.schema.actorElementType, bundleValidation: schema.schema.bundleValidation.status, validate: validate.status };
  });

  record('deployed MCP falls back to the default ArchiMate 3.2 schema (no .argo/schema)', () => {
    writeDefaultWorkspace();
    const server = path.join(ARGO, 'scripts', 'argo-mcp-server.js');
    const [schema] = mcpCall(server, [
      { name: 'queryNeo4jGraph', arguments: { schema: true, workspaceRoot: WS_DEFAULT } },
    ], { ARGO_REPO_ROOT: WS_DEFAULT, NODE_PATH: path.join(ARGO, 'node_modules') });
    const enums = (schema.schema && schema.schema.archimateElementTypes) || [];
    if (schema.schema.schemaKind !== 'default') throw new Error(`expected schemaKind=default, got ${schema.schema.schemaKind}`);
    if (enums.length !== 64 || !enums.includes('Business Actor')) throw new Error(`default enums wrong: ${enums.length}`);
    return { schemaKind: schema.schema.schemaKind, language: schema.schema.schemaLanguage, elementTypeCount: enums.length };
  });

  record('deployed MCP loads the shipped custom-schema example (Team Graph) end-to-end', () => {
    const server = path.join(ARGO, 'scripts', 'argo-mcp-server.js');
    const exampleWorkspace = path.join(WORK, 'custom-schema');
    const [schema, validate] = mcpCall(server, [
      { name: 'queryNeo4jGraph', arguments: { schema: true, workspaceRoot: exampleWorkspace } },
      { name: 'validateSystemArchitecture', arguments: { workspaceRoot: exampleWorkspace } },
    ], { ARGO_REPO_ROOT: exampleWorkspace, NODE_PATH: path.join(ARGO, 'node_modules') });
    if (schema.schema.schemaKind !== 'workspace') throw new Error(`expected schemaKind=workspace, got ${schema.schema.schemaKind}`);
    if (schema.schema.schemaLanguage !== 'Team Graph') throw new Error(`expected Team Graph, got ${schema.schema.schemaLanguage}`);
    if (schema.schema.actorElementType !== 'Agent Node') throw new Error(`expected actorElementType=Agent Node, got ${schema.schema.actorElementType}`);
    if (!schema.schema.bundleValidation || schema.schema.bundleValidation.status !== 'passed') {
      throw new Error(`bundle validation not passed: ${JSON.stringify(schema.schema.bundleValidation)}`);
    }
    if (validate.status !== 'passed') throw new Error(`validate status=${validate.status}: ${JSON.stringify(validate).slice(0, 400)}`);
    return { language: schema.schema.schemaLanguage, actorElementType: schema.schema.actorElementType, bundleValidation: schema.schema.bundleValidation.status, validate: validate.status };
  });

  record('OpenCode runtime loads the deployed ARGO MCP server', () => {
    const cfgDir = path.join(HOME, '.config', 'opencode');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'opencode.json'), JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        argo: {
          type: 'local',
          command: ['node', path.join(ARGO, 'scripts', 'argo-mcp-server.js')],
          enabled: true,
          environment: { ARGO_REPO_ROOT: WS_CUSTOM },
        },
      },
    }, null, 2));
    const result = run('opencode', ['mcp', 'list'], {
      cwd: WS_CUSTOM,
      env: { ...process.env, ARGO_REPO_ROOT: WS_CUSTOM },
      timeout: 90000,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (result.error) throw new Error(`opencode mcp list did not finish: ${result.error.message}\n${output.slice(0, 1200)}`);
    if (result.status !== 0) throw new Error(`opencode mcp list exited ${result.status}: ${output.slice(0, 1000)}`);
    if (!/argo/i.test(output)) throw new Error(`opencode did not report the argo MCP server: ${output.slice(0, 1000)}`);
    if (/fail|error/i.test(output)) throw new Error(`opencode reported an MCP error: ${output.slice(0, 1000)}`);
    return { output: output.trim().slice(0, 600) };
  });

  const failed = steps.filter((s) => s.status === 'failed');
  const report = {
    status: failed.length === 0 ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    container,
    passed: steps.length - failed.length,
    total: steps.length,
    steps,
  };
  try {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch (error) {
    console.log(`[warn] could not write report: ${error.message}`);
  }
  console.log(`\n${report.passed}/${report.total} checks passed -> ${REPORT_PATH}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
