'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'ea-web-service-requirements.md');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const WORK_PACKAGE_NAME = '开发EA知识图谱导入导出本地Web服务';
const WORK_PACKAGE_ID = '2758';
const VIEW_ID = '1800';

function readDoc() {
  assert.ok(existsSync(DOC), 'requirements doc should exist');
  return readFileSync(DOC, 'utf8');
}

test('ea-web-service: requirements doc exists and describes a local web service without EA', () => {
  // GIVEN the EA import/export capability is being migrated to a local web service
  // WHEN the requirements doc is inspected
  // THEN it describes a local web service and states the no-EA dependency
  const doc = readDoc();
  assert.match(doc, /本地\s*Web\s*服务/, 'doc should mention 本地 Web 服务');
  assert.match(doc, /不依赖|无需|不再依赖/, 'doc should state the no-EA dependency');
  assert.match(doc, /Sparx\s*EA|Enterprise\s*Architect/, 'doc should reference the EA toolchain being replaced');
});

test('ea-web-service: doc contains user stories and GIVEN-WHEN-THEN acceptance criteria', () => {
  // GIVEN the requirement analysis must follow the user-story and GIVEN-WHEN-THEN conventions
  // WHEN the doc is inspected
  // THEN it contains user stories and executable GIVEN-WHEN-THEN acceptance criteria
  const doc = readDoc();
  assert.match(doc, /作为一个/, 'doc should contain at least one user story');
  assert.match(doc, /GIVEN/, 'doc should contain GIVEN clauses');
  assert.match(doc, /WHEN/, 'doc should contain WHEN clauses');
  assert.match(doc, /THEN/, 'doc should contain THEN clauses');
  assert.match(doc, /##\s*3\.\s*用户故事/, 'doc should have a user stories section');
  assert.match(doc, /##\s*6\.\s*验收标准/, 'doc should have an acceptance criteria section');
});

test('ea-web-service: doc covers import, export, no-EA, format and size validation', () => {
  // GIVEN the core paths must be covered
  // WHEN the acceptance criteria section is inspected
  // THEN import, export, no-EA, format validation and size validation are all covered
  const doc = readDoc();
  assert.match(doc, /AC-1（导入）/, 'AC-1 import should be present');
  assert.match(doc, /AC-2（导出）/, 'AC-2 export should be present');
  assert.match(doc, /AC-3（无 EA 依赖）/, 'AC-3 no-EA should be present');
  assert.match(doc, /AC-4（格式校验）/, 'AC-4 format validation should be present');
  assert.match(doc, /AC-5（大小校验）/, 'AC-5 size validation should be present');
});

test('ea-web-service: the Work Package is registered under the EA Tooling view', () => {
  // GIVEN the intent graph models the new web service work package
  // WHEN a caller looks it up
  // THEN a unique Work Package exists with the expected name, parent and view membership
  const matches = GRAPH.elements.filter((entry) => entry.name === WORK_PACKAGE_NAME);
  assert.equal(matches.length, 1, `exactly one Work Package named ${WORK_PACKAGE_NAME} should exist`);
  const element = matches[0];
  assert.equal(element.id, WORK_PACKAGE_ID, 'Work Package id should be 2758');
  assert.equal(element.type, 'Work Package', 'element should be a Work Package');
  assert.equal(element.parent, '1249', 'Work Package should hang under Implementation and Migration Viewpoint (1249)');
  assert.ok(element.description && element.description.trim().length > 0, 'Work Package should carry a non-empty description');

  const view = GRAPH.views.find((entry) => entry.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.equal(view.parent_element_id, '1249', 'EA Tooling view should hang under 1249');
  assert.ok(view.included_elements.includes(WORK_PACKAGE_ID), 'EA Tooling view should include the Work Package');
});

test('ea-web-service: Work Package carries executable GIVEN-WHEN-THEN testcases', () => {
  // GIVEN every acceptance testcase must be executable and in GIVEN-WHEN-THEN form
  // WHEN the Work Package testcases are inspected
  // THEN at least 5 testcases exist, each GIVEN-WHEN-THEN and pointing at the executable test file
  const element = GRAPH.elements.find((entry) => entry.id === WORK_PACKAGE_ID);
  assert.ok(element, 'Work Package should exist');
  assert.ok(Array.isArray(element.testcases) && element.testcases.length >= 5, 'at least 5 testcases should exist');

  for (const tc of element.testcases) {
    assert.ok(tc.name && tc.name.startsWith('AT-2758-'), 'testcase name should use the AT-2758- prefix');
    assert.match(tc.description, /GIVEN/, 'testcase description should contain GIVEN');
    assert.match(tc.description, /WHEN/, 'testcase description should contain WHEN');
    assert.match(tc.description, /THEN/, 'testcase description should contain THEN');
    assert.equal(tc.type, 'Acceptance Test', 'testcase type should be Acceptance Test');
    assert.ok(tc.Input && tc.Input.includes('node --test tests/ea-web-service.test.js'), 'testcase Input should be executable');
    assert.ok(tc.acceptanceCriteria && tc.acceptanceCriteria.trim().length > 0, 'testcase should carry acceptanceCriteria');
  }
});
