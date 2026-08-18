const {
  DEFAULT_GRAPH_PATH,
  getNeo4jConfig,
  syncArchitectureToNeo4j,
  verifyArchitectureSync,
} = require('./neo4j-system-architecture-store.js');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const architecturePath = args.architecturePath || DEFAULT_GRAPH_PATH;
  const config = getNeo4jConfig({
    database: args.database,
  });

  const result = args.verifyOnly
    ? await verifyArchitectureSync({ architecturePath, ...config })
    : await syncArchitectureToNeo4j({ architecturePath, ...config });

  const verification = args.verifyOnly ? result : result.verification;
  if (!verification.matches) {
    console.error('Neo4j sync verification failed.');
    console.error(JSON.stringify(verification, null, 2));
    process.exit(1);
  }

  const output = {
    mode: args.verifyOnly ? 'verify' : 'sync',
    architecturePath,
    database: config.database,
    databaseProvision: verification.databaseProvision || (result && result.databaseProvision) || null,
    uri: config.uri,
    counts: verification.actual,
    matches: verification.matches,
  };

  console.log(JSON.stringify(output, null, 2));
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--verify') {
      args.verifyOnly = true;
      continue;
    }
    if (token === '--architecture-path') {
      args.architecturePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--database') {
      args.database = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${token}`);
  }

  return args;
}

main().catch(error => {
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
});