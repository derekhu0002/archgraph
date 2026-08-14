const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CAPABILITY_NAMES = Object.freeze([
  'isSecretFileIgnored',
  'isSecretFileTracked',
  'readCurrentIdentity',
  'readSecretFileAcl',
]);

function createSystemMetadataCommandAdapter(options = {}) {
  requireExactKeys(options, ['repositoryRoot']);
  const repositoryRoot = requireRepositoryRoot(options.repositoryRoot);
  return createAdapter({
    repositoryRoot,
    executeMetadataCommand: spawnSync,
    mutateInvocation: undefined,
    forbiddenValues: [],
  }).adapter;
}

function createReadinessAttestationMetadataAdapter(options = {}) {
  requireExactKeys(options, ['repositoryRoot']);
  const repositoryRoot = requireRepositoryRoot(options.repositoryRoot);
  const file = path.join(
    options.repositoryRoot,
    '.argo',
    'temp',
    'semantic-readiness-attestation.json',
  );
  const directory = path.dirname(file);
  const environment = sanitizedEnvironment();

  function spawnExact(executable, args) {
    return spawnSync(executable, args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...environment },
      shell: false,
      windowsHide: true,
    });
  }

  return Object.freeze({
    readCurrentIdentity: () => spawnExact('whoami', []),
    readReadinessAttestationDirectoryAcl: () => spawnExact('icacls', [directory]),
    readReadinessAttestationAcl: () => spawnExact('icacls', [file]),
    readReadinessAttestationOwner: () => spawnExact('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      exactOwnerScript(file),
    ]),
  });
}

function exactOwnerScript(file) {
  const literalPath = String(file).replace(/'/g, "''");
  return `(Get-Acl -LiteralPath '${literalPath}').Owner`;
}

function sanitizedEnvironment() {
  return Object.freeze(Object.fromEntries(
    ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR']
      .filter(key => typeof process.env[key] === 'string')
      .map(key => [key, process.env[key]]),
  ));
}

function withSystemMetadataCommandTestComposition(options = {}, callback) {
  requireExactKeys(options, [
    'executeMetadataCommand',
    'forbiddenValues',
    'mutateInvocation',
    'repositoryRoot',
  ], true);
  if (typeof options.executeMetadataCommand !== 'function' || typeof callback !== 'function') {
    throw prohibited();
  }
  const composition = createAdapter({
    repositoryRoot: requireRepositoryRoot(options.repositoryRoot),
    executeMetadataCommand: options.executeMetadataCommand,
    mutateInvocation: options.mutateInvocation,
    forbiddenValues: Array.isArray(options.forbiddenValues) ? [...options.forbiddenValues] : [],
  });
  let result;
  let then;
  let asyncRevocationOwner = false;
  try {
    result = callback(composition.adapter);
    if (
      result !== null
      && (typeof result === 'object' || typeof result === 'function')
    ) {
      then = result.then;
    }
    if (typeof then === 'function') {
      asyncRevocationOwner = true;
      return assimilateThenable(result, then, composition.revoke);
    }
    return undefined;
  } finally {
    if (!asyncRevocationOwner) composition.revoke();
  }
}

async function assimilateThenable(value, then, revoke) {
  try {
    await new Promise((resolve, reject) => {
      then.call(value, resolve, reject);
    });
    return undefined;
  } finally {
    revoke();
  }
}

function createAdapter({
  repositoryRoot,
  executeMetadataCommand,
  mutateInvocation,
  forbiddenValues,
}) {
  const canonicalPath = path.join(repositoryRoot, '.argo', '.env');
  const sanitizedEnvironment = Object.freeze(Object.fromEntries(
    ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR']
      .filter(key => typeof process.env[key] === 'string')
      .map(key => [key, process.env[key]]),
  ));
  let revoked = false;

  function invoke(capabilityName, receivedArguments) {
    if (revoked) {
      const error = new Error('TEST_SYSTEM_METADATA_ADAPTER_REVOKED');
      error.category = 'TEST_SYSTEM_METADATA_ADAPTER_REVOKED';
      throw error;
    }
    if (receivedArguments.length !== 0) throw prohibited();
    const expected = buildInvocation(
      capabilityName,
      repositoryRoot,
      canonicalPath,
      sanitizedEnvironment,
    );
    const candidate = typeof mutateInvocation === 'function'
      ? mutateInvocation(cloneInvocation(expected))
      : expected;
    validateInvocation(candidate, expected, forbiddenValues);
    return executeMetadataCommand(
      candidate.executable,
      [...candidate.args],
      cloneOptions(candidate.options),
    );
  }

  const adapter = Object.create(null);
  for (const capabilityName of CAPABILITY_NAMES) {
    const capability = capabilityName === 'isSecretFileIgnored'
      ? (...args) => invoke(capabilityName, args).status === 0
      : capabilityName === 'isSecretFileTracked'
        ? (...args) => invoke(capabilityName, args).status === 0
        : (...args) => {
          const result = invoke(capabilityName, args);
          return {
            status: result.status,
            stdout: typeof result.stdout === 'string' ? result.stdout : '',
          };
        };
    Object.freeze(capability);
    Object.defineProperty(adapter, capabilityName, {
      value: capability,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  Object.freeze(adapter);
  return {
    adapter,
    revoke() {
      revoked = true;
    },
  };
}

function buildInvocation(capabilityName, repositoryRoot, canonicalPath, environment) {
  const templates = {
    isSecretFileIgnored: ['git', ['check-ignore', '--quiet', '--', '.argo/.env']],
    isSecretFileTracked: ['git', ['ls-files', '--error-unmatch', '--', '.argo/.env']],
    readCurrentIdentity: ['whoami', []],
    readSecretFileAcl: ['icacls', [canonicalPath]],
  };
  const template = templates[capabilityName];
  if (!template) throw prohibited();
  return {
    executable: template[0],
    args: [...template[1]],
    options: {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...environment },
      shell: false,
      windowsHide: true,
    },
  };
}

function validateInvocation(candidate, expected, forbiddenValues) {
  if (!candidate || typeof candidate !== 'object') throw prohibited();
  if (JSON.stringify(candidate) !== JSON.stringify(expected)) throw prohibited();
  const serialized = JSON.stringify(candidate);
  for (const forbiddenValue of forbiddenValues) {
    if (typeof forbiddenValue === 'string' && forbiddenValue && serialized.includes(forbiddenValue)) {
      throw prohibited();
    }
  }
}

function cloneInvocation(invocation) {
  return {
    executable: invocation.executable,
    args: [...invocation.args],
    options: cloneOptions(invocation.options),
  };
}

function cloneOptions(options) {
  return {
    cwd: options.cwd,
    encoding: options.encoding,
    env: { ...options.env },
    shell: options.shell,
    windowsHide: options.windowsHide,
  };
}

function requireExactKeys(value, allowedKeys, optional = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw prohibited();
  const actual = Object.keys(value).sort();
  const allowed = [...allowedKeys].sort();
  if (actual.some(key => !allowed.includes(key))) throw prohibited();
  if (!optional && (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index]))) {
    throw prohibited();
  }
}

function requireRepositoryRoot(value) {
  if (typeof value !== 'string' || value.trim() === '') throw prohibited();
  return path.resolve(value);
}

function prohibited() {
  const error = new Error('SYSTEM_METADATA_COMMAND_PROHIBITED');
  error.category = 'SYSTEM_METADATA_COMMAND_PROHIBITED';
  return error;
}

module.exports = {
  createReadinessAttestationMetadataAdapter,
  createSystemMetadataCommandAdapter,
  withSystemMetadataCommandTestComposition,
};
