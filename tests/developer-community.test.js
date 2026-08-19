'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'developer-community-requirements.md');
const GUIDE_PATH = path.join(ROOT, 'docs', 'developer-community-guide.md');
const { scanSensitiveInfo, generatePostTemplate } = require('../scripts/developer-community-publish.js');
const { validateSubgraph } = require('../scripts/developer-community-validate.js');

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

function buildSensitiveSubgraph() {
  return {
    name: '敏感子图',
    description: '内部测试子图，包含凭据与路径',
    elements: [
      {
        id: 'el-1',
        name: '组件A',
        type: 'Application Component',
        description: '部署在 C:\\Users\\xiaoming\\archgraph，联系人 xiaoming@example.com',
        attributes: [
          { name: 'api_token', value: 'sk-1234567890abcdefghijklmnop' },
          { name: 'password', value: 'p@ssw0rd' },
          { name: 'commit', value: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
          { name: 'phone', value: '13800138000' },
        ],
      },
    ],
    relationships: [
      {
        id: 'rel-1',
        statement: '组件A --(Association)--> 组件B',
        name: '依赖',
        type: 'Association',
        source_id: 'el-1',
        target_id: 'el-2',
      },
    ],
    views: [{ view_id: 'v1', view_name: '主视图' }],
  };
}

function buildCleanSubgraph() {
  return {
    name: '干净子图',
    description: '可公开复用的子图',
    elements: [
      {
        id: 'el-1',
        name: '通用组件',
        type: 'Application Component',
        description: '通用业务组件',
        attributes: [{ name: 'owner', value: 'dev-team' }],
      },
    ],
    relationships: [
      {
        id: 'rel-1',
        statement: '通用组件 --(Association)--> 数据对象',
        name: '关联',
        type: 'Association',
        source_id: 'el-1',
        target_id: 'el-2',
      },
    ],
    views: [{ view_id: 'v1', view_name: '主视图' }],
  };
}

test('publish-scan: subgraph with token/absolute-path/email is flagged as sensitive', () => {
  // GIVEN an exported subgraph JSON carrying credentials, internal absolute paths and personal info
  // WHEN a developer runs the publish helper sensitive-info scan
  // THEN the scan reports hits with credential, absolute-path and personal-info types
  const hits = scanSensitiveInfo(buildSensitiveSubgraph());
  const types = hits.map((hit) => hit.type);

  assert.ok(types.includes('credential'), `should flag credentials, got: ${types.join(', ')}`);
  assert.ok(types.includes('absolute-path'), `should flag absolute paths, got: ${types.join(', ')}`);
  assert.ok(types.includes('personal-info'), `should flag personal info, got: ${types.join(', ')}`);
  assert.ok(types.includes('commit'), `should flag commit details, got: ${types.join(', ')}`);

  const emailHit = hits.find((hit) => hit.type === 'personal-info' && hit.value.includes('xiaoming@example.com'));
  assert.ok(emailHit, 'should flag the email address value');
  assert.match(emailHit.path, /description/, 'email hit should point at the description field');
});

test('publish-scan: clean subgraph returns no hits', () => {
  // GIVEN a sanitized subgraph with no sensitive patterns
  // WHEN a developer runs the publish helper sensitive-info scan
  // THEN the scan returns an empty hit list
  const hits = scanSensitiveInfo(buildCleanSubgraph());
  assert.deepEqual(hits, []);
});

test('publish-scan: generatePostTemplate emits work-package title and subgraph link', () => {
  // GIVEN work package metadata (name, description, author, link)
  // WHEN a developer generates the discussion post template
  // THEN the template contains the [工作包] title and the subgraph link
  const template = generatePostTemplate({
    name: '订单服务',
    description: '订单领域子图，可复用于订单建模',
    author: 'xiaoming',
    link: 'https://gist.github.com/xiaoming/abc123',
  });
  assert.match(template, /\[工作包\] 订单服务/, 'template should include the work package title');
  assert.match(template, /描述：订单领域子图/, 'template should include the description');
  assert.match(template, /作者：xiaoming/, 'template should include the author');
  assert.match(template, /子图链接：https:\/\/gist\.github\.com\/xiaoming\/abc123/, 'template should include the subgraph link');
});

test('import-validate: rejects subgraph missing the views array', () => {
  // GIVEN a downloaded subgraph JSON lacking the required views array
  // WHEN a developer validates it before import
  // THEN validation fails with a structural error mentioning views
  const { elements, relationships } = buildCleanSubgraph();
  const invalid = { name: '缺少views', elements, relationships };
  const result = validateSubgraph(invalid, 1024 * 1024);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('views')), `errors should mention missing views: ${result.errors.join('; ')}`);
});

test('import-validate: rejects subgraph exceeding the size limit', () => {
  // GIVEN a well-formed subgraph JSON whose serialized size exceeds the configured limit
  // WHEN a developer validates it before import
  // THEN validation fails with a size error
  const subgraph = buildCleanSubgraph();
  const result = validateSubgraph(subgraph, 16);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /size/i.test(error)), `errors should mention size: ${result.errors.join('; ')}`);
});

test('import-validate: accepts a well-formed subgraph within the size limit', () => {
  // GIVEN a subgraph with elements/relationships/views and a size under the limit
  // WHEN a developer validates it before import
  // THEN validation passes with no errors
  const result = validateSubgraph(buildCleanSubgraph(), 1024 * 1024);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});
