const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ATTESTATION_PATH = '.argo/temp/semantic-readiness-attestation.json';
const SCHEMA_VERSION = '1.0';
const ACL_REMEDIATION = 'Restrict .argo/temp and semantic-readiness-attestation.json ownership and ACLs to the current OS identity and SYSTEM, then run semantic readiness again';
const FIELDS = Object.freeze([
  'schemaVersion',
  'authorizationOperation',
  'graphPath',
  'verified',
  'canonicalVersion',
  'contentVersion',
  'indexVersion',
  'completedChannels',
  'missingChannels',
  'mismatchedChannels',
  'fullSnapshotFallback',
  'canonicalDigest',
  'integrityDigest',
]);

function createSemanticReadinessAttestationStore(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const graphPath = normalizeGraphPath(options.graphPath);
  const metadataAdapter = options.metadataAdapter;
  const attestationPath = path.join(repositoryRoot, ...ATTESTATION_PATH.split('/'));
  const directoryPath = path.dirname(attestationPath);
  const canonicalPath = path.join(repositoryRoot, ...graphPath.split('/'));

  return Object.freeze({
    record(readiness) {
      const record = buildRecord(readiness, {
        repositoryRoot,
        graphPath,
        canonicalPath,
      });
      writeAttestationAtomically(record, {
        attestationPath,
        directoryPath,
        metadataAdapter,
      });
      return Object.freeze(record);
    },

    read() {
      if (!fs.existsSync(attestationPath)) return null;
      assertPathTrust(attestationPath, directoryPath);
      let record;
      try {
        record = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
      } catch {
        throw attestationError('SEMANTIC_READINESS_ATTESTATION_INVALID');
      }
      assertRecord(record, repositoryRoot);
      assertOperatingSystemTrust({
        attestationPath,
        directoryPath,
        metadataAdapter,
      });
      if (digestFile(canonicalPath) !== record.canonicalDigest) {
        throw attestationError('SEMANTIC_READINESS_ATTESTATION_STALE');
      }
      return Object.freeze(record);
    },

    clear() {
      try {
        fs.rmSync(attestationPath, { force: true });
      } catch {
        throw attestationError('SEMANTIC_READINESS_ATTESTATION_INVALID');
      }
    },

    validate(attestation, readiness) {
      assertOperatingSystemTrust({
        attestationPath,
        directoryPath,
        metadataAdapter,
      });
      if (digestFile(canonicalPath) !== attestation.canonicalDigest) return false;
      return exactReadinessMatch(attestation, readiness);
    },
  });
}

function buildRecord(readiness, context) {
  const record = {
    schemaVersion: SCHEMA_VERSION,
    authorizationOperation: 'verifyReadiness',
    graphPath: context.graphPath,
    verified: readiness.verified === true,
    canonicalVersion: readiness.canonicalVersion,
    contentVersion: readiness.contentVersion,
    indexVersion: readiness.indexVersion,
    completedChannels: copyChannels(readiness.completedChannels),
    missingChannels: copyChannels(readiness.missingChannels),
    mismatchedChannels: copyChannels(readiness.mismatchedChannels),
    fullSnapshotFallback: false,
    canonicalDigest: digestFile(context.canonicalPath),
  };
  record.integrityDigest = integrityDigest(record, context.repositoryRoot);
  assertRecord(record, context.repositoryRoot);
  return record;
}

function writeAttestationAtomically(readiness, context) {
  fs.mkdirSync(context.directoryPath, { recursive: true, mode: 0o700 });
  assertPathTrust(undefined, context.directoryPath);
  const temporaryPath = `${context.attestationPath}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeSync(descriptor, `${JSON.stringify(readiness)}\n`, null, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, context.attestationPath);
    assertMetadataResult(context.metadataAdapter.readReadinessAttestationAcl());
    assertMetadataResult(context.metadataAdapter.readReadinessAttestationOwner());
    assertOperatingSystemTrust(context);
    if (process.platform === 'win32') {
      if (path.dirname(temporaryPath) !== path.dirname(context.attestationPath)) {
        throw attestationError('ATTESTATION_RENAME_VOLUME_CHANGED');
      }
      recordDirectoryFlushFallback('WINDOWS_DIRECTORY_FSYNC_UNSUPPORTED_SAME_DIRECTORY_RENAME');
    } else {
      const directoryDescriptor = fs.openSync(path.dirname(context.attestationPath), 'r');
      fs.fsyncSync(directoryDescriptor);
      fs.closeSync(directoryDescriptor);
    }
    return readiness;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {}
    if (error && error.category) throw error;
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  }
}

function assertRecord(record, repositoryRoot) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_INVALID');
  }
  if (
    Object.keys(record).sort().join('\n') !== [...FIELDS].sort().join('\n')
    || record.schemaVersion !== SCHEMA_VERSION
    || record.authorizationOperation !== 'verifyReadiness'
    || record.verified !== true
    || record.fullSnapshotFallback !== false
    || !isString(record.graphPath)
    || !isString(record.canonicalVersion)
    || !isString(record.contentVersion)
    || !isString(record.indexVersion)
    || !isString(record.canonicalDigest)
    || !isString(record.integrityDigest)
    || !areChannels(record.completedChannels)
    || !areChannels(record.missingChannels)
    || !areChannels(record.mismatchedChannels)
    || record.integrityDigest !== integrityDigest(record, repositoryRoot)
  ) {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_INVALID');
  }
}

function assertPathTrust(attestationPath, directoryPath) {
  let directory;
  try {
    directory = fs.lstatSync(directoryPath);
  } catch {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  }
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  }
  if (!attestationPath) return;
  let file;
  try {
    file = fs.lstatSync(attestationPath);
  } catch {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  }
  if (!file.isFile() || file.isSymbolicLink()) {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  }
}

function assertOperatingSystemTrust(context) {
  assertPathTrust(context.attestationPath, context.directoryPath);
  if (process.platform === 'win32') {
    const identity = assertCommandSucceeded(context.metadataAdapter, 'readCurrentIdentity');
    const directoryAcl = normalizeWindowsAclEvidence(assertCommandSucceeded(
      context.metadataAdapter,
      'readReadinessAttestationDirectoryAcl',
    ), context.directoryPath);
    const fileAcl = normalizeWindowsAclEvidence(
      assertCommandSucceeded(context.metadataAdapter, 'readReadinessAttestationAcl'),
      context.attestationPath,
    );
    const owner = assertCommandSucceeded(
      context.metadataAdapter,
      'readReadinessAttestationOwner',
    );
    assertWindowsAclTrust({ identity, owner, directoryAcl, fileAcl });
    return;
  }
  const file = fs.lstatSync(context.attestationPath);
  const directory = fs.lstatSync(context.directoryPath);
  if (
    (file.mode & 0o077) !== 0
    || (directory.mode & 0o077) !== 0
    || (typeof process.getuid === 'function'
      && (file.uid !== process.getuid() || directory.uid !== process.getuid()))
  ) {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  }
}

function assertCommandSucceeded(adapter, capability) {
  if (!adapter || typeof adapter[capability] !== 'function') {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  }
  const result = adapter[capability]();
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  }
  return result.stdout;
}

function assertMetadataResult(result) {
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  }
  return result.stdout;
}

function exactReadinessMatch(attestation, readiness) {
  return Boolean(
    readiness
    && readiness.verified === true
    && attestation.canonicalVersion === readiness.canonicalVersion
    && attestation.contentVersion === readiness.contentVersion
    && attestation.indexVersion === readiness.indexVersion
    && sameArray(attestation.completedChannels, readiness.completedChannels)
    && sameArray(attestation.missingChannels, readiness.missingChannels)
    && sameArray(attestation.mismatchedChannels, readiness.mismatchedChannels)
    && readiness.fullSnapshotFallback === false
  );
}

function integrityDigest(record, repositoryRoot) {
  const evidence = {};
  for (const field of FIELDS) {
    if (field !== 'integrityDigest') evidence[field] = record[field];
  }
  return digest(`${path.resolve(repositoryRoot)}\n${JSON.stringify(evidence)}`);
}

function digestFile(filePath) {
  try {
    return digest(fs.readFileSync(filePath));
  } catch {
    throw attestationError('SEMANTIC_READINESS_ATTESTATION_INVALID');
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function copyChannels(value) {
  return Array.isArray(value) ? [...value] : [];
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function areChannels(value) {
  return Array.isArray(value) && value.every(isString);
}

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

function normalizeGraphPath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('graphPath is required');
  }
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeIdentity(value) {
  return String(value).trim().toLowerCase();
}

function normalizeWindowsAclEvidence(value, subjectPath) {
  const lines = String(value).split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => (
      line
      && !/^Successfully processed \d+ files?; Failed processing \d+ files?$/i.test(line)
      && !/\b\d+\b.*;\s*.*\b\d+\b/.test(line)
    ));
  if (lines.length > 0) {
    const prefix = String(subjectPath);
    if (lines[0].toLowerCase().startsWith(prefix.toLowerCase())) {
      lines[0] = lines[0].slice(prefix.length).trim();
    }
  }
  return lines.filter(Boolean).join('\n');
}

function parseWindowsAcl(value) {
  const lines = String(value).split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) throw windowsTrustError();
  return lines.map(line => {
    const match = line.match(/^(.+?):((?:\([^)]*\))+?)$/);
    if (!match) throw windowsTrustError();
    const flags = Array.from(
      match[2].matchAll(/\(([^)]*)\)/g),
      entry => entry[1].toUpperCase(),
    );
    return {
      principal: normalizeIdentity(match[1]),
      denied: flags.includes('DENY'),
      permissions: flags
        .filter(flag => !['DENY', 'I', 'OI', 'CI', 'IO'].includes(flag))
        .flatMap(flag => flag.split(',')),
    };
  });
}

function grantsProtectedAccess(entry) {
  return entry.permissions.some(permission => /^(?:F|M|RX|R|W|D|DE|RC|WDAC|WO|S|AS|MA|GR|GW|GE|GA|RD|WD|AD|REA|WEA|X|DC|RA|WA)$/.test(permission));
}

function grantsRequiredIdentityAccess(entry) {
  return entry.permissions.some(permission => permission === 'F' || permission === 'M');
}

function windowsTrustError() {
  const error = new Error('SEMANTIC_READINESS_ATTESTATION_UNTRUSTED');
  error.category = 'SEMANTIC_READINESS_ATTESTATION_UNTRUSTED';
  error.fullSnapshotFallback = false;
  error.action = ACL_REMEDIATION;
  return error;
}

function assertWindowsAclTrust({ identity, owner, directoryAcl, fileAcl }) {
  const current = normalizeIdentity(identity);
  if (!current || normalizeIdentity(owner) !== current) throw windowsTrustError();
  for (const acl of [directoryAcl, fileAcl]) {
    const entries = parseWindowsAcl(acl);
    const currentEntries = entries.filter(entry => entry.principal === current);
    if (
      !currentEntries.some(entry => !entry.denied && grantsRequiredIdentityAccess(entry))
      || currentEntries.some(entry => entry.denied && grantsProtectedAccess(entry))
      || entries.some(entry => (
        !entry.denied
        && grantsProtectedAccess(entry)
        && entry.principal !== current
        && entry.principal !== 'nt authority\\system'
      ))
    ) {
      throw windowsTrustError();
    }
  }
}

function recordDirectoryFlushFallback(reason) {
  return Object.freeze({ reason });
}

function attestationError(category) {
  const error = new Error(category);
  error.category = category;
  error.fullSnapshotFallback = false;
  error.action = category === 'SEMANTIC_READINESS_ATTESTATION_UNTRUSTED'
    ? ACL_REMEDIATION
    : 'Run semantic readiness verification again before semantic query';
  return error;
}

module.exports = {
  createSemanticReadinessAttestationStore,
};
