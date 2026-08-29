'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'ea-web-service-design.md');
const GRAPH = JSON.parse(
  readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8')
);

const COMPONENT_ID = '2760';
const COMPONENT_NAME = 'ArchGraph 本地 Web 服务';
const SERVICE_IDS = ['2761', '2762', '2763', '2764', '2765'];
const SERVICE_NAMES = [
  '知识图谱导入服务',
  '知识图谱导出服务',
  '知识图谱搜索服务',
  '知识图谱图形化查看服务',
  '知识图谱编辑服务',
];
const VIEW_ID = '1800';
const WP_ID = '2758';

function readDoc() {
  assert.ok(existsSync(DOC), 'design doc should exist');
  return readFileSync(DOC, 'utf8');
}

function elementById(id) {
  return GRAPH.elements.find((entry) => entry.id === id);
}

function isGivenWhenThen(text) {
  return /GIVEN/.test(text) && /WHEN/.test(text) && /THEN/.test(text);
}

test('ea-web-service-design: design doc exists and describes a layered architecture', () => {
  // GIVEN the system designer has produced the solution design
  // WHEN the design doc is inspected
  // THEN it exists and describes the layered architecture (UI/web/MCP adapter/data access)
  const doc = readDoc();
  assert.match(doc, /总体架构/, 'doc should have an overall architecture section');
  assert.match(doc, /分层|架构分层/, 'doc should mention layered architecture');
  assert.match(doc, /前端\s*UI\s*层/, 'doc should mention the UI layer');
  assert.match(doc, /Web\s*服务层/, 'doc should mention the local web service layer');
  assert.match(doc, /ARGO\s*MCP\s*适配层/, 'doc should mention the ARGO MCP adapter layer');
  assert.match(doc, /图谱数据访问层/, 'doc should mention the graph data access layer');
  assert.match(doc, /mermaid|flowchart/i, 'doc should include a Mermaid diagram');
});

test('ea-web-service-design: design doc covers every AD decision from requirements §7', () => {
  // GIVEN requirements §7 lists nine decisions for the system designer
  // WHEN the design doc is inspected
  // THEN each AD (a-i) is present with a decision, rationale and rejected alternative
  const doc = readDoc();
  for (const ad of ['AD-a', 'AD-b', 'AD-c', 'AD-d', 'AD-e', 'AD-f', 'AD-g', 'AD-h', 'AD-i']) {
    assert.ok(doc.includes(ad), `doc should contain ${ad}`);
  }
  assert.match(doc, /导入语义/, 'AD-a import semantics should be covered');
  assert.match(doc, /整体替换/, 'AD-a should decide replace');
  assert.match(doc, /零配置/, 'AD-b zero-config startup should be covered');
  assert.match(doc, /网页\s*UI|HTTP\s*接口/, 'AD-c UI vs API should be covered');
  assert.match(doc, /项目命名|项目发现|路径映射/, 'AD-d project enumeration should be covered');
  assert.match(doc, /fs\.watch|轮询/, 'AD-e realtime read should be covered');
  assert.match(doc, /进程内/, 'AD-f in-process MCP call should be covered');
  assert.match(doc, /callTool/, 'AD-f should reference callTool');
  assert.match(doc, /SVG/, 'AD-g rendering should be covered');
  assert.match(doc, /力导向/, 'AD-g force-directed layout should be covered');
  assert.match(doc, /撤销\/重做/, 'AD-h undo/redo should be covered');
  assert.match(doc, /Command/, 'AD-h should reference the Command pattern');
  assert.match(doc, /备份/, 'AD-i backup should be covered');
  assert.match(doc, /文件锁|并发/, 'AD-i concurrency/lock should be covered');
  const rejectedCount = (doc.match(/被否方案/g) || []).length;
  assert.ok(rejectedCount >= 9, `each AD should list a rejected alternative (found ${rejectedCount})`);
});

test('ea-web-service-design: AD-c adopts a zero-build SPA shell with an open-source graph core (G6/Cytoscape)', () => {
  // GIVEN the planner feedback replaced the all-hand-rolled SVG UI with a zero-build SPA + open-source graph core
  // WHEN the AD-c decision is inspected
  // THEN it keeps the built-in SPA + REST API form, uses G6 v5 (primary) / Cytoscape.js (fallback), and is zero-build
  const doc = readDoc();
  assert.match(doc, /G6\s*v?5/, 'AD-c should name AntV G6 v5 as the primary graph kernel');
  assert.match(doc, /Cytoscape/, 'AD-c should name Cytoscape.js as the fallback');
  assert.match(doc, /零构建/, 'AD-c should keep the zero-build static page');
  assert.match(doc, /开源图库/, 'AD-c should reference an open-source graph library');
  assert.match(doc, /REST\/HTTP JSON API|REST\s*JSON\s*API/, 'AD-c should keep the REST JSON API');
  assert.match(doc, /React\/Vite/, 'AD-c should name React/Vite as a rejected/evolution alternative');
  assert.match(doc, /被否方案/, 'AD-c should keep rejected alternatives');
  assert.match(doc, /ui-insight|2766/, 'AD-c should trace back to the planner insight report/element 2766');
});

test('ea-web-service-design: AD-g renders with AntV G6 v5 (Canvas default, built-in layouts, native drag/hit)', () => {
  // GIVEN the planner feedback replaced self-built SVG + force-directed + fx/fy with G6 v5
  // WHEN the AD-g decision is inspected
  // THEN G6 v5 renders Canvas by default, uses built-in force/dagre layouts and native drag/select/hit, no self-built fx/fy
  const doc = readDoc();
  assert.match(doc, /G6\s*v?5/, 'AD-g should name AntV G6 v5');
  assert.match(doc, /Canvas/, 'AD-g should default to Canvas rendering');
  assert.match(doc, /dagre/, 'AD-g should use the built-in dagre layout');
  assert.match(doc, /force/, 'AD-g should use the built-in force layout');
  assert.match(doc, /内置.*拖动|drag-node|拖动\/选择\/命中|拖动\/命中/, 'AD-g should rely on library-native drag/select/hit');
  assert.match(doc, /固定节点|固定.*位置/, 'AD-g should rely on native fixed-node positioning');
  assert.match(doc, /无需自研.*fx\/fy|不再.*fx\/fy|自研.*fx\/fy/, 'AD-g should retire the self-built fx/fy mechanism');
  assert.match(doc, /Cytoscape\.js/, 'AD-g should keep Cytoscape.js as the fallback');
});

test('ea-web-service-design: design doc specifies local vendored G6 assets (no CDN, no build chain)', () => {
  // GIVEN zero-config requires no external network or build step
  // WHEN the tech-stack/dependency section is inspected
  // THEN G6 is vendored locally, not loaded from a CDN, and React/Vite is recorded as an evolution item
  const doc = readDoc();
  assert.match(doc, /vendor/, 'doc should mention local vendored assets (web/vendor/)');
  assert.match(doc, /不引入\s*CDN|不.*CDN/, 'doc should avoid CDN to preserve zero-config offline operation');
  assert.match(doc, /零配置/, 'doc should keep the zero-config requirement');
  assert.match(doc, /演进项|后续演进/, 'doc should record React/Vite as a future evolution item');
});

test('ea-web-service-design: design doc lists the API and the edit↔MCP mapping table', () => {
  // GIVEN the service exposes REST endpoints and must map edits to ARGO MCP writes
  // WHEN the design doc is inspected
  // THEN it lists the API endpoints and a one-to-one edit↔MCP mapping table
  const doc = readDoc();
  assert.match(doc, /\/api\/projects/, 'doc should list the projects API');
  assert.match(doc, /\/export/, 'doc should list the export endpoint');
  assert.match(doc, /\/import/, 'doc should list the import endpoint');
  assert.match(doc, /\/edit/, 'doc should list the edit endpoint');
  assert.match(doc, /addArchitectureElement/, 'mapping should reference addArchitectureElement');
  assert.match(doc, /updateArchitectureElement/, 'mapping should reference updateArchitectureElement');
  assert.match(doc, /removeArchitectureElement/, 'mapping should reference removeArchitectureElement');
  assert.match(doc, /addArchitectureView/, 'mapping should reference addArchitectureView');
  assert.match(doc, /updateArchitectureView/, 'mapping should reference updateArchitectureView');
  assert.match(doc, /removeArchitectureView/, 'mapping should reference removeArchitectureView');
  assert.match(doc, /addArchitectureRelationship/, 'mapping should reference addArchitectureRelationship');
  assert.match(doc, /updateArchitectureRelationship/, 'mapping should reference updateArchitectureRelationship');
  assert.match(doc, /removeArchitectureRelationship/, 'mapping should reference removeArchitectureRelationship');
  assert.match(doc, /applySystemArchitectureMutation/, 'mapping should reference applySystemArchitectureMutation');
  assert.match(doc, /禁止.*SystemArchitecture\.json|不.*绕过\s*MCP|绕过\s*MCP/, 'doc should forbid bypassing MCP');
});

test('ea-web-service-design: graph contains the Application Component under the EA Tooling view', () => {
  // GIVEN the solution architecture element was registered in the intent graph
  // WHEN a caller looks up the component
  // THEN a unique Application Component exists with parent 1249 and is in view 1800
  const matches = GRAPH.elements.filter((entry) => entry.name === COMPONENT_NAME);
  assert.equal(matches.length, 1, `exactly one component named ${COMPONENT_NAME} should exist`);
  const component = matches[0];
  assert.equal(component.id, COMPONENT_ID, 'component id should be 2760');
  assert.equal(component.type, 'Application Component', 'component should be an Application Component');
  assert.equal(component.parent, '1249', 'component should hang under Implementation and Migration Viewpoint (1249)');
  assert.ok(component.description && component.description.trim().length > 0, 'component should carry a description');

  const view = GRAPH.views.find((entry) => entry.view_id === VIEW_ID);
  assert.ok(view, `view ${VIEW_ID} should exist`);
  assert.ok(view.included_elements.includes(COMPONENT_ID), 'EA Tooling view should include the component');
});

test('ea-web-service-design: graph contains five Application Service sub-elements of the component', () => {
  // GIVEN the component decomposes into import/export/search/graphical-view/edit services
  // WHEN the services are looked up
  // THEN five Application Services exist, each parented under the component and in view 1800
  const view = GRAPH.views.find((entry) => entry.view_id === VIEW_ID);
  for (let i = 0; i < SERVICE_IDS.length; i += 1) {
    const element = elementById(SERVICE_IDS[i]);
    assert.ok(element, `service ${SERVICE_IDS[i]} should exist`);
    assert.equal(element.name, SERVICE_NAMES[i], `service ${SERVICE_IDS[i]} name should be ${SERVICE_NAMES[i]}`);
    assert.equal(element.type, 'Application Service', 'service should be an Application Service');
    assert.equal(element.parent, COMPONENT_ID, 'service should be parented under the component');
    assert.ok(view.included_elements.includes(SERVICE_IDS[i]), `view should include service ${SERVICE_IDS[i]}`);
  }
});

test('ea-web-service-design: graph contains Realization relationships wiring WP to component and component to services', () => {
  // GIVEN the Work Package realizes the component and the component realizes its services
  // WHEN the relationships are inspected
  // THEN Realization edges 1980..1985 exist with the expected endpoints and are in view 1800
  const view = GRAPH.views.find((entry) => entry.view_id === VIEW_ID);

  const wpToComponent = GRAPH.relationships.find((rel) => rel.id === '1985');
  assert.ok(wpToComponent, 'relationship 1985 should exist');
  assert.equal(wpToComponent.type, 'Realization', '1985 should be Realization');
  assert.equal(wpToComponent.source_id, WP_ID, '1985 source should be WP 2758');
  assert.equal(wpToComponent.target_id, COMPONENT_ID, '1985 target should be component 2760');
  assert.ok(view.included_relationships.includes('1985'), 'view should include relationship 1985');

  for (let i = 0; i < SERVICE_IDS.length; i += 1) {
    const relId = String(1980 + i);
    const rel = GRAPH.relationships.find((entry) => entry.id === relId);
    assert.ok(rel, `relationship ${relId} should exist`);
    assert.equal(rel.type, 'Realization', `${relId} should be Realization`);
    assert.equal(rel.source_id, COMPONENT_ID, `${relId} source should be component 2760`);
    assert.equal(rel.target_id, SERVICE_IDS[i], `${relId} target should be service ${SERVICE_IDS[i]}`);
    assert.ok(view.included_relationships.includes(relId), `view should include relationship ${relId}`);
  }
});

test('ea-web-service-design: new elements carry executable GIVEN-WHEN-THEN testcases', () => {
  // GIVEN every acceptance testcase must be executable and GIVEN-WHEN-THEN
  // WHEN the new element testcases are inspected
  // THEN the component and each service carry GIVEN-WHEN-THEN testcases pointing at the design test file
  const ids = [COMPONENT_ID, ...SERVICE_IDS];
  for (const id of ids) {
    const element = elementById(id);
    assert.ok(element, `element ${id} should exist`);
    assert.ok(Array.isArray(element.testcases) && element.testcases.length >= 1, `element ${id} should carry testcases`);
    for (const tc of element.testcases) {
      assert.match(tc.description, /GIVEN/, `${id} testcase description should contain GIVEN`);
      assert.match(tc.description, /WHEN/, `${id} testcase description should contain WHEN`);
      assert.match(tc.description, /THEN/, `${id} testcase description should contain THEN`);
      assert.equal(tc.type, 'Acceptance Test', `${id} testcase type should be Acceptance Test`);
      assert.ok(
        tc.Input && (
          tc.Input.includes('tests/ea-web-service-design.test.js')
          || tc.Input.includes('tests/ea-web-service-impl.test.js')
          || tc.Input.includes('tests/ea-web-service-code-review.test.js')
        ),
        `${id} testcase Input should be executable`
      );
      assert.ok(tc.acceptanceCriteria && tc.acceptanceCriteria.trim().length > 0, `${id} testcase should carry acceptanceCriteria`);
    }
  }
});

test('ea-web-service-design: component carries a testcase asserting the open-source graph core (not hand-rolled SVG)', () => {
  // GIVEN the planner feedback introduced an open-source graph core
  // WHEN the component testcases are inspected
  // THEN 2760 carries a GIVEN-WHEN-THEN testcase asserting the UI uses G6/Cytoscape, not all-hand-rolled SVG
  const component = elementById(COMPONENT_ID);
  assert.ok(component, 'component 2760 should exist');
  assert.ok(Array.isArray(component.testcases) && component.testcases.length >= 2, 'component should carry at least 2 testcases');
  const tc = component.testcases.find((entry) => /2760-02|开源图库|G6/.test(entry.name || ''));
  assert.ok(tc, 'component should carry a testcase asserting the open-source graph core');
  assert.match(tc.description, /GIVEN/, 'testcase should contain GIVEN');
  assert.match(tc.description, /WHEN/, 'testcase should contain WHEN');
  assert.match(tc.description, /THEN/, 'testcase should contain THEN');
  assert.match(tc.description, /G6|Cytoscape/, 'testcase should name G6/Cytoscape');
  assert.equal(tc.type, 'Acceptance Test', 'testcase type should be Acceptance Test');
  assert.ok(tc.Input && tc.Input.includes('tests/ea-web-service-design.test.js'), 'testcase Input should be executable');
});

test('ea-web-service-design: design doc includes design-stage GIVEN-WHEN-THEN acceptance criteria', () => {
  // GIVEN the design stage itself must be verifiable
  // WHEN the design doc is inspected
  // THEN it contains executable GIVEN-WHEN-THEN design acceptance criteria (ADES)
  const doc = readDoc();
  assert.match(doc, /ADES-\d/, 'doc should contain ADES design acceptance criteria');
  assert.match(doc, /设计阶段验收标准/, 'doc should have a design acceptance section');
  assert.match(doc, /GIVEN/, 'doc should contain GIVEN');
  assert.match(doc, /WHEN/, 'doc should contain WHEN');
  assert.match(doc, /THEN/, 'doc should contain THEN');
});
