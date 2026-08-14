const fs = require('node:fs');
const path = require('node:path');
const {
  createSystemMetadataCommandAdapter,
} = require('./systemMetadataCommandAdapter.js');

const CONFIG_KEYS = Object.freeze([
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
const OPTIONAL_CONFIG_KEYS = Object.freeze([
  'ARGO_NEO4J_DATABASE',
]);
const OPT_IN_KEYS = Object.freeze({
  ARGO_LIVE_PROVIDER_E2E: 'LIVE_PROVIDER_E2E_OPT_IN_REQUIRED',
  ARGO_W31_LIVE_MUTATION_VECTOR_E2E: 'W31_MUTATION_VECTOR_E2E_OPT_IN_REQUIRED',
});
const READABLE_KEYS = Object.freeze([
  ...CONFIG_KEYS,
  ...OPTIONAL_CONFIG_KEYS,
  ...Object.keys(OPT_IN_KEYS),
]);
const LEGACY_KEYS = Object.freeze(['ARGO_NEO4J_URI', 'ARGO_NEO4J_USERNAME', 'ARGO_NEO4J_PASSWORD']);
const PROHIBITED_RUNTIME_FIELD_KEYS = Object.freeze(['neo4jUri', 'embeddingCredential']);
const SECRET_KEYS = new Set(['ARGO_NEO4J_DATABASE_PASSWORD', 'QWEN_KEY']);
const APPROVED = Object.freeze({
  ARGO_EMBEDDING_BASE_URL: 'https://llm-clids9mqc5o1mbvb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  ARGO_EMBEDDING_MODEL: 'qwen3.7-text-embedding',
  ARGO_EMBEDDING_PROVIDER: 'alibaba-cloud-model-studio-openai-compatible-cn-beijing',
  ARGO_EMBEDDING_MODEL_VERSION: 'qualification-2026-07-25',
  ARGO_EMBEDDING_DIMENSIONS: '1024',
});
const issuedAdapters = new WeakSet();
const issuedTraces = new WeakSet();
const invalidTraces = new WeakSet();
const prohibitedTraces = new WeakSet();

async function resolveApprovedLiveConfiguration(options) {
  requireProductionOptions(options);
  const repositoryRoot = requireRoot(options.repositoryRoot);
  return resolveTrusted({
    repositoryRoot,
    requiredOptIns: resolveRequiredOptIns(options),
    adapters: {
      filesystem: fs,
      systemMetadata: createSystemMetadataCommandAdapter({ repositoryRoot }),
    },
    source: createTrustedSource({
      behavior: productionSourceBehavior(repositoryRoot),
    }),
  });
}

async function withApprovedLiveConfigurationTestComposition(
  { sourceBehavior, adapters = {}, observeTrace },
  callback,
) {
  if (!sourceBehavior || typeof callback !== 'function') throw safeError('SOURCE_ADAPTER_UNTRUSTED');
  const source = createTrustedSource({ behavior: sourceBehavior, observeTrace });
  const resolver = Object.freeze(options => resolveTrusted({
    repositoryRoot: requireRoot(options && options.repositoryRoot),
    requiredOptIns: resolveRequiredOptIns(options),
    adapters,
    source,
  }));
  return callback(resolver);
}

async function resolveTrusted({
  repositoryRoot,
  requiredOptIns = ['ARGO_LIVE_PROVIDER_E2E'],
  adapters,
  source,
}) {
  if (!issuedAdapters.has(source)) throw safeError('SOURCE_ADAPTER_UNTRUSTED');
  const filesystem = adapters.filesystem || fs;
  const canonicalFilePath = path.join(repositoryRoot, '.argo', '.env');
  const configuredFilePath = source.filePath();
  const fileExists = filesystem.existsSync(configuredFilePath);
  if (fileExists || path.resolve(configuredFilePath) !== path.resolve(canonicalFilePath)) {
    preflightFile({
      canonicalFilePath,
      configuredFilePath,
      filesystem,
      adapters,
    });
  }

  const processValues = new Map();
  for (const key of [...READABLE_KEYS, ...LEGACY_KEYS, ...PROHIBITED_RUNTIME_FIELD_KEYS]) {
    const envelope = source.readProcessKey(key);
    validateEnvelope(envelope, source, key, null, 'process');
    processValues.set(key, envelope.value);
  }
  if ([...LEGACY_KEYS, ...PROHIBITED_RUNTIME_FIELD_KEYS].some(key => present(processValues.get(key)))) {
    throw safeError('SECRET_SOURCE_PROVENANCE_PROHIBITED');
  }

  const fileValues = new Map();
  if (fileExists) {
    const records = source.readFileEntries(configuredFilePath);
    if (!Array.isArray(records)) throw safeError('SOURCE_TRACE_INVALID');
    for (const record of records) {
      if (!record || !Object.isFrozen(record)) throw safeError('SOURCE_TRACE_UNTRUSTED');
      validateTrace(record.trace, source, record.key, configuredFilePath, 'file');
      if (fileValues.has(record.key)) throw safeError('SECRET_FILE_DUPLICATE_KEY');
      if (!READABLE_KEYS.includes(record.key)) {
        throw safeError(PROHIBITED_RUNTIME_FIELD_KEYS.includes(record.key) || secretLooking(record.key)
          ? 'SECRET_FILE_UNKNOWN_KEY'
          : 'LIVE_PROVIDER_CONFIGURATION_REQUIRED');
      }
      fileValues.set(record.key, record.value);
    }
  }

  const normalized = {};
  const attribution = {};
  for (const key of CONFIG_KEYS) {
    const processValue = processValues.get(key);
    const fileValue = fileValues.get(key);
    if (present(processValue) && present(fileValue) && processValue !== fileValue) {
      throw safeError(SECRET_KEYS.has(key)
        ? 'SECRET_SOURCE_CONFLICT'
        : 'LIVE_PROVIDER_CONFIGURATION_CONFLICT');
    }
    if (present(processValue)) {
      normalized[key] = processValue;
      attribution[key] = 'process';
    } else if (present(fileValue)) {
      normalized[key] = fileValue;
      attribution[key] = 'file';
    } else {
      const error = safeError(SECRET_KEYS.has(key)
        ? 'APPROVED_SECRET_REQUIRED'
        : 'LIVE_PROVIDER_CONFIGURATION_REQUIRED');
      error.field = key;
      throw error;
    }
  }
  for (const key of requiredOptIns) {
    const processValue = processValues.get(key);
    const fileValue = fileValues.get(key);
    if (present(processValue) && present(fileValue) && processValue !== fileValue) {
      throw safeError('LIVE_PROVIDER_CONFIGURATION_CONFLICT');
    }
    const selectedValue = present(processValue) ? processValue : fileValue;
    if (selectedValue !== '1') {
      throw safeError(OPT_IN_KEYS[key]);
    }
    attribution[key] = present(processValue) ? 'process' : 'file';
  }
  for (const [key, expected] of Object.entries(APPROVED)) {
    if (normalized[key] !== expected) throw safeError('LIVE_PROVIDER_CONFIGURATION_REQUIRED');
  }
  const configuration = Object.freeze({
    embeddingBaseUrl: normalized.ARGO_EMBEDDING_BASE_URL,
    embeddingModel: normalized.ARGO_EMBEDDING_MODEL,
    embeddingProvider: normalized.ARGO_EMBEDDING_PROVIDER,
    embeddingModelVersion: normalized.ARGO_EMBEDDING_MODEL_VERSION,
    embeddingDimensions: 1024,
    neo4jDatabaseUrl: normalized.ARGO_NEO4J_DATABASE_URL,
    neo4jDatabaseUsername: normalized.ARGO_NEO4J_DATABASE_USERNAME,
    neo4jDatabasePassword: normalized.ARGO_NEO4J_DATABASE_PASSWORD,
    neo4jDatabase: optionalDatabaseName(processValues.get('ARGO_NEO4J_DATABASE') || fileValues.get('ARGO_NEO4J_DATABASE'), repositoryRoot),
    qwenKey: normalized.QWEN_KEY,
  });
  return Object.freeze({
    ...configuration,
    configuration,
    attribution: Object.freeze({ ...attribution }),
  });
}

function optionalDatabaseName(value, repositoryRoot) {
  if (present(value)) return String(value).trim();
  const repoName = path.basename(repositoryRoot);
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

function createTrustedSource({ behavior, observeTrace }) {
  const adapter = {
    filePath: () => path.resolve(String(behavior.expectedFilePath)),
    readProcessKey(key) {
      const selected = selectProcessOperation(behavior, key);
      return Object.freeze({
        value: selected.read(key),
        trace: issueTrace(selected.makeTrace(key), selected.kind, observeTrace),
      });
    },
    readFileEntries(requestedPath) {
      const selected = selectFileOperation(behavior);
      const entries = selected.read(requestedPath);
      if (!Array.isArray(entries)) return entries;
      return entries.map(([key, value]) => Object.freeze({
        key,
        value,
        trace: issueTrace(selected.makeTrace(key, requestedPath), selected.kind, observeTrace),
      }));
    },
    observeValidation(traceValue, trusted) {
      if (observeTrace) observeTrace(Object.freeze({ phase: 'validated', trace: traceValue, trusted }));
    },
  };
  Object.freeze(adapter);
  issuedAdapters.add(adapter);
  return adapter;
}

function selectProcessOperation(behavior, key) {
  const mutations = [
    ['readCliKey', () => makeTrace('cli', 'cli', key, 'read', [key]), 'prohibited'],
    ['readLiteralKey', () => makeTrace('literal', 'literal', key, 'read', [key]), 'prohibited'],
    ['readFallbackKey', () => makeTrace('process', null, key, 'fallback', [key]), 'prohibited'],
    ['readAliasedProcessKey', () => makeTrace('process', null, key, 'read', ['QWEN_ALIAS', key]), 'prohibited'],
    ['readIndirectProcessKey', () => makeTrace('process', null, key, 'indirect', ['configuration', 'credentials', key]), 'prohibited'],
    ['readProcessKeyWithForgedTrace', () => makeTrace('process', null, key, 'read', [key]), 'forged'],
    ['readProcessKeyWithMutableTrace', () => makeTrace('process', null, key, 'read', [key]), 'mutable'],
    ['readProcessKeyWithInvalidTraceSchema', () => ({ sourceKind: 'process' }), 'invalid'],
    ['readProcessKeyWithRequestedKeyMismatch', () => makeTrace('process', null, `${key}-mismatch`, 'read', [key]), 'invalid'],
    ['readProcessKeyWithMissingTraceField', () => ({
      sourceKind: 'process', path: null, key, operation: 'read',
    }), 'invalid'],
    ['readProcessKeyWithExtraTraceField', () => ({
      ...makeTrace('process', null, key, 'read', [key]), extra: true,
    }), 'invalid'],
    ['readProcessKeyWithWrongTraceFieldType', () => makeTrace('process', null, key, 'read', key), 'invalid'],
  ];
  if (key === 'QWEN_KEY') {
    for (const [method, make, kind] of mutations) {
      if (typeof behavior[method] === 'function') return { read: behavior[method], makeTrace: make, kind };
    }
  }
  return {
    read: behavior.readProcessKey,
    makeTrace: requested => makeTrace('process', null, requested, 'read', [requested]),
    kind: 'issued',
  };
}

function selectFileOperation(behavior) {
  if (typeof behavior.readFileEntriesWithRequestedPathMismatch === 'function') {
    return {
      read: behavior.readFileEntriesWithRequestedPathMismatch,
      makeTrace: (key, requested) => makeTrace('file', `${requested}.mismatch`, key, 'read', [key]),
      kind: 'invalid',
    };
  }
  return {
    read: behavior.readFileEntries,
    makeTrace: (key, requested) => makeTrace('file', requested, key, 'read', [key]),
    kind: 'issued',
  };
}

function issueTrace(candidate, kind, observeTrace) {
  const aliasChain = Array.isArray(candidate.aliasChain)
    ? (kind === 'mutable' ? [...candidate.aliasChain] : Object.freeze([...candidate.aliasChain]))
    : candidate.aliasChain;
  const value = kind === 'mutable'
    ? { ...candidate, aliasChain }
    : Object.freeze({ ...candidate, aliasChain });
  if (kind !== 'forged') issuedTraces.add(value);
  if (kind === 'invalid') invalidTraces.add(value);
  if (kind === 'prohibited') prohibitedTraces.add(value);
  if (observeTrace) observeTrace(Object.freeze({ phase: 'issued', trace: value }));
  return value;
}

function validateEnvelope(envelope, source, key, requestedPath, sourceKind) {
  if (!envelope || !Object.isFrozen(envelope)) throw safeError('SOURCE_TRACE_UNTRUSTED');
  validateTrace(envelope.trace, source, key, requestedPath, sourceKind);
}

function validateTrace(value, source, key, requestedPath, sourceKind) {
  const trusted = issuedTraces.has(value)
    && Object.isFrozen(value)
    && Object.isFrozen(value && value.aliasChain);
  source.observeValidation(value, trusted);
  if (!trusted) throw safeError('SOURCE_TRACE_UNTRUSTED');
  if (invalidTraces.has(value)) throw safeError('SOURCE_TRACE_INVALID');
  const fields = value && typeof value === 'object' ? Object.keys(value).sort().join(',') : '';
  if (
    fields !== 'aliasChain,key,operation,path,sourceKind'
    || typeof value.sourceKind !== 'string'
    || !(value.path === null || typeof value.path === 'string')
    || typeof value.key !== 'string'
    || typeof value.operation !== 'string'
    || !Array.isArray(value.aliasChain)
    || value.aliasChain.some(item => typeof item !== 'string')
  ) {
    throw safeError('SOURCE_TRACE_INVALID');
  }
  if (prohibitedTraces.has(value)) throw safeError('SECRET_SOURCE_PROVENANCE_PROHIBITED');
  if (
    value.sourceKind !== sourceKind
    || value.path !== requestedPath
    || value.key !== key
    || value.operation !== 'read'
    || value.aliasChain.length !== 1
    || value.aliasChain[0] !== key
  ) {
    throw safeError('SOURCE_TRACE_INVALID');
  }
}

function makeTrace(sourceKind, sourcePath, key, operation, aliasChain) {
  return { sourceKind, path: sourcePath, key, operation, aliasChain };
}

function preflightFile({ canonicalFilePath, configuredFilePath, filesystem, adapters }) {
  if (path.resolve(configuredFilePath) !== path.resolve(canonicalFilePath)) {
    throw safeError('SECRET_FILE_PATH_PROHIBITED');
  }
  const stat = filesystem.lstatSync(configuredFilePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw safeError('SECRET_FILE_REPARSE_PROHIBITED');
  if (path.resolve(filesystem.realpathSync(configuredFilePath)) !== path.resolve(canonicalFilePath)) {
    throw safeError('SECRET_FILE_PATH_PROHIBITED');
  }

  let ignored;
  let tracked;
  let aclEvidence;
  if (adapters.systemMetadata) {
    ignored = adapters.systemMetadata.isSecretFileIgnored();
    tracked = adapters.systemMetadata.isSecretFileTracked();
    const identityResult = adapters.systemMetadata.readCurrentIdentity();
    const aclResult = adapters.systemMetadata.readSecretFileAcl();
    aclEvidence = {
      status: aclResult.status,
      stdout: aclResult.stdout,
      identity: identityResult.status === 0 ? identityResult.stdout.trim() : '',
    };
  } else {
    ignored = adapters.git.isIgnored(configuredFilePath);
    tracked = adapters.git.isTracked(configuredFilePath);
    aclEvidence = adapters.acl.inspect(configuredFilePath);
  }
  if (tracked) throw safeError('SECRET_FILE_TRACKED');
  if (!ignored) throw safeError('SECRET_FILE_NOT_IGNORED');
  validateAcl(aclEvidence);
}

function validateAcl(result) {
  if (!result || result.status !== 0 || typeof result.stdout !== 'string' || !result.identity) {
    throw safeError('SECRET_FILE_ACL_UNVERIFIABLE');
  }
  const permissions = parseAcl(result.stdout);
  const current = permissions.get(String(result.identity).toLowerCase());
  if (!current || !current.allow || current.deny) throw safeError('SECRET_FILE_ACL_UNSAFE');
  for (const broad of ['everyone', 'builtin\\users', 'authenticated users', 'nt authority\\authenticated users']) {
    const permission = permissions.get(broad);
    if (permission && permission.allow && !permission.deny) throw safeError('SECRET_FILE_ACL_UNSAFE');
  }
}

function parseAcl(output) {
  const result = new Map();
  for (const line of output.split(/\r?\n/)) {
    const normalizedLine = line.trim().replace(/^[A-Za-z]:\\.*?\.env\s+/, '');
    const match = normalizedLine.match(/^(.+?):((?:\([^)]*\))+)\s*$/);
    if (!match) continue;
    const tokens = [...match[2].matchAll(/\(([^)]*)\)/g)].map(item => item[1].toUpperCase());
    if (!tokens.some(token => /^(?:F|M|R|RX)$/.test(token))) continue;
    const key = match[1].trim().toLowerCase();
    const entry = result.get(key) || { allow: false, deny: false };
    if (tokens.includes('DENY')) entry.deny = true;
    else entry.allow = true;
    result.set(key, entry);
  }
  return result;
}

function productionSourceBehavior(repositoryRoot) {
  return Object.freeze({
    expectedFilePath: path.join(repositoryRoot, '.argo', '.env'),
    readProcessKey: key => process.env[key],
    readFileEntries: filePath => parseEnv(fs.readFileSync(filePath, 'utf8')),
  });
}

function parseEnv(text) {
  const entries = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) throw safeError('SECRET_FILE_INVALID');
    entries.push([line.slice(0, equals).trim(), line.slice(equals + 1)]);
  }
  return entries;
}

function requireRoot(value) {
  if (typeof value !== 'string' || value.trim() === '') throw safeError('LIVE_PROVIDER_CONFIGURATION_REQUIRED');
  return path.resolve(value);
}

function requireProductionOptions(options) {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !Reflect.ownKeys(options).every(key => (
      key === 'repositoryRoot'
      || key === 'requiredOptIns'
      || key === 'useCase'
    ))
    || !Reflect.ownKeys(options).includes('repositoryRoot')
  ) {
    throw safeError('SOURCE_ADAPTER_UNTRUSTED');
  }
}

function resolveRequiredOptIns(options) {
  requireProductionOptions(options);
  if (Object.prototype.hasOwnProperty.call(options, 'useCase')) {
    if (
      options.useCase !== 'production-semantic-query'
      || Object.prototype.hasOwnProperty.call(options, 'requiredOptIns')
    ) {
      throw safeError('SOURCE_ADAPTER_UNTRUSTED');
    }
    return [];
  }
  return normalizeRequiredOptIns(options.requiredOptIns);
}

function normalizeRequiredOptIns(value) {
  const requested = value === undefined ? ['ARGO_LIVE_PROVIDER_E2E'] : value;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw safeError('SOURCE_ADAPTER_UNTRUSTED');
  }
  const normalized = [];
  for (const key of requested) {
    if (!Object.prototype.hasOwnProperty.call(OPT_IN_KEYS, key)) {
      throw safeError('SOURCE_ADAPTER_UNTRUSTED');
    }
    if (!normalized.includes(key)) {
      normalized.push(key);
    }
  }
  return normalized;
}

function present(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function secretLooking(key) {
  return /(?:key|password|secret|token|credential)/i.test(String(key));
}

function safeError(category) {
  const error = new Error(category);
  error.category = category;
  return error;
}

module.exports = {
  resolveApprovedLiveConfiguration,
  withApprovedLiveConfigurationTestComposition,
};
