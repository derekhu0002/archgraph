'use strict';

// Render a CONCISE, human-readable summary of the argo-init report.
//
// The full report is large (the endpoint matrix alone is ~180 KB); the CLI used
// to print it whole, flooding the terminal/agent context. The CLI now prints this
// summary by default and the COMPLETE report only with `--json` (still always
// written to .argo/temp/argo-harness-init-report.json).
//
// Pure and defensive: it never throws and tolerates partial reports (an early
// failure leaves later sections absent).

const path = require('node:path');

function present(value) {
  return value !== undefined && value !== null;
}

function countItems(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((n, key) => n + countItems(value[key]), 0);
  }
  return value ? 1 : 0;
}

function axiomCategoryCount(axioms) {
  if (!axioms || typeof axioms !== 'object') return 0;
  return Object.keys(axioms).filter(key => countItems(axioms[key]) > 0).length;
}

function sectionStatus(section) {
  return section && section.status ? String(section.status) : 'n/a';
}

function insideWorkspace(target, workspaceRoot) {
  if (typeof target !== 'string' || target.trim() === '') return false;
  const resolved = path.resolve(target).replace(/[\\/]+$/, '');
  const root = path.resolve(workspaceRoot).replace(/[\\/]+$/, '');
  const normalizedResolved = resolved.toLowerCase();
  const normalizedRoot = root.toLowerCase();
  return normalizedResolved === normalizedRoot
    || normalizedResolved.startsWith(`${normalizedRoot}${path.sep.toLowerCase()}`)
    || normalizedResolved.startsWith(`${normalizedRoot}/`);
}

function yesNo(flag) {
  return flag ? 'yes' : 'no';
}

// Collect the human-actionable failures across every phase (blocking sections).
const FAILABLE = ['workspaceBootstrap', 'mcp', 'systemArchitecture', 'ontology', 'ontologyValidation', 'neo4j', 'qeaFullProjection', 'subdiagramViews', 'semanticLifecycle'];

function failureLines(report) {
  const lines = [];
  for (const name of FAILABLE) {
    const section = report && report[name];
    if (section && section.status === 'failed') {
      const detail = section.error || section.message || section.category || (Array.isArray(section.errors) ? section.errors.join('; ') : '');
      lines.push(`  - ${name}: ${String(detail).slice(0, 400)}`);
    }
  }
  if (report && report.error && !lines.length) {
    lines.push(`  - ${String(report.error).slice(0, 400)}`);
  }
  return lines;
}

function renderInitSummary(report) {
  if (!report || typeof report !== 'object') return 'ARGO INIT  unknown (no report)\n';

  const workspaceRoot = report.workspaceRoot || process.cwd();
  const repoName = path.basename(workspaceRoot);
  const overall = report.status === 'ok' ? 'OK' : 'FAILED';

  const schema = report.schemaBundle || report.schema || {};
  const schemaLine = `${schema.kind || 'unknown'} / ${schema.language || 'unknown'}${schema.dialect ? ` (${schema.dialect})` : ''}`
    + `${schema.actorElementType ? `   actor: ${schema.actorElementType}` : ''}`
    + `${schema.bundleValidation ? `   bundleValidation: ${schema.bundleValidation}` : ''}`;

  const lines = [];
  lines.push(`ARGO INIT  ${overall}`);
  // The argo-init CLI always runs prepare-and-check (never check-only); the
  // returned report object may omit `mode`, so default it instead of printing n/a.
  lines.push(`workspace: ${repoName} (${workspaceRoot})   mode: ${report.mode || 'prepare-and-check'}`);
  lines.push(`schema: ${schemaLine}`);

  const bootstrap = report.workspaceBootstrap || {};
  const mcp = report.mcp || {};
  const sys = report.systemArchitecture || {};
  lines.push(
    `bootstrap: ${sectionStatus(report.workspaceBootstrap)}   `
    + `mcp: ${sectionStatus(report.mcp)}${present(mcp.toolCount) ? ` (${mcp.toolCount} tools)` : ''}   `
    + `canonical: ${sectionStatus(report.systemArchitecture)}`
    + `${present(sys.elementCount) ? ` (${sys.elementCount} el / ${sys.relationshipCount} rel / ${sys.viewCount} views)` : ''}`,
  );

  const ontology = report.ontology || {};
  const typeCount = Array.isArray(ontology.elementTypes) ? ontology.elementTypes.length : 0;
  const relTypeCount = Array.isArray(ontology.relationshipTypes) ? ontology.relationshipTypes.length : 0;
  const hasMatrix = ontology.endpointMatrix && typeof ontology.endpointMatrix === 'object'
    && Object.keys(ontology.endpointMatrix).length > 0;
  lines.push(
    `ontology: ${sectionStatus(report.ontology)}   ${typeCount} types / ${relTypeCount} rel-types   `
    + `matrix: ${yesNo(hasMatrix)}   invariants: ${countItems(ontology.invariants)}   `
    + `axioms: ${axiomCategoryCount(ontology.axioms)} cats   missing: ${countItems(ontology.missing)}`,
  );

  const ov = report.ontologyValidation || {};
  const ovErrors = Array.isArray(ov.errors) ? ov.errors.length : 0;
  lines.push(`ontologyValidation: ${sectionStatus(report.ontologyValidation)}${ovErrors ? ` (${ovErrors} errors)` : ''}`);

  const neo4j = report.neo4j || {};
  const db = neo4j.database;
  const dbMatch = present(db) ? (String(db) === repoName) : false;
  const sync = neo4j.initialSync ? 'ok' : 'n/a';
  const verify = neo4j.verification ? (neo4j.verification.matches === false ? 'mismatch' : 'match') : 'n/a';
  lines.push(`neo4j: ${sectionStatus(report.neo4j)}   db=${present(db) ? db : 'n/a'} (repo match: ${present(db) ? yesNo(dbMatch) : 'n/a'})   initialSync: ${sync}   verification: ${verify}`);

  const qea = report.qeaFullProjection;
  if (qea) {
    const qeaMatch = qea.qea ? yesNo(insideWorkspace(qea.qea, workspaceRoot)) : 'n/a';
    lines.push(`qea: ${sectionStatus(qea)}   target=${qea.qea || qea.reason || 'n/a'} (repo match: ${qeaMatch})${present(qea.ms) ? `   ${qea.ms} ms` : ''}`);
  } else {
    lines.push('qea: n/a');
  }

  const sub = report.subdiagramViews || {};
  lines.push(`subdiagramViews: ${sectionStatus(report.subdiagramViews)}${present(sub.driftCount) ? ` (drift ${sub.driftCount} / fixed ${sub.fixedCount})` : ''}`);

  const semantic = report.semanticLifecycle || {};
  lines.push(
    `semanticLifecycle: ${sectionStatus(report.semanticLifecycle)}`
    + `${semantic.state ? `   state=${semantic.state}` : ''}`
    + `${semantic.alignment ? `   alignment=${semantic.alignment}` : ''}`,
  );

  const failures = failureLines(report);
  if (failures.length) {
    lines.push('failures:');
    lines.push(...failures);
  }

  const reportPath = report.reportPath || '.argo/temp/argo-harness-init-report.json';
  lines.push(`report: ${reportPath}   (full JSON: argo-init --json)`);

  return `${lines.join('\n')}\n`;
}

module.exports = { renderInitSummary };
