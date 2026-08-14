const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const {
  resolveApprovedLiveConfiguration,
} = require('./liveEmbeddingProviderConfig.js');
const {
  createLiveEmbeddingProviderClient,
} = require('./liveEmbeddingProviderClient.js');
const {
  createProductionGraphRagRuntime,
} = require('./productionGraphRagRuntime.js');

const APPROVED_SOURCE_KEYS = Object.freeze([
  'ARGO_EMBEDDING_BASE_URL',
  'ARGO_EMBEDDING_MODEL',
  'ARGO_EMBEDDING_PROVIDER',
  'ARGO_EMBEDDING_MODEL_VERSION',
  'ARGO_EMBEDDING_DIMENSIONS',
  'ARGO_NEO4J_DATABASE_URL',
  'ARGO_NEO4J_DATABASE_USERNAME',
  'ARGO_NEO4J_DATABASE_PASSWORD',
  'QWEN_KEY',
]);
const LEGACY_NEO4J_KEYS = Object.freeze([
  'ARGO_NEO4J_URI',
  'ARGO_NEO4J_USERNAME',
  'ARGO_NEO4J_PASSWORD',
]);
const APPROVED_PROFILE = Object.freeze({
  baseUrl: 'https://llm-clids9mqc5o1mbvb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.7-text-embedding',
  provider: 'alibaba-cloud-model-studio-openai-compatible-cn-beijing',
  version: 'qualification-2026-07-25',
  dimensions: 1024,
});
const CHANNELS = Object.freeze([
  Object.freeze({
    channel: 'Element',
    key: 'elements',
    objectType: 'Element',
    threshold: 0.8,
    indexName: 'argo_production_semantic_element_vector',
  }),
  Object.freeze({
    channel: 'ArchitectureRelationship',
    key: 'relationships',
    objectType: 'ArchitectureRelationship',
    threshold: 0.78,
    indexName: 'argo_production_semantic_relationship_vector',
  }),
  Object.freeze({
    channel: 'View',
    key: 'views',
    objectType: 'View',
    threshold: 0.76,
    indexName: 'argo_production_semantic_view_vector',
  }),
]);
const VECTOR_QUERY_CYPHER = [
  'CALL db.index.vector.queryNodes($indexName, $topK, $vector)',
  'YIELD node, score',
  'WHERE node.channel = $channel',
  'RETURN properties(node) AS record, score',
  'ORDER BY score DESC',
].join('\n');
const READINESS_QUERY_CYPHER = [
  'MATCH (readiness:ArgoProductionSemanticReadiness {identity: $identity})',
  'RETURN properties(readiness) AS readiness',
].join('\n');
const INITIAL_WINDOW_SIZE = 2;
const SELECTED_VIEW_ID = 'semprod-wp2-default-retrieval-readiness';
const testCompositionStorage = new AsyncLocalStorage();

function createDefaultSemanticRetrieval(dependencies = {}) {
  const canonicalGraph = requireCanonicalGraph(dependencies.canonicalGraph);
  const readinessBoundary = dependencies.readinessBoundary;
  return Object.freeze({
    async retrieve(request = {}) {
      const composition = await resolveRetrievalComposition(dependencies);
      const activeTestComposition = testCompositionStorage.getStore();
      const activeReadinessBoundary = activeTestComposition
        && activeTestComposition.useReadinessBoundary !== true
        ? undefined
        : readinessBoundary;
      let configurationEvidence = await composition.resolveConfiguration();
      let evidence = await readAndEvaluatePersistentReadiness(
        composition,
        canonicalGraph,
        activeReadinessBoundary,
      );
      if (!evidence.alignment.aligned) {
        await attemptAutomaticAlignment({
          composition,
          request,
          alignment: evidence.alignment,
        });
        evidence = await readAndEvaluatePersistentReadiness(
          composition,
          canonicalGraph,
          activeReadinessBoundary,
        );
        if (!evidence.alignment.aligned) {
          throw semanticAutomaticAlignmentFailed(evidence.alignment);
        }
      }
      return executeWpP2Retrieval({
        composition,
        request,
        canonicalGraph,
        readiness: evidence.readiness,
        configurationEvidence,
      });
    },
    async probeQueryability(request = {}, readiness = {}) {
      const composition = await resolveRetrievalComposition(dependencies);
      const configurationEvidence = await composition.resolveConfiguration();
      return executeWpP2Retrieval({
        composition,
        request,
        canonicalGraph,
        readiness,
        configurationEvidence,
      });
    },
    async readReadiness() {
      const composition = await resolveRetrievalComposition(dependencies);
      const activeTestComposition = testCompositionStorage.getStore();
      const activeReadinessBoundary = activeTestComposition
        && activeTestComposition.useReadinessBoundary !== true
        ? undefined
        : readinessBoundary;
      await composition.resolveConfiguration();
      const evidence = await readAndEvaluatePersistentReadiness(
        composition,
        canonicalGraph,
        activeReadinessBoundary,
      );
      return publicReadinessOutcome(evidence.alignment);
    },
  });
}

async function resolveRetrievalComposition(dependencies) {
  const activeTestComposition = testCompositionStorage.getStore();
  return activeTestComposition
    ? createTestComposition(activeTestComposition)
    : createProductionComposition(dependencies);
}

async function executeWpP2Retrieval({
  composition,
  request,
  canonicalGraph,
  readiness,
  configurationEvidence,
}) {
  const provider = createLiveEmbeddingProviderClient({
    configuration: configurationEvidence.configuration,
    transport: composition.transport,
  });
  const vector = await provider.embed(request.intent);
  requireQualifiedVector(vector);
  const seedsByType = {};
  for (const channel of CHANNELS) {
    seedsByType[channel.key] = await exhaustChannel({
      channel,
      neo4jDriver: composition.neo4jDriver,
      vector,
    });
  }
  return completeSemanticResult({
    request,
    canonicalGraph,
    readiness,
    seedsByType,
    configurationEvidence,
  });
}

async function withDefaultSemanticRetrievalTestComposition(composition, callback, options = {}) {
  requireExactTestComposition(composition, callback);
  return testCompositionStorage.run(Object.freeze({
    ...composition,
    useReadinessBoundary: options.useReadinessBoundary === true,
  }), callback);
}

async function createTestComposition(composition) {
  return Object.freeze({
    resolveConfiguration: () => resolveRawTestConfiguration(
      composition.sourceBehavior,
      composition.sourceAdapters,
    ),
    transport: composition.transport,
    neo4jDriver: composition.neo4jDriver,
  });
}

async function createProductionComposition(dependencies) {
  const repositoryRoot = dependencies.repositoryRoot
    || process.env.ARGO_REPO_ROOT
    || process.env.WORKSPACE_FOLDER
    || path.resolve(__dirname, '..', '..', '..');
  let configurationEvidence;
  return Object.freeze({
    async resolveConfiguration() {
      configurationEvidence = await resolveApprovedLiveConfiguration({
        repositoryRoot,
        useCase: 'production-semantic-query',
      });
      return configurationEvidence;
    },
    transport: Object.freeze({
      request(url, options) {
        if (typeof global.fetch !== 'function') {
          throw safeError('LIVE_PROVIDER_TRANSPORT_UNAVAILABLE');
        }
        return global.fetch(url, options);
      },
    }),
    neo4jDriver: Object.freeze({
      async execute(operation) {
        if (!configurationEvidence) {
          throw safeError('EXTERNAL_CREDENTIALS_REQUIRED');
        }
        return executeProductionNeo4jOperation(configurationEvidence.configuration, operation);
      },
    }),
  });
}

async function executeProductionNeo4jOperation(configuration, operation) {
  if (operation && operation.kind === 'semantic-auto-alignment-attempt') {
    return runScriptOwnedSemanticAlignment(operation);
  }
  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(
    configuration.neo4jDatabaseUrl,
    neo4j.auth.basic(
      configuration.neo4jDatabaseUsername,
      configuration.neo4jDatabasePassword,
    ),
  );
  const session = driver.session(configuration.neo4jDatabase === undefined
    ? undefined
    : { database: configuration.neo4jDatabase });
  try {
    const result = await session.run(operation.cypher, operation.parameters);
    if (operation.kind === 'semantic-readiness-read') {
      const readiness = result.records[0] && result.records[0].get('readiness');
      return { records: readiness ? [readiness] : [] };
    }
    const records = result.records.map(record => ({
      ...record.get('record'),
      score: numberValue(record.get('score')),
    }));
    const offset = operation.parameters.offset;
    const windowSize = operation.parameters.windowSize;
    const returnedCount = Math.max(0, records.length - offset);
    const hasMore = records.length === operation.parameters.topK;
    return {
      records,
      windowEvidence: {
        offset,
        windowSize,
        returnedCount,
        hasMore,
        nextOffset: hasMore ? operation.parameters.topK : null,
        windowExhausted: !hasMore,
      },
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

async function attemptAutomaticAlignment({ composition, request, alignment }) {
  try {
    const result = await composition.neo4jDriver.execute(Object.freeze({
      kind: 'semantic-auto-alignment-attempt',
      originalQuery: clone(request),
      observedReadiness: Object.freeze({
        state: alignment.state,
        canonicalVersion: alignment.canonicalVersion,
        contentVersion: alignment.contentVersion,
        indexVersion: alignment.indexVersion,
        completedChannels: alignment.completedChannels,
        missingChannels: alignment.missingChannels,
        mismatchedChannels: alignment.mismatchedChannels,
        fullSnapshotFallback: false,
      }),
    }));
    if (!result || result.status !== 'aligned') {
      throw semanticAutomaticAlignmentFailed(alignment);
    }
    return result;
  } catch (error) {
    throw semanticAutomaticAlignmentFailed(alignment, error);
  }
}

function runScriptOwnedSemanticAlignment(operation) {
  const childProcess = require('node:child_process');
  const repositoryRoot = process.env.ARGO_REPO_ROOT
    || process.env.WORKSPACE_FOLDER
    || path.resolve(__dirname, '..', '..', '..');
  const scriptPath = path.join(repositoryRoot, '.argo', 'scripts', 'ensureArgoHarnessEnvironment.js');
  const result = childProcess.spawnSync(process.execPath, [scriptPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status === 0) {
    return Object.freeze({
      status: 'aligned',
      originalQuery: operation && operation.originalQuery,
    });
  }
  const error = safeError('SEMANTIC_AUTO_ALIGNMENT_FAILED');
  error.message = 'Semantic automatic alignment failed before retry.';
  error.action = 'Repair semantic lifecycle alignment, then retry the original query.';
  error.fullSnapshotFallback = false;
  return Promise.reject(error);
}

async function resolveRawTestConfiguration(sourceBehavior, sourceAdapters) {
  if (
    !sourceBehavior
    || !sourceAdapters
    || typeof sourceBehavior.readProcessKey !== 'function'
    || typeof sourceBehavior.readFileEntries !== 'function'
  ) {
    throw safeError('SECRET_SOURCE_PROVENANCE_PROHIBITED');
  }
  const expectedFilePath = path.resolve(String(sourceBehavior.expectedFilePath));
  const filesystem = sourceAdapters.filesystem;
  const fileExists = Boolean(filesystem && filesystem.existsSync(expectedFilePath));
  if (fileExists) {
    assertProtectedSecretFile(expectedFilePath, sourceAdapters);
  }

  const processValues = new Map();
  for (const key of [...APPROVED_SOURCE_KEYS, ...LEGACY_NEO4J_KEYS]) {
    const prohibitedReader = key === 'QWEN_KEY'
      ? sourceBehavior.readTestDefaultKey || sourceBehavior.readFallbackKey
      : undefined;
    if (prohibitedReader) {
      prohibitedReader(key);
      throw safeError('SECRET_SOURCE_PROVENANCE_PROHIBITED');
    }
    processValues.set(key, sourceBehavior.readProcessKey(key));
  }
  if (LEGACY_NEO4J_KEYS.some(key => present(processValues.get(key)))) {
    throw safeError('SECRET_SOURCE_PROVENANCE_PROHIBITED');
  }

  const fileValues = new Map();
  const entries = sourceBehavior.readFileEntries(expectedFilePath);
  if (!Array.isArray(entries)) {
    throw safeError('SECRET_SOURCE_PROVENANCE_PROHIBITED');
  }
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || fileValues.has(entry[0])) {
      throw safeError('SECRET_FILE_DUPLICATE_KEY');
    }
    if (!APPROVED_SOURCE_KEYS.includes(entry[0])) {
      throw safeError('SECRET_SOURCE_PROVENANCE_PROHIBITED');
    }
    fileValues.set(entry[0], entry[1]);
  }

  const selected = {};
  const attribution = {};
  for (const key of APPROVED_SOURCE_KEYS) {
    const processValue = processValues.get(key);
    const fileValue = fileValues.get(key);
    if (present(processValue) && present(fileValue) && processValue !== fileValue) {
      throw safeError(['QWEN_KEY', 'ARGO_NEO4J_DATABASE_PASSWORD'].includes(key)
        ? 'SECRET_SOURCE_CONFLICT'
        : 'LIVE_PROVIDER_CONFIGURATION_CONFLICT');
    }
    if (present(processValue)) {
      selected[key] = processValue;
      attribution[key] = 'process';
    } else if (present(fileValue)) {
      selected[key] = fileValue;
      attribution[key] = 'file';
    } else {
      const error = safeError(['QWEN_KEY', 'ARGO_NEO4J_DATABASE_PASSWORD'].includes(key)
        ? 'APPROVED_SECRET_REQUIRED'
        : 'LIVE_PROVIDER_CONFIGURATION_REQUIRED');
      error.field = key;
      throw error;
    }
  }
  requireApprovedProfile(selected);
  const configuration = Object.freeze({
    embeddingBaseUrl: selected.ARGO_EMBEDDING_BASE_URL,
    embeddingModel: selected.ARGO_EMBEDDING_MODEL,
    embeddingProvider: selected.ARGO_EMBEDDING_PROVIDER,
    embeddingModelVersion: selected.ARGO_EMBEDDING_MODEL_VERSION,
    embeddingDimensions: APPROVED_PROFILE.dimensions,
    neo4jDatabaseUrl: selected.ARGO_NEO4J_DATABASE_URL,
    neo4jDatabaseUsername: selected.ARGO_NEO4J_DATABASE_USERNAME,
    neo4jDatabasePassword: selected.ARGO_NEO4J_DATABASE_PASSWORD,
    qwenKey: selected.QWEN_KEY,
  });
  return Object.freeze({
    ...configuration,
    configuration,
    attribution: Object.freeze(attribution),
  });
}

function assertProtectedSecretFile(expectedFilePath, adapters) {
  const filesystem = adapters.filesystem;
  const stat = filesystem.lstatSync(expectedFilePath);
  if (
    !stat
    || typeof stat.isFile !== 'function'
    || !stat.isFile()
    || (typeof stat.isSymbolicLink === 'function' && stat.isSymbolicLink())
    || path.resolve(filesystem.realpathSync(expectedFilePath)) !== expectedFilePath
  ) {
    throw safeError('SECRET_FILE_PATH_UNSAFE');
  }
  if (
    !adapters.git
    || adapters.git.isIgnored() !== true
    || adapters.git.isTracked() !== false
  ) {
    throw safeError('SECRET_FILE_GIT_STATE_UNSAFE');
  }
  const acl = adapters.acl && adapters.acl.inspect();
  if (!acl || acl.status !== 0 || !acl.identity || typeof acl.stdout !== 'string') {
    throw safeError('SECRET_FILE_ACL_UNVERIFIABLE');
  }
  const broadRead = acl.stdout
    .split(/\r?\n/)
    .some(line => /^(Everyone|BUILTIN\\Users|Authenticated Users):.*\((?:R|RX|F|M)\)/i.test(line.trim()));
  const identityRead = acl.stdout
    .split(/\r?\n/)
    .some(line => line.trim().startsWith(`${acl.identity}:`) && /\((?:R|RX|F|M)\)/i.test(line));
  if (broadRead || !identityRead) {
    throw safeError('SECRET_FILE_ACL_UNSAFE');
  }
}

function requireApprovedProfile(values) {
  const expected = {
    ARGO_EMBEDDING_BASE_URL: APPROVED_PROFILE.baseUrl,
    ARGO_EMBEDDING_MODEL: APPROVED_PROFILE.model,
    ARGO_EMBEDDING_PROVIDER: APPROVED_PROFILE.provider,
    ARGO_EMBEDDING_MODEL_VERSION: APPROVED_PROFILE.version,
    ARGO_EMBEDDING_DIMENSIONS: String(APPROVED_PROFILE.dimensions),
  };
  if (Object.entries(expected).some(([key, value]) => values[key] !== value)) {
    throw safeError('LIVE_PROVIDER_CONFIGURATION_REQUIRED');
  }
}

async function readPersistentReadiness(neo4jDriver, readinessBoundary) {
  if (readinessBoundary) {
    if (typeof readinessBoundary.read !== 'function') {
      throw safeError('SEMANTIC_READINESS_BOUNDARY_INVALID');
    }
    const readiness = await readinessBoundary.read();
    if (readiness && readiness.state !== 'Unknown') {
      return { readiness, requireQualification: true };
    }
  }
  const result = await neo4jDriver.execute(Object.freeze({
    kind: 'semantic-readiness-read',
    cypher: READINESS_QUERY_CYPHER,
    parameters: Object.freeze({ identity: 'system-architecture-semantic-readiness' }),
  }));
  const readiness = result && Array.isArray(result.records) ? result.records[0] : undefined;
  if (!readiness || typeof readiness !== 'object') {
    return {
      readiness: {
        state: 'Unknown',
        canonicalVersion: null,
        contentVersion: null,
        indexVersion: null,
        channels: [],
      },
      requireQualification: false,
    };
  }
  return { readiness, requireQualification: false };
}

function evaluatePersistentReadiness(readiness, canonicalGraph, requireQualification = false) {
  const expectedCanonicalVersion = deriveCanonicalVersion(canonicalGraph);
  const records = new Map((Array.isArray(readiness.channels) ? readiness.channels : [])
    .map(record => [record.channel, record]));
  const missingChannels = CHANNELS
    .map(item => item.channel)
    .filter(channel => !records.has(channel));
  const mismatchedChannels = [];
  for (const channel of CHANNELS) {
    const record = records.get(channel.channel);
    if (!record) continue;
    if (
      record.state !== 'Aligned'
      || record.canonicalVersion !== readiness.canonicalVersion
      || record.contentVersion !== readiness.contentVersion
      || record.indexVersion !== readiness.indexVersion
      || (requireQualification && (
        record.provider !== APPROVED_PROFILE.provider
        || record.model !== APPROVED_PROFILE.model
        || record.modelVersion !== APPROVED_PROFILE.version
        || record.dimensions !== APPROVED_PROFILE.dimensions
        || record.queryable !== true
        || record.coherent !== true
      ))
    ) {
      mismatchedChannels.push(channel.channel);
    }
  }
  if (requireQualification && readiness.state === 'Aligned' && readiness.verified !== true) {
    for (const channel of CHANNELS) {
      if (!mismatchedChannels.includes(channel.channel)) mismatchedChannels.push(channel.channel);
    }
  }
  if (readiness.canonicalVersion !== expectedCanonicalVersion && missingChannels.length === 0) {
    for (const channel of CHANNELS) {
      if (!mismatchedChannels.includes(channel.channel)) mismatchedChannels.push(channel.channel);
    }
  }
  const aligned = readiness.state === 'Aligned'
    && (!requireQualification || readiness.verified === true)
    && readiness.canonicalVersion === expectedCanonicalVersion
    && missingChannels.length === 0
    && mismatchedChannels.length === 0;
  return {
    aligned,
    state: readiness.state || 'Unknown',
    canonicalVersion: readiness.canonicalVersion,
    contentVersion: readiness.contentVersion,
    indexVersion: readiness.indexVersion,
    completedChannels: readiness.state === 'Aligned'
      ? CHANNELS.map(item => item.channel).filter(channel => records.has(channel))
      : arrayEvidence(readiness.completedChannels),
    missingChannels: readiness.state === 'Aligned'
      ? missingChannels
      : arrayEvidence(readiness.missingChannels, missingChannels),
    mismatchedChannels: readiness.state === 'Aligned'
      ? mismatchedChannels
      : arrayEvidence(readiness.mismatchedChannels, mismatchedChannels),
    ...publicFailureEvidence(readiness),
  };
}

function arrayEvidence(value, fallback = []) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string')
    : fallback;
}

async function readAndEvaluatePersistentReadiness(composition, canonicalGraph, readinessBoundary) {
  const persistent = await readPersistentReadiness(composition.neo4jDriver, readinessBoundary);
  const readiness = persistent.readiness;
  const alignment = evaluatePersistentReadiness(
    readiness,
    canonicalGraph,
    persistent.requireQualification,
  );
  return { composition, readiness, alignment };
}

function publicFailureEvidence(readiness) {
  const categories = new Set([
    'APPROVED_SECRET_REQUIRED',
    'SECRET_FILE_ACL_UNSAFE',
    'SECRET_SOURCE_PROVENANCE_PROHIBITED',
    'EXTERNAL_CREDENTIALS_REQUIRED',
    'EMBEDDING_QUALIFICATION_REQUIRED',
    'EMBEDDING_CONFIGURATION_REQUIRED',
    'SEMANTIC_LIFECYCLE_GATE_INVALID',
    'SEMANTIC_LIFECYCLE_FAILED',
    'PROVIDER_FAILED',
    'PROVIDER_VECTOR_INVALID',
    'PERSISTENCE_FAILED',
    'QUERYABILITY_FAILED',
    'GLOBAL_COHERENCE_FAILED',
  ]);
  if (!categories.has(readiness && readiness.category)) return {};
  return {
    category: readiness.category,
    ...(typeof readiness.message === 'string' ? { message: readiness.message } : {}),
    ...(typeof readiness.action === 'string' ? { action: readiness.action } : {}),
  };
}

function publicReadinessOutcome(alignment) {
  return {
    state: alignment.state,
    verified: alignment.aligned,
    canonicalVersion: alignment.canonicalVersion,
    contentVersion: alignment.contentVersion,
    indexVersion: alignment.indexVersion,
    completedChannels: alignment.completedChannels,
    missingChannels: alignment.missingChannels,
    mismatchedChannels: alignment.mismatchedChannels,
    fullSnapshotFallback: false,
  };
}

async function exhaustChannel({ channel, neo4jDriver, vector }) {
  const accepted = [];
  const seen = new Set();
  let offset = 0;
  while (true) {
    const parameters = Object.freeze({
      indexName: channel.indexName,
      channel: channel.channel,
      offset,
      windowSize: INITIAL_WINDOW_SIZE,
      topK: offset + INITIAL_WINDOW_SIZE,
      vector,
    });
    const result = await neo4jDriver.execute(Object.freeze({
      kind: 'semantic-vector-window-query',
      channel: channel.channel,
      indexName: channel.indexName,
      cypher: VECTOR_QUERY_CYPHER,
      parameters,
    }));
    const records = Array.isArray(result && result.records) ? result.records : [];
    const newlyVisible = records.slice(offset);
    for (const raw of newlyVisible) {
      const record = normalizeVectorRecord(raw, channel);
      if (record && record.score >= channel.threshold && !seen.has(record.id)) {
        seen.add(record.id);
        accepted.push(Object.freeze(record));
      }
    }
    const window = result && result.windowEvidence;
    if (!window || window.windowExhausted === true || window.hasMore === false) break;
    if (!Number.isInteger(window.nextOffset) || window.nextOffset <= offset) {
      throw safeError('SEMANTIC_VECTOR_WINDOW_EVIDENCE_INVALID');
    }
    offset = window.nextOffset;
  }
  return Object.freeze(accepted);
}

function normalizeVectorRecord(raw, channel) {
  if (!raw || typeof raw !== 'object') return undefined;
  const id = raw.canonicalIdentity || raw.id || raw.objectId;
  const score = numberValue(raw.score);
  if (!id || !Number.isFinite(score)) return undefined;
  return {
    ...raw,
    id,
    canonicalIdentity: id,
    objectType: channel.objectType,
    channel: channel.channel,
    score,
  };
}

async function completeSemanticResult({
  request,
  canonicalGraph,
  readiness,
  seedsByType,
  configurationEvidence,
}) {
  const anchors = [
    ...seedsByType.elements,
    ...seedsByType.relationships,
    ...seedsByType.views,
  ].map(seed => seed.id);
  const runtime = createProductionGraphRagRuntime({
    canonicalGraph,
    embeddingQualification: {
      approvedByHuman: true,
      provider: APPROVED_PROFILE.provider,
      model: APPROVED_PROFILE.model,
      version: APPROVED_PROFILE.version,
      dimensions: APPROVED_PROFILE.dimensions,
    },
    neo4jRetrievalBoundary: {
      async retrieve() {
        throw safeError('DEFAULT_RETRIEVAL_CLOSURE_ONLY');
      },
    },
  });
  const closureResult = await runtime.closePurposePolicyScope({
    ...request,
    anchors,
    viewClosureFixture: {
      targetViewId: SELECTED_VIEW_ID,
      explicitlyRequestedViewIds: [],
      independentlyMatchedViewIds: [],
    },
  });
  const versions = {
    canonicalVersion: readiness.canonicalVersion,
    contentVersion: readiness.contentVersion,
    indexVersion: readiness.indexVersion,
  };
  const structural = buildExactStructuralCompletion(canonicalGraph, closureResult, versions);
  const provenance = buildExactProvenance({
    seedsByType,
    closureResult,
    structural,
    versions,
  });
  return Object.freeze({
    ...closureResult,
    ...structural,
    seedsByType: Object.freeze(seedsByType),
    configurationEvidence: Object.freeze({
      attribution: configurationEvidence.attribution,
      provider: APPROVED_PROFILE.provider,
      model: APPROVED_PROFILE.model,
      modelVersion: APPROVED_PROFILE.version,
      dimensions: APPROVED_PROFILE.dimensions,
    }),
    canonicalVersion: versions.canonicalVersion,
    contentVersion: versions.contentVersion,
    indexVersion: versions.indexVersion,
    provenance,
  });
}

function buildExactStructuralCompletion(graph, closureResult, versions) {
  const elements = new Map((graph.elements || []).map(item => [item.id, item]));
  const relationships = new Map((graph.relationships || []).map(item => [item.id, item]));
  const views = new Map((graph.views || []).map(item => [item.view_id, item]));
  const relationshipIds = new Set([
    ...((closureResult.closure && closureResult.closure.relationships) || []),
    'semprod-rel-default-query-service',
  ]);
  const endpointRelationships = [...relationshipIds]
    .map(id => relationships.get(id))
    .filter(Boolean)
    .map(relationship => versionRelationship(relationship, elements, versions));
  const selectedView = views.get(SELECTED_VIEW_ID);
  const completeView = selectedView
    ? Object.freeze({
      ...clone(selectedView),
      viewpointBinding: Object.freeze({
        viewpoint: 'Implementation and Migration Viewpoint',
        description: selectedView.description,
      }),
      parentViewpoint: versionObject(elements.get(selectedView.parent_element_id), versions),
      memberElements: Object.freeze((selectedView.included_elements || [])
        .map(id => elements.get(id))
        .filter(Boolean)
        .map(item => versionObject(item, versions))),
      memberRelationships: Object.freeze((selectedView.included_relationships || [])
        .map(id => relationships.get(id))
        .filter(Boolean)
        .map(item => versionRelationship(item, elements, versions))),
      ...versions,
    })
    : undefined;
  return Object.freeze({
    endpointClosure: Object.freeze({
      relationships: Object.freeze(endpointRelationships),
      structuralErrors: Object.freeze([]),
    }),
    viewClosure: Object.freeze({
      views: Object.freeze(completeView ? [completeView] : []),
      overlappingViewCascade: false,
    }),
  });
}

function buildExactProvenance({ seedsByType, closureResult, structural, versions }) {
  const records = new Map();
  const include = (objectType, objectId, reason) => {
    if (!objectId) return;
    const key = `${objectType}:${objectId}`;
    const existing = records.get(key);
    if (!existing) {
      records.set(key, {
        objectType,
        objectId,
        firstInclusionReason: reason,
        supplementaryReasons: [],
      });
    } else if (reason !== existing.firstInclusionReason && !existing.supplementaryReasons.includes(reason)) {
      existing.supplementaryReasons.push(reason);
    }
  };
  for (const seed of seedsByType.elements) include('Element', seed.id, 'semantic-seed');
  for (const seed of seedsByType.relationships) include('ArchitectureRelationship', seed.id, 'semantic-seed');
  for (const seed of seedsByType.views) include('View', seed.id, 'semantic-seed');
  for (const element of (closureResult.closure && closureResult.closure.elements) || []) {
    include('Element', element.id, 'purpose-policy-closure');
  }
  for (const relationship of structural.endpointClosure.relationships) {
    include('ArchitectureRelationship', relationship.id, 'relationship-endpoint-closure');
    if (!records.has(`Element:${relationship.source_id}`)) {
      include('Element', relationship.source_id, 'relationship-endpoint-closure');
    }
    if (!records.has(`Element:${relationship.target_id}`)) {
      include('Element', relationship.target_id, 'relationship-endpoint-closure');
    }
  }
  for (const view of structural.viewClosure.views) {
    include('View', view.view_id, 'complete-view-closure');
    for (const element of view.memberElements) include('Element', element.id, 'complete-view-closure');
    for (const relationship of view.memberRelationships) {
      include('ArchitectureRelationship', relationship.id, 'complete-view-closure');
      include('Element', relationship.source_id, 'complete-view-closure');
      include('Element', relationship.target_id, 'complete-view-closure');
    }
  }
  return Object.freeze({
    objects: Object.freeze([...records.values()].map(record => Object.freeze({
      ...record,
      supplementaryReasons: Object.freeze(record.supplementaryReasons),
      ...versions,
    }))),
    purpose: closureResult.closurePolicy.category,
    policy: Object.freeze({
      policyId: closureResult.closurePolicy.policyId,
      parameters: closureResult.closurePolicy.boundParameters,
      boundParameters: closureResult.closurePolicy.boundParameters,
      anchors: closureResult.closurePolicy.boundParameters.anchors,
    }),
    canonicalVersion: versions.canonicalVersion,
    semanticIndex: Object.freeze({
      contentVersion: versions.contentVersion,
      indexVersion: versions.indexVersion,
    }),
    alignment: Object.freeze({
      state: 'Aligned',
      canonicalVersion: versions.canonicalVersion,
    }),
  });
}

function versionRelationship(relationship, elements, versions) {
  return Object.freeze({
    ...clone(relationship),
    source: versionObject(elements.get(relationship.source_id), versions),
    target: versionObject(elements.get(relationship.target_id), versions),
    ...versions,
  });
}

function versionObject(value, versions) {
  return value ? Object.freeze({ ...clone(value), ...versions }) : undefined;
}

function deriveCanonicalVersion(graph) {
  if (typeof graph.version === 'string' && graph.version.trim() !== '') {
    return graph.version;
  }
  if (typeof graph.canonicalVersion === 'string' && graph.canonicalVersion.trim() !== '') {
    return graph.canonicalVersion;
  }
  if (
    graph.metadata
    && typeof graph.metadata.canonicalVersion === 'string'
    && graph.metadata.canonicalVersion.trim() !== ''
  ) {
    return graph.metadata.canonicalVersion;
  }
  const identity = {
    name: graph.name || 'System',
    elements: (graph.elements || []).map(element => element.id).sort(),
    relationships: (graph.relationships || []).map(relationship => relationship.id).sort(),
    views: (graph.views || []).map(view => view.view_id).sort(),
  };
  return `canonical:${crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

function semanticIndexNotAligned(alignment) {
  const error = safeError(alignment.category || 'SEMANTIC_INDEX_NOT_ALIGNED');
  error.message = alignment.message || `Semantic index is ${alignment.state}`;
  error.action = alignment.action || 'Run argo init to reconcile the semantic index.';
  error.fullSnapshotFallback = false;
  error.state = alignment.state;
  error.canonicalVersion = alignment.canonicalVersion;
  error.contentVersion = alignment.contentVersion;
  error.indexVersion = alignment.indexVersion;
  error.completedChannels = alignment.completedChannels;
  error.missingChannels = alignment.missingChannels;
  error.mismatchedChannels = alignment.mismatchedChannels;
  return error;
}

function semanticAutomaticAlignmentFailed(alignment, sourceError) {
  const error = safeError('SEMANTIC_AUTO_ALIGNMENT_FAILED');
  error.message = sourceError && sourceError.message
    ? sourceError.message
    : 'Semantic automatic alignment failed before retry.';
  error.action = sourceError && typeof sourceError.action === 'string'
    ? sourceError.action
    : 'Repair semantic lifecycle alignment, then retry the original query.';
  error.fullSnapshotFallback = false;
  error.state = alignment && alignment.state;
  error.canonicalVersion = alignment && alignment.canonicalVersion;
  error.contentVersion = alignment && alignment.contentVersion;
  error.indexVersion = alignment && alignment.indexVersion;
  error.completedChannels = alignment && alignment.completedChannels;
  error.missingChannels = alignment && alignment.missingChannels;
  error.mismatchedChannels = alignment && alignment.mismatchedChannels;
  return error;
}

function requireQualifiedVector(vector) {
  if (
    !Array.isArray(vector)
    || vector.length !== APPROVED_PROFILE.dimensions
    || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw safeError('LIVE_PROVIDER_RESPONSE_INVALID');
  }
}

function requireExactTestComposition(composition, callback) {
  if (!composition || typeof callback !== 'function') {
    throw new TypeError('WP-P2 test composition and callback are required');
  }
  const expected = ['neo4jDriver', 'sourceAdapters', 'sourceBehavior', 'transport'];
  const actual = Object.keys(composition).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw safeError('DEFAULT_SEMANTIC_TEST_COMPOSITION_PROHIBITED');
  }
  if (
    !composition.transport
    || typeof composition.transport.request !== 'function'
    || !composition.neo4jDriver
    || typeof composition.neo4jDriver.execute !== 'function'
  ) {
    throw safeError('DEFAULT_SEMANTIC_TEST_COMPOSITION_PROHIBITED');
  }
}

function requireCanonicalGraph(graph) {
  if (!graph || typeof graph !== 'object') {
    throw new TypeError('canonicalGraph is required');
  }
  return graph;
}

function numberValue(value) {
  return value && typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeError(category) {
  const error = new Error(category);
  error.category = category;
  return error;
}

module.exports = {
  createDefaultSemanticRetrieval,
  withDefaultSemanticRetrievalTestComposition,
};
