/**
 * Custom Test Executor Template
 *
 * Copy this file to `.argo/scripts/test-executors/` with a descriptive name
 * (e.g., `docker.js`, `cloud-run.js`) and implement the required interface.
 *
 * Each executor module must export:
 *   name: string                    — human-readable identifier for logging
 *   canHandle(acceptanceCriteria, workspaceRoot): boolean
 *   execute(acceptanceCriteria, workspaceRoot): Promise<{exitCode, stdout, stderr}>
 *   getCommandPreview(acceptanceCriteria, workspaceRoot): string | null  (optional)
 *
 * Auto-discovery: any .js/.cjs/.mjs file in this directory is loaded automatically.
 * Custom executors are tried BEFORE the built-in default executor.
 * If canHandle() returns false, the next executor is tried.
 */

const name = 'my-custom-executor';

/**
 * Return true if this executor can handle the given acceptanceCriteria.
 * The acceptanceCriteria is the raw value from the architecture graph's testcase.
 *
 * Example criteria formats this executor might handle:
 *   - "docker://my-image:tag /tests/run.sh"
 *   - "https://ci.example.com/jobs/..."
 *   - "cloud-function://us-central1/my-test"
 */
function canHandle(acceptanceCriteria, workspaceRoot) {
    // TODO: implement your matching logic
    // Example: return acceptanceCriteria.startsWith('docker://');
    return false;
}

/**
 * Return a human-readable command preview for logging.
 * Return null if no preview is available.
 */
function getCommandPreview(acceptanceCriteria, workspaceRoot) {
    // TODO: return a readable command string
    return `[${name}] ${acceptanceCriteria}`;
}

/**
 * Execute the test and return {exitCode, stdout, stderr}.
 * exitCode: 0 = pass, non-zero = fail, null = execution error
 */
async function execute(acceptanceCriteria, workspaceRoot) {
    // TODO: implement your execution logic
    // Example: spawn a Docker container, call a cloud API, etc.
    return {
        exitCode: 1,
        stdout: '',
        stderr: `${name}: not implemented`,
    };
}

module.exports = { name, canHandle, execute, getCommandPreview };
