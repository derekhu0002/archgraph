'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'developer-community-requirements.md');

function loadDoc() {
  assert.ok(existsSync(DOC_PATH), 'docs/developer-community-requirements.md should exist');
  return readFileSync(DOC_PATH, 'utf8');
}

test('requirements-ready: requirement analysis documents user scenarios and stories', () => {
  // GIVEN the product manager performs requirement analysis for the developer community
  // WHEN a reader opens the requirements document
  // THEN it contains user scenarios and user stories
  const doc = loadDoc();
  assert.match(doc, /用户场景/, 'doc should have a user-scenarios section');
  assert.match(doc, /用户故事/, 'doc should have a user-stories section');
  assert.match(doc, /作为一个开发者/, 'doc should express user stories from the developer perspective');
});

test('requirements-acceptance: acceptance criteria use GIVEN-WHEN-THEN', () => {
  // GIVEN the developer community needs externally verifiable acceptance
  // WHEN a reader inspects the requirements document
  // THEN it states GIVEN-WHEN-THEN acceptance criteria covering browse, publish, detail, download and discuss
  const doc = loadDoc();
  assert.match(doc, /GIVEN/, 'doc should contain GIVEN clauses');
  assert.match(doc, /WHEN/, 'doc should contain WHEN clauses');
  assert.match(doc, /THEN/, 'doc should contain THEN clauses');
  assert.match(doc, /浏览/, 'acceptance should cover browsing work packages');
  assert.match(doc, /发布/, 'acceptance should cover publishing a work package');
  assert.match(doc, /详情/, 'acceptance should cover viewing a work package detail');
  assert.match(doc, /下载/, 'acceptance should cover downloading a work package');
  assert.match(doc, /评论/, 'acceptance should cover commenting on a work package');
});

test('requirements-github-discussions: community should use GitHub Discussions at zero cost', () => {
  // GIVEN the community must be cheap to deliver and maintain
  // WHEN a reader inspects the non-functional requirements
  // THEN the document requires GitHub Discussions (zero cost, zero ops) instead of self-hosting a forum
  const doc = loadDoc();
  assert.match(doc, /GitHub Discussions/, 'doc should require GitHub Discussions');
  assert.match(doc, /零成本/, 'doc should state zero cost');
  assert.match(doc, /不自研/, 'doc should rule out building the community from scratch');
});
