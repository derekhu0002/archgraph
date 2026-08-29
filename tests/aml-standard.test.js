'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'agent-programming-language.md');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

test('aml-standard: spec document declares version and ArchiMate extension', () => {
  // GIVEN the repository keeps the AML specification
  // WHEN a reader opens docs/agent-programming-language.md
  // THEN it declares a version and states that AML extends ArchiMate 3.2
  assert.ok(existsSync(DOC_PATH), 'docs/agent-programming-language.md should exist');
  const doc = readFileSync(DOC_PATH, 'utf8');
  assert.match(doc, /v0\.1/, 'spec should declare a version');
  assert.match(doc, /ArchiMate 3\.2/, 'spec should state it extends ArchiMate 3.2');
});

test('aml-standard: graph models the AML standard Contract', () => {
  // GIVEN the intent graph models the AML standard
  // WHEN a reader inspects the graph
  // THEN an AML 规范 Contract element hangs under the Implementation and Migration Viewpoint
  const el = GRAPH.elements.find((entry) => entry.name === 'AML 规范');
  assert.ok(el, 'graph should contain an AML 规范 element');
  assert.equal(el.type, 'Contract', 'AML 规范 should be a Contract');
  assert.equal(el.parent, '1249', 'AML 规范 should hang under the Implementation and Migration Viewpoint');
});

test('aml-standard: three active workstream Work Packages hang under the AML standard', () => {
  // GIVEN the AML standardization roadmap is modeled
  // WHEN a reader inspects the graph
  // THEN three Work Packages hang under the AML 规范 element, each with an acceptance testcase,
  // and the deferred workstreams (一致性测试套件, 下游厂商生态) are not modeled
  const aml = GRAPH.elements.find((entry) => entry.name === 'AML 规范');
  assert.ok(aml, 'AML 规范 element should exist');

  const expected = [
    '制定AML语言规范',
    '提供AML参考实现',
    '简化上游消费者建模体验',
  ];

  for (const name of expected) {
    const wp = GRAPH.elements.find((entry) => entry.name === name);
    assert.ok(wp, `graph should contain Work Package "${name}"`);
    assert.equal(wp.type, 'Work Package', `${name} should be a Work Package`);
    assert.equal(wp.parent, aml.id, `${name} should hang under AML 规范`);
  }

  const removed = ['建立AML一致性测试套件', '构建下游厂商生态'];
  for (const name of removed) {
    assert.ok(
      !GRAPH.elements.some((entry) => entry.name === name),
      `graph should NOT contain Work Package "${name}"`
    );
  }
});
