const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const {
  getArgoRoot,
  getWorkspaceRoot,
  resolveCallWorkspaceRoot,
} = require('./argo-paths.js');

const DEFAULT_ARCHITECTURE_GRAPH_PATH = 'design/KG/SystemArchitecture.json';

const SCRIPT_CANDIDATES = {
  validateSystemArchitecture: [
    'scripts/validateSystemArchitecture.js',
  ],
  runArchitectureTests: [
    'scripts/runArchitectureTests.js',
  ],
};

const TOOLS = [
  {
    name: 'validateSystemArchitecture',
    description: 'Validate design/KG/SystemArchitecture.json against .argo/schema/SystemArchitecture.schema.json and Argo graph rules.',
    inputSchema: {
      type: 'object',
      properties: {},
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
          description: `Optional architecture graph path relative to workspace root. Default: ${DEFAULT_ARCHITECTURE_GRAPH_PATH}`,
        },
      },
      additionalProperties: false,
    },
  },
];

// Every tool accepts an optional per-call `workspaceRoot` (absolute path,
// honored unconditionally when provided). The DeepSeek Harness bridge injects
// the current session's workspace directory here automatically.
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

function resolveWorkspaceRoot(args) {
  // Per-call workspaceRoot override, honored unconditionally when provided;
  // defaults to the launch-directory root.
  return resolveCallWorkspaceRoot(args);
}

function resolveScriptPath(workspaceRoot, candidates) {
  const argoRoot = getArgoRoot();
  for (const relativePath of candidates) {
    const absolutePath = path.join(argoRoot, relativePath);
    if (fs.existsSync(absolutePath)) {
      return { absolutePath, relativePath };
    }
  }

  for (const relativePath of candidates) {
    const absolutePath = path.join(workspaceRoot, '.argo', relativePath);
    if (fs.existsSync(absolutePath)) {
      return { absolutePath, relativePath };
    }
  }

  throw new Error(`Unable to locate validator script. Checked: ${candidates.join(', ')}`);
}

async function runValidatorScriptStreaming(workspaceRoot, scriptKey, args, progressToken) {
  const { absolutePath, relativePath } = resolveScriptPath(workspaceRoot, SCRIPT_CANDIDATES[scriptKey]);
  const command = process.execPath;
  const commandArgs = [absolutePath, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ARGO_REPO_ROOT: workspaceRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const stdoutLines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

    stdoutLines.on('line', (line) => {
      stdout += line + '\n';

      const progressMatch = line.match(/^\[PROGRESS\]\s*(.+)$/);
      if (progressMatch) {
        try {
          const payload = JSON.parse(progressMatch[1]);
          send({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: payload.passedCount !== undefined
                ? payload.passedCount
                : payload.index + 1,
              total: payload.total,
              message: `${payload.testcaseName || '(unnamed)'}: ${payload.status}`,
            },
          });
        } catch (_) {
          // ignore malformed progress lines
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (exitCode) => {
      const code = exitCode === null ? 1 : exitCode;
      const passed = code === 0;
      resolve({
        status: passed ? 'passed' : 'failed',
        exitCode: code,
        workspaceRoot,
        scriptPath: relativePath,
        command: [command, ...commandArgs],
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function runValidatorScript(workspaceRoot, scriptKey, args = []) {
  const { absolutePath, relativePath } = resolveScriptPath(workspaceRoot, SCRIPT_CANDIDATES[scriptKey]);
  const command = process.execPath;
  const commandArgs = [absolutePath, ...args];

  try {
    const { stdout, stderr } = await execFileAsync(command, commandArgs, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ARGO_REPO_ROOT: workspaceRoot,
      },
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      status: 'passed',
      exitCode: 0,
      workspaceRoot,
      scriptPath: relativePath,
      command: [command, ...commandArgs],
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (error) {
    return {
      status: 'failed',
      exitCode: typeof error.code === 'number' ? error.code : 1,
      workspaceRoot,
      scriptPath: relativePath,
      command: [command, ...commandArgs],
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || error.message || error).trim(),
    };
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
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

async function callTool(name, args, progressToken = null) {
  const workspaceRoot = resolveWorkspaceRoot(args);

  if (name === 'validateSystemArchitecture') {
    return toolResult(await runValidatorScript(workspaceRoot, 'validateSystemArchitecture'));
  }

  if (name === 'runArchitectureTests') {
    const architecturePath = (args && args.architecturePath) || DEFAULT_ARCHITECTURE_GRAPH_PATH;
    if (progressToken) {
      return toolResult(await runValidatorScriptStreaming(workspaceRoot, 'runArchitectureTests', [architecturePath], progressToken));
    }
    return toolResult(await runValidatorScript(workspaceRoot, 'runArchitectureTests', [architecturePath]));
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(request) {
  const { id, method, params } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
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
      result: {
        tools: TOOLS,
      },
    };
  }

  if (method === 'tools/call') {
    try {
      const result = await callTool(params.name, params.arguments || {});
      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: String(error && error.stack ? error.stack : error),
            },
          ],
          isError: true,
        },
      };
    }
  }

  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: {},
    };
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
  TOOLS,
  callTool,
  main,
};
