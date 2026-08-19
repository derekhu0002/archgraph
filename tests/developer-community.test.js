'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'developer-community-requirements.md');
const GUIDE_PATH = path.join(ROOT, 'docs', 'developer-community-guide.md');

function loadDoc() {
  assert.ok(existsSync(DOC_PATH), 'docs/developer-community-requirements.md should exist');
  return readFileSync(DOC_PATH, 'utf8');
}

function loadGuide() {
  assert.ok(existsSync(GUIDE_PATH), 'docs/developer-community-guide.md should exist');
  return readFileSync(GUIDE_PATH, 'utf8');
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

test('requirements-desensitization: publishing mandates a pre-publish desensitization checklist', () => {
  // GIVEN a shared subgraph JSON may carry sensitive info (credentials, internal paths, commit details, PII)
  // WHEN a developer publishes a work package
  // THEN the guide mandates a pre-publish desensitization checklist
  const guide = loadGuide();
  assert.match(guide, /脱敏检查清单/, 'guide should define a desensitization checklist');
  assert.match(guide, /密钥|token|密码/, 'guide should cover credentials/tokens/passwords');
  assert.match(guide, /绝对路径/, 'guide should cover internal absolute paths');
  assert.match(guide, /个人信息/, 'guide should cover personal information');
});

test('requirements-import-validation: importing requires format and size validation', () => {
  // GIVEN a work package post links a subgraph JSON
  // WHEN a developer fetches and prepares to import it
  // THEN the subgraph JSON must pass export-to-kg.js format validation and a size cap, else it is rejected
  const guide = loadGuide();
  assert.match(guide, /格式校验/, 'guide should require format validation');
  assert.match(guide, /大小上限/, 'guide should require a size cap');
  assert.match(guide, /拒绝导入/, 'guide should reject invalid imports');
});
