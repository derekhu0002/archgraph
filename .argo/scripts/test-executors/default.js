/**
 * Default Test Executor — file-extension-based execution.
 *
 * This is the built-in executor that handles the original acceptanceCriteria format:
 * a workspace-relative script path, optionally with a pytest node-id selector.
 *
 * Custom executors can be added to this directory; they are auto-discovered by
 * runArchitectureTests.js. Each executor module must export:
 *   name: string
 *   canHandle(acceptanceCriteria, workspaceRoot): boolean
 *   execute(acceptanceCriteria, workspaceRoot): Promise<{exitCode, stdout, stderr}>
 *   getCommandPreview(acceptanceCriteria, workspaceRoot): string | null  (optional)
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PYTHON_EXECUTABLE = resolvePythonExecutable();
const TEST_TIMEOUT_MS = readPositiveInteger(process.env.ARGO_TEST_TIMEOUT_MS, 120000);

const SUPPORTED_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.py', '.ps1', '.cmd', '.bat']);

const DISALLOWED_PATTERNS = [
    /[\r\n]/,
    /[|&;<>]/,
    /^['"].*['"]$/,
    /^(?:npm|pnpm|yarn|npx|node|python|py|powershell|pwsh|cmd|bash|sh)\b/i,
];

// --- Exported interface ---

const name = 'default';

/**
 * The default executor handles acceptanceCriteria that are workspace-relative
 * script file paths (optionally with ::pytest_node_id selectors).
 */
function canHandle(acceptanceCriteria) {
    if (!acceptanceCriteria) return false;

    for (const pattern of DISALLOWED_PATTERNS) {
        if (pattern.test(acceptanceCriteria)) return false;
    }

    const parsed = parseCriteria(acceptanceCriteria);
    const ext = path.extname(parsed.scriptRelativePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return false;

    if (parsed.selector && ext !== '.py') return false;

    return true;
}

function getCommandPreview(acceptanceCriteria) {
    const parsed = parseCriteria(acceptanceCriteria);
    if (parsed.selector) {
        return formatCommand('python', ['-m', 'pytest', buildPytestNodeId(parsed)]);
    }

    const ext = path.extname(parsed.scriptRelativePath).toLowerCase();
    switch (ext) {
        case '.js': case '.cjs': case '.mjs':
            return formatCommand(process.execPath, [parsed.displayPath || parsed.scriptRelativePath]);
        case '.py':
            return formatCommand('python', [parsed.scriptRelativePath]);
        case '.ps1':
            return formatCommand('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', parsed.scriptRelativePath]);
        case '.cmd': case '.bat':
            return formatCommand(parsed.scriptRelativePath, []);
        default:
            return formatCommand(parsed.scriptRelativePath, []);
    }
}

async function execute(acceptanceCriteria, workspaceRoot) {
    const parsed = parseCriteria(acceptanceCriteria);
    const scriptPath = path.join(workspaceRoot, ...parsed.scriptRelativePath.split('/'));

    if (!fs.existsSync(scriptPath)) {
        return {
            exitCode: null,
            stdout: '',
            stderr: `test script not found: ${acceptanceCriteria}`,
        };
    }

    if (parsed.selector) {
        return runPythonPytestNodeId(parsed, workspaceRoot);
    }

    const ext = path.extname(scriptPath).toLowerCase();
    switch (ext) {
        case '.js': case '.cjs': case '.mjs':
            return runCommand(process.execPath, [scriptPath], workspaceRoot, parsed.fragment
                ? { ARGO_TESTCASE_ANCHOR: parsed.fragment }
                : undefined);
        case '.py':
            return runCommand(PYTHON_EXECUTABLE, [scriptPath], workspaceRoot);
        case '.ps1':
            return runCommand('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], workspaceRoot);
        case '.cmd': case '.bat':
            return runCommand(scriptPath, [], workspaceRoot);
        default:
            return runCommand(scriptPath, [], workspaceRoot);
    }
}

// --- Internal helpers ---

function parseCriteria(value) {
    const [pathAndFragment, ...selectorParts] = value.split('::');
    const hashIndex = pathAndFragment.indexOf('#');
    const scriptRelativePath = hashIndex >= 0 ? pathAndFragment.slice(0, hashIndex) : pathAndFragment;
    const fragment = hashIndex >= 0 ? pathAndFragment.slice(hashIndex + 1).trim() : undefined;
    return {
        scriptRelativePath: normalizePath(scriptRelativePath),
        displayPath: normalizePath(pathAndFragment),
        fragment,
        selector: selectorParts.length > 0 ? selectorParts.join('::').trim() : undefined,
    };
}

function buildPytestNodeId(criteria) {
    return criteria.selector
        ? `${criteria.scriptRelativePath}::${criteria.selector}`
        : criteria.scriptRelativePath;
}

async function runPythonPytestNodeId(criteria, cwd) {
    return runCommand(PYTHON_EXECUTABLE, ['-m', 'pytest', buildPytestNodeId(criteria)], cwd);
}

async function runCommand(command, args, cwd, extraEnv = undefined) {
    try {
        const { stdout, stderr } = await execFileAsync(command, args, {
            cwd,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 10,
            timeout: TEST_TIMEOUT_MS,
            env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
        });
        return { exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
        const timedOut = error && (error.killed || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT');
        return {
            exitCode: typeof error.code === 'number' ? error.code : 1,
            stdout: String(error.stdout || '').trim(),
            stderr: timedOut
                ? `Command timed out after ${TEST_TIMEOUT_MS}ms: ${formatCommand(command, args)}`
                : String(error.stderr || error.message || error).trim(),
        };
    }
}

function resolvePythonExecutable() {
    const workspaceRoot = process.env.ARGO_REPO_ROOT
        || process.env.WORKSPACE_FOLDER
        || path.resolve(__dirname, '..', '..', '..');

    const candidates = process.platform === 'win32'
        ? [
            path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe'),
            path.join(workspaceRoot, 'venv', 'Scripts', 'python.exe'),
        ]
        : [
            path.join(workspaceRoot, '.venv', 'bin', 'python'),
            path.join(workspaceRoot, 'venv', 'bin', 'python'),
        ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return 'python';
}

function readPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePath(value) {
    return String(value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function formatCommand(command, args) {
    return [quote(command), ...args.map(quote)].join(' ');
}

function quote(value) {
    return /\s/.test(value) ? `"${value}"` : value;
}

module.exports = { name, canHandle, execute, getCommandPreview };
