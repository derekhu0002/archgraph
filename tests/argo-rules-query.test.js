'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rulesPath = path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md');

function readRules() {
  return fs.readFileSync(rulesPath, 'utf8');
}

test('archgraph-rules-document-query-priority-kg-first', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  // THEN it documents the QueryPriorityGuideline section
  const section = rules.match(/<QueryPriorityGuideline>([\s\S]*?)<\/QueryPriorityGuideline>/);
  assert.ok(section, 'QueryPriorityGuideline section must exist');
  // AND it mandates that any retrieval first queries the KG
  assert.match(section[1], /KG-first retrieval/);
  // AND the CoreRules section references the query priority gate as a red line
  const coreRules = rules.match(/<CoreRules>([\s\S]*?)<\/CoreRules>/);
  assert.ok(coreRules, 'CoreRules section must exist');
  assert.match(coreRules[1], /QueryPriorityGuideline/);
  // AND the ExplorationGuideline also carries the KG-first rule
  const exploration = rules.match(/<ExplorationGuideline>([\s\S]*?)<\/ExplorationGuideline>/);
  assert.ok(exploration, 'ExplorationGuideline section must exist');
  assert.match(exploration[1], /KG-first retrieval/);
});

test('archgraph-rules-document-query-semantic-first', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  const section = rules.match(/<QueryPriorityGuideline>([\s\S]*?)<\/QueryPriorityGuideline>/);
  assert.ok(section, 'QueryPriorityGuideline section must exist');
  // THEN it mandates semantic retrieval as the priority path for KG retrieval
  assert.match(section[1], /Semantic-first KG retrieval/);
  assert.match(section[1], /getSystemArchitecture/);
  assert.match(section[1], /query\.purpose/);
  assert.match(section[1], /query\.intent/);
  assert.match(section[1], /getIntentElementContext/);
  // AND it demotes structural Cypher queries to the secondary path
  assert.match(section[1], /queryNeo4jGraph/);
  assert.match(section[1], /SECONDARY/);
  // AND the ToolsGuideline mandates the semantic query (not merely recommends it)
  const tools = rules.match(/<ToolsGuideline>([\s\S]*?)<\/ToolsGuideline>/);
  assert.ok(tools, 'ToolsGuideline section must exist');
  assert.match(tools[1], /MUST supply query\.purpose \+ query\.intent/);
});

test('archgraph-rules-document-query-scope', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  const section = rules.match(/<QueryPriorityGuideline>([\s\S]*?)<\/QueryPriorityGuideline>/);
  assert.ok(section, 'QueryPriorityGuideline section must exist');
  // THEN it documents subgraph scoping for over-broad semantic retrieval
  assert.match(section[1], /scope/);
  assert.match(section[1], /view_id/);
  assert.match(section[1], /element_id/);
  assert.match(section[1], /too much content/);
});
