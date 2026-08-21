const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { AsyncLocalStorage } = require('node:async_hooks');

const validatorMcp = require('./validator-mcp-server.js');
const systemArchitectureMcp = require('./systemarchitecture-mcp-server.js');
const {
  semanticOperatorErrorResult,
} = require('./graph-rag/semanticOperatorError.js');
const {
  runCanonicalSemanticInit,
} = require('./graph-rag/semanticOperatorJourney.js');
const {
  loadRepositoryArgoEnvironment,
} = require('./repositoryArgoEnvironment.js');
const {
  getWorkspaceRoot,
  hasStaticWorkspace,
  resolveArgoPath,
  resolveCallWorkspaceRoot,
  setMcpWorkspaceRoots,
} = require('./argo-paths.js');
const canonicalSemanticInitStorage = new AsyncLocalStorage();

const HANDOFF_FILES_TO_RESET = [
  ['.argo', 'temp', 'IntentToImplementationHandoff.json'],
  ['.argo', 'temp', 'ImplementationToCodingHandoff.json'],
];
const WORKSPACE_GRAPH_PATH_SEGMENTS = ['design', 'KG', 'SystemArchitecture.json'];
const BUNDLED_GRAPH_DEFAULT_SEGMENTS = ['defaults', 'design', 'KG', 'SystemArchitecture.json'];
const BUNDLED_EA_TEMPLATE_SEGMENTS = ['defaults', 'EA-model-template.feap'];
const EA_TEMPLATE_PATH_CANDIDATES = [
  ['.opencode', 'customtools', 'EA-model-template.feap'],
  ['.opencode', 'EA-model-template.feap'],
  ['eatool', 'EA-model-template.feap'],
  ['EA-model-template.feap'],
  ['Argo.feap'],
];
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

const VALIDATOR_TOOL_NAMES = new Set([
  'validateSystemArchitecture',
  'validateStageHandoff',
  'validateTraceProposal',
  'runArchitectureTests',
]);
const SYSTEM_ARCHITECTURE_TOOL_NAMES = new Set([
  'getSystemArchitecture',
  'getIntentElementContext',
  'getArchitectureViewContext',
  'previewSystemArchitectureMutation',
  'applySystemArchitectureMutation',
  'addArchitectureElement',
  'updateArchitectureElement',
  'removeArchitectureElement',
  'addArchitectureRelationship',
  'updateArchitectureRelationship',
  'removeArchitectureRelationship',
  'addArchitectureView',
  'updateArchitectureView',
  'removeArchitectureView',
  'generateArchitectureDiffPlantuml',
]);

const TOOLS = [
  {
    name: 'initializeWorkspace',
    description: 'Bootstrap an Argo workspace by copying the EA template target and resetting stage handoff artifacts.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'validateStageHandoff',
    description: 'Validate Argo stage handoff JSON. Use stage intent-to-implementation or implementation-to-coding, or omit to validate all supported stages.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['intent-to-implementation', 'implementation-to-coding'],
          description: 'Optional handoff stage to validate.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'validateTraceProposal',
    description: 'Validate ImplementationToIntentTraceProposal JSON against .argo/schema/ImplementationToIntentTraceProposal.schema.json and repository path references.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalPath: {
          type: 'string',
          description: 'Optional proposal path relative to workspace root. Default: design/KG/ImplementationToIntentTraceProposal.json',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'runArchitectureTests',
    description: 'Execute explicit architecture testcases from the intent graph and refresh design/KG/test-failure-records.json. This MCP call can exceed client timeouts; if it times out, run the same test runner directly with: node .argo/scripts/runArchitectureTests.js',
    inputSchema: {
      type: 'object',
      properties: {
        architecturePath: {
          type: 'string',
          description: 'Optional architecture graph path relative to workspace root. Default: design/KG/SystemArchitecture.json',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'generateArchitectureDiffPlantuml',
    description: 'Generate a timestamped PlantUML Markdown tree for current git diff changes in SystemArchitecture.json. The tool compares HEAD and working tree, extracts changed elements/relationships, and writes to .argo/temp/architecture_analysis/.',
    inputSchema: {
      type: 'object',
      properties: {
        architecturePath: {
          type: 'string',
          description: 'Optional architecture graph path relative to workspace root. Default: design/KG/SystemArchitecture.json',
        },
        outputDir: {
          type: 'string',
          description: 'Optional output directory relative to workspace root. Default: .argo/temp/architecture_analysis',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'getSystemArchitecture',
    description: 'Start here, but prefer an explicit semantic query instead of an omitted-query full graph read. Provide query.purpose and query.intent to get a compact business/architecture result, then use returned element ids with getIntentElementContext for focused dependency context. Omit query only when an exact full canonical snapshot is explicitly required.',
    inputSchema: {
      type: 'object',
      properties: {
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
        query: {
          type: 'object',
          description: 'Preferred for ordinary agent reading. Use semantic query instead of full graph reads; combine the returned element ids with getIntentElementContext when deeper local context is needed.',
          properties: {
            purpose: {
              type: 'string',
              enum: ['intent-decision', 'implementation-design', 'coding-repair', 'audit', 'graph-tidy'],
              description: 'Declared reading purpose. Use intent-decision, implementation-design, coding-repair, or audit for semantic retrieval; graph-tidy intentionally bypasses semantic retrieval and may return a full snapshot.',
            },
            intent: { type: 'string', description: 'Natural-language intent for semantic retrieval, for example "summarize business features for high-risk audit".' },
            subject: { type: 'string', description: 'Required for audit; optional anchor/focus id for other semantic purposes.' },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
    outputSchema: systemArchitectureMcp.GET_SYSTEM_ARCHITECTURE_OUTPUT_SCHEMA,
  },
  {
    name: 'getIntentElementContext',
    description: 'read-only query that returns an intent subgraph context for one element. Uses ArchiMate semantic dependency traversal with dependencyDepth and dependentDepth, preserving native subgraph elements, relationships, and views.',
    inputSchema: intentElementContextInputSchema(),
  },
  {
    name: 'previewSystemArchitectureMutation',
    description: 'Use before apply for complex or risky changes. Performs a dry-run of one or more mutations, runs schema, graph, view, and ArchiMate 3.2 validation, and does not write the graph.',
    inputSchema: mutationInputSchema(),
  },
  {
    name: 'applySystemArchitectureMutation',
    description: 'Use for multi-step or dependent graph changes that should be validated and written atomically. Prefer focused tools for a single simple add, update, or remove operation.',
    inputSchema: mutationInputSchema(),
  },
  {
    name: 'addArchitectureElement',
    description: 'Use for one element. Creates a new element or adds an existing element to view_ids. view_ids is required so elements never exist outside views.',
    inputSchema: {
      type: 'object',
      required: ['element', 'view_ids'],
      properties: {
        element: { type: 'object' },
        view_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'updateArchitectureElement',
    description: 'Use for one global element metadata patch. Does not change view membership. Element id and type are immutable; remove and re-add to change them.',
    inputSchema: {
      type: 'object',
      required: ['id', 'patch'],
      properties: {
        id: { type: 'string' },
        patch: { type: 'object' },
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'removeArchitectureElement',
    description: 'Use for one element removal. With view_ids, removes only from those views and cascades related relationships in the same views; without view_ids, removes from all views and the graph.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        view_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'addArchitectureRelationship',
    description: 'Use for one relationship. Creates a new relationship or adds an existing relationship to view_ids. relationship.type is the ArchiMate 3.2 relationship type and is validated against endpoint element types.',
    inputSchema: {
      type: 'object',
      required: ['relationship', 'view_ids'],
      properties: {
        relationship: { type: 'object' },
        view_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'updateArchitectureRelationship',
    description: 'Use for one global relationship metadata patch, such as name, statement, source_name, or target_name. Relationship id and type are immutable; remove and re-add to change them.',
    inputSchema: {
      type: 'object',
      required: ['id', 'patch'],
      properties: {
        id: { type: 'string' },
        patch: { type: 'object' },
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'removeArchitectureRelationship',
    description: 'Use for one relationship removal. With view_ids, removes only from those views; without view_ids, removes from all views and deletes it from the graph.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        view_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'addArchitectureView',
    description: 'Use for one view. The graph must have exactly one top-level view named SystemArchitecture; all sub-views must attach to an element with parent_element_id.',
    inputSchema: {
      type: 'object',
      required: ['view'],
      properties: {
        view: { type: 'object' },
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'updateArchitectureView',
    description: 'Use for one view metadata or membership patch. Keep the one top-level view named SystemArchitecture and attach sub-views to parent elements.',
    inputSchema: {
      type: 'object',
      required: ['view_id', 'patch'],
      properties: {
        view_id: { type: 'string' },
        patch: { type: 'object' },
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'removeArchitectureView',
    description: 'Use for one view removal. After removal, every remaining element and relationship must still belong to at least one view.',
    inputSchema: {
      type: 'object',
      required: ['view_id'],
      properties: {
        view_id: { type: 'string' },
        architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      },
      additionalProperties: false,
    },
  },
];

// Every tool accepts an optional per-call `workspaceRoot` (absolute path,
// honored unconditionally when provided). The DeepSeek Harness bridge injects
// the current session's workspace directory here automatically.
// (tools/list dedupes with systemArchitectureMcp/validatorMcp tools, which
// carry the same field; this covers the local-only rows like initializeWorkspace.)
const WORKSPACE_ROOT_PARAM = Object.freeze({
  type: 'string',
  description:
    'Optional absolute workspace root for this call. When provided it is used as-is; otherwise the server launch directory is used.',
});
for (const tool of TOOLS) {
  const inputSchema = tool && tool.inputSchema;
  if (inputSchema && inputSchema.type === 'object' && inputSchema.properties) {
    if (!Object.prototype.hasOwnProperty.call(inputSchema.properties, 'workspaceRoot')) {
      inputSchema.properties.workspaceRoot = WORKSPACE_ROOT_PARAM;
    }
  }
}

function intentElementContextInputSchema() {
  return {
    type: 'object',
    properties: {
      architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      elementId: { type: 'string' },
      elementName: { type: 'string' },
      profile: {
        type: 'string',
        enum: ['implementation-design', 'coding-repair', 'audit', 'generic-agent'],
        description: 'Default: generic-agent. Affects workContext enrichment only; subgraph shape stays native.',
      },
      dependencyDepth: { type: 'number', description: 'Default: 2. Semantic dependencies needed by the focus element.' },
      dependentDepth: { type: 'number', description: 'Default: 1. Semantic dependents that rely on the focus element.' },
      associationDepth: { type: 'number', description: 'Default: 1. Association neighbors are expanded at least one layer.' },
      associationNeighborDependencyDepth: { type: 'number', description: 'Default: 0. Optional dependency expansion from association neighbors.' },
    },
    additionalProperties: false,
  };
}

function mutationInputSchema() {
  return {
    type: 'object',
    required: ['mutations'],
    properties: {
      architecturePath: { type: 'string', description: 'Default: design/KG/SystemArchitecture.json' },
      mutations: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: [
                'addElement',
                'updateElement',
                'removeElement',
                'addRelationship',
                'updateRelationship',
                'removeRelationship',
                'addView',
                'updateView',
                'removeView',
              ],
            },
            element: { type: 'object' },
            relationship: { type: 'object' },
            view: { type: 'object' },
            id: { type: 'string' },
            patch: { type: 'object' },
            view_id: { type: 'string' },
            view_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
            element_ids: { type: 'array', items: { type: 'string' } },
            relationship_ids: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  };
}

function resolveWorkspaceRoot() {
  return getWorkspaceRoot();
}

function resolveWorkspaceRoot(args) {
  // Per-call workspaceRoot override, honored unconditionally when provided;
  // defaults to the launch-directory root.
  return resolveCallWorkspaceRoot(args);
}

async function callTool(name, args = {}, progressToken = null, dependencies = undefined) {
  loadRepositoryArgoEnvironment(resolveWorkspaceRoot(args));
  if (name === 'initializeWorkspace') {
    const workspace = await initializeWorkspace(resolveWorkspaceRoot(args));
    const composition = canonicalSemanticInitStorage.getStore()
      || systemArchitectureMcp.createDefaultCanonicalSemanticInitComposition({
        repositoryRoot: resolveWorkspaceRoot(args),
      });
    const semanticLifecycle = await runCanonicalSemanticInit(composition, {
      repositoryRoot: resolveWorkspaceRoot(args),
      workspace,
    });
    return toolResult({
      ...workspace,
      semanticState: semanticLifecycle.state,
      semanticLifecycle,
      alignment: semanticLifecycle.alignment,
    });
  }
  if (VALIDATOR_TOOL_NAMES.has(name)) {
    return validatorMcp.callTool(name, args, progressToken);
  }
  if (SYSTEM_ARCHITECTURE_TOOL_NAMES.has(name)) {
    return systemArchitectureMcp.callTool(name, args, dependencies);
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function withCanonicalSemanticInitTestComposition(composition, callback) {
  if (!composition || typeof callback !== 'function') {
    throw new TypeError('Canonical semantic init composition and callback are required');
  }
  return canonicalSemanticInitStorage.run(Object.freeze({ ...composition }), callback);
}

async function initializeWorkspace(workspaceRoot) {
  const workspaceName = path.basename(workspaceRoot);
  const createdFiles = [];
  const updatedFiles = [];
  const removedFiles = [];
  const skippedSteps = [];

  const graphTargetPath = path.join(workspaceRoot, ...WORKSPACE_GRAPH_PATH_SEGMENTS);
  const graphRelativePath = normalizeRelativePath(path.relative(workspaceRoot, graphTargetPath));
  if (!fs.existsSync(graphTargetPath)) {
    const graphSourcePath = resolveGraphDefaultSourcePath();
    await fs.promises.mkdir(path.dirname(graphTargetPath), { recursive: true });
    await fs.promises.copyFile(graphSourcePath, graphTargetPath);
    createdFiles.push(graphRelativePath);
  } else {
    skippedSteps.push(`${graphRelativePath} already exists`);
  }

  const templateSourcePath = resolveTemplateSourcePath(workspaceRoot);
  const targetFeapName = buildTargetFileName(workspaceName);
  const targetFeapPath = path.join(workspaceRoot, targetFeapName);
  if (!fs.existsSync(targetFeapPath)) {
    await fs.promises.copyFile(templateSourcePath, targetFeapPath);
    createdFiles.push(normalizeRelativePath(targetFeapName));
  } else {
    skippedSteps.push(`${normalizeRelativePath(targetFeapName)} already exists`);
  }

  for (const handoffPath of HANDOFF_FILES_TO_RESET) {
    const absolutePath = path.join(workspaceRoot, ...handoffPath);
    if (fs.existsSync(absolutePath)) {
      await fs.promises.rm(absolutePath, { force: true });
      removedFiles.push(normalizeRelativePath(path.relative(workspaceRoot, absolutePath)));
    }
  }

  return {
    workspaceRoot,
    targetFeapName,
    createdFiles,
    updatedFiles,
    removedFiles,
    skippedSteps,
    status: 'ok',
  };
}

function resolveTemplateSourcePath(workspaceRoot) {
  for (const candidate of EA_TEMPLATE_PATH_CANDIDATES) {
    const absolutePath = path.join(workspaceRoot, ...candidate);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  const bundledPath = resolveArgoPath(...BUNDLED_EA_TEMPLATE_SEGMENTS);
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  throw new Error(`Unable to locate EA template. Checked: ${EA_TEMPLATE_PATH_CANDIDATES.map(candidate => candidate.join('/')).join(', ')}, and bundled ${BUNDLED_EA_TEMPLATE_SEGMENTS.join('/')}`);
}

function resolveGraphDefaultSourcePath() {
  const bundledPath = resolveArgoPath(...BUNDLED_GRAPH_DEFAULT_SEGMENTS);
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  throw new Error(`Unable to locate default SystemArchitecture template. Checked: bundled ${BUNDLED_GRAPH_DEFAULT_SEGMENTS.join('/')}`);
}

function buildTargetFileName(workspaceName) {
  const sanitized = sanitizeFileName(workspaceName) || 'workspace';
  const safeBaseName = WINDOWS_RESERVED_NAMES.has(sanitized.toUpperCase())
    ? `${sanitized}_workspace`
    : sanitized;
  return `${safeBaseName}.feap`;
}

function sanitizeFileName(value) {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[.\s]+$/g, '')
    .trim();
}

function normalizeRelativePath(value) {
  return String(value).replace(/\\/g, '/');
}

function toolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError: payload.status === 'failed',
  };
}

function canonicalInitErrorResult(error) {
  const result = semanticOperatorErrorResult(error);
  if (error.safeSemanticLifecycleMessage !== true) return result;
  const payload = Object.freeze({
    status: 'failed',
    error: Object.freeze({
      ...result.error,
      message: error.message,
    }),
  });
  return Object.freeze({
    ...result,
    ...payload,
    content: Object.freeze([
      Object.freeze({
        type: 'text',
        text: JSON.stringify(payload),
      }),
    ]),
  });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let rootRequestSeq = 0;
let rootRequestInFlight = false;
let rootRequestTimer = null;
let rootsSettled = false;
const pendingRootRequests = new Map();
const deferredToolCalls = [];

function flushDeferredToolCalls() {
  const pending = deferredToolCalls.splice(0);
  for (const request of pending) {
    void (async () => {
      const response = await handleRequest(request);
      if (response) {
        send(response);
      }
    })();
  }
}

function settleRoots() {
  if (rootsSettled) {
    return;
  }
  rootsSettled = true;
  if (rootRequestTimer) {
    clearTimeout(rootRequestTimer);
    rootRequestTimer = null;
  }
  rootRequestInFlight = false;
  pendingRootRequests.clear();
  flushDeferredToolCalls();
}

function requestRoots() {
  if (rootRequestInFlight || rootsSettled) {
    return;
  }
  rootRequestInFlight = true;
  const id = `argo-roots-${++rootRequestSeq}`;
  rootRequestTimer = setTimeout(() => {
    rootRequestTimer = null;
    rootRequestInFlight = false;
    settleRoots();
  }, 8000);
  pendingRootRequests.set(id, (result) => {
    if (result && Array.isArray(result.roots)) {
      setMcpWorkspaceRoots(result.roots);
    }
    settleRoots();
  });
  send({ jsonrpc: '2.0', id, method: 'roots/list', params: {} });
}

async function handleRequest(request, dependencies = undefined) {
  const { id, method, params } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, roots: { listChanged: true } },
        serverInfo: {
          name: 'argo',
          version: '1.0.0',
        },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'notifications/roots/list_changed') {
    setMcpWorkspaceRoots(params && params.roots);
    if (params && Array.isArray(params.roots) && params.roots.length > 0) {
      settleRoots();
    }
    return null;
  }

  if (method === 'tools/list') {
    // Deduplicate tools by name — last writer wins.
    // Priority order: validatorMcp > systemArchitectureMcp > local TOOLS.
    // This ensures zero duplicate tool names in the response, which would
    // cause VS Code's MCP client to silently drop tools.
    const toolMap = new Map();
    for (const tool of [...TOOLS, ...systemArchitectureMcp.TOOLS, ...validatorMcp.TOOLS]) {
      toolMap.set(tool.name, tool);
    }
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: [...toolMap.values()] },
    };
  }

  if (method === 'tools/call') {
    try {
      const progressToken = (params._meta && params._meta.progressToken) || null;
      let activeDependencies = dependencies;
      if (
        !activeDependencies
        && params.name === 'getSystemArchitecture'
        && params.arguments
        && Object.prototype.hasOwnProperty.call(params.arguments, 'query')
        && params.arguments.query
        && params.arguments.query.purpose !== 'graph-tidy'
      ) {
        activeDependencies = {
          semanticOperatorJourney:
            await systemArchitectureMcp.createDefaultProductionSemanticOperatorJourney({
              repositoryRoot: resolveWorkspaceRoot(params.arguments),
            }),
        };
      }
      const result = await callTool(
        params.name,
        params.arguments || {},
        progressToken,
        activeDependencies,
      );
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: params.name === 'initializeWorkspace'
          ? canonicalInitErrorResult(error)
          : semanticOperatorErrorResult(error),
      };
    }
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }

    // A JSON-RPC message without a `method` is a response to a server-sent request.
    if (typeof request.method === 'undefined' && request.id !== undefined) {
      const resolver = pendingRootRequests.get(request.id);
      if (resolver) {
        pendingRootRequests.delete(request.id);
        resolver(request.result);
      }
      continue;
    }

    // Workspace-dependent tool calls must wait for roots so the global server
    // targets the current workspace instead of the home directory.
    if (request.method === 'tools/call' && !hasStaticWorkspace() && !rootsSettled) {
      deferredToolCalls.push(request);
      continue;
    }

    const response = await handleRequest(request);
    if (response) {
      send(response);
    }
    if ((request.method === 'initialize' || request.method === 'notifications/initialized')
      && !hasStaticWorkspace()) {
      requestRoots();
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  callTool,
  handleRequest,
  initializeWorkspace,
  main,
  withCanonicalSemanticInitTestComposition,
};
