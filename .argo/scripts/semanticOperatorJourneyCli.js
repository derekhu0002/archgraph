const path = require('node:path');
const {
  semanticOperatorErrorPayload,
} = require('./graph-rag/semanticOperatorError.js');

async function runSemanticOperatorCommand({ command, options = {}, journey }) {
  if (!journey) {
    throw new TypeError('journey is required');
  }
  if (command === 'init') return journey.startNewProject(options);
  if (command === 'backfill') return journey.runExplicitBackfill(options);
  if (command === 'readiness') return journey.verifyReadiness(options);
  if (command === 'query') return journey.query(options);
  if (command === 'snapshot') return journey.readFullSnapshot();
  throw new Error(`Unknown semantic operator command: ${command}`);
}

async function runCliProcess({
  argv = [],
  dependencies = {},
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const command = argv[0];
  const parsedOptions = parseOptions(argv.slice(1));
  const repositoryRoot = dependencies.repositoryRoot
    || process.env.ARGO_REPO_ROOT
    || process.env.WORKSPACE_FOLDER
    || path.resolve(__dirname, '..', '..');
  const options = {
    ...parsedOptions,
    approvedConfigurationRequest: {
      repositoryRoot,
      useCase: 'production-semantic-query',
    },
  };
  const {
    createDefaultProductionSemanticOperatorJourney,
  } = require('./systemarchitecture-mcp-server.js');
  const createSemanticOperatorJourney = dependencies.createSemanticOperatorJourney
    || createDefaultProductionSemanticOperatorJourney;
  try {
    const journey = await createSemanticOperatorJourney({ repositoryRoot });
    const result = await runSemanticOperatorCommand({ command, options, journey });
    stdout.write(`${JSON.stringify(result)}\n`);
    return { exitCode: 0, result };
  } catch (error) {
    const result = {
      status: 'failed',
      error: semanticOperatorErrorPayload(error),
    };
    stderr.write(`${JSON.stringify(result)}\n`);
    return { exitCode: 1, result };
  }
}

async function main(argv = process.argv.slice(2)) {
  const outcome = await runCliProcess({ argv });
  process.exitCode = outcome.exitCode;
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--automatic-backfill') options.automaticBackfillOptIn = true;
    else if (argument === '--explicit-opt-in') options.explicitOptIn = true;
    else if (argument === '--resume') options.resume = true;
    else if (argument === '--request-json') {
      index += 1;
      return JSON.parse(args[index]);
    }
  }
  return options;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      error: semanticOperatorErrorPayload(error),
    })}\n`);
    process.exit(1);
  });
}

module.exports = {
  runCliProcess,
  runSemanticOperatorCommand,
};
