'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const RULES = path.join(ROOT, 'argo', 'rules', 'archgraph.instructions.md');

function readRules() {
  return fs.readFileSync(RULES, 'utf8');
}

function taskCaptureSection() {
  const rules = readRules();
  const match = rules.match(/<TaskMemoryCapture>([\s\S]*?)<\/TaskMemoryCapture>/);
  assert.ok(match, 'TaskMemoryCapture section must exist');
  return match[1];
}

// Reference parser for the protocol's marker line. The control plane implements
// its own parser; this one proves the grammar in the rules is executable and
// unambiguous.
function parseCaptureMarker(text) {
  const markerLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('memory-capture:'));
  if (markerLines.length === 0) return { kind: 'missing' };
  if (markerLines.length > 1) return { kind: 'invalid', reason: 'more than one marker' };

  const line = markerLines[0];
  const written = line.match(/^memory-capture: argo:([^#\s]+)#(\S+)$/);
  if (written) return { kind: 'written', graphKey: written[1], elementId: written[2] };

  const skipped = line.match(/^memory-capture: none: (.+)$/);
  if (skipped) return { kind: 'none', reason: skipped[1].trim() };

  return { kind: 'invalid', reason: 'malformed marker' };
}

test('AT-task-memory-capture-01: one task-level summary, not per-turn/per-session', () => {
  // GIVEN the global ARGO workflow rules file
  const section = taskCaptureSection();
  // THEN it declares one summary per task and rejects per-turn summarization
  assert.match(section, /ONE summary per task/i, 'must declare one summary per task');
  assert.match(section, /never per turn/i, 'must state it is not per turn');
  assert.match(section, /do not.*per-turn|not.*per-turn/i, 'must not require per-turn summaries');
  // AND the summary is written before reporting the task complete
  assert.match(section, /before reporting it complete/i, 'must be written before completion');
  // AND the control plane, not the framework, determines task end
  assert.match(section, /control plane.*determines when the task ends/i, 'control plane owns task end');
});

test('AT-task-memory-capture-02: summary content is the four-part capture checklist', () => {
  // GIVEN the task capture contract
  const section = taskCaptureSection();
  // THEN it requires result + evidence (commit/files/verification)
  assert.match(section, /result and evidence/i);
  assert.match(section, /commit id/i);
  assert.match(section, /verification/i);
  // AND key decisions with rejected alternatives
  assert.match(section, /key decisions/i);
  assert.match(section, /rejected alternatives/i);
  // AND pitfalls with symptom -> cause -> fix
  assert.match(section, /pitfalls and fixes/i);
  assert.match(section, /symptom, cause, fix/i);
});

test('AT-task-memory-capture-03: marker grammar has written and none forms', () => {
  // GIVEN the task capture contract
  const section = taskCaptureSection();
  // THEN the written marker is defined verbatim
  assert.match(section, /memory-capture: argo:<graphKey>#<elementId>/);
  // AND the deliberate-skip marker carries a reason
  assert.match(section, /memory-capture: none: <reason>/);
  // AND the prefix is case-sensitive and the graph key is verbatim
  assert.match(section, /case-sensitive/);
  assert.match(section, /verbatim/);
});

test('AT-task-memory-capture-04: control plane blocks twice, then releases without escalation', () => {
  // GIVEN the task capture contract
  const section = taskCaptureSection();
  // THEN the control plane (not the framework) enforces it
  assert.match(section, /Enforcement belongs to the control plane/i);
  // AND it blocks with the exact template, up to two times
  assert.match(section, /up to two times/i);
  assert.match(section, /exact template/i);
  // AND after two blocks it releases and continues normal flow
  assert.match(section, /then releases and continues the normal flow/i);
  // AND it never escalates to a human
  assert.match(section, /without escalating to a human/i);
  // AND a declared none is a conscious waiver that passes immediately
  assert.match(section, /conscious waiver and passes immediately/i);
  // AND the framework never hard-blocks and exposes no CLI/MCP checker
  assert.match(section, /never hard-blocks/i);
  assert.match(section, /no CLI or MCP checker/i);
});

test('AT-task-memory-capture-05: CoreRules make task-end capture a red line', () => {
  // GIVEN the CoreRules section
  const rules = readRules();
  const coreRules = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(coreRules, 'CoreRules section must exist');
  // THEN it references the task capture contract and its marker
  assert.match(coreRules[1], /TaskMemoryCapture/);
  assert.match(coreRules[1], /memory-capture/);
  // AND it keeps enforcement with the control plane, not the framework
  assert.match(coreRules[1], /control plane, not this framework, enforces it/i);
});

test('AT-task-memory-capture-06: marker parser accepts written/none and rejects malformed/duplicate', () => {
  // GIVEN the marker grammar
  const graphKey = 'design/KG/SystemArchitecture.json';
  const elementId = 'overseer-wm-summary-001';

  // WHEN the summary contains a written marker
  assert.deepEqual(parseCaptureMarker(`memory-capture: argo:${graphKey}#${elementId}`), {
    kind: 'written',
    graphKey,
    elementId,
  });

  // AND WHEN it declares a deliberate skip
  assert.deepEqual(parseCaptureMarker('memory-capture: none: no graph access'), {
    kind: 'none',
    reason: 'no graph access',
  });

  // THEN a summary without a marker is detected as missing (the "forgot" branch)
  assert.equal(parseCaptureMarker('just a summary without a marker').kind, 'missing');

  // AND the prefix is case-sensitive
  assert.equal(parseCaptureMarker(`Memory-Capture: argo:${graphKey}#${elementId}`).kind, 'missing');

  // AND exactly one marker is allowed
  const duplicated = [
    `memory-capture: argo:${graphKey}#${elementId}`,
    `memory-capture: argo:${graphKey}#${elementId}`,
  ].join('\n');
  assert.equal(parseCaptureMarker(duplicated).kind, 'invalid');

  // AND a malformed written marker is rejected
  assert.equal(parseCaptureMarker('memory-capture: argo:no-id').kind, 'invalid');
});

test('AT-task-memory-capture-07: no CLI or MCP checker is introduced (protocol-only)', () => {
  // GIVEN the protocol-only decision
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // THEN no bin entry exposes a memory-capture checker
  for (const binName of Object.keys(pkg.bin || {})) {
    assert.doesNotMatch(binName, /memory|capture/i, `unexpected bin entry: ${binName}`);
  }
  // AND no bin file is a memory-capture checker
  for (const file of fs.readdirSync(path.join(ROOT, 'bin'))) {
    assert.doesNotMatch(file, /memory|capture/i, `unexpected bin file: ${file}`);
  }
  // AND neither MCP server exposes a capture-check tool
  for (const rel of ['argo/scripts/argo-mcp-server.js', 'argo/scripts/systemarchitecture-mcp-server.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /checkTaskMemory|task-memory-capture|memoryCaptureCheck/i, `${rel} must not expose a capture checker`);
  }
});
