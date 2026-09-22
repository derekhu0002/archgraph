'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rulesPath = path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md');

function readRules() {
  return fs.readFileSync(rulesPath, 'utf8');
}

// AT-rules-06 — federation behaviour contract on the framework side.
test('archgraph-rules-document-federation-guideline', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  // THEN it documents the <FederationGuideline> section (Agent-facing behaviour contract)
  const section = rules.match(/<FederationGuideline>([\s\S]*?)<\/FederationGuideline>/);
  assert.ok(section, 'FederationGuideline section must exist');
  const body = section[1];
  // AND it names the federation lifecycle actions
  assert.match(body, /register/i, 'must mention register');
  assert.match(body, /deregister/i, 'must mention deregister');
  assert.match(body, /discover/i, 'must mention discover');
  assert.match(body, /authoriz/i, 'must mention authorize');
  // AND it states default-deny (no implicit trust)
  assert.match(body, /denied by default/i, 'must state default-deny');
  // AND it forbids copying another member's content (reference, not a copy)
  assert.match(body, /reference, not a copy/i, 'must state read returns a reference, not a copy');
  // AND it declares a single central platform reached through the graph MCP
  assert.match(body, /one center/i, 'must state there is one center');
  assert.match(body, /graph MCP/i, 'must state the graph MCP surface');
  // AND it records that register/exit needs no separate external approval
  assert.match(body, /no separate external approval/i, 'must state no separate approval for register/exit');
});

test('archgraph-rules-federation-core-rule', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  const coreRules = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(coreRules, 'CoreRules section must exist');
  // THEN the CoreRules section references the federation rule as a red line
  assert.match(coreRules[1], /FederationGuideline/, 'CoreRules must reference FederationGuideline');
  assert.match(coreRules[1], /reference, not a copy/i, 'CoreRules must state reference-not-copy');
});
