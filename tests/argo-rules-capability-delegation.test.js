'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rulesPath = path.join(__dirname, '..', 'argo', 'rules', 'archgraph.instructions.md');

function readRules() {
  return fs.readFileSync(rulesPath, 'utf8');
}

test('archgraph-rules-document-capability-delegation', () => {
  // GIVEN the global ARGO workflow rules file
  const rules = readRules();
  // THEN it documents the CapabilityDelegationGuideline section
  const section = rules.match(/<CapabilityDelegationGuideline>([\s\S]*?)<\/CapabilityDelegationGuideline>/);
  assert.ok(section, 'CapabilityDelegationGuideline section must exist');
  // AND the section covers image and video tasks
  assert.match(section[1], /图片/);
  assert.match(section[1], /视频/);
  // AND it forbids pretending to have consumed content the agent cannot see
  assert.match(section[1], /不具备/);
  assert.match(section[1], /识别能力/);
  assert.match(section[1], /不得/);
  // AND it mandates proactive delegation to a capable Business Actor
  assert.match(section[1], /Business Actor/);
  assert.match(section[1], /委托/);
  // AND it routes delegation through the existing CoperationGuideline
  assert.match(section[1], /CoperationGuideline/);
});
