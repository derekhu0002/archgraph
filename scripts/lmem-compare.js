#!/usr/bin/env node
'use strict';
/**
 * LongMemEval A/B comparison — host orchestrator.
 *   1. select 5 capability groups × 2 questions from the oracle dataset,
 *   2. write results/lmem-compare-selection.json (question + serialized haystack),
 *   3. docker run archgraph-sandbox (mounts selection + argo/.env + results),
 *      executes `node /opt/sandbox/lmem-comparison.js` inside the container,
 *   4. read results/lmem-comparison-report.json and print the summary.
 *
 * Groups (5): temporal-reasoning / multi-session / knowledge-update /
 *             single-session-user / single-session-assistant  (2 each = 10 Q)
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const ORACLE = path.join(ROOT, 'data', 'benchmarks', 'longmemeval', 'longmemeval_oracle.json');
const RESULTS = path.join(ROOT, 'results');
const SEL = path.join(RESULTS, 'lmem-compare-selection.json');
const REPORT = path.join(RESULTS, 'lmem-comparison-report.json');
const DIST = path.join(ROOT, 'sandbox', 'dist');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const GROUPS = ['temporal-reasoning', 'multi-session', 'knowledge-update',
                'single-session-user', 'single-session-assistant'];
const PER = 2;

// Keys the ARGO semantic lifecycle accepts in an env file
// (mirrors READABLE_KEYS in argo/scripts/graph-rag/liveEmbeddingProviderConfig.js).
const SUPPORTED_KEYS = new Set([
  'ARGO_EMBEDDING_BASE_URL',
  'ARGO_EMBEDDING_MODEL',
  'ARGO_EMBEDDING_PROVIDER',
  'ARGO_EMBEDDING_MODEL_VERSION',
  'ARGO_EMBEDDING_DIMENSIONS',
  'ARGO_NEO4J_DATABASE_URL',
  'ARGO_NEO4J_DATABASE_USERNAME',
  'ARGO_NEO4J_DATABASE_PASSWORD',
  'QWEN_KEY',
  'ARGO_NEO4J_DATABASE',
  'ARGO_LIVE_PROVIDER_E2E',
  'ARGO_W31_LIVE_MUTATION_VECTOR_E2E',
]);

// Split an env file into lines whose key is ARGO-supported vs the rest.
// Extra keys (e.g. DEEPSEEK_*) must NOT be in the mounted /env/argo.env
// because the framework's trusted-source preflight rejects unknown keys
// (SECRET_FILE_UNKNOWN_KEY) and the semantic lifecycle then fails.
function splitEnvFile(srcPath) {
  const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);
  const kept = [];
  const extra = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) continue;
    if (SUPPORTED_KEYS.has(m[1])) kept.push(line);
    else extra.push(line);
  }
  return { kept, extra };
}

function serializeHaystack(sessions) {
  const parts = [];
  (sessions || []).forEach((msgs, i) => {
    parts.push(`--- Session ${i + 1} ---`);
    (msgs || []).forEach((m) => parts.push(`${m.role}: ${m.content}`));
  });
  return parts.join('\n');
}

function main() {
  const all = JSON.parse(fs.readFileSync(ORACLE, 'utf8'));
  const selected = [];
  for (const g of GROUPS) {
    const qs = all.filter((q) => q.question_type === g);
    for (let i = 0; i < PER && i < qs.length; i++) {
      selected.push({
        qid: qs[i].question_id,
        type: qs[i].question_type,
        question: qs[i].question,
        answer: qs[i].answer,
        doc_id: `lmem-${qs[i].question_id}`,
        haystack: serializeHaystack(qs[i].haystack_sessions),
      });
    }
  }
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(SEL, JSON.stringify(selected, null, 2));
  console.log(`[lmem] selected ${selected.length} questions (${GROUPS.length} groups × ${PER}) -> ${SEL}`);

  // local tarball (npm pack — NO npm publish), mounted for in-container install
  fs.mkdirSync(DIST, { recursive: true });
  const pack = spawnSync(NPM, ['pack', '--pack-destination', DIST, '--json'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  if (pack.status !== 0) throw new Error('npm pack failed:\n' + (pack.stderr || pack.stdout || ''));
  const tarball = path.join(DIST, JSON.parse(pack.stdout)[0].filename);

  const mounts = [
    '-v', `${tarball}:/tarball/archgraph-argo.tgz:ro`,
    '-v', `${SEL}:/opt/lmem-selection.json:ro`,
    '-v', `${RESULTS}:/results`,
  ];
  const envFile = path.join(ROOT, 'argo', '.env');
  const runArgs = ['run', '--rm', '-e', 'RUN_COMPARISON=1'];
  if (fs.existsSync(envFile)) {
    const { kept, extra } = splitEnvFile(envFile);
    const sanitized = path.join(DIST, 'argo.env.sanitized');
    const extraFile = path.join(DIST, 'argo.env.extra');
    fs.writeFileSync(sanitized, kept.join('\n') + '\n');
    mounts.push('-v', `${sanitized}:/env/argo.env:ro`);
    if (extra.length > 0) {
      fs.writeFileSync(extraFile, extra.join('\n') + '\n');
      runArgs.push('--env-file', extraFile);
    }
  }

  spawnSync('docker', [...runArgs, ...mounts, 'archgraph-sandbox'], { stdio: 'inherit' });

  if (!fs.existsSync(REPORT)) { console.error('[lmem] no report produced'); process.exit(1); }
  const rep = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const a = rep.summary.A; const b = rep.summary.B;
  console.log(`\n[lmem] A(argo)    : ${a.correct}/${a.total}  (${(100 * a.correct / a.total).toFixed(1)}%)  avg ${a.avgLatencyMs}ms  tok ${a.totalTokens}  cost \$${a.totalCost.toFixed(4)}`);
  console.log(`[lmem] B(lightrag): ${b.correct}/${b.total}  (${(100 * b.correct / b.total).toFixed(1)}%)  avg ${b.avgLatencyMs}ms  tok ${b.totalTokens}  cost \$${b.totalCost.toFixed(4)}`);
}

main();
