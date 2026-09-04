const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const argoMcp = require('./argo-mcp-server.js');
const systemArchitectureMcp = require('./systemarchitecture-mcp-server.js');
const {
  runCanonicalSemanticInit,
} = require('./graph-rag/semanticOperatorJourney.js');
const {
  DEFAULT_GRAPH_PATH,
  createDriver,
  ensureDatabaseExists,
  getNeo4jConfig,
  getNeo4jGraphSyncState,
  syncArchitectureToNeo4j,
  verifyArchitectureSync,
} = require('./neo4j-system-architecture-store.js');
const {
  loadRepositoryArgoEnvironment,
} = require('./repositoryArgoEnvironment.js');
const {
  getWorkspaceRoot,
  resolveArgoPath,
} = require('./argo-paths.js');
const {
  repairSubdiagramViews,
} = require('./repair-subdiagram-views.js');

const REQUIRED_TOOL_NAMES = [
  'getSystemArchitecture',
  'applySystemArchitectureMutation',
  'validateSystemArchitecture',
];

// Build the deterministic argo-init harness report (Neo4j structural sync,
// semantic lifecycle, canonical validation, subdiagram_views consistency).
// `includeBootstrap` is true for the standalone CLI (it calls initializeWorkspace
// to bootstrap the workspace); the initializeWorkspace MCP tool passes false
// because it already bootstrapped — avoids re-entrancy through ensureWorkspaceBootstrap.
async function buildHarnessReport({ checkOnly = false, workspaceRoot, includeBootstrap = true }) {
  const reportPath = path.join(workspaceRoot, '.argo', 'temp', 'argo-harness-init-report.json');
  const report = {
    status: 'ok',
    workspaceRoot,
    generatedAt: new Date().toISOString(),
    mode: checkOnly ? 'check-only' : 'prepare-and-check',
    reportPath: normalizeRelativePath(path.relative(workspaceRoot, reportPath)),
  };

  try {
    report.harnessEnvironment = loadRepositoryArgoEnvironment(workspaceRoot);
    if (includeBootstrap) {
      report.workspaceBootstrap = await ensureWorkspaceBootstrap({ checkOnly, workspaceRoot });
    }
    report.mcp = verifyArgoMcpServer({ workspaceRoot });
    report.systemArchitecture = await verifyCanonicalSystemArchitecture({ workspaceRoot });
    report.subdiagramViews = report.systemArchitecture.status === 'ok'
      ? await ensureSubdiagramViewsConsistency({ checkOnly, workspaceRoot })
      : {
          status: 'skipped',
          mode: checkOnly ? 'check' : 'fix-direct',
          reason: 'system architecture invalid; subdiagram_views repair skipped',
        };
    report.neo4j = await ensureNeo4jProjection({ checkOnly, workspaceRoot });
    report.semanticLifecycle = await ensureCanonicalSemanticLifecycle({
      checkOnly,
      workspaceRoot,
      neo4j: report.neo4j,
    });
  } catch (error) {
    report.status = 'failed';
    report.error = formatErrorForReport(error);
  }

  for (const section of ['workspaceBootstrap', 'mcp', 'systemArchitecture', 'neo4j', 'semanticLifecycle', 'subdiagramViews']) {
    if (report[section] && report[section].status === 'failed') {
      report.status = 'failed';
    }
  }

  writeJson(reportPath, report);
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const report = await buildHarnessReport({
    checkOnly: options.checkOnly,
    workspaceRoot,
    includeBootstrap: true,
  });
  const reportPath = path.join(workspaceRoot, '.argo', 'temp', 'argo-harness-init-report.json');
  writeJson(reportPath, report);
  console.log(JSON.stringify(report, null, 2));

  if (report.status !== 'ok') {
    process.exit(1);
  }
}

module.exports = { buildHarnessReport, main };

function parseArgs(argv) {
  const options = {
    checkOnly: false,
  };

  for (const token of argv) {
    if (token === '--check-only') {
      options.checkOnly = true;
      continue;
    }
    throw new Error(`Unsupported argument: ${token}`);
  }

  return options;
}

function resolveWorkspaceRoot() {
  return getWorkspaceRoot();
}

async function ensureWorkspaceBootstrap({ checkOnly, workspaceRoot }) {
  if (checkOnly) {
    return {
      status: 'skipped',
      reason: 'check-only',
    };
  }

  try {
    const workspace = await argoMcp.initializeWorkspace(workspaceRoot);
    return {
      status: 'ok',
      workspaceRoot: workspace.workspaceRoot,
      targetEaName: workspace.targetEaName,
      createdFiles: workspace.createdFiles,
      updatedFiles: workspace.updatedFiles,
      removedFiles: workspace.removedFiles,
      skippedSteps: workspace.skippedSteps,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: String(error && error.message ? error.message : error),
    };
  }
}

async function ensureCanonicalSemanticLifecycle({ checkOnly, workspaceRoot, neo4j }) {
  if (checkOnly) {
    return {
      status: 'skipped',
      reason: 'check-only',
      fullSnapshotFallback: false,
    };
  }

  try {
    const semanticLifecycle = await runCanonicalSemanticInit(
      systemArchitectureMcp.createDefaultCanonicalSemanticInitComposition({ repositoryRoot: workspaceRoot }),
      {
        repositoryRoot: workspaceRoot,
        neo4j,
      },
    );
    return {
      status: 'ok',
      state: semanticLifecycle.state,
      alignment: semanticLifecycle.alignment,
      readiness: semanticLifecycle.readiness,
      fullSnapshotFallback: semanticLifecycle.fullSnapshotFallback === true,
    };
  } catch (error) {
    return {
      status: 'failed',
      ...formatSemanticLifecycleError(error),
    };
  }
}

function verifyArgoMcpServer({ workspaceRoot }) {
  const serverPath = resolveArgoPath('scripts', 'argo-mcp-server.js');
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'argo-init-skill', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'ping', params: {} },
  ];
  const input = `${requests.map(entry => JSON.stringify(entry)).join('\n')}\n`;
  const result = spawnSync(process.execPath, [serverPath], {
    cwd: workspaceRoot,
    input,
    encoding: 'utf8',
  });

  if (result.error) {
    return {
      status: 'failed',
      error: String(result.error),
    };
  }
  if (result.status !== 0) {
    return {
      status: 'failed',
      error: result.stderr || `argo MCP exited with code ${result.status}`,
    };
  }

  const responses = String(result.stdout || '')
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  const initializeResponse = responses.find(entry => entry.id === 1);
  const toolsListResponse = responses.find(entry => entry.id === 2);
  const pingResponse = responses.find(entry => entry.id === 3);

  if (!initializeResponse || !toolsListResponse || !pingResponse) {
    return {
      status: 'failed',
      error: 'argo MCP did not return initialize/tools-list/ping responses as expected.',
    };
  }

  const toolNames = (toolsListResponse.result && toolsListResponse.result.tools ? toolsListResponse.result.tools : [])
    .map(tool => tool.name)
    .sort();
  const missingTools = REQUIRED_TOOL_NAMES.filter(name => !toolNames.includes(name));
  if (missingTools.length > 0) {
    return {
      status: 'failed',
      error: `argo MCP is missing required tools: ${missingTools.join(', ')}`,
      toolCount: toolNames.length,
    };
  }

  return {
    status: 'ok',
    protocolVersion: initializeResponse.result && initializeResponse.result.protocolVersion,
    serverName: initializeResponse.result && initializeResponse.result.serverInfo && initializeResponse.result.serverInfo.name,
    toolCount: toolNames.length,
    checkedTools: REQUIRED_TOOL_NAMES,
    ping: 'ok',
  };
}

async function verifyCanonicalSystemArchitecture({ workspaceRoot } = {}) {
  const graphPath = DEFAULT_GRAPH_PATH;
  let document = null;
  try {
    const raw = fs.readFileSync(path.resolve(workspaceRoot, graphPath), 'utf8');
    document = JSON.parse(raw);
  } catch (error) {
    return {
      status: 'failed',
      error: `failed to read canonical graph ${graphPath}: ${error.message}`,
    };
  }

  const validateResponse = await argoMcp.callTool('validateSystemArchitecture', {
    workspaceRoot,
    architecturePath: graphPath,
  });
  const validatePayload = parseToolPayload(validateResponse);
  if (validatePayload.status !== 'passed') {
    return {
      status: 'failed',
      graphPath,
      error: 'validateSystemArchitecture reported errors.',
      errors: validatePayload.errors || [],
    };
  }

  return {
    status: 'ok',
    graphPath,
    elementCount: Array.isArray(document.elements) ? document.elements.length : 0,
    relationshipCount: Array.isArray(document.relationships) ? document.relationships.length : 0,
    viewCount: Array.isArray(document.views) ? document.views.length : 0,
    neo4jRecovery: null,
  };
}

async function ensureSubdiagramViewsConsistency({ checkOnly, workspaceRoot }) {
  const mode = checkOnly ? 'check' : 'fix-direct';
  try {
    const result = await repairSubdiagramViews({
      workspaceRoot,
      architecturePath: DEFAULT_GRAPH_PATH,
      mode,
    });
    return {
      status: result.status,
      mode,
      graphPath: result.graphPath,
      driftCount: result.driftCount,
      fixedCount: result.fixedCount,
      written: Boolean(result.written),
      backupPath: result.backupPath || null,
      reports: result.reports || [],
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  } catch (error) {
    return {
      status: 'failed',
      mode,
      error: String(error && error.message ? error.message : error),
    };
  }
}

async function ensureNeo4jProjection({ checkOnly, workspaceRoot }) {
  const config = getNeo4jConfig({ workspaceRoot });
  const dirtyBefore = getNeo4jGraphSyncState(DEFAULT_GRAPH_PATH, workspaceRoot);
  const driver = createDriver(config);
  let databaseProvision = null;
  try {
    await driver.verifyConnectivity();
    if (!checkOnly) {
      databaseProvision = await ensureDatabaseExists(driver, config.database);
    }
  } catch (error) {
    await driver.close();
    return {
      status: 'failed',
      uri: config.uri,
      database: config.database,
      dirtyBefore,
      error: String(error && error.message ? error.message : error),
    };
  }

  await driver.close();

  let syncResult = null;
  if (!checkOnly) {
    syncResult = await syncArchitectureToNeo4j({
      architecturePath: DEFAULT_GRAPH_PATH,
      workspaceRoot,
      ...config,
    });
    databaseProvision = syncResult.databaseProvision;
  }

  const verification = await verifyArchitectureSync({
    architecturePath: DEFAULT_GRAPH_PATH,
    workspaceRoot,
    ...config,
  });
  if (!verification.matches) {
    return {
      status: 'failed',
      uri: config.uri,
      database: config.database,
      databaseProvision: verification.databaseProvision || databaseProvision,
      dirtyBefore,
      initialSync: syncResult ? syncResult.counts : null,
      verification,
    };
  }

  return {
    status: 'ok',
    uri: config.uri,
    database: config.database,
    databaseProvision: verification.databaseProvision || databaseProvision,
    dirtyBefore,
    initialSync: syncResult ? {
      graphKey: syncResult.graphKey,
      counts: syncResult.counts,
    } : null,
    verification,
  };
}

function formatSemanticLifecycleError(error) {
  const payload = error && typeof error === 'object' ? error : {};
  const category = typeof payload.category === 'string'
    ? payload.category
    : 'SEMANTIC_LIFECYCLE_INIT_FAILED';
  const action = typeof payload.action === 'string'
    ? payload.action
    : 'Repair semantic lifecycle initialization, then run argo init again.';
  const message = payload.safeSemanticLifecycleMessage === true && typeof payload.message === 'string'
    ? payload.message
    : (typeof payload.publicMessage === 'string'
      ? payload.publicMessage
      : 'Semantic lifecycle initialization failed.');
  return {
    category,
    action,
    message,
    ...(typeof payload.field === 'string' ? { field: payload.field } : {}),
  };
}

function parseToolPayload(result) {
  if (!result || !Array.isArray(result.content) || result.content.length === 0) {
    throw new Error('Unexpected MCP tool result shape.');
  }
  return JSON.parse(result.content[0].text);
}

function normalizeRelativePath(value) {
  return String(value).replace(/\\/g, '/');
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function formatErrorForReport(error) {
  let message = String(error && error.stack ? error.stack : error);
  for (const key of ['QWEN_KEY', 'ARGO_NEO4J_DATABASE_PASSWORD']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      message = message.split(value).join(`[REDACTED:${key}]`);
    }
  }
  return message;
}

if (require.main === module) {
  main().catch(error => {
    console.error(formatErrorForReport(error));
    process.exit(1);
  });
}
