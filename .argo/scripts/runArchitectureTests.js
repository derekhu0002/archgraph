const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const repoRoot = process.env.ARGO_REPO_ROOT
    || process.env.WORKSPACE_FOLDER
    || path.resolve(__dirname, '..', '..');
const PYTHON_EXECUTABLE = resolvePythonExecutable(repoRoot);
const DEFAULT_ARCHITECTURE_GRAPH_PATH = 'design/KG/SystemArchitecture.json';
const FAILURE_RECORDS_PATH = 'design/KG/test-failure-records.json';
const DEFAULT_TEST_TIMEOUT_MS = 60000000;
const TEST_TIMEOUT_MS = readPositiveInteger(process.env.ARGO_TEST_TIMEOUT_MS, DEFAULT_TEST_TIMEOUT_MS);
const TEST_EXECUTORS_DIR = path.join(__dirname, 'test-executors');
const DISALLOWED_ACCEPTANCE_CRITERIA_PATTERNS = [
    /[\r\n]/,
    /[|&;<>]/,
    /^['"].*['"]$/,
    /^(?:npm|pnpm|yarn|npx|node|python|py|powershell|pwsh|cmd|bash|sh)\b/i,
];

// --- Test Executor Registry ---

/** @type {Array<{name:string, canHandle:(criteria:string, wsRoot:string)=>boolean, execute:(criteria:string, wsRoot:string)=>Promise<{exitCode:number|null, stdout:string, stderr:string}>, getCommandPreview?:(criteria:string, wsRoot:string)=>string|null}>} */
let executors = [];

function loadExecutors() {
    if (executors.length > 0) return;

    // Always load the built-in default executor first
    const defaultExecutor = require('./test-executors/default.js');
    executors.push(defaultExecutor);

    // Discover additional executors from the test-executors directory
    if (!fs.existsSync(TEST_EXECUTORS_DIR)) return;

    const entries = fs.readdirSync(TEST_EXECUTORS_DIR);
    for (const entry of entries) {
        if (entry === 'default.js') continue; // already loaded
        if (entry.startsWith('_') || entry.startsWith('.')) continue; // templates / hidden files
        if (!entry.endsWith('.js') && !entry.endsWith('.cjs') && !entry.endsWith('.mjs')) continue;

        try {
            const mod = require(path.join(TEST_EXECUTORS_DIR, entry));
            if (mod && typeof mod.canHandle === 'function' && typeof mod.execute === 'function') {
                executors.push(mod);
                console.log(`[EXECUTOR] Loaded custom executor: ${mod.name || entry}`);
            }
        } catch (err) {
            console.error(`[EXECUTOR] Failed to load ${entry}: ${err.message}`);
        }
    }

    // Sort: default executor last (fallback), custom executors first
    executors.sort((a, b) => {
        if (a.name === 'default') return 1;
        if (b.name === 'default') return -1;
        return 0;
    });
}

/**
 * Find the first executor that can handle the given acceptanceCriteria.
 * Returns null if no executor matches.
 */
function findExecutor(acceptanceCriteria) {
    loadExecutors();
    for (const executor of executors) {
        if (executor.canHandle(acceptanceCriteria, repoRoot)) {
            return executor;
        }
    }
    return null;
}

async function main() {
    const architecturePath = normalizeRelativePath(process.argv[2] || DEFAULT_ARCHITECTURE_GRAPH_PATH);
    let summary;
    try {
        summary = await runArchitectureTests(repoRoot, architecturePath);
    } catch (error) {
        console.error(`Argo architecture test execution failed: ${String(error && error.stack ? error.stack : error)}`);
        process.exit(1);
    }

    printSummary(summary);
    if (summary.failedCount > 0) {
        process.exit(1);
    }
}

async function runArchitectureTests(workspaceRoot, architecturePath) {
    const resolvedArchitecturePath = normalizeRelativePath(architecturePath || DEFAULT_ARCHITECTURE_GRAPH_PATH);
    const graphPath = path.join(workspaceRoot, ...resolvedArchitecturePath.split('/'));
    const graph = await readArchitectureGraph(graphPath);
    const explicitTestcases = collectExplicitTestcases(graph);
    const results = [];
    const failureRecords = [];

    for (const [index, testcase] of explicitTestcases.entries()) {
        logTestcaseStart(index, explicitTestcases.length, testcase);
        const resolvedScriptPath = testcase.acceptanceCriteria
            ? normalizeRelativePath(testcase.acceptanceCriteria)
            : '';

        if (!testcase.acceptanceCriteria) {
            const result = buildExecutionResult({
                testcase,
                resolvedScriptPath: '',
                executionCommand: '',
                status: 'missing-criteria',
                exitCode: null,
                durationMs: 0,
                stdout: '',
                stderr: 'acceptanceCriteria is empty',
            });
            results.push(result);
            logTestcaseFinish(index, explicitTestcases.length, result);
            failureRecords.push(toFailedTestRecord(result));
            continue;
        }

        const validation = validateAcceptanceCriteria(resolvedScriptPath);
        if (!validation.valid) {
            const result = buildExecutionResult({
                testcase,
                resolvedScriptPath,
                executionCommand: '',
                status: 'invalid-criteria',
                exitCode: null,
                durationMs: 0,
                stdout: '',
                stderr: validation.reason || 'acceptanceCriteria must be a direct script file path',
            });
            results.push(result);
            logTestcaseFinish(index, explicitTestcases.length, result);
            failureRecords.push(toFailedTestRecord(result));
            continue;
        }

        const executor = findExecutor(resolvedScriptPath);
        if (!executor) {
            const result = buildExecutionResult({
                testcase,
                resolvedScriptPath,
                executionCommand: '',
                status: 'invalid-criteria',
                exitCode: null,
                durationMs: 0,
                stdout: '',
                stderr: `no test executor can handle: ${resolvedScriptPath}`,
            });
            results.push(result);
            logTestcaseFinish(index, explicitTestcases.length, result);
            failureRecords.push(toFailedTestRecord(result));
            continue;
        }

        const executionCommand = typeof executor.getCommandPreview === 'function'
            ? executor.getCommandPreview(resolvedScriptPath, workspaceRoot)
            : `[executor: ${executor.name || 'unknown'}] ${resolvedScriptPath}`;

        const start = Date.now();
        const execution = await executor.execute(resolvedScriptPath, workspaceRoot);
        const passed = execution.exitCode === 0;
        const result = buildExecutionResult({
            testcase,
            resolvedScriptPath,
            executionCommand,
            status: passed ? 'passed' : 'failed',
            exitCode: execution.exitCode,
            durationMs: Date.now() - start,
            stdout: execution.stdout,
            stderr: execution.stderr,
        });
        results.push(result);
        logTestcaseFinish(index, explicitTestcases.length, result);
        if (!passed) {
            failureRecords.push(toFailedTestRecord(result));
        }
    }

    await writeFailureRecords(workspaceRoot, failureRecords);

    const deliveryChanges = refreshDeliveryStatus(graph, results);
    if (deliveryChanges.length > 0) {
        await writeArchitectureGraph(graphPath, graph);
        console.log(`[DELIVERY] Refreshed delivery status: ${deliveryChanges.length} element(s) changed`);
        for (const change of deliveryChanges) {
            const direction = change.deliveryStatus === 'delivered' ? 'DELIVERED' : 'NOT_DELIVERED';
            console.log(`[DELIVERY]   ${change.id} "${change.name}" [${direction}] ${change.previousStatus || '(none)'} → ${change.deliveryStatus}`);
        }
    }

    return {
        architecturePath: resolvedArchitecturePath,
        failureRecordsPath: FAILURE_RECORDS_PATH,
        totalTestCases: explicitTestcases.length,
        passedCount: results.filter(result => result.passed).length,
        failedCount: failureRecords.length,
        missingCriteriaCount: results.filter(result => result.status === 'missing-criteria').length,
        deliveryChanges,
        results,
        failureRecords,
    };
}

async function readArchitectureGraph(graphPath) {
    try {
        return JSON.parse(await fs.promises.readFile(graphPath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to read architecture graph: ${graphPath}. ${String(error)}`);
    }
}

function buildExecutionResult(input) {
    // Truncate stdout/stderr to bound memory: 32 tests × 4KB each = 128KB max.
    // Error details are typically at the tail; keep the last portion.
    const MAX_OUTPUT_CHARS = 4096;
    const truncate = (s) => {
        const str = String(s || '');
        return str.length > MAX_OUTPUT_CHARS
            ? '...(truncated)...\n' + str.slice(str.length - MAX_OUTPUT_CHARS)
            : str;
    };
    return {
        testcaseName: input.testcase.testcaseName,
        testDescription: input.testcase.testDescription,
        acceptanceCriteria: input.testcase.acceptanceCriteria,
        elementId: input.testcase.elementId,
        resolvedScriptPath: input.resolvedScriptPath,
        executionCommand: input.executionCommand,
        status: input.status,
        passed: input.status === 'passed',
        exitCode: input.exitCode,
        durationMs: input.durationMs,
        stdout: truncate(input.stdout),
        stderr: truncate(input.stderr),
    };
}

async function writeFailureRecords(workspaceRoot, records) {
    const targetPath = path.join(workspaceRoot, ...FAILURE_RECORDS_PATH.split('/'));
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, JSON.stringify(records, null, 2) + '\n', 'utf8');
}

function toFailedTestRecord(result) {
    return {
        testcasename: result.testcaseName,
        testdescription: result.testDescription,
        acceptanceCriteria: result.acceptanceCriteria,
        relatedIntentElementId: result.elementId,
        status: result.status,
        resolvedScriptPath: result.resolvedScriptPath,
        executionCommand: result.executionCommand,
        exitCode: result.exitCode,
        failureError: buildFailureError(result),
        stdout: result.stdout,
        stderr: result.stderr,
    };
}

function buildFailureError(result) {
    const stderr = result.stderr.trim();
    if (stderr) {
        return stderr;
    }
    const stdout = result.stdout.trim();
    if (stdout) {
        return stdout;
    }
    if (result.exitCode !== null) {
        return `Command exited with code ${result.exitCode}`;
    }
    return `Test status: ${result.status}`;
}

function resolvePythonExecutable(workspaceRoot) {
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
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return 'python';
}

async function runCommand(command, args, cwd) {
    try {
        const { stdout, stderr } = await execFileAsync(command, args, {
            cwd,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 10,
            timeout: TEST_TIMEOUT_MS,
        });
        return {
            exitCode: 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
        };
    } catch (error) {
        const timedOut = error && (error.killed || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT');
        return {
            exitCode: typeof error.code === 'number' ? error.code : 1,
            stdout: String(error.stdout || '').trim(),
            stderr: timedOut
                ? `Command timed out after ${TEST_TIMEOUT_MS}ms: ${[command, ...args].join(' ')}`
                : String(error.stderr || error.message || error).trim(),
        };
    }
}

function validateAcceptanceCriteria(value) {
    if (!value) {
        return { valid: false, reason: 'acceptanceCriteria is empty' };
    }

    for (const pattern of DISALLOWED_ACCEPTANCE_CRITERIA_PATTERNS) {
        if (pattern.test(value)) {
            return {
                valid: false,
                reason: 'acceptanceCriteria must be a single workspace-relative test entry only, without extra command wrappers or arguments',
            };
        }
    }

    // Format-specific validation is delegated to test executors via canHandle().
    // If no executor matches, the test loop reports 'invalid-criteria'.
    return { valid: true };
}

function collectExplicitTestcases(graph) {
    const testcases = [];
    for (const element of graph.elements || []) {
        const elementId = String(element.id || '');
        for (const testcase of element.testcases || []) {
            testcases.push({
                elementId,
                testcaseName: String(testcase.name || ''),
                testDescription: String(testcase.description || ''),
                acceptanceCriteria: String(testcase.acceptanceCriteria || '').trim(),
            });
        }
    }
    return testcases;
}

function normalizeRelativePath(value) {
    return String(value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function readPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function logTestcaseStart(index, total, testcase) {
    const label = formatTestcaseLabel(index, total, testcase.testcaseName);
    console.log(`[START] ${label}`);
    console.log(`        script: ${testcase.acceptanceCriteria || '(missing acceptanceCriteria)'}`);
}

function logTestcaseFinish(index, total, result) {
    const label = formatTestcaseLabel(index, total, result.testcaseName);
    const exitCode = result.exitCode === null ? 'n/a' : String(result.exitCode);
    console.log(`[END]   ${label}`);
    console.log(`        result: ${result.status}; exitCode=${exitCode}; durationMs=${result.durationMs}`);
    console.log(`        command: ${result.executionCommand || '(n/a)'}`);
    if (result.stderr) {
        console.log(`        stderr: ${truncateSingleLine(result.stderr)}`);
    }
    console.log(`[PROGRESS] ${JSON.stringify(buildProgressPayload(index, total, result))}`);
}

function buildProgressPayload(index, total, result) {
    return {
        index,
        total,
    };
}

function formatTestcaseLabel(index, total, testcaseName) {
    return `[${index + 1}/${total}] ${testcaseName || '(unnamed testcase)'}`;
}

function truncateSingleLine(value) {
    const singleLine = String(value).replace(/\s+/g, ' ').trim();
    return singleLine.length > 240 ? `${singleLine.slice(0, 237)}...` : singleLine;
}

function printSummary(summary) {
    console.log(`Argo architecture tests from: ${summary.architecturePath}`);
    console.log(`Failure records: ${summary.failureRecordsPath}`);
    console.log(`Total: ${summary.totalTestCases}; Passed: ${summary.passedCount}; Failed or missing: ${summary.failedCount}; Missing acceptanceCriteria: ${summary.missingCriteriaCount}`);
    for (const result of summary.results) {
        const exitCode = result.exitCode === null ? 'n/a' : String(result.exitCode);
        console.log(`- ${result.testcaseName || '(unnamed testcase)'}: ${result.status} | ${result.resolvedScriptPath || '(missing)'} | ${result.executionCommand || '(n/a)'} | exitCode: ${exitCode}`);
    }
}

async function writeArchitectureGraph(graphPath, graph) {
    await fs.promises.writeFile(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf8');
}

// --- Delivery Status Refresh (hard guardrail: computed by test runner, not by agents) ---

/**
 * Dependency direction for delivery:
 * For element X, its upstream dependencies = elements X needs to be delivered first.
 * Mirrors resolveSemanticEdges from systemarchitecture-mcp-server.js.
 *
 *   - Access, Assignment, Specialization, Composition, Aggregation: source depends on target
 *   - Serving, Realization, Flow, Triggering, Influence: target depends on source
 */
const DEPENDENCY_TYPES_SOURCE_DEPENDS_ON_TARGET = new Set(['Access', 'Assignment', 'Specialization', 'Composition', 'Aggregation']);
const DEPENDENCY_TYPES_TARGET_DEPENDS_ON_SOURCE = new Set(['Serving', 'Realization', 'Flow', 'Triggering', 'Influence']);

/**
 * Resolve upstream dependencies for a single element.
 * Returns the set of element IDs that this element depends on.
 */
function resolveUpstreamDependencies(elementId, relationships) {
    const dependencies = new Set();
    for (const rel of relationships || []) {
        const sourceId = String(rel.source_id || rel.source || '');
        const targetId = String(rel.target_id || rel.target || '');
        const relType = String(rel.type || '');

        if (elementId === sourceId && elementId === targetId) continue;

        if (DEPENDENCY_TYPES_SOURCE_DEPENDS_ON_TARGET.has(relType) && elementId === sourceId) {
            dependencies.add(targetId);
            continue;
        }

        if (DEPENDENCY_TYPES_TARGET_DEPENDS_ON_SOURCE.has(relType) && elementId === targetId) {
            dependencies.add(sourceId);
        }
    }
    return dependencies;
}

/**
 * Refresh delivery status for elements with mounted testcases based on test results and dependency topology.
 * An element with mounted testcases is:
 *   - "delivered" when:
 *   1. It has at least one testcase AND all its testcases passed
 *   2. All its upstream dependencies are also "delivered"
 *   - "not_delivered" otherwise
 *
 * Elements without mounted testcases are left untouched: no new deliveryStatus
 * is added, and any existing status remains as-is.
 * Returns the list of elements whose delivery status changed (additions and regressions).
 */
function refreshDeliveryStatus(graph, testResults) {
    if (!graph || !graph.elements) return [];

    // Build test-results map: elementId → { allPassed, hasTestcases }
    const testResultByElement = new Map();
    for (const result of testResults) {
        const eid = String(result.elementId || '');
        if (!testResultByElement.has(eid)) {
            testResultByElement.set(eid, { allPassed: true, hasTestcases: false });
        }
        const entry = testResultByElement.get(eid);
        entry.hasTestcases = true;
        if (!result.passed) {
            entry.allPassed = false;
        }
    }

    // Build upstream dependency map for all elements
    const upstreamDeps = new Map();
    for (const element of graph.elements) {
        const eid = String(element.id || '');
        upstreamDeps.set(eid, resolveUpstreamDependencies(eid, graph.relationships));
    }

    // Record previous delivery status, then strip only mounted-testcase elements.
    // Untested architectural scaffolding is not marked by this runner.
    const previousStatus = new Map();
    for (const element of graph.elements) {
        const eid = String(element.id || '');
        const attr = (element.attributes || []).find(a => a.name === 'deliveryStatus');
        previousStatus.set(eid, attr ? attr.value : '');
        const testInfo = testResultByElement.get(eid);
        if (testInfo && testInfo.hasTestcases && element.attributes) {
            element.attributes = element.attributes.filter(a => a.name !== 'deliveryStatus');
        }
    }

    // Fresh delivery status map — tested elements start as not_delivered.
    // Untested elements preserve their previous status for reporting/dependency
    // bookkeeping but do not block dependents.
    const deliveryStatus = new Map();
    for (const element of graph.elements) {
        const eid = String(element.id || '');
        const testInfo = testResultByElement.get(eid);
        deliveryStatus.set(eid, testInfo && testInfo.hasTestcases ? 'not_delivered' : (previousStatus.get(eid) || ''));
    }

    // Iterate to fixed point: mark elements whose tests pass AND whose upstream deps are delivered
    // Fixed-point iteration: an element becomes 'delivered' when its own tests pass
    // AND all its upstream dependencies are already 'delivered'.  We must guard against
    // re-processing already-delivered elements; otherwise the loop never terminates
    // (every iteration re-enters the marking block for delivered elements, sets
    // changed=true, and pushes duplicate deliveryStatus attributes — OOM on 32 tests).
    let changed = true;
    while (changed) {
        changed = false;
        for (const element of graph.elements) {
            const eid = String(element.id || '');

            // Skip elements already marked as delivered in a previous iteration
            if (deliveryStatus.get(eid) === 'delivered') continue;

            const testInfo = testResultByElement.get(eid);
            // Only mark elements that have testcases.
            if (!testInfo || !testInfo.hasTestcases) continue;
            if (!testInfo.allPassed) continue;

            // Check upstream deps: only those that have testcases block delivery.
            // Elements without testcases (e.g. architectural scaffolding) cannot
            // be marked delivered themselves, so they should not block dependents.
            const deps = upstreamDeps.get(eid) || new Set();
            let allRelevantDepsDelivered = true;
            for (const depId of deps) {
                const depInfo = testResultByElement.get(depId);
                if (depInfo && depInfo.hasTestcases && deliveryStatus.get(depId) !== 'delivered') {
                    allRelevantDepsDelivered = false;
                    break;
                }
            }
            if (!allRelevantDepsDelivered) continue;

            deliveryStatus.set(eid, 'delivered');
            changed = true;
        }
    }

    // Persist final status for every mounted-testcase element.
    for (const element of graph.elements) {
        const eid = String(element.id || '');
        const testInfo = testResultByElement.get(eid);
        if (!testInfo || !testInfo.hasTestcases) continue;

        if (!element.attributes) element.attributes = [];
        element.attributes.push({ name: 'deliveryStatus', value: deliveryStatus.get(eid) || 'not_delivered' });
    }

    // Compute changes for mounted-testcase elements only.
    const changes = [];
    for (const element of graph.elements) {
        const eid = String(element.id || '');
        const testInfo = testResultByElement.get(eid);
        if (!testInfo || !testInfo.hasTestcases) continue;

        const prev = previousStatus.get(eid) || '';
        const curr = deliveryStatus.get(eid) || 'not_delivered';
        if (prev !== curr) {
            changes.push({ id: eid, name: element.name, previousStatus: prev, deliveryStatus: curr });
        }
    }

    return changes;
}

main();
