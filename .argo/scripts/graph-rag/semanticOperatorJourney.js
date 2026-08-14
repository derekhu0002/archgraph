const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LIVE_PROVIDER_GATE = 'ARGO_LIVE_PROVIDER_E2E';
const MUTATION_VECTOR_GATE = 'ARGO_W31_LIVE_MUTATION_VECTOR_E2E';
const SEMANTIC_CHANNELS = Object.freeze(['Element', 'ArchitectureRelationship', 'View']);

function createProductionSemanticOperatorJourney(dependencies) {
  assertDependencies(dependencies);

  async function runBackfill(request, automatic) {
    const configurationRequest = request.approvedConfigurationRequest || request;
    await resolveConfigurationSafely(
      dependencies.resolveApprovedConfiguration,
      configurationRequest,
    );
    const explicitOptIn = automatic
      ? request.automaticBackfillOptIn === true
      : request.explicitOptIn;
    return dependencies.runSemanticBackfill({
      ...request,
      explicitOptIn,
      automatic,
    });
  }

  return Object.freeze({
    async startNewProject(request = {}) {
      const workspace = await dependencies.initializeWorkspace(request);
      const structuralProjection = await dependencies.syncCanonicalStructuralProjection(request);
      const pending = {
        ...structuralProjection,
        workspace,
        semanticState: 'SemanticIndexPending',
        guidance: 'Enable both canonical semantic gates with approved external configuration, then run argo init again.',
      };
      if (request.automaticBackfillOptIn !== true) {
        return Object.freeze(pending);
      }
      const backfill = await runBackfill(request, true);
      return Object.freeze({ ...pending, backfill });
    },

    runExplicitBackfill(request = {}) {
      return runBackfill(request, false);
    },

    async verifyReadiness(request = {}) {
      const readiness = await dependencies.readSemanticReadiness(request);
      if (readiness.verified !== true) {
        throw readinessError(readiness);
      }
      return readiness;
    },

    async query(request = {}) {
      return dependencies.querySystemArchitecture({ query: request });
    },

    readFullSnapshot() {
      return dependencies.querySystemArchitecture({});
    },
  });
}

function assertDependencies(dependencies) {
  for (const name of [
    'initializeWorkspace',
    'syncCanonicalStructuralProjection',
    'resolveApprovedConfiguration',
    'runSemanticBackfill',
    'readSemanticReadiness',
    'querySystemArchitecture',
  ]) {
    if (!dependencies || typeof dependencies[name] !== 'function') {
      throw new TypeError(`${name} is required`);
    }
  }
}

async function runCanonicalSemanticInit(dependencies, request = {}) {
  requireCanonicalInitDependencies(dependencies);
  const providerGate = readGate(dependencies.configurationBehavior, LIVE_PROVIDER_GATE);
  const mutationGate = readGate(dependencies.configurationBehavior, MUTATION_VECTOR_GATE);
  const gateDecision = evaluateDualGate(providerGate, mutationGate);
  const versions = canonicalInitVersions(request);
  await dependencies.finalReadiness.invalidate(canonicalInitReadiness(
    gateDecision === 'disabled' ? 'SemanticIndexPending' : 'Stale',
    versions,
  ));
  if (gateDecision === 'disabled') {
    return Object.freeze({
      state: 'SemanticDisabled',
      alignment: 'SemanticIndexPending',
      readiness: canonicalInitReadiness('SemanticIndexPending', versions),
      fullSnapshotFallback: false,
    });
  }
  if (gateDecision !== 'enabled') {
    const error = safeLifecycleError(
      'SEMANTIC_LIFECYCLE_GATE_INVALID',
      'Set both semantic lifecycle gates to exactly 1, or disable both.',
      'Semantic lifecycle gates must both be exactly 1 or both disabled.',
    );
    throw await recordCanonicalInitFailure(dependencies.finalReadiness, versions, error, 'Failed');
  }

  try {
    await resolveCanonicalConfiguration(dependencies.configurationBehavior, request);
  } catch (error) {
    throw await recordCanonicalInitFailure(dependencies.finalReadiness, versions, error, 'Failed');
  }
  let backfill;
  try {
    backfill = await dependencies.productionGraphRagRuntime.runSemanticBackfill({
      ...request,
      explicitOptIn: true,
      automatic: true,
    });
  } catch {
    const error = reconciliationFailure();
    throw await recordCanonicalInitFailure(dependencies.finalReadiness, versions, error, 'Stale');
  }
  if (!backfill || backfill.alignmentState !== 'Aligned') {
    const error = reconciliationFailure();
    throw await recordCanonicalInitFailure(dependencies.finalReadiness, versions, error, 'Stale');
  }
  let queryable;
  try {
    queryable = await dependencies.finalReadiness.verifyQueryability(backfill);
  } catch {
    queryable = false;
  }
  if (queryable !== true) {
    const error = safeLifecycleError(
      'SEMANTIC_QUERYABILITY_NOT_VERIFIED',
      'Repair semantic vector queryability, then run argo init again.',
    );
    throw await recordCanonicalInitFailure(dependencies.finalReadiness, versions, error, 'Stale');
  }
  let coherent;
  try {
    coherent = await dependencies.finalReadiness.verifyGlobalCoherence(backfill);
  } catch {
    coherent = false;
  }
  if (coherent !== true) {
    const error = safeLifecycleError(
      'SEMANTIC_GLOBAL_COHERENCE_NOT_VERIFIED',
      'Repair semantic global coherence, then run argo init again.',
    );
    throw await recordCanonicalInitFailure(dependencies.finalReadiness, versions, error, 'Stale');
  }
  const alignedEvidence = Object.freeze({
    state: 'Aligned',
    verified: true,
    ...versions,
    completedChannels: ['Element', 'ArchitectureRelationship', 'View'],
    missingChannels: [],
    mismatchedChannels: [],
    fullSnapshotFallback: false,
    channels: Object.freeze(Object.entries(backfill.channels || {}).map(([channel]) => (
      Object.freeze({
        channel,
        state: 'Aligned',
        ...versions,
      })
    ))),
  });
  await dependencies.finalReadiness.recordAligned(alignedEvidence);
  return Object.freeze({
    state: 'Aligned',
    alignment: 'Aligned',
    backfill,
    readiness: alignedEvidence,
    fullSnapshotFallback: false,
  });
}

function requireCanonicalInitDependencies(dependencies) {
  if (!dependencies || !dependencies.configurationBehavior) {
    throw new TypeError('configurationBehavior is required');
  }
  if (
    !dependencies.productionGraphRagRuntime
    || typeof dependencies.productionGraphRagRuntime.runSemanticBackfill !== 'function'
  ) {
    throw new TypeError('productionGraphRagRuntime.runSemanticBackfill is required');
  }
  for (const name of [
    'invalidate',
    'recordFailure',
    'verifyQueryability',
    'verifyGlobalCoherence',
    'recordAligned',
  ]) {
    if (!dependencies.finalReadiness || typeof dependencies.finalReadiness[name] !== 'function') {
      throw new TypeError(`finalReadiness.${name} is required`);
    }
  }
}

function readGate(configurationBehavior, name) {
  if (typeof configurationBehavior.readGate === 'function') {
    return configurationBehavior.readGate(name);
  }
  if (configurationBehavior.gates && typeof configurationBehavior.gates === 'object') {
    return configurationBehavior.gates[name];
  }
  return process.env[name];
}

function evaluateDualGate(providerGate, mutationGate) {
  const providerDisabled = providerGate === undefined || providerGate === '';
  const mutationDisabled = mutationGate === undefined || mutationGate === '';
  if (providerDisabled && mutationDisabled) return 'disabled';
  if (providerGate === '1' && mutationGate === '1') return 'enabled';
  return 'invalid';
}

async function resolveCanonicalConfiguration(configurationBehavior, request) {
  try {
    if (typeof configurationBehavior.readExternalConfiguration === 'function') {
      return await configurationBehavior.readExternalConfiguration(request);
    }
    if (configurationBehavior.state === 'valid-external-only') {
      return configurationBehavior;
    }
    if (typeof configurationBehavior.resolve === 'function') {
      return await configurationBehavior.resolve(request);
    }
    throw safeLifecycleError(
      'EXTERNAL_CREDENTIALS_REQUIRED',
      'Provide approved external semantic configuration, then run argo init again.',
    );
  } catch (error) {
    throw sanitizeLifecycleError(error);
  }
}

function sanitizeLifecycleError(sourceError) {
  const approvedCategories = new Set([
    'APPROVED_SECRET_REQUIRED',
    'SECRET_FILE_ACL_UNSAFE',
    'SECRET_FILE_DUPLICATE_KEY',
    'SECRET_FILE_UNKNOWN_KEY',
    'SECRET_FILE_TRACKED',
    'SECRET_FILE_NOT_IGNORED',
    'SECRET_FILE_PATH_PROHIBITED',
    'SECRET_FILE_REPARSE_PROHIBITED',
    'SECRET_SOURCE_CONFLICT',
    'SECRET_SOURCE_PROVENANCE_PROHIBITED',
    'LIVE_PROVIDER_CONFIGURATION_CONFLICT',
    'EXTERNAL_CREDENTIALS_REQUIRED',
    'EMBEDDING_QUALIFICATION_REQUIRED',
    'EMBEDDING_CONFIGURATION_REQUIRED',
  ]);
  const sourceCategory = sourceError && sourceError.category;
  const category = sourceCategory === 'LIVE_PROVIDER_CONFIGURATION_REQUIRED'
    ? 'EXTERNAL_CREDENTIALS_REQUIRED'
    : (approvedCategories.has(sourceCategory)
      ? sourceCategory
      : 'EMBEDDING_CONFIGURATION_REQUIRED');
  const field = safeConfigurationField(sourceError && sourceError.field);
  const error = safeLifecycleError(
    category,
    configurationAction(category, field),
    configurationMessage(category, field),
  );
  if (field) error.field = field;
  return error;
}

function safeConfigurationField(field) {
  if (typeof field !== 'string') return null;
  return /^(ARGO|QWEN)_[A-Z0-9_]+$/.test(field) ? field : null;
}

function configurationMessage(category, field) {
  if (category === 'SECRET_FILE_UNKNOWN_KEY') {
    return field
      ? `Approved semantic configuration contains unsupported key ${field}.`
      : 'Approved semantic configuration contains an unsupported key.';
  }
  if (category === 'SECRET_FILE_DUPLICATE_KEY') {
    return field
      ? `Approved semantic configuration contains duplicate key ${field}.`
      : 'Approved semantic configuration contains a duplicate key.';
  }
  if (category === 'SECRET_SOURCE_CONFLICT' || category === 'LIVE_PROVIDER_CONFIGURATION_CONFLICT') {
    return field
      ? `Approved semantic configuration has conflicting sources for ${field}.`
      : 'Approved semantic configuration has conflicting sources.';
  }
  if (category === 'SECRET_FILE_TRACKED') {
    return 'Approved semantic configuration file is tracked by Git.';
  }
  if (category === 'SECRET_FILE_NOT_IGNORED') {
    return 'Approved semantic configuration file is not ignored by Git.';
  }
  if (category === 'SECRET_FILE_PATH_PROHIBITED') {
    return 'Semantic configuration must come from repository-relative .argo/.env.';
  }
  if (category === 'SECRET_FILE_REPARSE_PROHIBITED') {
    return 'Approved semantic configuration file must not be a reparse point or symlink.';
  }
  return 'Approved external semantic configuration was rejected.';
}

function configurationAction(category, field) {
  if (category === 'SECRET_FILE_UNKNOWN_KEY') {
    return field
      ? `Remove or rename unsupported key ${field} in .argo/.env, then run argo init again.`
      : 'Remove unsupported keys from .argo/.env, then run argo init again.';
  }
  if (category === 'SECRET_FILE_DUPLICATE_KEY') {
    return field
      ? `Keep exactly one ${field} entry in .argo/.env, then run argo init again.`
      : 'Remove duplicate keys from .argo/.env, then run argo init again.';
  }
  if (category === 'SECRET_SOURCE_CONFLICT' || category === 'LIVE_PROVIDER_CONFIGURATION_CONFLICT') {
    return field
      ? `Make process environment and .argo/.env agree for ${field}, then run argo init again.`
      : 'Resolve conflicting approved configuration sources, then run argo init again.';
  }
  if (category === 'SECRET_FILE_TRACKED') {
    return 'Remove .argo/.env from Git tracking, add it to .gitignore, then run argo init again.';
  }
  if (category === 'SECRET_FILE_NOT_IGNORED') {
    return 'Add .argo/.env to .gitignore, then run argo init again.';
  }
  if (category === 'SECRET_FILE_PATH_PROHIBITED') {
    return 'Move semantic secrets to .argo/.env and remove alternate env file usage, then run argo init again.';
  }
  if (category === 'SECRET_FILE_REPARSE_PROHIBITED') {
    return 'Replace .argo/.env with a regular file, then run argo init again.';
  }
  return 'Correct approved external configuration and retry argo init.';
}

function safeLifecycleError(category, action, message = category) {
  const error = new Error(message);
  error.category = category;
  error.action = action;
  error.fullSnapshotFallback = false;
  error.safeSemanticLifecycleMessage = true;
  return error;
}

function reconciliationFailure() {
  return safeLifecycleError(
    'SEMANTIC_RECONCILIATION_FAILED',
    'Repair the durable semantic reconciliation failure, then run argo init again.',
    'Semantic reconciliation failed before readiness could be verified.',
  );
}

function canonicalInitVersions(request) {
  const repositoryRoot = path.resolve(
    request.repositoryRoot
    || (request.workspace && request.workspace.workspaceRoot)
    || process.cwd(),
  );
  const graph = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, 'design', 'KG', 'SystemArchitecture.json'),
    'utf8',
  ));
  const identity = {
    name: graph.name || 'System',
    elements: (graph.elements || []).map(element => element.id).sort(),
    relationships: (graph.relationships || []).map(relationship => relationship.id).sort(),
    views: (graph.views || []).map(view => view.view_id).sort(),
  };
  const canonicalVersion = `canonical:${crypto.createHash('sha256')
    .update(JSON.stringify(identity))
    .digest('hex')}`;
  return Object.freeze({
    canonicalVersion,
    contentVersion: `content:${canonicalVersion}`,
    indexVersion: `index:${canonicalVersion}`,
  });
}

function canonicalInitReadiness(state, versions, failure = {}) {
  return Object.freeze({
    state,
    verified: false,
    ...versions,
    completedChannels: [],
    missingChannels: [...SEMANTIC_CHANNELS],
    mismatchedChannels: [],
    channels: Object.freeze([]),
    fullSnapshotFallback: false,
    ...failure,
  });
}

async function recordCanonicalInitFailure(finalReadiness, versions, error, state) {
  const evidence = canonicalInitReadiness(state, versions, {
    category: error.category || 'SEMANTIC_LIFECYCLE_FAILED',
    message: error.message || 'Semantic lifecycle failed.',
    action: error.action || 'Repair semantic readiness, then run argo init again.',
    ...(typeof error.field === 'string' ? { field: error.field } : {}),
  });
  await finalReadiness.recordFailure(evidence);
  for (const [field, value] of Object.entries(evidence)) {
    error[field] = value;
  }
  return error;
}

async function resolveConfigurationSafely(resolveApprovedConfiguration, request) {
  try {
    return await resolveApprovedConfiguration(request);
  } catch (sourceError) {
    const category = safeConfigurationCategory(sourceError && sourceError.category);
    const error = new Error(`${category}: approved external configuration was rejected`);
    error.category = category;
    error.action = 'Correct approved external configuration and retry argo semantic init';
    throw error;
  }
}

function safeConfigurationCategory(category) {
  const approvedCategories = new Set([
    'APPROVED_SECRET_REQUIRED',
    'SECRET_FILE_ACL_UNSAFE',
    'SECRET_SOURCE_PROVENANCE_PROHIBITED',
    'EXTERNAL_CREDENTIALS_REQUIRED',
    'EMBEDDING_QUALIFICATION_REQUIRED',
    'EMBEDDING_CONFIGURATION_REQUIRED',
  ]);
  return approvedCategories.has(category) ? category : 'APPROVED_CONFIGURATION_REJECTED';
}

function readinessError(readiness = {}) {
  const error = new Error('SemanticIndexPending');
  error.category = readiness.state || 'SemanticIndexPending';
  error.state = readiness.state || 'SemanticIndexPending';
  error.verified = readiness.verified;
  error.canonicalVersion = readiness.canonicalVersion;
  error.contentVersion = readiness.contentVersion;
  error.indexVersion = readiness.indexVersion;
  error.completedChannels = readiness.completedChannels;
  error.missingChannels = readiness.missingChannels;
  error.mismatchedChannels = readiness.mismatchedChannels;
  error.fullSnapshotFallback = readiness.fullSnapshotFallback;
  return error;
}

module.exports = {
  createProductionSemanticOperatorJourney,
  runCanonicalSemanticInit,
};
