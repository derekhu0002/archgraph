const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');

const DEFAULT_GRAPH_PATH = 'design/KG/SystemArchitecture.json';
const LEGAL_QUERY_PURPOSES = new Set([
  'intent-decision',
  'implementation-design',
  'coding-repair',
  'audit',
  'graph-tidy',
]);
const FORBIDDEN_RESPONSE_SHAPE_CONTROL_FIELDS = Object.freeze([
  'responseProfile',
  'detail',
  'outputMode',
]);
const FORBIDDEN_RESPONSE_SHAPE_CONTROL_VALUES = new Set([
  'debug',
  'full',
  'evidence',
]);
const FORBIDDEN_RESPONSE_SHAPE_CONTROL_FLAGS = Object.freeze([
  'debug',
  'full',
  'evidence',
]);
const GET_SYSTEM_ARCHITECTURE_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['version', 'mode', 'document', 'query', 'error'],
  properties: {
    version: {
      type: 'string',
      const: '1.0',
      description: 'Version of the typed getSystemArchitecture output contract.',
    },
    mode: {
      type: 'string',
      enum: ['full-snapshot', 'semantic-query', 'error'],
      description: 'Discriminator for the response variant.',
    },
    document: {
      type: ['object', 'null'],
      description: 'Canonical graph snapshot for full-snapshot responses; semantic business-summary responses may use result in the text payload and set this to null; null for errors.',
    },
    query: {
      type: ['object', 'null'],
      properties: {
        purpose: { type: 'string', enum: Array.from(LEGAL_QUERY_PURPOSES) },
        intent: { type: 'string' },
        subject: { type: 'string' },
        mode: { type: 'string', enum: ['full-snapshot', 'semantic-query'] },
        semanticRetrieval: { type: 'string', enum: ['bypassed', 'invoked'] },
      },
      additionalProperties: true,
      description: 'Normalized explicit query metadata; null for no-argument snapshots and errors.',
    },
    error: {
      oneOf: [
        {
          type: 'object',
          required: ['category', 'message'],
          properties: {
            category: { type: 'string' },
            message: { type: 'string' },
            action: { type: 'string' },
            fullSnapshotFallback: { type: 'boolean' },
            state: { type: ['string', 'null'] },
            canonicalVersion: { type: ['string', 'null'] },
            contentVersion: { type: ['string', 'null'] },
            indexVersion: { type: ['string', 'null'] },
            completedChannels: { type: 'array', items: { type: 'string' } },
            missingChannels: { type: 'array', items: { type: 'string' } },
            mismatchedChannels: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        { type: 'null' },
      ],
      description: 'Stable typed error details; null for successful responses.',
    },
  },
  oneOf: [
    {
      properties: {
        mode: { const: 'full-snapshot' },
        document: { type: 'object' },
        query: { type: ['object', 'null'] },
        error: { type: 'null' },
      },
    },
    {
      properties: {
        mode: { const: 'semantic-query' },
        document: { type: ['object', 'null'] },
        query: { type: 'object' },
        error: { type: 'null' },
      },
    },
    {
      properties: {
        mode: { const: 'error' },
        document: { type: 'null' },
        query: { type: 'null' },
        error: {
          type: 'object',
          required: ['category', 'message'],
        },
      },
    },
  ],
  additionalProperties: false,
};
const SCHEMA_PATH_CANDIDATES = [
  '.argo/schema/SystemArchitecture.schema.json',
];
const W31_LIVE_OPT_IN = 'ARGO_W31_LIVE_MUTATION_VECTOR_E2E';
const LIVE_PROVIDER_OPT_IN = 'ARGO_LIVE_PROVIDER_E2E';
const W31_APPROVED_PROFILE = Object.freeze({
  approvedByHuman: true,
  provider: 'alibaba-cloud-model-studio-openai-compatible-cn-beijing',
  baseUrl: 'https://llm-clids9mqc5o1mbvb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.7-text-embedding',
  version: 'qualification-2026-07-25',
  dimensions: 1024,
  source: 'explicit-human-approval',
});

const {
  validateGraphSemantics,
  validateArchiMateEndpointMatrix,
  validateViewElementLimits,
} = require('./graph-semantics.js');
const architectureDiffPlantuml = require('./generateArchitectureDiffPlantuml.js');
const {
  createProductionGraphRagRuntime,
} = require('./graph-rag/productionGraphRagRuntime.js');
const {
  createDefaultSemanticRetrieval,
} = require('./graph-rag/defaultSemanticRetrieval.js');
const {
  createProductionSemanticOperatorJourney,
} = require('./graph-rag/semanticOperatorJourney.js');
const {
  semanticOperatorErrorResult,
} = require('./graph-rag/semanticOperatorError.js');
const {
  resolveExternalProductionConfig,
} = require('./graph-rag/externalProductionConfig.js');
const {
  resolveApprovedLiveConfiguration,
} = require('./graph-rag/liveEmbeddingProviderConfig.js');
const {
  createLiveEmbeddingProviderClient,
} = require('./graph-rag/liveEmbeddingProviderClient.js');
const {
  createProductionSemanticReadinessStore,
} = require('./graph-rag/mutationEmbeddingVectorLifecycle.js');
const {
  DEFAULT_GRAPH_PATH: NEO4J_DEFAULT_GRAPH_PATH,
  recoverNeo4jSyncIfNeeded,
  syncArchitectureToNeo4j,
  verifyArchitectureSync,
} = require('./neo4j-system-architecture-store.js');

const HANDLED_MUTATION_TYPES = new Set([
  'addElement',
  'updateElement',
  'removeElement',
  'addRelationship',
  'updateRelationship',
  'removeRelationship',
  'addView',
  'updateView',
  'removeView',
]);

const TOOLS = [
  {
    name: 'getSystemArchitecture',
    description: 'Start here for read-only intent architecture access, but prefer an explicit semantic query instead of an omitted-query full graph read. Provide query.purpose and query.intent to get a compact business/architecture result, then use returned element ids with getIntentElementContext for focused dependency context. Omit query only when an exact full canonical snapshot is explicitly required.',
    inputSchema: {
      type: 'object',
      properties: {
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
        query: {
          type: 'object',
          description: 'Preferred for ordinary agent reading. Use semantic query instead of full graph reads; combine the returned element ids with getIntentElementContext when deeper local context is needed.',
          properties: {
            purpose: {
              type: 'string',
              enum: Array.from(LEGAL_QUERY_PURPOSES),
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
    outputSchema: GET_SYSTEM_ARCHITECTURE_OUTPUT_SCHEMA,
  },
  {
    name: 'getIntentElementContext',
    description: 'read-only query that returns an intent subgraph context for one element. Uses ArchiMate semantic dependency traversal with dependencyDepth and dependentDepth, preserving native subgraph elements, relationships, and views.',
    inputSchema: intentElementContextInputSchema(),
  },
  {
    name: 'generateArchitectureDiffPlantuml',
    description: 'Generate a timestamped PlantUML Markdown tree for current git diff changes in SystemArchitecture.json. The tool compares HEAD and working tree, extracts changed elements/relationships, and writes to .argo/temp/architecture_analysis/.',
    inputSchema: {
      type: 'object',
      properties: {
        architecturePath: {
          type: 'string',
          description: `Optional architecture graph path relative to workspace root. Default: ${DEFAULT_GRAPH_PATH}`,
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
    description: 'Use for one element. Creates a new element or adds an existing element to view_ids. view_ids is required so elements never exist outside views. Set dryRun to preview without writing.',
    inputSchema: {
      type: 'object',
      required: ['element', 'view_ids'],
      properties: {
        element: { type: 'object' },
        view_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
        dryRun: { type: 'boolean', description: 'When true, validates and returns the result without writing to the graph. Default: false.' },
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'updateArchitectureElement',
    description: 'Use for one global element metadata patch. Does not change view membership. Element id and type are immutable; remove and re-add to change them. Set dryRun to preview without writing.',
    inputSchema: {
      type: 'object',
      required: ['id', 'patch'],
      properties: {
        id: { type: 'string' },
        patch: { type: 'object' },
        dryRun: { type: 'boolean', description: 'When true, validates and returns the result without writing to the graph. Default: false.' },
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'removeArchitectureElement',
    description: 'Use for one element removal. With view_ids, removes only from those views and cascades related relationships in the same views; without view_ids, removes from all views and the graph. Set dryRun to preview without writing.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        view_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
        dryRun: { type: 'boolean', description: 'When true, validates and returns the result without writing to the graph. Default: false.' },
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'addArchitectureRelationship',
    description: 'Use for one relationship. Creates a new relationship or adds an existing relationship to view_ids. relationship.type is the ArchiMate 3.2 relationship type and is validated against endpoint element types. Set dryRun to preview without writing.',
    inputSchema: {
      type: 'object',
      required: ['relationship', 'view_ids'],
      properties: {
        relationship: { type: 'object' },
        view_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
        dryRun: { type: 'boolean', description: 'When true, validates and returns the result without writing to the graph. Default: false.' },
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'updateArchitectureRelationship',
    description: 'Use for one global relationship metadata patch, such as name, statement, source_name, or target_name. Relationship id and type are immutable; remove and re-add to change them. Set dryRun to preview without writing.',
    inputSchema: {
      type: 'object',
      required: ['id', 'patch'],
      properties: {
        id: { type: 'string' },
        patch: { type: 'object' },
        dryRun: { type: 'boolean', description: 'When true, validates and returns the result without writing to the graph. Default: false.' },
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'removeArchitectureRelationship',
    description: 'Use for one relationship removal. With view_ids, removes only from those views; without view_ids, removes from all views and deletes it from the graph. Set dryRun to preview without writing.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        view_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
        dryRun: { type: 'boolean', description: 'When true, validates and returns the result without writing to the graph. Default: false.' },
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'addArchitectureView',
    description: 'Use for one view. The graph must have exactly one top-level view named SystemArchitecture; all sub-views must attach to an element with parent_element_id. Set dryRun to preview without writing.',
    inputSchema: {
      type: 'object',
      required: ['view'],
      properties: {
        view: { type: 'object' },
        dryRun: { type: 'boolean', description: 'When true, validates and returns the result without writing to the graph. Default: false.' },
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'updateArchitectureView',
    description: 'Use for one view metadata or membership patch. Keep the one top-level view named SystemArchitecture and attach sub-views to parent elements. Set dryRun to preview without writing.',
    inputSchema: {
      type: 'object',
      required: ['view_id', 'patch'],
      properties: {
        view_id: { type: 'string' },
        patch: { type: 'object' },
        dryRun: { type: 'boolean', description: 'When true, validates and returns the result without writing to the graph. Default: false.' },
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'removeArchitectureView',
    description: 'Use for one view removal. After removal, every remaining element and relationship must still belong to at least one view. Set dryRun to preview without writing.',
    inputSchema: {
      type: 'object',
      required: ['view_id'],
      properties: {
        view_id: { type: 'string' },
        dryRun: { type: 'boolean', description: 'When true, validates and returns the result without writing to the graph. Default: false.' },
        architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      },
      additionalProperties: false,
    },
  },
];

function intentElementContextInputSchema() {
  return {
    type: 'object',
    properties: {
      architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
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
      architecturePath: { type: 'string', description: `Default: ${DEFAULT_GRAPH_PATH}` },
      mutations: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: Array.from(HANDLED_MUTATION_TYPES) },
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
  return process.env.ARGO_REPO_ROOT
    || process.env.WORKSPACE_FOLDER
    || path.resolve(__dirname, '..', '..');
}

function initializeWorkspace(request) {
  return require('./argo-mcp-server.js').initializeWorkspace(
    request && request.repositoryRoot ? request.repositoryRoot : resolveWorkspaceRoot(),
  );
}

async function syncCanonicalStructuralProjection(request) {
  const context = await loadContext(request);
  return syncArchitectureToNeo4j({
    architecturePath: context.graphPath.relativePath,
    document: context.document,
  });
}

function resolveWorkspacePath(workspaceRoot, relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath || DEFAULT_GRAPH_PATH);
  const absolutePath = path.resolve(workspaceRoot, normalizedPath);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (!absolutePath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }
  return { absolutePath, relativePath: normalizedPath };
}

function normalizeRelativePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveSchemaPath(workspaceRoot) {
  for (const candidate of SCHEMA_PATH_CANDIDATES) {
    const absolutePath = path.join(workspaceRoot, candidate);
    if (fs.existsSync(absolutePath)) {
      return { absolutePath, relativePath: candidate };
    }
    const bundledPath = path.resolve(__dirname, '..', '..', candidate);
    if (fs.existsSync(bundledPath)) {
      return { absolutePath: bundledPath, relativePath: candidate };
    }
  }
  throw new Error(`Unable to locate SystemArchitecture schema. Checked: ${SCHEMA_PATH_CANDIDATES.join(', ')}`);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${String(error)}`);
  }
}

async function loadContext(args = {}) {
  const workspaceRoot = resolveWorkspaceRoot();
  const graphPath = resolveWorkspacePath(workspaceRoot, args.architecturePath || DEFAULT_GRAPH_PATH);
  const schemaPath = resolveSchemaPath(workspaceRoot);
  const context = {
    workspaceRoot,
    graphPath,
    schemaPath,
    document: readJson(graphPath.absolutePath, graphPath.relativePath),
    schema: readJson(schemaPath.absolutePath, schemaPath.relativePath),
  };
  context.neo4jSyncRecovery = await recoverNeo4jSyncIfNeeded({
    architecturePath: graphPath.relativePath,
    document: context.document,
  });
  return context;
}

function validateDocument(document, schema, options = {}) {
  const errors = [];
  validateAgainstSchema(document, schema, '#', errors, schema);
  validateGraphSemantics(document, errors);
  validateArchiMateEndpointMatrix(document, errors, {
    touchedRelationshipIds: options.touchedRelationshipIds,
  });
  validateViewElementLimits(document, errors, {
    touchedViewIds: options.validateAllViewElementLimits
      ? (document.views || []).map(view => view && view.view_id)
      : options.touchedViewIds,
  });
  return errors;
}

function buildIntentElementContext(context, args = {}) {
  const profile = args.profile || 'generic-agent';
  const focusResult = resolveFocusElement(context.document, args);
  if (focusResult.status !== 'passed') {
    return focusResult;
  }

  const dependencyDepth = normalizeDepth(args.dependencyDepth, 2);
  const dependentDepth = normalizeDepth(args.dependentDepth, 1);
  const associationDepth = Math.max(1, normalizeDepth(args.associationDepth, 1));
  const associationNeighborDependencyDepth = normalizeDepth(args.associationNeighborDependencyDepth, 0);
  const graphIndex = buildGraphIndex(context.document);
  const focusElement = focusResult.element;
  const includedElementIds = new Set([focusElement.id]);
  const includedRelationshipIds = new Set();
  const dependencyDepthByElement = new Map([[focusElement.id, 0]]);
  const dependentDepthByElement = new Map([[focusElement.id, 0]]);
  const associationDepthByElement = new Map([[focusElement.id, 0]]);

  traverseSemanticContext({
    startId: focusElement.id,
    maxDepth: dependencyDepth,
    mode: 'dependency',
    graphIndex,
    includedElementIds,
    includedRelationshipIds,
    depthByElement: dependencyDepthByElement,
  });
  traverseSemanticContext({
    startId: focusElement.id,
    maxDepth: dependentDepth,
    mode: 'dependent',
    graphIndex,
    includedElementIds,
    includedRelationshipIds,
    depthByElement: dependentDepthByElement,
  });
  traverseSemanticContext({
    startId: focusElement.id,
    maxDepth: associationDepth,
    mode: 'association',
    graphIndex,
    includedElementIds,
    includedRelationshipIds,
    depthByElement: associationDepthByElement,
  });

  if (associationNeighborDependencyDepth > 0) {
    for (const [elementId, depth] of associationDepthByElement.entries()) {
      if (elementId === focusElement.id || depth < 1) {
        continue;
      }
      traverseSemanticContext({
        startId: elementId,
        maxDepth: associationNeighborDependencyDepth,
        mode: 'dependency',
        graphIndex,
        includedElementIds,
        includedRelationshipIds,
        depthByElement: new Map([[elementId, 0]]),
      });
    }
  }

  includeViewAnchors(context.document, includedElementIds, includedRelationshipIds, graphIndex);
  const boundary = buildBoundary({
    graphIndex,
    includedElementIds,
    dependencyDepthByElement,
    dependentDepthByElement,
    associationDepthByElement,
    dependencyDepth,
    dependentDepth,
    associationDepth,
  });
  const explorationHints = buildExplorationHints(boundary, {
    profile,
    dependencyDepth,
    dependentDepth,
    associationDepth,
  });

  return {
    status: 'passed',
    query: {
      architecturePath: context.graphPath.relativePath,
      elementId: focusElement.id,
      elementName: focusElement.name,
      profile,
      dependencyDepth,
      dependentDepth,
      associationDepth,
      associationNeighborDependencyDepth,
      traversalMode: 'archimate-semantic',
    },
    focusElementId: focusElement.id,
    subgraph: buildNativeSubgraph(context.document, includedElementIds, includedRelationshipIds),
    boundary,
    explorationHints,
    workContext: {},
    diagnostics: [],
  };
}

function resolveFocusElement(document, args) {
  if (args.elementId) {
    const element = (document.elements || []).find(entry => entry.id === args.elementId);
    if (!element) {
      return {
        status: 'failed',
        error: `Element '${args.elementId}' does not exist`,
        candidates: [],
      };
    }
    return { status: 'passed', element };
  }

  if (!args.elementName) {
    return {
      status: 'failed',
      error: 'elementId or elementName is required',
      candidates: [],
    };
  }

  const matches = (document.elements || []).filter(element => element.name === args.elementName);
  if (matches.length === 1) {
    return { status: 'passed', element: matches[0] };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      error: `Element name '${args.elementName}' matched multiple elements`,
      candidates: matches.map(element => ({ id: element.id, name: element.name, type: element.type })),
    };
  }
  return {
    status: 'failed',
    error: `Element name '${args.elementName}' does not exist`,
    candidates: [],
  };
}

function normalizeDepth(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return defaultValue;
  }
  return Math.floor(numericValue);
}

function buildGraphIndex(document) {
  const relationshipById = new Map();
  const elementById = new Map((document.elements || []).map(element => [element.id, element]));
  const relationshipsByElementId = new Map();
  for (const relationship of document.relationships || []) {
    relationshipById.set(relationship.id, relationship);
    addIndexedRelationship(relationshipsByElementId, relationship.source_id, relationship);
    addIndexedRelationship(relationshipsByElementId, relationship.target_id, relationship);
  }
  return { elementById, relationshipById, relationshipsByElementId };
}

function addIndexedRelationship(index, elementId, relationship) {
  if (!index.has(elementId)) {
    index.set(elementId, []);
  }
  index.get(elementId).push(relationship);
}

function traverseSemanticContext(options) {
  const {
    startId,
    maxDepth,
    mode,
    graphIndex,
    includedElementIds,
    includedRelationshipIds,
    depthByElement,
  } = options;
  if (maxDepth < 1) {
    return;
  }

  const queue = [{ elementId: startId, depth: 0 }];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.depth >= maxDepth) {
      continue;
    }
    for (const edge of resolveSemanticEdges(current.elementId, graphIndex)) {
      if (edge.kind !== mode) {
        continue;
      }
      const nextDepth = current.depth + 1;
      includedElementIds.add(edge.neighborId);
      includedRelationshipIds.add(edge.relationship.id);
      if (!depthByElement.has(edge.neighborId) || nextDepth < depthByElement.get(edge.neighborId)) {
        depthByElement.set(edge.neighborId, nextDepth);
        queue.push({ elementId: edge.neighborId, depth: nextDepth });
      }
    }
  }
}

function resolveSemanticEdges(elementId, graphIndex) {
  const edges = [];
  for (const relationship of graphIndex.relationshipsByElementId.get(elementId) || []) {
    const isSource = relationship.source_id === elementId;
    const neighborId = isSource ? relationship.target_id : relationship.source_id;
    const relationshipType = relationship.type;

    if (relationshipType === 'Association') {
      edges.push({ kind: 'association', neighborId, relationship });
      continue;
    }

    const sourceDependsOnTarget = ['Access', 'Assignment', 'Specialization', 'Composition', 'Aggregation'].includes(relationshipType);
    const targetDependsOnSource = ['Serving', 'Realization', 'Flow', 'Triggering', 'Influence'].includes(relationshipType);
    if (sourceDependsOnTarget) {
      edges.push({ kind: isSource ? 'dependency' : 'dependent', neighborId, relationship });
      continue;
    }
    if (targetDependsOnSource) {
      edges.push({ kind: isSource ? 'dependent' : 'dependency', neighborId, relationship });
    }
  }
  return edges;
}

function includeViewAnchors(document, includedElementIds, includedRelationshipIds, graphIndex) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const view of document.views || []) {
      if (!viewTouchesSubgraph(view, includedElementIds, includedRelationshipIds)) {
        continue;
      }
      if (view.parent_element_id && !includedElementIds.has(view.parent_element_id) && graphIndex.elementById.has(view.parent_element_id)) {
        includedElementIds.add(view.parent_element_id);
        changed = true;
      }
    }
    for (const elementId of Array.from(includedElementIds)) {
      const element = graphIndex.elementById.get(elementId);
      if (element && element.parent && !includedElementIds.has(element.parent) && graphIndex.elementById.has(element.parent)) {
        includedElementIds.add(element.parent);
        changed = true;
      }
    }
  }
}

function viewTouchesSubgraph(view, includedElementIds, includedRelationshipIds) {
  return (view.included_elements || []).some(elementId => includedElementIds.has(elementId))
    || (view.included_relationships || []).some(relationshipId => includedRelationshipIds.has(relationshipId));
}

function buildBoundary(options) {
  return {
    truncatedDependencies: collectTruncatedBoundary({
      ...options,
      depthByElement: mergeBoundaryDepths(options.dependencyDepthByElement, options.associationDepthByElement),
      maxDepth: options.dependencyDepth,
      kind: 'dependency',
    }),
    truncatedDependents: collectTruncatedBoundary({
      ...options,
      depthByElement: options.dependentDepthByElement,
      maxDepth: options.dependentDepth,
      kind: 'dependent',
    }),
  };
}

function mergeBoundaryDepths(primaryDepths, associationDepths) {
  const merged = new Map(primaryDepths);
  for (const [elementId, depth] of associationDepths.entries()) {
    if (!merged.has(elementId) || depth < merged.get(elementId)) {
      merged.set(elementId, depth);
    }
  }
  return merged;
}

function collectTruncatedBoundary(options) {
  const {
    graphIndex,
    includedElementIds,
    depthByElement,
    maxDepth,
    kind,
  } = options;
  const truncated = [];
  if (maxDepth < 0) {
    return truncated;
  }
  for (const [elementId, depth] of depthByElement.entries()) {
    if (depth < maxDepth && kind !== 'dependency') {
      continue;
    }
    const unexpandedEdges = resolveSemanticEdges(elementId, graphIndex).filter(edge => (
      (edge.kind === kind || (kind === 'dependency' && edge.kind === 'association'))
      && !includedElementIds.has(edge.neighborId)
    ));
    if (unexpandedEdges.length === 0) {
      continue;
    }
    const element = graphIndex.elementById.get(elementId);
    truncated.push({
      elementId,
      elementName: element ? element.name : undefined,
      direction: kind,
      remainingEdgeCount: unexpandedEdges.length,
      relationshipIds: unexpandedEdges.map(edge => edge.relationship.id),
      reason: `${kind} depth limit reached`,
    });
  }
  return truncated;
}

function buildExplorationHints(boundary, defaults) {
  const hints = [];
  for (const entry of boundary.truncatedDependencies || []) {
    hints.push({
      reason: `Element ${entry.elementId} has unexpanded dependency context`,
      suggestedTool: 'getIntentElementContext',
      suggestedArguments: {
        elementId: entry.elementId,
        profile: defaults.profile,
        dependencyDepth: Math.max(1, defaults.dependencyDepth),
        dependentDepth: 0,
        associationDepth: defaults.associationDepth,
      },
    });
  }
  for (const entry of boundary.truncatedDependents || []) {
    hints.push({
      reason: `Element ${entry.elementId} has unexpanded dependent context`,
      suggestedTool: 'getIntentElementContext',
      suggestedArguments: {
        elementId: entry.elementId,
        profile: defaults.profile,
        dependencyDepth: 0,
        dependentDepth: Math.max(1, defaults.dependentDepth),
        associationDepth: defaults.associationDepth,
      },
    });
  }
  return hints;
}

function buildNativeSubgraph(document, includedElementIds, includedRelationshipIds) {
  const elements = (document.elements || [])
    .filter(element => includedElementIds.has(element.id))
    .map(clone);
  const relationships = (document.relationships || [])
    .filter(relationship => includedRelationshipIds.has(relationship.id))
    .map(clone);
  const views = (document.views || [])
    .filter(view => viewTouchesSubgraph(view, includedElementIds, includedRelationshipIds))
    .map(view => {
      const viewCopy = clone(view);
      if (Array.isArray(viewCopy.included_elements)) {
        viewCopy.included_elements = viewCopy.included_elements.filter(elementId => includedElementIds.has(elementId));
      }
      if (Array.isArray(viewCopy.included_relationships)) {
        viewCopy.included_relationships = viewCopy.included_relationships.filter(relationshipId => includedRelationshipIds.has(relationshipId));
      }
      return viewCopy;
    });
  return { elements, relationships, views };
}

function applyMutations(document, mutations) {
  const nextDocument = clone(document);
  const touchedElementIds = new Set();
  const touchedRelationshipIds = new Set();
  const touchedViewIds = new Set();
  const viewLimitCheckIds = new Set();
  const mutationSummaries = [];

  if (!Array.isArray(mutations) || mutations.length === 0) {
    throw new Error('mutations must contain at least one mutation');
  }

  for (const mutation of mutations) {
    if (!mutation || typeof mutation !== 'object' || !HANDLED_MUTATION_TYPES.has(mutation.type)) {
      throw new Error(`Unsupported mutation type: ${mutation && mutation.type}`);
    }

    if (mutation.type === 'addElement') {
      requireObject(mutation.element, 'mutation.element');
      const scopedViews = requireViewScope(nextDocument.views, mutation.view_ids, 'mutation.view_ids');
      requireId(mutation.element.id, 'mutation.element.id');
      const existingElement = findById(nextDocument.elements, mutation.element.id);
      if (!existingElement) {
        nextDocument.elements.push(clone(mutation.element));
      }
      for (const view of scopedViews) {
        view.included_elements = addUnique(view.included_elements || [], [mutation.element.id]);
        touchedViewIds.add(view.view_id);
        viewLimitCheckIds.add(view.view_id);
      }
      touchedElementIds.add(mutation.element.id);
      mutationSummaries.push({
        type: mutation.type,
        id: mutation.element.id,
        view_ids: mutation.view_ids,
        created: !existingElement,
      });
      continue;
    }

    if (mutation.type === 'updateElement') {
      requireId(mutation.id, 'mutation.id');
      requireObject(mutation.patch, 'mutation.patch');
      const element = findById(nextDocument.elements, mutation.id);
      if (!element) {
        throw new Error(`Element '${mutation.id}' does not exist`);
      }
      requirePatchDoesNotChangeElementIdentityOrType(mutation.id, mutation.patch);
      Object.assign(element, clone(mutation.patch));
      touchedElementIds.add(element.id);
      mutationSummaries.push({ type: mutation.type, id: element.id });
      continue;
    }

    if (mutation.type === 'removeElement') {
      requireId(mutation.id, 'mutation.id');
      const element = findById(nextDocument.elements, mutation.id);
      if (!element) {
        throw new Error(`Element '${mutation.id}' does not exist`);
      }
      const scopedViews = mutation.view_ids === undefined
        ? nextDocument.views
        : requireViewScope(nextDocument.views, mutation.view_ids, 'mutation.view_ids');
      const relatedRelationshipIds = nextDocument.relationships
        .filter(relationship => relationship.source_id === mutation.id || relationship.target_id === mutation.id)
        .map(relationship => relationship.id);
      for (const view of scopedViews) {
        view.included_elements = removeEntries(view.included_elements || [], [mutation.id]);
        view.included_relationships = removeEntries(view.included_relationships || [], relatedRelationshipIds);
        touchedViewIds.add(view.view_id);
      }
      const stillIncludedInView = nextDocument.views.some(view => (
        Array.isArray(view.included_elements) && view.included_elements.includes(mutation.id)
      ));
      if (!stillIncludedInView) {
        for (const view of nextDocument.views) {
          view.included_relationships = removeEntries(view.included_relationships || [], relatedRelationshipIds);
          touchedViewIds.add(view.view_id);
        }
        nextDocument.elements = nextDocument.elements.filter(entry => entry.id !== mutation.id);
      }
      const relationshipIdsStillInViews = new Set();
      for (const view of nextDocument.views) {
        for (const relationshipId of view.included_relationships || []) {
          relationshipIdsStillInViews.add(relationshipId);
        }
      }
      nextDocument.relationships = nextDocument.relationships.filter(relationship => (
        !relatedRelationshipIds.includes(relationship.id) || relationshipIdsStillInViews.has(relationship.id)
      ));
      touchedElementIds.add(mutation.id);
      for (const relationshipId of relatedRelationshipIds) {
        touchedRelationshipIds.add(relationshipId);
      }
      mutationSummaries.push({
        type: mutation.type,
        id: mutation.id,
        view_ids: mutation.view_ids,
        removed_from_graph: !stillIncludedInView,
        removed_relationship_ids: relatedRelationshipIds.filter(relationshipId => !relationshipIdsStillInViews.has(relationshipId)),
      });
      continue;
    }

    if (mutation.type === 'addRelationship') {
      requireObject(mutation.relationship, 'mutation.relationship');
      const scopedViews = requireViewScope(nextDocument.views, mutation.view_ids, 'mutation.view_ids');
      requireId(mutation.relationship.id, 'mutation.relationship.id');
      const existingRelationship = findById(nextDocument.relationships, mutation.relationship.id);
      if (!existingRelationship) {
        nextDocument.relationships.push(clone(mutation.relationship));
      }
      for (const view of scopedViews) {
        view.included_elements = addUnique(view.included_elements || [], [
          mutation.relationship.source_id,
          mutation.relationship.target_id,
        ]);
        view.included_relationships = addUnique(view.included_relationships || [], [mutation.relationship.id]);
        touchedViewIds.add(view.view_id);
      }
      touchedRelationshipIds.add(mutation.relationship.id);
      mutationSummaries.push({
        type: mutation.type,
        id: mutation.relationship.id,
        view_ids: mutation.view_ids,
        created: !existingRelationship,
      });
      continue;
    }

    if (mutation.type === 'updateRelationship') {
      requireId(mutation.id, 'mutation.id');
      requireObject(mutation.patch, 'mutation.patch');
      const relationship = findById(nextDocument.relationships, mutation.id);
      if (!relationship) {
        throw new Error(`Relationship '${mutation.id}' does not exist`);
      }
      requirePatchDoesNotChangeRelationshipIdentityOrType(mutation.id, mutation.patch);
      Object.assign(relationship, clone(mutation.patch));
      for (const view of nextDocument.views) {
        if ((view.included_relationships || []).includes(relationship.id)) {
          view.included_elements = addUnique(view.included_elements || [], [
            relationship.source_id,
            relationship.target_id,
          ]);
        }
      }
      touchedRelationshipIds.add(relationship.id);
      mutationSummaries.push({ type: mutation.type, id: relationship.id });
      continue;
    }

    if (mutation.type === 'removeRelationship') {
      requireId(mutation.id, 'mutation.id');
      const relationship = findById(nextDocument.relationships, mutation.id);
      if (!relationship) {
        throw new Error(`Relationship '${mutation.id}' does not exist`);
      }
      const scopedViews = mutation.view_ids === undefined
        ? nextDocument.views
        : requireViewScope(nextDocument.views, mutation.view_ids, 'mutation.view_ids');
      for (const view of scopedViews) {
        view.included_relationships = removeEntries(view.included_relationships || [], [mutation.id]);
        touchedViewIds.add(view.view_id);
      }
      const stillIncludedInView = nextDocument.views.some(view => (
        Array.isArray(view.included_relationships) && view.included_relationships.includes(mutation.id)
      ));
      if (!stillIncludedInView) {
        nextDocument.relationships = nextDocument.relationships.filter(entry => entry.id !== mutation.id);
      }
      touchedRelationshipIds.add(mutation.id);
      mutationSummaries.push({
        type: mutation.type,
        id: mutation.id,
        view_ids: mutation.view_ids,
        removed_from_graph: !stillIncludedInView,
      });
      continue;
    }

    if (mutation.type === 'addView') {
      requireObject(mutation.view, 'mutation.view');
      if (findView(nextDocument.views, mutation.view.view_id)) {
        throw new Error(`View '${mutation.view.view_id}' already exists`);
      }
      nextDocument.views.push(clone(mutation.view));
      touchedViewIds.add(mutation.view.view_id);
      viewLimitCheckIds.add(mutation.view.view_id);
      mutationSummaries.push({ type: mutation.type, id: mutation.view.view_id });
      continue;
    }

    if (mutation.type === 'updateView') {
      const viewId = mutation.view_id || mutation.id;
      requireId(viewId, 'mutation.view_id');
      requireObject(mutation.patch, 'mutation.patch');
      const view = findView(nextDocument.views, viewId);
      if (!view) {
        throw new Error(`View '${viewId}' does not exist`);
      }
      Object.assign(view, clone(mutation.patch));
      touchedViewIds.add(view.view_id);
      if (Object.prototype.hasOwnProperty.call(mutation.patch, 'included_elements')) {
        viewLimitCheckIds.add(view.view_id);
      }
      mutationSummaries.push({ type: mutation.type, id: view.view_id });
      continue;
    }

    if (mutation.type === 'removeView') {
      requireId(mutation.view_id, 'mutation.view_id');
      const beforeCount = nextDocument.views.length;
      nextDocument.views = nextDocument.views.filter(view => view.view_id !== mutation.view_id);
      if (nextDocument.views.length === beforeCount) {
        throw new Error(`View '${mutation.view_id}' does not exist`);
      }
      touchedViewIds.add(mutation.view_id);
      mutationSummaries.push({ type: mutation.type, id: mutation.view_id });
      continue;
    }

  }

  return {
    document: nextDocument,
    touchedElementIds: Array.from(touchedElementIds),
    touchedRelationshipIds: Array.from(touchedRelationshipIds),
    touchedViewIds: Array.from(touchedViewIds),
    viewLimitCheckIds: Array.from(viewLimitCheckIds),
    mutationSummaries,
  };
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireId(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function requireViewScope(views, viewIds, label) {
  if (!Array.isArray(viewIds) || viewIds.length === 0) {
    throw new Error(`${label} must contain at least one view id`);
  }

  const scopedViews = [];
  const seenViewIds = new Set();
  for (const viewId of viewIds) {
    requireId(viewId, `${label}[]`);
    if (seenViewIds.has(viewId)) {
      continue;
    }
    const view = findView(views, viewId);
    if (!view) {
      throw new Error(`View '${viewId}' does not exist`);
    }
    scopedViews.push(view);
    seenViewIds.add(viewId);
  }
  return scopedViews;
}

function requirePatchDoesNotChangeElementIdentityOrType(elementId, patch) {
  if (Object.prototype.hasOwnProperty.call(patch, 'id')) {
    throw new Error(`Element '${elementId}' id cannot be updated; remove and re-add the element to change its id`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'type')) {
    throw new Error(`Element '${elementId}' type cannot be updated; remove and re-add the element to change its type`);
  }
}

function requirePatchDoesNotChangeRelationshipIdentityOrType(relationshipId, patch) {
  if (Object.prototype.hasOwnProperty.call(patch, 'id')) {
    throw new Error(`Relationship '${relationshipId}' id cannot be updated; remove and re-add the relationship to change its id`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'type')) {
    throw new Error(`Relationship '${relationshipId}' type cannot be updated; remove and re-add the relationship to change its type`);
  }
}

function findById(entries, id) {
  return Array.isArray(entries) ? entries.find(entry => entry && entry.id === id) : undefined;
}

function findView(entries, viewId) {
  return Array.isArray(entries) ? entries.find(entry => entry && entry.view_id === viewId) : undefined;
}

function addUnique(existing, additions) {
  const result = Array.isArray(existing) ? [...existing] : [];
  for (const addition of additions) {
    if (!result.includes(addition)) {
      result.push(addition);
    }
  }
  return result;
}

function removeEntries(existing, removals) {
  const removalSet = new Set(removals);
  return (Array.isArray(existing) ? existing : []).filter(entry => !removalSet.has(entry));
}

async function buildMutationResult(context, mutations, write) {
  const beforeSummary = summarizeDocument(context.document);
  let mutationResult;
  try {
    mutationResult = applyMutations(context.document, mutations);
  } catch (error) {
    const errors = [String(error && error.message ? error.message : error)];
    return {
      status: 'failed',
      written: false,
      graphPath: context.graphPath.relativePath,
      schemaPath: context.schemaPath.relativePath,
      mutations: [],
      touchedElementIds: [],
      touchedRelationshipIds: [],
      before: beforeSummary,
      after: beforeSummary,
      errors,
      guidance: buildFailureGuidance(errors),
    };
  }
  const errors = validateDocument(mutationResult.document, context.schema, {
    touchedRelationshipIds: mutationResult.touchedRelationshipIds,
    touchedViewIds: mutationResult.viewLimitCheckIds,
  });
  const afterSummary = summarizeDocument(mutationResult.document);
  const result = {
    status: errors.length === 0 ? 'passed' : 'failed',
    written: false,
    graphPath: context.graphPath.relativePath,
    schemaPath: context.schemaPath.relativePath,
    mutations: mutationResult.mutationSummaries,
    touchedElementIds: mutationResult.touchedElementIds,
    touchedRelationshipIds: mutationResult.touchedRelationshipIds,
    touchedViewIds: mutationResult.touchedViewIds,
    viewLimitCheckIds: mutationResult.viewLimitCheckIds,
    before: beforeSummary,
    after: afterSummary,
    errors,
  };
  if (errors.length > 0) {
    result.guidance = buildFailureGuidance(errors);
  }

  if (errors.length > 0 || !write) {
    return result;
  }

  writeGraph(context.graphPath.absolutePath, mutationResult.document);
  result.written = true;

  if (shouldSyncCanonicalGraphToNeo4j(context.graphPath.relativePath)) {
    try {
      const syncResult = await syncArchitectureToNeo4j({
        architecturePath: context.graphPath.relativePath,
        document: mutationResult.document,
      });
      result.neo4jSync = {
        status: 'passed',
        graphKey: syncResult.graphKey,
        counts: syncResult.counts,
      };
    } catch (error) {
      const errorMessage = String(error && error.message ? error.message : error);
      result.neo4jSync = {
        status: 'failed',
        error: errorMessage,
      };
      result.warnings = addUnique(result.warnings || [], [
        `SystemArchitecture.json was written, but Neo4j sync failed: ${errorMessage}`,
        'Run node .argo/scripts/syncSystemArchitectureToNeo4j.js to rebuild the Neo4j projection for the canonical intent graph.',
      ]);
    }
  }

  await attachMutationEmbeddingLifecycle(context, result, mutationResult.document);

  return result;
}

function shouldSyncCanonicalGraphToNeo4j(relativeGraphPath) {
  return normalizeRelativePath(relativeGraphPath) === normalizeRelativePath(NEO4J_DEFAULT_GRAPH_PATH);
}

async function attachMutationEmbeddingLifecycle(context, result, document) {
  if (!shouldRunMutationEmbeddingLifecycle(result)) {
    return;
  }
  try {
    const lifecycle = require(
      './graph-rag/mutationEmbeddingVectorLifecycle.js'
    ).createPersistentMutationEmbeddingLifecycle({
      repositoryRoot: resolveWorkspaceRoot(),
    });
    const embeddingLifecycle = await lifecycle.reconcile({
      canonicalWrite: {
        written: true,
        architecturePath: result.graphPath,
        document,
        mutations: result.mutations,
        touchedElementIds: result.touchedElementIds,
        touchedRelationshipIds: result.touchedRelationshipIds,
        touchedViewIds: result.touchedViewIds,
      },
      preview: false,
      gates: {
        [LIVE_PROVIDER_OPT_IN]: process.env[LIVE_PROVIDER_OPT_IN],
        [W31_LIVE_OPT_IN]: process.env[W31_LIVE_OPT_IN],
      },
    });
    result.embeddingLifecycle = embeddingLifecycle;
    result.alignment = embeddingLifecycle.alignment || buildMutationAlignment(embeddingLifecycle);
    result.businessComplete = result.alignment && result.alignment.state === 'Aligned';
  } catch (error) {
    result.embeddingLifecycle = buildMutationEmbeddingLifecycleFailure(error, result);
    result.alignment = buildMutationAlignment(result.embeddingLifecycle);
    result.businessComplete = false;
  }
}

function shouldRunMutationEmbeddingLifecycle(result) {
  return result
    && result.status === 'passed'
    && result.written === true
    && normalizeRelativePath(result.graphPath) === normalizeRelativePath(DEFAULT_GRAPH_PATH)
    && (
      (Array.isArray(result.touchedElementIds) && result.touchedElementIds.length > 0)
      || (Array.isArray(result.touchedRelationshipIds) && result.touchedRelationshipIds.length > 0)
      || (Array.isArray(result.touchedViewIds) && result.touchedViewIds.length > 0)
    );
}

function buildMutationAlignment(embeddingLifecycle) {
  const state = embeddingLifecycle && embeddingLifecycle.alignmentState
    ? embeddingLifecycle.alignmentState
    : 'Failed';
  return Object.freeze({
    state,
    pureSemanticQueryRejected: state !== 'Aligned',
    category: state === 'Aligned' ? 'SEMANTIC_INDEX_ALIGNED' : 'SEMANTIC_INDEX_NOT_ALIGNED',
    fullSnapshotFallback: false,
  });
}

function buildMutationEmbeddingLifecycleFailure(error, result) {
  const category = error && error.category ? error.category : 'W31_MUTATION_VECTOR_LIFECYCLE_FAILED';
  return Object.freeze({
    mutation: Object.freeze({
      applied: true,
      architecturePath: result.graphPath,
    }),
    touchedRecords: [],
    provider: Object.freeze({
      profile: Object.freeze({
        provider: W31_APPROVED_PROFILE.provider,
        model: W31_APPROVED_PROFILE.model,
        version: W31_APPROVED_PROFILE.version,
        dimensions: W31_APPROVED_PROFILE.dimensions,
      }),
      offlineEvidenceAccepted: false,
      realRequestCount: 0,
    }),
    vectorEvidence: [],
    vectorQuery: Object.freeze({
      returnedTouchedRecordIds: [],
    }),
    alignmentState: 'Failed',
    failureMatrix: Object.freeze([
      Object.freeze({
        name: 'automatic-mutation-lifecycle-failure',
        alignmentState: 'Failed',
        category,
        pureSemanticQueryRejected: true,
        semanticQueryRejection: Object.freeze({
          request: null,
          status: 'rejected',
          alignmentState: 'Failed',
          category: 'SEMANTIC_INDEX_NOT_ALIGNED',
          fullSnapshotFallback: false,
        }),
        offlineEvidenceAccepted: false,
      }),
    ]),
    pureSemanticQueryRejected: true,
    semanticQueryRejection: Object.freeze({
      request: null,
      status: 'rejected',
      alignmentState: 'Failed',
      category: 'SEMANTIC_INDEX_NOT_ALIGNED',
      fullSnapshotFallback: false,
    }),
    secretLeaks: [],
  });
}

function buildFailureGuidance(errors) {
  const guidance = [];
  for (const error of errors || []) {
    addGuidanceForError(guidance, String(error));
  }
  if (guidance.length === 0 && Array.isArray(errors) && errors.length > 0) {
    guidance.push('Inspect the error text, call getSystemArchitecture with an explicit semantic query to refresh relevant ids, use getIntentElementContext for focused dependency context when needed, then retry with previewSystemArchitectureMutation before writing. Use an omitted-query full snapshot only when exact complete view membership is required.');
  }
  return guidance;
}

function addGuidanceForError(guidance, error) {
  if (error.includes('mutation.view_ids must contain at least one view id')) {
    pushUnique(guidance, 'Select the target view_ids explicitly. Prefer getSystemArchitecture with an explicit semantic query to find relevant views, then use getIntentElementContext for focused element dependencies when needed. Use a full snapshot only if exact complete view membership is required.');
  }
  if (error.includes('violates ArchiMate 3.2 relationship matrix')) {
    pushUnique(guidance, 'Check relationship.type and the source and target element types against ArchiMate 3.2. If the intended meaning is still valid, choose a compliant relationship type or change the endpoint element types by remove-and-add.');
  }
  if (error.includes('uses unsupported ArchiMate relationship type')) {
    pushUnique(guidance, 'Use relationship.type for the ArchiMate relationship type and choose one of the schema-supported ArchiMate 3.2 relationship types.');
  }
  if (error.includes('id cannot be updated') || error.includes('type cannot be updated')) {
    pushUnique(guidance, 'Do not patch immutable identity or type fields. To change an id or type, remove the existing element or relationship, then add the replacement with the desired id or type.');
  }
  if (error.includes('must be included in at least one view')) {
    pushUnique(guidance, 'Every element and relationship must belong to at least one view. Add it with view_ids, or add the existing object to an appropriate view before validating again.');
  }
  if (error.includes('must declare parent_element_id') || error.includes('top-level view')) {
    pushUnique(guidance, 'Keep exactly one top-level view named SystemArchitecture. For any sub-view, set parent_element_id to an existing element and keep parent_element_name aligned with that element name.');
  }
  if (error.includes('must contain at most 15 elements')) {
    pushUnique(guidance, 'Do not force more than 15 included_elements into one view. Pause and think about layered architecture: split the view into layered sub-views, attach each sub-view with parent_element_id, and move lower-level elements into the appropriate child view before retrying.');
  }
  if (error.includes('does not exist') || error.includes('references missing')) {
    pushUnique(guidance, 'Refresh current ids with getSystemArchitecture semantic query first, then call getIntentElementContext for any returned element that needs dependency context. Do not guess ids; use existing element, relationship, and view ids or create missing objects first.');
  }
}

function pushUnique(entries, entry) {
  if (!entries.includes(entry)) {
    entries.push(entry);
  }
}

function summarizeDocument(document) {
  return {
    elementCount: Array.isArray(document.elements) ? document.elements.length : 0,
    relationshipCount: Array.isArray(document.relationships) ? document.relationships.length : 0,
    viewCount: Array.isArray(document.views) ? document.views.length : 0,
  };
}

function writeGraph(graphPath, document) {
  const tempPath = `${graphPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, graphPath);
}

function validateAgainstSchema(value, schemaNode, pointer, errors, rootSchema) {
  if (!schemaNode || typeof schemaNode !== 'object') {
    return;
  }

  const resolvedSchema = schemaNode.$ref ? resolveRef(schemaNode.$ref, rootSchema, errors, pointer) : schemaNode;
  if (!resolvedSchema) {
    return;
  }

  if (resolvedSchema.const !== undefined && !isDeepStrictEqual(value, resolvedSchema.const)) {
    errors.push(`${pointer} must equal ${JSON.stringify(resolvedSchema.const)}`);
    return;
  }

  if (resolvedSchema.enum && !resolvedSchema.enum.some(option => isDeepStrictEqual(option, value))) {
    errors.push(`${pointer} must be one of: ${resolvedSchema.enum.map(option => JSON.stringify(option)).join(', ')}`);
    return;
  }

  if (resolvedSchema.type !== undefined) {
    validateType(value, resolvedSchema.type, pointer, errors);
    if (!typeMatches(value, resolvedSchema.type)) {
      return;
    }
  }

  if (typeof resolvedSchema.minLength === 'number' && (typeof value !== 'string' || value.length < resolvedSchema.minLength)) {
    errors.push(`${pointer} must be at least ${resolvedSchema.minLength} character(s) long`);
  }

  if (resolvedSchema.pattern) {
    const matcher = new RegExp(resolvedSchema.pattern);
    if (typeof value !== 'string' || !matcher.test(value)) {
      errors.push(`${pointer} must match pattern ${JSON.stringify(resolvedSchema.pattern)}`);
    }
  }

  if (typeof resolvedSchema.minItems === 'number' && (!Array.isArray(value) || value.length < resolvedSchema.minItems)) {
    errors.push(`${pointer} must contain at least ${resolvedSchema.minItems} item(s)`);
  }

  if (resolvedSchema.type === 'object') {
    validateObject(value, resolvedSchema, pointer, errors, rootSchema);
    return;
  }

  if (resolvedSchema.type === 'array') {
    validateArray(value, resolvedSchema, pointer, errors, rootSchema);
  }
}

function validateObject(value, schemaNode, pointer, errors, rootSchema) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  const properties = schemaNode.properties || {};
  const required = Array.isArray(schemaNode.required) ? schemaNode.required : [];
  for (const key of required) {
    if (!(key in value)) {
      errors.push(`${pointer} is missing required property '${key}'`);
    }
  }

  if (schemaNode.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        errors.push(`${pointer} contains unsupported property '${key}'`);
      }
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (key in value) {
      validateAgainstSchema(value[key], propertySchema, `${pointer}.${key}`, errors, rootSchema);
    }
  }
}

function validateArray(value, schemaNode, pointer, errors, rootSchema) {
  if (!Array.isArray(value)) {
    return;
  }

  if (schemaNode.items) {
    value.forEach((entry, index) => {
      validateAgainstSchema(entry, schemaNode.items, `${pointer}[${index}]`, errors, rootSchema);
    });
  }
}

function validateType(value, expectedType, pointer, errors) {
  if (!typeMatches(value, expectedType)) {
    const printableType = Array.isArray(expectedType) ? expectedType.join(' or ') : expectedType;
    errors.push(`${pointer} must be of type ${printableType}`);
  }
}

function typeMatches(value, expectedType) {
  if (Array.isArray(expectedType)) {
    return expectedType.some(candidate => typeMatches(value, candidate));
  }
  switch (expectedType) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function resolveRef(ref, rootSchema, errors, pointer) {
  if (!ref.startsWith('#/')) {
    errors.push(`${pointer} uses unsupported $ref '${ref}'`);
    return undefined;
  }

  const segments = ref.slice(2).split('/');
  let current = rootSchema;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      errors.push(`${pointer} references missing schema path '${ref}'`);
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function isDeepStrictEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateExplicitQuery(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || !query.purpose) {
    return queryError('QUERY_PURPOSE_REQUIRED', 'Explicit queries require a purpose');
  }
  if (!LEGAL_QUERY_PURPOSES.has(query.purpose)) {
    return queryError('QUERY_PURPOSE_INVALID', `Unsupported query purpose: ${query.purpose}`);
  }
  if (typeof query.intent !== 'string' || query.intent.trim().length === 0) {
    return queryError('QUERY_INTENT_REQUIRED', 'Explicit queries require a non-blank intent');
  }
  if (
    query.purpose === 'audit'
    && (typeof query.subject !== 'string' || query.subject.trim().length === 0)
  ) {
    return queryError('AUDIT_SUBJECT_REQUIRED', 'Audit queries require a non-blank subject');
  }

  return {
    status: 'passed',
    query: {
      ...query,
      intent: query.intent.trim(),
      ...(query.subject === undefined ? {} : { subject: query.subject.trim() }),
    },
  };
}

function validateSemanticQueryResponseShapeControls(query) {
  for (const field of FORBIDDEN_RESPONSE_SHAPE_CONTROL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(query, field)) {
      continue;
    }
    if (FORBIDDEN_RESPONSE_SHAPE_CONTROL_VALUES.has(String(query[field]).trim().toLowerCase())) {
      return queryError(
        'QUERY_RESPONSE_SHAPE_CONTROL_FORBIDDEN',
        `Semantic query response-shape control '${field}' is forbidden`,
      );
    }
  }
  for (const flag of FORBIDDEN_RESPONSE_SHAPE_CONTROL_FLAGS) {
    if (
      Object.prototype.hasOwnProperty.call(query, flag)
      && query[flag] !== false
      && query[flag] !== null
      && query[flag] !== undefined
    ) {
      return queryError(
        'QUERY_RESPONSE_SHAPE_CONTROL_FORBIDDEN',
        `Semantic query response-shape control '${flag}' is forbidden`,
      );
    }
  }
  return { status: 'passed' };
}

function isPurposeClosureProbe(query) {
  return Array.isArray(query && query.anchors) && query.anchors.length > 0;
}

function isOrdinarySemanticQuery(query) {
  return !!query
    && typeof query === 'object'
    && !Array.isArray(query)
    && query.purpose !== 'graph-tidy';
}

function isCanonicalSubsetSemanticContract(query, options = {}) {
  if (!isOrdinarySemanticQuery(query)) {
    return false;
  }
  if (!Array.isArray(query.anchors) || query.anchors.length === 0) {
    return !!(
      options.defaultNoAnchorSubset
      || options.architecturePath
    );
  }
  return query.anchors.some(anchor => !/^grag-[a-z0-9-]+$/.test(String(anchor)));
}

function semanticContractOptions(args = {}, dependencies = undefined) {
  return {
    architecturePath: args.architecturePath,
    canonicalDocument: args.canonicalDocument,
    defaultNoAnchorSubset: !dependencies
      || !!dependencies.canonicalSubsetForNoAnchor
      || !!(
        dependencies.semanticOperatorJourney
        && dependencies.semanticOperatorJourney.canonicalSubsetForNoAnchor
      ),
  };
}

function queryError(category, message, extras = {}) {
  return {
    status: 'failed',
    error: { category, message, ...extras },
  };
}

function toolResult(payload, structuredContent = undefined) {
  return {
    ...payload,
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    ...(structuredContent === undefined ? {} : { structuredContent }),
    isError: payload.status === 'failed',
  };
}

function mutationToolResult(payload, write) {
  if (write !== true || isMutationResponseDebugEnabled()) {
    return toolResult(payload);
  }
  return toolResult(compactMutationResponse(payload));
}

function isMutationResponseDebugEnabled() {
  return process.env.ARGO_MCP_MUTATION_RESPONSE_DEBUG === '1';
}

function compactMutationResponse(payload) {
  const compact = {
    status: payload && payload.status,
    written: Boolean(payload && payload.written),
  };
  if (payload && payload.embeddingLifecycle && payload.embeddingLifecycle.state) {
    compact.embeddingLifecycle = { state: payload.embeddingLifecycle.state };
  }
  // Failed actual writes must retain business diagnostics (e.g. View15 maximum/observed)
  // so callers can distinguish reject reasons; successful writes stay compact.
  if (payload && payload.status === 'failed') {
    if (Array.isArray(payload.errors)) {
      compact.errors = payload.errors;
    }
    if (Array.isArray(payload.guidance)) {
      compact.guidance = payload.guidance;
    }
  }
  return compact;
}

function getSystemArchitectureResult(payload) {
  const failed = payload.status === 'failed';
  return toolResult(payload, {
    version: '1.0',
    mode: failed ? 'error' : ((payload.query && payload.query.mode) || 'full-snapshot'),
    document: failed ? null : (payload.document === undefined ? null : payload.document),
    query: failed ? null : (payload.query || null),
    error: failed ? payload.error : null,
  });
}

async function callTool(name, args = {}, dependencies = undefined) {
  if (name === 'getSystemArchitecture') {
    if (Object.prototype.hasOwnProperty.call(args, 'query')) {
      const validation = validateExplicitQuery(args.query);
      if (validation.status === 'failed') {
        return getSystemArchitectureResult(validation);
      }

      const query = validation.query;
      if (query.purpose === 'graph-tidy') {
        const context = await loadContext(args);
        const payload = {
          status: 'passed',
          graphPath: context.graphPath.relativePath,
          document: context.document,
        };
        if (isPurposeClosureProbe(query) && !dependencies) {
          return attachContextWarnings(payload, context);
        }
        payload.query = {
          ...query,
          mode: 'full-snapshot',
          semanticRetrieval: 'bypassed',
        };
        return getSystemArchitectureResult(attachContextWarnings(payload, context));
      }
      const context = await loadContext(args);
      const contractOptions = semanticContractOptions({
        ...args,
        canonicalDocument: context.document,
      }, dependencies);
      if (isCanonicalSubsetSemanticContract(query, contractOptions)) {
        const responseShapeValidation = validateSemanticQueryResponseShapeControls(query);
        if (responseShapeValidation.status === 'failed') {
          return getSystemArchitectureResult(responseShapeValidation);
        }
      }

      const journey = await resolveSemanticOperatorJourney(dependencies);
      return applySemanticResponseProfile(await journey.query(query), query, contractOptions);
    }

    const context = await loadContext(args);
    return getSystemArchitectureResult(attachContextWarnings({
      status: 'passed',
      graphPath: context.graphPath.relativePath,
      document: context.document,
    }, context));
  }

  if (name === 'getIntentElementContext') {
    const context = await loadContext(args);
    return toolResult(attachContextWarnings(buildIntentElementContext(context, args), context));
  }

  if (name === 'generateArchitectureDiffPlantuml') {
    return toolResult(architectureDiffPlantuml.generateArchitectureDiffPlantuml({
      workspaceRoot: resolveWorkspaceRoot(),
      architecturePath: args.architecturePath,
      outputDir: args.outputDir,
    }));
  }

  if (name === 'previewSystemArchitectureMutation') {
    const context = await loadContext(args);
    return toolResult(attachContextWarnings(await buildMutationResult(context, args.mutations, false), context));
  }

  if (name === 'applySystemArchitectureMutation') {
    const context = await loadContext(args);
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, args.mutations, true), context), true);
  }

  if (name === 'addArchitectureElement') {
    const context = await loadContext(args);
    const write = !args.dryRun;
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, [{ type: 'addElement', element: args.element, view_ids: args.view_ids }], write), context), write);
  }

  if (name === 'updateArchitectureElement') {
    const context = await loadContext(args);
    const write = !args.dryRun;
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, [{ type: 'updateElement', id: args.id, patch: args.patch }], write), context), write);
  }

  if (name === 'removeArchitectureElement') {
    const context = await loadContext(args);
    const write = !args.dryRun;
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, [{ type: 'removeElement', id: args.id, view_ids: args.view_ids }], write), context), write);
  }

  if (name === 'addArchitectureRelationship') {
    const context = await loadContext(args);
    const write = !args.dryRun;
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, [{ type: 'addRelationship', relationship: args.relationship, view_ids: args.view_ids }], write), context), write);
  }

  if (name === 'updateArchitectureRelationship') {
    const context = await loadContext(args);
    const write = !args.dryRun;
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, [{ type: 'updateRelationship', id: args.id, patch: args.patch }], write), context), write);
  }

  if (name === 'removeArchitectureRelationship') {
    const context = await loadContext(args);
    const write = !args.dryRun;
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, [{ type: 'removeRelationship', id: args.id, view_ids: args.view_ids }], write), context), write);
  }

  if (name === 'addArchitectureView') {
    const context = await loadContext(args);
    const write = !args.dryRun;
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, [{ type: 'addView', view: args.view }], write), context), write);
  }

  if (name === 'updateArchitectureView') {
    const context = await loadContext(args);
    const write = !args.dryRun;
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, [{ type: 'updateView', view_id: args.view_id, patch: args.patch }], write), context), write);
  }

  if (name === 'removeArchitectureView') {
    const context = await loadContext(args);
    const write = !args.dryRun;
    return mutationToolResult(attachContextWarnings(await buildMutationResult(context, [{ type: 'removeView', view_id: args.view_id }], write), context), write);
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function resolveSemanticOperatorJourney(dependencies) {
  return dependencies && dependencies.semanticOperatorJourney
    ? dependencies.semanticOperatorJourney
    : createDefaultProductionSemanticOperatorJourney();
}

async function executeSemanticSystemArchitectureQuery(args, dependencies) {
  const context = await loadContext(args);
  const query = args.query;
  const contractOptions = semanticContractOptions(args, dependencies);
  const canonicalSubsetContract = isCanonicalSubsetSemanticContract(query, contractOptions);
  if (canonicalSubsetContract) {
    const responseShapeValidation = validateSemanticQueryResponseShapeControls(query);
    if (responseShapeValidation.status === 'failed') {
      return getSystemArchitectureResult(responseShapeValidation);
    }
  }
  const semanticRetrievalBoundary = resolveSemanticRetrievalBoundary(dependencies, {
    canonicalGraph: context.document,
  });
  if (!semanticRetrievalBoundary || typeof semanticRetrievalBoundary.retrieve !== 'function') {
    return getSystemArchitectureResult(queryError(
      'SEMANTIC_RETRIEVAL_UNAVAILABLE',
      'Semantic retrieval boundary is unavailable',
    ));
  }
  let document;
  try {
    const retrieved = await semanticRetrievalBoundary.retrieve(query);
    if (canonicalSubsetContract) {
      const subset = buildCanonicalSemanticDocumentSubset(retrieved, context.document);
      if (subset.status === 'failed') {
        return getSystemArchitectureResult(subset);
      }
      document = subset.document;
    } else {
      document = shouldReturnDebugSemanticResult(query)
        ? retrieved
        : buildBusinessSemanticSummary(retrieved, query);
    }
  } catch (error) {
    const semanticErrorEvidence = {};
    for (const field of [
      'action',
      'fullSnapshotFallback',
      'state',
      'canonicalVersion',
      'contentVersion',
      'indexVersion',
      'completedChannels',
      'missingChannels',
      'mismatchedChannels',
    ]) {
      if (error && Object.prototype.hasOwnProperty.call(error, field)) {
        semanticErrorEvidence[field] = error[field];
      }
    }
    if (
      error
      && error.category === 'SEMANTIC_AUTO_ALIGNMENT_FAILED'
      && typeof semanticErrorEvidence.action !== 'string'
    ) {
      semanticErrorEvidence.action = 'Repair semantic lifecycle alignment, then retry the original query.';
    }
    return getSystemArchitectureResult(queryError(
      error && error.category ? error.category : 'SEMANTIC_RETRIEVAL_FAILED',
      error && error.message ? error.message : 'Semantic retrieval failed',
      semanticErrorEvidence,
    ));
  }
  const semanticPayload = {
    status: 'passed',
    graphPath: context.graphPath.relativePath,
    query: {
      ...query,
      mode: 'semantic-query',
      semanticRetrieval: 'invoked',
      ...(canonicalSubsetContract
        ? {}
        : { responseProfile: shouldReturnDebugSemanticResult(query) ? 'debug' : 'business-summary' }),
    },
  };
  return getSystemArchitectureResult({
    ...semanticPayload,
    ...(canonicalSubsetContract
      ? { document }
      : (document && Object.prototype.hasOwnProperty.call(document, 'result')
        ? { result: document.result }
        : { result: document })),
    ...(canonicalSubsetContract || !shouldReturnDebugSemanticResult(query) ? {} : { document }),
  });
}

function shouldReturnDebugSemanticResult(query) {
  return ['debug', 'full', 'evidence'].includes(String(
    query && (query.responseProfile || query.detail || query.outputMode) || '',
  ).toLowerCase());
}

function buildBusinessSemanticSummary(retrieved, query = {}) {
  if (retrieved && retrieved.responseProfile === 'business-summary') return retrieved;
  if (retrieved && retrieved.result && retrieved.result.responseProfile === 'business-summary') return retrieved.result;
  const source = retrieved && typeof retrieved === 'object' ? retrieved : {};
  const provenanceObjects = Array.isArray(source.provenance && source.provenance.objects)
    ? source.provenance.objects
    : [];
  const hitReasonByKey = new Map(provenanceObjects.map(item => [
    `${item.objectType}:${item.objectId}`,
    {
      firstInclusionReason: item.firstInclusionReason,
      supplementaryReasons: Array.isArray(item.supplementaryReasons) ? [...item.supplementaryReasons] : [],
    },
  ]));
  const seedLimit = businessSummaryLimit(query);
  const semanticSeeds = summarizeSeeds(source.seedsByType, hitReasonByKey, seedLimit);
  const elements = summarizeElements(source, hitReasonByKey, seedLimit * 2);
  const relationships = summarizeRelationships(source, hitReasonByKey, seedLimit * 2);
  const views = summarizeViews(source, hitReasonByKey, seedLimit);
  const includedObjectIds = Object.freeze([
    ...elements.map(item => item.id),
    ...relationships.map(item => item.id),
    ...views.map(item => item.id),
  ]);
  return Object.freeze({
    responseProfile: 'business-summary',
    purpose: query.purpose,
    intent: query.intent,
    semanticSeeds,
    businessObjects: Object.freeze({
      elements: Object.freeze(elements),
      relationships: Object.freeze(relationships),
      views: Object.freeze(views),
    }),
    hitReasons: Object.freeze(provenanceObjects.map(item => Object.freeze({
      objectType: item.objectType,
      objectId: item.objectId,
      firstInclusionReason: item.firstInclusionReason,
      supplementaryReasons: Object.freeze(Array.isArray(item.supplementaryReasons) ? item.supplementaryReasons : []),
    }))),
    policySummary: Object.freeze({
      policyId: source.closurePolicy && source.closurePolicy.policyId,
      purpose: source.closurePolicy && source.closurePolicy.category,
      boundaryRationale: source.boundary && source.boundary.rationale,
    }),
    boundarySummary: Object.freeze({
      includedObjectIds,
      includedCount: includedObjectIds.length,
      excluded: Object.freeze(Array.isArray(source.boundary && source.boundary.excluded) ? source.boundary.excluded : []),
    }),
    semanticIndex: Object.freeze({
      canonicalVersion: source.canonicalVersion,
      contentVersion: source.contentVersion,
      indexVersion: source.indexVersion,
      alignment: source.provenance && source.provenance.alignment && source.provenance.alignment.state,
    }),
    omittedByDefault: Object.freeze([
      'embedding vectors',
      'full provenance version evidence per object',
      'queryTemplate',
      'parameterContract',
      'archimateSemantics',
      'full element descriptions',
      'full testcase bodies',
    ]),
    expandWith: 'Set query.responseProfile to "debug" to return the full semantic evidence payload.',
  });
}

function applySemanticResponseProfile(response, query, options = {}) {
  if (!isCanonicalSubsetSemanticContract(query, options)) {
    if (shouldReturnDebugSemanticResult(query)) return normalizeSemanticToolResponse(response);
    const payload = parseToolResponsePayload(response);
    if (!payload) return response;
    if (payload.status === 'failed') {
      return normalizeFailedSemanticResponse(payload, response);
    }
    const source = payload.result || payload.document;
    const summary = buildBusinessSemanticSummary(source, query);
    const { document: _omittedDocument, ...payloadWithoutDocument } = payload;
    return getSystemArchitectureResult({
      ...payloadWithoutDocument,
      query: {
        ...(payload.query || query),
        responseProfile: 'business-summary',
      },
      result: summary,
    });
  }
  const payload = parseToolResponsePayload(response);
  if (!payload) return response;
  if (payload.status === 'failed') {
    return normalizeFailedSemanticResponse(payload, response);
  }
  const source = payload.result || payload.document;
  const subset = buildCanonicalSemanticDocumentSubset(source, options.canonicalDocument);
  if (subset.status === 'failed') {
    return getSystemArchitectureResult(subset);
  }
  const { document: _omittedDocument, result: _omittedResult, ...payloadWithoutDocument } = payload;
  return getSystemArchitectureResult({
    ...payloadWithoutDocument,
    query: {
      ...(payload.query || query),
      mode: 'semantic-query',
      semanticRetrieval: 'invoked',
    },
    document: subset.document,
  });
}

function normalizeFailedSemanticResponse(payload, fallbackResponse) {
  const error = payload && payload.error;
  if (!error || error.category !== 'SEMANTIC_AUTO_ALIGNMENT_FAILED' || typeof error.action === 'string') {
    return fallbackResponse;
  }
  return getSystemArchitectureResult({
    ...payload,
    error: {
      ...error,
      action: 'Repair semantic lifecycle alignment, then retry the original query.',
    },
  });
}

function buildCanonicalSemanticDocumentSubset(source, canonicalDocument = undefined) {
  const evidence = source && typeof source === 'object' ? source : {};
  const endpointClosureRelationships = arrayAt(evidence, ['endpointClosure', 'relationships']);
  const viewClosureViews = arrayAt(evidence, ['viewClosure', 'views']);
  const viewMemberRelationships = viewClosureViews.flatMap(view => (
    Array.isArray(view && view.memberRelationships) ? view.memberRelationships : []
  ));
  const evidenceElements = uniqueById([
    ...arrayAt(evidence, ['closure', 'elements']),
    ...arrayAt(evidence, ['elements']),
    ...endpointClosureRelationships.flatMap(relationship => [relationship && relationship.source, relationship && relationship.target]),
    ...viewClosureViews.flatMap(view => (
      Array.isArray(view && view.memberElements) ? view.memberElements : []
    )),
    ...viewMemberRelationships.flatMap(relationship => [relationship && relationship.source, relationship && relationship.target]),
  ], 'id');
  const evidenceRelationships = uniqueById([
    ...endpointClosureRelationships,
    ...arrayAt(evidence, ['relationships']),
    ...viewMemberRelationships,
  ], 'id');
  const evidenceViews = uniqueById([
    ...viewClosureViews,
    ...arrayAt(evidence, ['views']),
  ], 'view_id');

  const canonicalElements = Array.isArray(canonicalDocument && canonicalDocument.elements)
    ? canonicalDocument.elements
    : [];
  const canonicalRelationships = Array.isArray(canonicalDocument && canonicalDocument.relationships)
    ? canonicalDocument.relationships
    : [];
  const canonicalViews = Array.isArray(canonicalDocument && canonicalDocument.views)
    ? canonicalDocument.views
    : [];

  const canonicalElementById = new Map(canonicalElements.map(element => [element && element.id, element]));
  const canonicalRelationshipById = new Map(canonicalRelationships.map(relationship => [relationship && relationship.id, relationship]));
  const canonicalViewById = new Map(canonicalViews.map(view => [view && view.view_id, view]));
  const evidenceElementCandidates = evidenceElements
    .map(item => classifyCanonicalSubsetCandidate(item, 'Element'))
    .filter(candidate => candidate && candidate.kind === 'Element');
  const evidenceRelationshipCandidates = evidenceRelationships
    .map(item => classifyCanonicalSubsetCandidate(item, 'ArchitectureRelationship'))
    .filter(candidate => candidate && candidate.kind === 'ArchitectureRelationship');
  const evidenceViewCandidates = evidenceViews
    .map(item => classifyCanonicalSubsetCandidate(item, 'View'))
    .filter(candidate => candidate && candidate.kind === 'View');
  const evidenceElementById = new Map(evidenceElementCandidates
    .map(candidate => [candidate.id, candidate.item]));
  const evidenceRelationshipById = new Map(evidenceRelationshipCandidates
    .map(candidate => [candidate.id, candidate.item]));
  const evidenceViewById = new Map(evidenceViewCandidates
    .map(candidate => [candidate.id, candidate.item]));

  const elementIds = new Set([...evidenceElementById.keys()].filter(id => canonicalElementById.has(id)));
  const relationshipIds = new Set([...evidenceRelationshipById.keys()]);
  const viewIds = new Set([...evidenceViewById.keys()]);

  const selectElement = (elementId, category, message) => {
    if (!evidenceElementById.has(elementId)) {
      return semanticSubsetError(category, message);
    }
    const element = canonicalElementById.get(elementId);
    if (!element) {
      return semanticSubsetError(category, message);
    }
    elementIds.add(elementId);
    return undefined;
  };
  const selectRelationship = (relationshipId, category, message) => {
    if (!evidenceRelationshipById.has(relationshipId)) {
      return { error: semanticSubsetError(category, message) };
    }
    const relationship = canonicalRelationshipById.get(relationshipId);
    if (!relationship) {
      return { error: semanticSubsetError(category, message) };
    }
    relationshipIds.add(relationshipId);
    return { relationship };
  };

  for (const viewId of [...viewIds]) {
    const view = canonicalViewById.get(viewId);
    if (!view) {
      viewIds.delete(viewId);
      continue;
    }
    for (const elementId of view && Array.isArray(view.included_elements) ? view.included_elements : []) {
      const error = selectElement(
        elementId,
        'SEMANTIC_SUBSET_VIEW_MISSING',
        `Semantic View subset is missing included Element '${elementId}'`,
      );
      if (error) {
        return error;
      }
    }
    for (const relationshipId of view && Array.isArray(view.included_relationships) ? view.included_relationships : []) {
      const selected = selectRelationship(
        relationshipId,
        'SEMANTIC_SUBSET_VIEW_MISSING',
        `Semantic View subset is missing included Relationship '${relationshipId}'`,
      );
      if (selected.error) {
        return selected.error;
      }
      const { relationship } = selected;
      for (const endpointId of [relationship.source_id, relationship.target_id]) {
        const error = selectElement(
          endpointId,
          'SEMANTIC_SUBSET_VIEW_MISSING',
          `Semantic View subset is missing endpoint Elements for Relationship '${relationship.id}'`,
        );
        if (error) {
          return error;
        }
      }
    }
  }

  for (const relationshipId of [...relationshipIds]) {
    const selected = selectRelationship(
      relationshipId,
      'SEMANTIC_SUBSET_RELATIONSHIP_MISSING',
      `Semantic Relationship subset is missing canonical Relationship '${relationshipId}'`,
    );
    if (selected.error) {
      return selected.error;
    }
    const { relationship } = selected;
    for (const endpointId of [relationship && relationship.source_id, relationship && relationship.target_id]) {
      const error = selectElement(
        endpointId,
        'SEMANTIC_SUBSET_RELATIONSHIP_MISSING',
        `Semantic Relationship subset is missing endpoint Elements for Relationship '${relationship && relationship.id}'`,
      );
      if (error) {
        return error;
      }
    }
  }

  const elements = [...elementIds]
    .map(id => canonicalElementById.get(id))
    .filter(Boolean);
  const relationships = [...relationshipIds]
    .map(id => canonicalRelationshipById.get(id))
    .filter(Boolean);
  const views = [...viewIds]
    .map(id => canonicalViewById.get(id))
    .filter(Boolean);

  return {
    status: 'passed',
    document: {
      elements: elements.map(clone),
      relationships: relationships.map(clone),
      views: views.map(clone),
    },
  };
}

function classifyCanonicalSubsetCandidate(item, fallbackKind) {
  if (!item || typeof item !== 'object') return undefined;
  const rawId = item.id || item.view_id || item.objectId || item.canonicalIdentity;
  if (!rawId) return undefined;
  const qualified = parseSemanticQualifiedId(rawId);
  if (qualified) {
    return { ...qualified, item };
  }
  return {
    kind: normalizeSemanticObjectKind(item.objectType || item.channel || fallbackKind),
    id: String(rawId),
    item,
  };
}

function parseSemanticQualifiedId(rawId) {
  const text = String(rawId);
  for (const [prefix, kind] of [
    ['ArchitectureRelationship:', 'ArchitectureRelationship'],
    ['Relationship:', 'ArchitectureRelationship'],
    ['View:', 'View'],
    ['Element:', 'Element'],
  ]) {
    if (text.startsWith(prefix)) {
      return {
        kind,
        id: text.slice(prefix.length),
      };
    }
  }
  return undefined;
}

function normalizeSemanticObjectKind(value) {
  const kind = String(value || '').toLowerCase();
  if (kind === 'architecturerelationship' || kind === 'relationship' || kind === 'relationships') {
    return 'ArchitectureRelationship';
  }
  if (kind === 'view' || kind === 'views') {
    return 'View';
  }
  return 'Element';
}

function arrayAt(value, pathSegments) {
  let current = value;
  for (const segment of pathSegments) {
    current = current && current[segment];
  }
  return Array.isArray(current) ? current : [];
}

function semanticSubsetError(category, message) {
  return queryError(category, message, { fullSnapshotFallback: false });
}

function parseToolResponsePayload(response) {
  if (!response || typeof response !== 'object') return undefined;
  if (response.content && Array.isArray(response.content) && response.content[0] && typeof response.content[0].text === 'string') {
    try {
      return JSON.parse(response.content[0].text);
    } catch (_error) {
      return undefined;
    }
  }
  return response;
}

function normalizeSemanticToolResponse(response) {
  if (response && response.content && Array.isArray(response.content)) return response;
  const payload = response && typeof response === 'object'
    ? response
    : { status: 'failed', error: { category: 'SEMANTIC_RETRIEVAL_FAILED', message: 'Semantic retrieval failed' } };
  return getSystemArchitectureResult(payload);
}

function businessSummaryLimit(query) {
  const supplied = Number(query && (query.topN || query.limit || query.maxResults));
  return Number.isInteger(supplied) && supplied > 0 ? Math.min(supplied, 50) : 8;
}

function summarizeSeeds(seedsByType = {}, hitReasonByKey, limit) {
  return Object.freeze(Object.fromEntries(Object.entries(seedsByType).map(([type, seeds]) => [
    type,
    Object.freeze((Array.isArray(seeds) ? seeds : [])
      .slice()
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .slice(0, limit)
      .map(seed => {
        const objectType = seed.objectType || seed.channel || inferObjectTypeFromSeedType(type);
        const objectId = seed.id || seed.objectId || seed.canonicalIdentity;
        const reasons = hitReasonByKey.get(`${objectType}:${objectId}`) || {};
        return Object.freeze({
          objectId,
          objectType,
          score: typeof seed.score === 'number' ? seed.score : undefined,
          hitReason: reasons.firstInclusionReason || 'semantic-seed',
          supplementaryReasons: Object.freeze(reasons.supplementaryReasons || []),
        });
      })),
  ])));
}

function inferObjectTypeFromSeedType(type) {
  if (type === 'relationships') return 'ArchitectureRelationship';
  if (type === 'views') return 'View';
  return 'Element';
}

function summarizeElements(source, hitReasonByKey, limit) {
  return uniqueById([
    ...(((source.closure && source.closure.elements) || [])),
    ...((((source.viewClosure && source.viewClosure.views) || []).flatMap(view => view.memberElements || []))),
    ...((((source.endpointClosure && source.endpointClosure.relationships) || []).flatMap(relationship => [relationship.source, relationship.target]).filter(Boolean))),
  ], 'id').slice(0, limit).map(element => summarizeElement(element, hitReasonByKey));
}

function summarizeRelationships(source, hitReasonByKey, limit) {
  return uniqueById([
    ...(((source.endpointClosure && source.endpointClosure.relationships) || [])),
    ...((((source.viewClosure && source.viewClosure.views) || []).flatMap(view => view.memberRelationships || []))),
  ], 'id').slice(0, limit).map(relationship => summarizeRelationship(relationship, hitReasonByKey));
}

function summarizeViews(source, hitReasonByKey, limit) {
  return uniqueById(((source.viewClosure && source.viewClosure.views) || []), 'view_id')
    .slice(0, limit)
    .map(view => summarizeView(view, hitReasonByKey));
}

function summarizeElement(element, hitReasonByKey) {
  const attributes = attributesMap(element);
  const reasons = hitReasonByKey.get(`Element:${element.id}`) || {};
  return Object.freeze({
    id: element.id,
    name: element.name,
    type: element.type,
    descriptionSummary: summarizeText(element.description),
    status: attributes.deliveryStatus || attributes.status,
    functionalPoints: Object.freeze(Object.entries(attributes)
      .filter(([name]) => name.startsWith('functionalPoint'))
      .map(([, value]) => value)),
    testCoverage: summarizeTestcases(element.testcases),
    hitReason: reasons.firstInclusionReason,
    supplementaryReasons: Object.freeze(reasons.supplementaryReasons || []),
  });
}

function summarizeRelationship(relationship, hitReasonByKey) {
  const reasons = hitReasonByKey.get(`ArchitectureRelationship:${relationship.id}`) || {};
  return Object.freeze({
    id: relationship.id,
    name: relationship.name,
    type: relationship.type,
    source_id: relationship.source_id,
    target_id: relationship.target_id,
    hitReason: reasons.firstInclusionReason,
    supplementaryReasons: Object.freeze(reasons.supplementaryReasons || []),
  });
}

function summarizeView(view, hitReasonByKey) {
  const reasons = hitReasonByKey.get(`View:${view.view_id}`) || {};
  return Object.freeze({
    view_id: view.view_id,
    view_name: view.view_name || view.name,
    descriptionSummary: summarizeText(view.description),
    elementCount: Array.isArray(view.included_elements) ? view.included_elements.length : undefined,
    relationshipCount: Array.isArray(view.included_relationships) ? view.included_relationships.length : undefined,
    hitReason: reasons.firstInclusionReason,
    supplementaryReasons: Object.freeze(reasons.supplementaryReasons || []),
  });
}

function attributesMap(value = {}) {
  const result = {};
  for (const attribute of Array.isArray(value.attributes) ? value.attributes : []) {
    if (attribute && typeof attribute.name === 'string') result[attribute.name] = attribute.value;
  }
  return result;
}

function summarizeTestcases(testcases) {
  return Object.freeze((Array.isArray(testcases) ? testcases : []).map(testcase => {
    if (typeof testcase === 'string') return { name: testcase };
    return {
      name: testcase.name || testcase.id || testcase.testcasename,
      status: testcase.status,
      coverage: testcase.coverage || testcase.coveragePoint || testcase.description,
    };
  }));
}

function summarizeText(text) {
  if (typeof text !== 'string') return undefined;
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= 180 ? compact : `${compact.slice(0, 177)}...`;
}

function uniqueById(items, idField) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const id = item && item[idField];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}

async function createDefaultProductionSemanticOperatorJourney(options = {}) {
  const workspaceRoot = options.repositoryRoot || resolveWorkspaceRoot();
  const graphPath = resolveWorkspacePath(workspaceRoot, DEFAULT_GRAPH_PATH);
  const canonicalGraph = readJson(graphPath.absolutePath, graphPath.relativePath);
  const readinessStore = createProductionSemanticReadinessStore({
    repositoryRoot: workspaceRoot,
  });
  const retrieval = createDefaultSemanticRetrieval({
    canonicalGraph,
    repositoryRoot: workspaceRoot,
    readinessBoundary: readinessStore,
  });
  const runtime = createProductionGraphRagRuntime({
    canonicalGraph,
    neo4jRetrievalBoundary: retrieval,
  });
  const journey = createProductionSemanticOperatorJourney({
    initializeWorkspace: request => initializeWorkspace(request),
    syncCanonicalStructuralProjection: request => syncCanonicalStructuralProjection(request),
    resolveApprovedConfiguration: request => resolveApprovedLiveConfiguration(request),
    runSemanticBackfill: request => runtime.runSemanticBackfill(request),
    readSemanticReadiness: () => retrieval.readReadiness(),
    querySystemArchitecture: request => executeSemanticSystemArchitectureQuery(request, {
      semanticRetrievalBoundary: retrieval,
      canonicalSubsetForNoAnchor: true,
    }),
  });
  return Object.freeze({
    ...journey,
    canonicalSubsetForNoAnchor: true,
  });
}

function createDefaultCanonicalSemanticInitComposition() {
  const repositoryRoot = resolveWorkspaceRoot();
  const readinessStore = createProductionSemanticReadinessStore({ repositoryRoot });
  const graphPath = resolveWorkspacePath(repositoryRoot, DEFAULT_GRAPH_PATH);
  const canonicalGraph = readJson(graphPath.absolutePath, graphPath.relativePath);
  let configurationEvidence;
  return Object.freeze({
    configurationBehavior: Object.freeze({
      readGate(name) {
        return process.env[name];
      },
      async resolve() {
        configurationEvidence = await resolveApprovedLiveConfiguration({
          repositoryRoot,
          requiredOptIns: [LIVE_PROVIDER_OPT_IN, W31_LIVE_OPT_IN],
        });
        return configurationEvidence;
      },
    }),
    productionGraphRagRuntime: Object.freeze({
      async runSemanticBackfill(request) {
        const runtime = await createDefaultProductionSemanticRuntime();
        try {
          return await runtime.runSemanticBackfill(request);
        } finally {
          if (runtime && typeof runtime.close === 'function') {
            await runtime.close();
          }
        }
      },
    }),
    finalReadiness: Object.freeze({
      async invalidate(evidence) {
        return readinessStore.invalidate(evidence);
      },
      async recordFailure(evidence) {
        return readinessStore.recordFailure(evidence);
      },
      async verifyQueryability(backfill) {
        if (!backfill || backfill.alignmentState !== 'Aligned') return false;
        const contentVersion = backfill.contentVersion || backfill.canonicalVersion;
        const indexVersion = backfill.indexVersion || backfill.canonicalVersion;
        const retrieval = createDefaultSemanticRetrieval({
          canonicalGraph,
          repositoryRoot,
        });
        await retrieval.probeQueryability(Object.freeze({
          purpose: 'implementation-design',
          intent: 'verify system architecture semantic queryability',
        }), Object.freeze({
          state: 'QueryabilityProbe',
          canonicalVersion: backfill.canonicalVersion,
          contentVersion,
          indexVersion,
        }));
        return true;
      },
      async verifyGlobalCoherence(backfill) {
        return Boolean(
          backfill
          && backfill.alignmentState === 'Aligned'
          && ['Element', 'ArchitectureRelationship', 'View'].every(channel => (
            backfill.channels
            && backfill.channels[channel]
            && backfill.channels[channel].status === 'complete'
            && backfill.channels[channel].canonicalVersion === backfill.canonicalVersion
          )),
        );
      },
      async recordAligned(evidence) {
        const profile = configurationEvidence && configurationEvidence.configuration;
        return readinessStore.recordAligned(Object.freeze({
          ...evidence,
          channels: Object.freeze((evidence.channels || []).map(channel => Object.freeze({
            ...channel,
            state: 'Aligned',
            provider: profile.embeddingProvider,
            model: profile.embeddingModel,
            modelVersion: profile.embeddingModelVersion,
            dimensions: profile.embeddingDimensions,
            queryable: true,
            coherent: true,
          }))),
        }));
      },
    }),
  });
}

async function createDefaultProductionSemanticRuntime() {
  const workspaceRoot = resolveWorkspaceRoot();
  const configuration = await resolveDefaultSemanticConfiguration();
  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(
    configuration.neo4jDatabaseUrl,
    neo4j.auth.basic(
      configuration.neo4jDatabaseUsername,
      configuration.neo4jDatabasePassword,
    ),
  );
  const graphPath = resolveWorkspacePath(workspaceRoot, DEFAULT_GRAPH_PATH);
  const canonicalDocument = readJson(graphPath.absolutePath, graphPath.relativePath);
  const canonicalVersion = deriveSemanticCanonicalVersion(canonicalDocument);
  const canonicalSnapshot = Object.freeze({
    ...canonicalDocument,
    version: canonicalVersion,
  });
  const qualification = Object.freeze({
    approvedByHuman: true,
    provider: configuration.embeddingProvider,
    model: configuration.embeddingModel,
    version: configuration.embeddingModelVersion,
    dimensions: configuration.embeddingDimensions,
    source: 'explicit-human-approval',
  });
  const providerClient = createLiveEmbeddingProviderClient({
    configuration,
    transport: Object.freeze({
      request(url, options) {
        if (typeof global.fetch !== 'function') {
          const error = new Error('LIVE_PROVIDER_TRANSPORT_UNAVAILABLE');
          error.category = 'LIVE_PROVIDER_TRANSPORT_UNAVAILABLE';
          throw error;
        }
        return global.fetch(url, options);
      },
    }),
  });

  const runtime = createProductionGraphRagRuntime({
    canonicalGraph: canonicalSnapshot,
    neo4jRetrievalBoundary: Object.freeze({
      async retrieve() {
        const error = new Error('SEMANTIC_RETRIEVAL_REQUEST_REQUIRED');
        error.category = 'SEMANTIC_RETRIEVAL_REQUEST_REQUIRED';
        throw error;
      },
    }),
    embeddingQualification: qualification,
    semanticPersistence: Object.freeze({
      canonicalSource: Object.freeze({
        async readSnapshot() {
          return canonicalSnapshot;
        },
      }),
      structuralProjection: Object.freeze({
        async requireComplete() {
          await verifyArchitectureSync({
            architecturePath: graphPath.relativePath,
            document: canonicalDocument,
            driver,
            database: configuration.neo4jDatabase,
          });
          return Object.freeze({
            status: 'complete',
            canonicalVersion,
          });
        },
      }),
      embeddingProvider: Object.freeze({
        async embedBatch(batch) {
          const vectors = [];
          const failures = [];
          for (const record of batch) {
            try {
              vectors.push(Object.freeze({
                canonicalIdentity: record.canonicalIdentity,
                vector: Object.freeze(await providerClient.embed(JSON.stringify(record.canonicalObject))),
              }));
            } catch (error) {
              failures.push(Object.freeze({
                canonicalIdentity: record.canonicalIdentity,
                category: error && error.category ? error.category : 'LIVE_PROVIDER_REQUEST_FAILED',
              }));
            }
          }
          return Object.freeze({
            vectors: Object.freeze(vectors),
            failures: Object.freeze(failures),
          });
        },
      }),
      neo4jDriver: driver,
      canonicalAuthority: Object.freeze({
        assertProjectionOnly() {
          return Object.freeze({
            authority: 'canonical-json',
            projectionRole: 'subordinate-projection-index',
          });
        },
      }),
      configuration,
      qualification,
      batchSize: 100,
    }),
  });
  return Object.freeze({
    ...runtime,
    async close() {
      await driver.close();
    },
  });
}

async function resolveDefaultSemanticConfiguration() {
  let external;
  try {
    external = resolveExternalProductionConfig({
      neo4jUri: process.env.ARGO_NEO4J_DATABASE_URL,
      neo4jUsername: process.env.ARGO_NEO4J_DATABASE_USERNAME,
      neo4jPassword: process.env.ARGO_NEO4J_DATABASE_PASSWORD,
      embeddingCredential: process.env.QWEN_KEY,
      neo4jDatabase: process.env.ARGO_NEO4J_DATABASE || getDefaultSemanticNeo4jDatabaseName(),
    }, {
      operation: 'semantic-backfill',
      sourceKeys: new Map([
        ['neo4jUri', 'ARGO_NEO4J_DATABASE_URL'],
        ['neo4jUsername', 'ARGO_NEO4J_DATABASE_USERNAME'],
        ['neo4jPassword', 'ARGO_NEO4J_DATABASE_PASSWORD'],
        ['embeddingCredential', 'QWEN_KEY'],
      ]),
    });
  } catch (error) {
    if (error && error.category === 'EXTERNAL_CREDENTIALS_REQUIRED') {
      const missing = new Error('EXTERNAL_CREDENTIALS_REQUIRED');
      missing.category = 'EXTERNAL_CREDENTIALS_REQUIRED';
      missing.field = error.field;
      throw missing;
    }
    throw error;
  }
  return Object.freeze({
    embeddingBaseUrl: W31_APPROVED_PROFILE.baseUrl,
    embeddingModel: W31_APPROVED_PROFILE.model,
    embeddingProvider: W31_APPROVED_PROFILE.provider,
    embeddingModelVersion: W31_APPROVED_PROFILE.version,
    embeddingDimensions: W31_APPROVED_PROFILE.dimensions,
    neo4jDatabaseUrl: external.neo4jUri,
    neo4jDatabaseUsername: external.neo4jUsername,
    neo4jDatabasePassword: external.neo4jPassword,
    qwenKey: external.embeddingCredential,
    embeddingCredential: external.embeddingCredential,
    ...(external.neo4jDatabase === undefined ? {} : { neo4jDatabase: external.neo4jDatabase }),
  });
}

function getDefaultSemanticNeo4jDatabaseName() {
  const repoName = path.basename(resolveWorkspaceRoot());
  const normalized = String(repoName)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-');
  const safe = normalized || 'workspace';
  const prefixed = /^[a-z]/.test(safe) ? safe : `db-${safe}`;
  return prefixed.slice(0, 63);
}

function deriveSemanticCanonicalVersion(document) {
  return `canonical:${crypto.createHash('sha256').update(JSON.stringify({
    name: document.name || 'System',
    elements: (document.elements || []).map(element => element.id).sort(),
    relationships: (document.relationships || []).map(relationship => relationship.id).sort(),
    views: (document.views || []).map(view => view.view_id).sort(),
  })).digest('hex')}`;
}

function resolveSemanticRetrievalBoundary(dependencies, context = {}) {
  if (!dependencies) {
    return createDefaultSemanticRetrievalBoundary(context);
  }
  if (
    dependencies.semanticRetrievalBoundary
    && typeof dependencies.semanticRetrievalBoundary.retrieve === 'function'
  ) {
    return dependencies.semanticRetrievalBoundary;
  }

  const runtime = dependencies.productionGraphRagRuntime
    || (dependencies.productionGraphRagDependencies
      ? createProductionGraphRagRuntime(dependencies.productionGraphRagDependencies)
      : undefined);
  if (!runtime || typeof runtime.querySemantic !== 'function') {
    return undefined;
  }
  return {
    retrieve(request) {
      return runtime.querySemantic(request);
    },
  };
}

function createDefaultSemanticRetrievalBoundary(context = {}) {
  return createDefaultSemanticRetrieval({
    canonicalGraph: context.canonicalGraph,
  });
}

function attachContextWarnings(payload, context) {
  const recovery = context && context.neo4jSyncRecovery;
  if (!recovery || !recovery.attempted) {
    return payload;
  }

  payload.neo4jRecovery = recovery;
  if (recovery.status === 'failed') {
    payload.warnings = addUnique(payload.warnings || [], [
      `Neo4j automatic resync failed before servicing ${context.graphPath.relativePath}: ${recovery.error}`,
      'The canonical JSON graph is still being served and written. Neo4j will be retried again on the next canonical read or write, or you can run node .argo/scripts/syncSystemArchitectureToNeo4j.js manually.',
    ]);
  }
  return payload;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(request, dependencies = undefined) {
  const { id, method, params } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
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

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS },
    };
  }

  if (method === 'tools/call') {
    try {
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
          semanticOperatorJourney: await createDefaultProductionSemanticOperatorJourney(),
          canonicalSubsetForNoAnchor: true,
        };
      }
      const result = await callTool(
        params.name,
        params.arguments || {},
        activeDependencies,
      );
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: semanticOperatorErrorResult(error),
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
    const response = await handleRequest(request);
    if (response) {
      send(response);
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
  GET_SYSTEM_ARCHITECTURE_OUTPUT_SCHEMA,
  TOOLS,
  applyMutations,
  callTool,
  compactMutationResponse,
  createDefaultCanonicalSemanticInitComposition,
  createDefaultProductionSemanticOperatorJourney,
  handleRequest,
  loadContext,
  main,
  validateDocument,
};
