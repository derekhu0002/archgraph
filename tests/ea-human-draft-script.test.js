'use strict';

// WP2792 (AT-2792-07): extract-human-draft — an EA-internal JScript (eatool/EA-jsscript/)
// that replaces the removed ea-human-draft argo skill and its node engine (argo/scripts/
// ea-human-diff.js, now deleted). Running INSIDE the open EA model, it reads the canonical
// JSON (design/KG/SystemArchitecture.json) as the BASELINE and the live EA *visible object
// model* (anchored by schema_id / schema_view_id, never kg_sync_meta) as the WORK, then
// classifies the human's changes into the semantic-diff proposal set (addElement/
// updateElement/removeElement / addRelationship/updateRelationship/removeRelationship /
// updateView), excluding pure geometry (layoutOnly).
//   - key fields compared: name / description / type for elements (status is NOT a top-level
//     canonical element field — an element's state lives in attributes[].name=='status', so it
//     is only compared through the attributes diff, never as a top-level fields.status);
//     name / description / type / source / target for relationships
//   - element attributes (t_attribute) and element testcases (t_objecttests) are read and
//     diffed into updateElement.fields.attributes / .testcases
//   - relationship attributes (relationship_attributes_json connector tag) are read and
//     diffed into updateRelationship.fields.attributes
// Writes results/human-draft.md — a compact summary plus the machine proposal set embedded as
// JSON (no standalone .json file). The agent/human reads the Markdown for both.
// ARGO preview/apply.
//
// External-view acceptance (static review, since EA scripts run in the JScript engine and
// cannot be driven by the node test runner): the script exists at the expected path, carries
// the identity markers, anchors on the visible object model (reads t_object/t_connector/
// t_diagramobjects/t_attribute/t_objecttests + schema_id tags), never reads kg_sync_meta,
// classifies all seven ops, excludes geometry, extracts attributes/testcases/type, and wraps
// a main() that writes the two artifacts. The node tool ea-human-diff.js is gone, the removed
// skill is gone from package.json and install-argo.ps1, and the 22 numbered deploy steps are
// untouched.
//
// A gated headless runtime test (AT-2792-07/R) mirrors ea-headless-roundtrip: it only runs
// when $env:EA_RUN_HEADLESS="1" and EA is available; otherwise it explicitly skips.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'eatool', 'EA-jsscript', 'extract-human-draft.js');
const PKG = path.join(ROOT, 'package.json');
const INSTALL = path.join(ROOT, 'install-argo.ps1');
const BOOTSTRAP = path.join(ROOT, 'eatool', 'EA-jsscript', 'headless', 'bootstrap.js');
const RUNNER = path.join(ROOT, 'eatool', 'EA-jsscript', 'headless', 'run-headless.ps1');
const TEMPLATE_QEA = path.join(ROOT, 'argo', 'defaults', 'EA-model-template.qea');
const OLD_NODE_TOOL = path.join(ROOT, 'argo', 'scripts', 'ea-human-diff.js');
const OLD_NODE_TEST = path.join(ROOT, 'tests', 'ea-human-diff.test.js');
const lib = require(path.join(ROOT, 'argo', 'scripts', 'ea-qea-sync-lib.js'));

function readScript() {
  assert.ok(fs.existsSync(SCRIPT), `script should exist: ${SCRIPT}`);
  return fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

test('ea-human-draft-script (AT-2792-07): EA-internal extractor wraps canonical baseline + visible-object-model semantic diff -> JSON + Markdown', () => {
  // GIVEN the extract-human-draft EA script replaces the removed ea-human-draft skill
  const content = readScript();

  // identity + runtime wiring
  assert.match(content, /INC Local Scripts\.EAConstants-JScript/, 'script must include EA constants');
  assert.match(content, /INC UTILITY\.JSON-Parser/, 'script must include the JSON-Parser include');
  assert.match(content, /Extract Human Draft/, 'script must carry its identity comment header');
  assert.match(content, /function\s+main\s*\(\s*\)/, 'script must wrap a main() entry point');
  assert.match(content, /main\s*\(\s*\);/, 'script must invoke main() on load');

  // baseline = canonical JSON (source of truth), NOT a second .qea (EA cannot open two models)
  assert.match(content, /design\\KG\\SystemArchitecture\.json/, 'script defaults baseline to the canonical graph path');
  assert.match(content, /g\.elements|elements/, 'script must read the canonical elements array');
  assert.match(content, /kg_sync_meta\s+\(/, 'script must state it never uses kg_sync_meta / reads the visible object model');

  // read the EA *visible object model* via SQLQuery on the base table names
  assert.match(content, /FROM t_object\b/, 'script must read t_object (elements)');
  assert.match(content, /FROM t_connector\b/, 'script must read t_connector (relationships)');
  assert.match(content, /FROM t_diagramobjects\b/, 'script must read t_diagramobjects (geometry/membership)');
  assert.match(content, /schema_id/, 'script must anchor on the schema_id tag');

  // attributes + testcases are read from EA-visible tables and diffed
  assert.match(content, /FROM t_attribute\b/, 'script must read t_attribute (element attributes)');
  assert.match(content, /FROM t_objecttests\b/, 'script must read t_objecttests (element testcases)');
  assert.match(content, /relationship_attributes_json/, 'script must read relationship attributes (connector tag)');
  assert.match(content, /function\s+diffAttrs\s*\(/, 'script must define an attribute diff helper');
  assert.match(content, /function\s+diffTestcases\s*\(/, 'script must define a testcase diff helper');
  assert.match(content, /fields\.attributes/, 'script must emit attributes into updateElement/updateRelationship fields');
  assert.match(content, /fields\.testcases/, 'script must emit testcases into updateElement fields');
  assert.match(content, /fields\.type/, 'script must emit type into updateElement/updateRelationship fields');

  // classify all canonical ops (incl. view add/remove/update)
  for (const op of ['addElement', 'updateElement', 'removeElement', 'addRelationship', 'updateRelationship', 'removeRelationship', 'addView', 'updateView', 'removeView']) {
    assert.match(content, new RegExp('op' + '.*' + op), `script must classify ${op}`);
  }

  // view add/remove/update detection
  assert.match(content, /extraDiagrams/, 'script must collect unmatched/human-drawn diagrams for addView detection');
  assert.match(content, /op: 'addView'/, 'script must emit addView for a user-added diagram');
  assert.match(content, /op: 'removeView'/, 'script must emit removeView for a canonical view absent from EA');
  assert.match(content, /knownViewNames/, 'script must match EA diagrams to canonical views by view_name (anchor fallback)');
  assert.match(content, /\.description/, 'script must read diagram Notes as the view description for updateView');

  // the Markdown embeds the machine JSON (one proposal per line), not verbose per-item prose
  assert.match(content, /## 提议集（JSON）/, 'script must embed the proposal JSON in the Markdown');
  assert.match(content, /function\s+compactJson\s*\(/, 'script must define a compact JSON helper for the Markdown body');

  // geometry-only is counted and excluded, never a proposal
  assert.match(content, /layoutOnly/, 'script must count layoutOnly (geometry-only, non-canonical)');
  assert.match(content, /geometry/i, 'script must reference geometry');

  // status is NOT a top-level canonical element field: the script must never emit a
  // top-level fields.status (it lives in attributes[].name=='status', handled by diffAttrs)
  assert.doesNotMatch(content, /fields\.status/, 'script must not emit a top-level fields.status (status is an attribute, not a canonical element property)');
  assert.match(content, /no top-level status field/, 'script must document why status is not compared as a top-level field');

  // normalization against the projector's forms (no false positives on a fresh projection):
  // type display-vs-normalized, and canonical attribute content -> EA Notes merge
  assert.match(content, /function\s+typeNorm\s*\(/, 'script must normalize ArchiMate type (display vs normalized) before comparing');
  assert.match(content, /function\s+toEaAttrForm\s*\(/, 'script must normalize canonical attributes to their EA Default/Notes form before diffing');
  assert.match(content, /arrayMapToEaAttrs/, 'element attribute diff must compare against the EA attribute form');

  // new additions carry their semantics: element/relationship descriptions + attrs; a drained
  // anchor-lost relationship is not misreported as a deletion
  assert.match(content, /op: 'addRelationship'[\s\S]*description: recRel\.description/, 'addRelationship.proposed must carry the EA Notes as description');
  assert.match(content, /connectorByEndpoints/, 'script must detect an anchor-lost (still-present) connector to avoid misreporting deletion');
  assert.match(content, /reAnchor/, 'script must emit a reAnchor hint for a drifted connection');
  assert.match(content, /driftedConnectorGuids/, 'script must not double-report a drifted connector as addRelationship');

  // output artifacts: only the Markdown is written (it embeds the proposal JSON)
  assert.match(content, /results\\human-draft/, 'script must default output to results/human-draft');
  assert.match(content, /\.md/, 'script must write the Markdown (which embeds the proposal JSON)');
  assert.doesNotMatch(content, /writeTextUtf8\(outStem \+ '\.json'/, 'script must not write a standalone .json file (JSON is embedded in the Markdown)');
  assert.match(content, /Only the Markdown is written/, 'script must document that only Markdown is written');

  // the node tool (old engine) is fully removed — this EA script is now the only implementation
  assert.ok(!fs.existsSync(OLD_NODE_TOOL), 'argo/scripts/ea-human-diff.js must be deleted');
  assert.ok(!fs.existsSync(OLD_NODE_TEST), 'tests/ea-human-diff.test.js must be deleted');

  // removed skill no longer ships in the npm package
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  assert.ok(Array.isArray(pkg.files) && !pkg.files.includes('argo/skills/ea-human-draft'),
    'package.json files must no longer include argo/skills/ea-human-draft');
  assert.ok(!fs.existsSync(path.join(ROOT, 'argo', 'skills', 'ea-human-draft')),
    'the ea-human-draft skill directory must be removed');

  // installer no longer deploys the skill, but its 22 numbered argo-init steps are intact
  const install = fs.readFileSync(INSTALL, 'utf8');
  assert.doesNotMatch(install, /ea-human-draft/, 'installer must no longer deploy the ea-human-draft skill');
  for (let i = 1; i <= 22; i++) {
    assert.ok(install.includes('[' + i + '/22]'), 'step marker [' + i + '/22] must exist');
  }
  assert.match(install, /\[16\/22\][^\n]*skills\\argo-init/, 'step 16 still deploys the argo-init skill (dsh)');
  assert.match(install, /\[21\/22\][^\n]*skills\\argo-init/, 'step 21 still deploys the argo-init skill (openclaw)');

  // headless draft mode is wired through bootstrap + runner
  const bootstrap = fs.readFileSync(BOOTSTRAP, 'utf8');
  assert.match(bootstrap, /MODE != 'draft'/, 'headless bootstrap must accept the draft mode');
  const runner = fs.readFileSync(RUNNER, 'utf8');
  assert.match(runner, /'draft'/, 'headless runner must accept the draft mode');
  assert.match(runner, /extract-human-draft\.js/, 'headless runner must map draft mode to extract-human-draft.js');
});

function runHeadlessDraft(workQea, graphPath, outStem) {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RUNNER,
    '-Feap', workQea, '-Mode', 'draft', '-Graph', graphPath, '-Output', outStem, '-KillEA', '-TimeoutSec', '300',
  ], { encoding: 'utf8', timeout: 600000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* ignore */ }
  return { json, r };
}

function projectFixture(graph, dir) {
  const baseQea = path.join(dir, 'base.qea');
  const workQea = path.join(dir, 'work.qea');
  const graphPath = path.join(dir, 'graph.json');
  const outStem = path.join(dir, 'human-draft');
  fs.copyFileSync(TEMPLATE_QEA, baseQea);
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf8');
  const proj = lib.fullProjection(graph, baseQea, {});
  assert.ok(proj.ok, 'fullProjection of fixture failed');
  fs.copyFileSync(baseQea, workQea);
  return { workQea, graphPath, outStem, baseQea };
}

// The proposal JSON is embedded in the .md fenced block (no standalone .json file). Extract
// each line and parse it into the proposal array plus the trailing summary (from the table).
// When there are no proposals the script omits the JSON block (it prints an explicit "none"
// note instead), so return an empty list in that case.
function readResultFromMd(outStem) {
  const md = fs.readFileSync(outStem + '.md', 'utf8').replace(/^\uFEFF/, '');
  const block = md.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  const proposals = block
    ? block[1].split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
    : [];
  const counts = {};
  const countRe = /\| ([a-zA-Z]+) \| (\d+) \|/g;
  let m;
  while ((m = countRe.exec(md)) !== null) { counts[m[1]] = +m[2]; }
  return { md, proposals, summary: counts };
}
