'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

test('readme: documents the current repository state', () => {
  // GIVEN the repository is in its current state
  // WHEN a reader opens README.md
  // THEN it reflects the current project: intent graph, global rules, skills, ARGO harness, KGlibrary, home site and tests
  assert.match(README, /design\/KG\/SystemArchitecture\.json/, 'README should reference the canonical intent graph');
  assert.match(README, /argo-copilot-instructions\.instructions\.md/, 'README should reference the global agent rules');
  assert.match(README, /\.github\/skills\//, 'README should reference the materialized skills directory');
  assert.match(README, /\.argo\//, 'README should reference the ARGO harness');
  assert.match(README, /KGlibrary\//, 'README should reference the reference library');
  assert.match(README, /index\.html/, 'README should reference the home site entry');
  assert.match(README, /tests\//, 'README should reference the tests directory');
  assert.match(README, /node --test/, 'README should show how to run tests');
});

function sectionAfter(md, heading) {
  const re = new RegExp('## ' + heading + '[\\s\\S]*?(?=\\n## |$)');
  const match = md.match(re);
  return match ? match[0] : '';
}

test('readme: how-to-use section explains framework adoption', () => {
  // GIVEN the README documents how to adopt the framework
  // WHEN a reader opens the How to use section
  // THEN it states ArchiMate 3.2 compliance and the pieces to copy into another project
  const section = sectionAfter(README, 'How to use');
  assert.ok(section, 'README should have a How to use section');
  assert.match(section, /ArchiMate 3\.2/, 'should state ArchiMate 3.2 compliance');
  assert.match(section, /\.argo\//, 'should mention copying .argo/');
  assert.match(section, /\.github\/|\.opencode\/|\.cursor\//, 'should mention copying one agent config directory');
  assert.match(section, /\.feap/, 'should mention the .feap EA model');
});
