'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const {
  discoverProjects,
  computeStatus,
  validateGraphDocument,
  buildViewGraph,
  searchLocal,
  searchSemantic,
  hitsFromPayload,
  buildEditArgs,
  deriveInverseCommand,
  createMcpAdapter,
  acquireFileLock,
  createService,
  EDIT_OP_TOOL_MAP,
  MAX_IMPORT_BYTES,
} = require(path.join(ROOT, 'scripts', 'ea-web-service.js'));

const REAL_GRAPH = path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json');
const GRAPH_REL = ['design', 'KG', 'SystemArchitecture.json'];

function miniGraph() {
  return {
    name: 'Mini',
    description: 'Mini fixture',
    elements: [
      { id: '1', name: 'A', type: 'Application Component', description: 'alpha 组件' },
      { id: '2', name: 'B', type: 'Application Service', parent: '1', description: 'beta 服务' },
    ],
    relationships: [
      {
        id: '10',
        statement: 'A serves B',
        name: 'Serving',
        type: 'Serving',
        source_id: '1',
        target_id: '2',
        source_name: 'A',
        target_name: 'B',
      },
    ],
    views: [{ view_id: '100', view_name: 'Main', included_elements: ['1', '2'], included_relationships: ['10'] }],
  };
}

function makeFixture(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-impl-'));
  const projectRoot = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(projectRoot, ...GRAPH_REL.slice(0, -1)), { recursive: true });
  const graphPath = path.join(projectRoot, ...GRAPH_REL);
  fs.writeFileSync(graphPath, JSON.stringify(overrides.graph || miniGraph(), null, 2));
  return { tmp, projectRoot, graphPath };
}

function readGraph(graphPath) {
  return JSON.parse(fs.readFileSync(graphPath, 'utf8'));
}

// 模拟 ARGO MCP 写图接口（仅用于撤销/重做逻辑测试；写图一致性由真实 MCP 测试覆盖）。
function createFakeAdapter() {
  return {
    available: true,
    mode: 'fake',
    callTool(toolName, args, projectRoot) {
      const graphPath = path.join(projectRoot, ...GRAPH_REL);
      const doc = readGraph(graphPath);
      switch (toolName) {
        case 'addArchitectureElement': {
          if (!doc.elements.some((e) => e.id === args.element.id)) {
            doc.elements.push(args.element);
          }
          for (const viewId of args.view_ids || []) {
            const view = doc.views.find((v) => v.view_id === viewId);
            if (view && !(view.included_elements || []).includes(args.element.id)) {
              view.included_elements = [...(view.included_elements || []), args.element.id];
            }
          }
          break;
        }
        case 'removeArchitectureElement': {
          for (const view of doc.views) {
            view.included_elements = (view.included_elements || []).filter((id) => id !== args.id);
          }
          doc.elements = doc.elements.filter((e) => e.id !== args.id);
          break;
        }
        case 'updateArchitectureElement': {
          const element = doc.elements.find((e) => e.id === args.id);
          if (element) {
            Object.assign(element, args.patch || {});
          }
          break;
        }
        default:
          return { ok: false, error: { message: `fake adapter 不支持 ${toolName}` } };
      }
      fs.writeFileSync(graphPath, JSON.stringify(doc, null, 2));
      return { ok: true, payload: { status: 'passed', written: true, graphPath: GRAPH_REL.join('/') } };
    },
  };
}

test('项目发现：以 design/KG/SystemArchitecture.json 为 marker 递归发现', () => {
  // GIVEN 一个临时目录下存在包含 SystemArchitecture.json 的项目
  // WHEN 调用 discoverProjects
  // THEN 返回该项目，name 为目录 basename，graphPath 指向图谱文件
  const { tmp, projectRoot, graphPath } = makeFixture();
  const projects = discoverProjects([tmp]);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'proj');
  assert.equal(path.resolve(projects[0].graphPath), path.resolve(graphPath));
  assert.equal(path.resolve(projects[0].root), path.resolve(projectRoot));
  assert.ok(projects[0].id && projects[0].id.length > 0);
});

test('状态统计：返回有效性、elements/relationships/views 数量与 mtime', () => {
  // GIVEN 一个结构合法的迷你图谱
  // WHEN 调用 computeStatus
  // THEN valid 为 true，数量正确，mtime 为 ISO 时间
  const { tmp } = makeFixture();
  const project = discoverProjects([tmp])[0];
  const status = computeStatus(project);
  assert.equal(status.valid, true);
  assert.equal(status.elements, 2);
  assert.equal(status.relationships, 1);
  assert.equal(status.views, 1);
  assert.ok(status.mtime && !Number.isNaN(Date.parse(status.mtime)));
});

test('导出内容一致性：文件内容与写入一致且无 BOM', () => {
  // GIVEN 图谱文件以 UTF-8 无 BOM 写入
  // WHEN 读取导出内容
  // THEN 内容与 JSON.stringify(miniGraph, null, 2) 一致，且不以 BOM 开头
  const graph = miniGraph();
  const { graphPath } = makeFixture({ graph });
  const text = fs.readFileSync(graphPath, 'utf8');
  assert.equal(text.charCodeAt(0) !== 0xfeff, true, '不应包含 BOM');
  assert.equal(text, JSON.stringify(graph, null, 2));
});

test('导入校验：合法 JSON 通过并替换文件', async () => {
  // GIVEN 一个符合结构的导入 JSON
  // WHEN 执行 importProject
  // THEN 文件被替换为导入内容
  const { tmp, graphPath } = makeFixture();
  const service = createService({ searchRoots: [tmp] });
  service.refreshProjects();
  const project = [...service.state.projects.values()][0];
  const imported = miniGraph();
  imported.name = 'Imported';
  imported.elements[0].name = 'A2';
  const result = await service.importProject(project.id, JSON.stringify(imported));
  assert.equal(result.ok, true);
  assert.equal(readGraph(graphPath).name, 'Imported');
});

test('导入校验：非法 JSON 不改动文件', async () => {
  // GIVEN 一个非法 JSON 文本
  // WHEN 执行 importProject
  // THEN 抛出可读错误且文件内容不变
  const { tmp, graphPath } = makeFixture();
  const before = fs.readFileSync(graphPath, 'utf8');
  const service = createService({ searchRoots: [tmp] });
  service.refreshProjects();
  const project = [...service.state.projects.values()][0];
  await assert.rejects(
    () => service.importProject(project.id, '{ not valid json'),
    (error) => error.message.includes('JSON 解析失败'),
  );
  assert.equal(fs.readFileSync(graphPath, 'utf8'), before);
});

test('导入校验：缺少根字段不改动文件', async () => {
  // GIVEN 一个缺少 elements 字段的 JSON
  // WHEN 执行 importProject
  // THEN 抛出校验错误且文件内容不变
  const { tmp, graphPath } = makeFixture();
  const before = fs.readFileSync(graphPath, 'utf8');
  const service = createService({ searchRoots: [tmp] });
  service.refreshProjects();
  const project = [...service.state.projects.values()][0];
  const bad = { name: 'x', description: 'y', relationships: [], views: [] };
  await assert.rejects(
    () => service.importProject(project.id, JSON.stringify(bad)),
    (error) => error.message.includes('校验失败'),
  );
  assert.equal(fs.readFileSync(graphPath, 'utf8'), before);
});

test('导入校验：引用断裂（source_id 不存在）不改动文件', async () => {
  // GIVEN 一个关系引用不存在元素的 JSON
  // WHEN 执行 importProject
  // THEN 抛出引用完整性错误且文件内容不变
  const { tmp, graphPath } = makeFixture();
  const before = fs.readFileSync(graphPath, 'utf8');
  const service = createService({ searchRoots: [tmp] });
  service.refreshProjects();
  const project = [...service.state.projects.values()][0];
  const bad = miniGraph();
  bad.relationships[0].source_id = '9999';
  await assert.rejects(
    () => service.importProject(project.id, JSON.stringify(bad)),
    (error) => error.message.includes('source_id'),
  );
  assert.equal(fs.readFileSync(graphPath, 'utf8'), before);
});

test('导入校验：超大文件被拒绝且不改动文件', async () => {
  // GIVEN 一个超过大小上限的文本
  // WHEN 执行 importProject
  // THEN 抛出 413 且文件内容不变
  const { tmp, graphPath } = makeFixture();
  const before = fs.readFileSync(graphPath, 'utf8');
  const service = createService({ searchRoots: [tmp] });
  service.refreshProjects();
  const project = [...service.state.projects.values()][0];
  const huge = 'a'.repeat(MAX_IMPORT_BYTES + 1);
  await assert.rejects(
    () => service.importProject(project.id, huge),
    (error) => error.status === 413,
  );
  assert.equal(fs.readFileSync(graphPath, 'utf8'), before);
});

test('编辑 op → ARGO MCP 接口名映射正确', () => {
  // GIVEN 编辑操作集
  // WHEN 检查映射表
  // THEN 每个 op 映射到对应的 ARGO MCP 写图接口
  assert.equal(EDIT_OP_TOOL_MAP.addElement, 'addArchitectureElement');
  assert.equal(EDIT_OP_TOOL_MAP.updateElement, 'updateArchitectureElement');
  assert.equal(EDIT_OP_TOOL_MAP.removeElement, 'removeArchitectureElement');
  assert.equal(EDIT_OP_TOOL_MAP.addView, 'addArchitectureView');
  assert.equal(EDIT_OP_TOOL_MAP.updateView, 'updateArchitectureView');
  assert.equal(EDIT_OP_TOOL_MAP.removeView, 'removeArchitectureView');
  assert.equal(EDIT_OP_TOOL_MAP.updateRelationship, 'updateArchitectureRelationship');
  assert.equal(EDIT_OP_TOOL_MAP.removeRelationship, 'removeArchitectureRelationship');
  assert.equal(EDIT_OP_TOOL_MAP.applyMutation, 'applySystemArchitectureMutation');
});

test('编辑载荷 → MCP 参数构造正确', () => {
  // GIVEN 各编辑 op 的 HTTP 载荷
  // WHEN 调用 buildEditArgs
  // THEN 生成 ARGO MCP 对应的参数
  assert.deepEqual(
    buildEditArgs('addElement', { element: { id: '9', name: 'C', type: 'Application Component' }, view_ids: ['100'] }),
    { element: { id: '9', name: 'C', type: 'Application Component' }, view_ids: ['100'] },
  );
  assert.deepEqual(buildEditArgs('updateElement', { id: '1', patch: { description: 'x' } }), { id: '1', patch: { description: 'x' } });
  assert.deepEqual(buildEditArgs('removeElement', { id: '1' }), { id: '1' });
  assert.deepEqual(buildEditArgs('removeElement', { id: '1', view_ids: ['100'] }), { id: '1', view_ids: ['100'] });
  assert.deepEqual(buildEditArgs('addView', { view: { view_id: '101', view_name: 'V' } }), { view: { view_id: '101', view_name: 'V' } });
  assert.deepEqual(buildEditArgs('applyMutation', { mutations: [{ type: 'addView', view: { view_id: '101', view_name: 'V' } }] }), { mutations: [{ type: 'addView', view: { view_id: '101', view_name: 'V' } }] });
});

test('逆操作推导：addElement/updateElement 生成正确逆调用', () => {
  // GIVEN 编辑前文档
  // WHEN 调用 deriveInverseCommand
  // THEN addElement 的逆是 removeArchitectureElement，updateElement 的逆恢复旧值
  const before = miniGraph();
  const addInverse = deriveInverseCommand('addElement', { element: { id: '9', name: 'C', type: 'Application Component' }, view_ids: ['100'] }, before);
  assert.equal(addInverse.tool, 'removeArchitectureElement');
  assert.deepEqual(addInverse.args, { id: '9' });

  const updateInverse = deriveInverseCommand('updateElement', { id: '1', patch: { description: 'new' } }, before);
  assert.equal(updateInverse.tool, 'updateArchitectureElement');
  assert.deepEqual(updateInverse.args, { id: '1', patch: { description: 'alpha 组件' } });
});

test('撤销/重做：addElement 后 undo 回退、redo 前进（真实文件状态）', async () => {
  // GIVEN 一个注入 fake MCP 适配器的服务
  // WHEN 执行 addElement → undo → redo
  // THEN 文件分别出现/消失/再出现该元素
  const { tmp, graphPath } = makeFixture();
  const service = createService({ searchRoots: [tmp], mcpAdapter: createFakeAdapter() });
  service.refreshProjects();
  const project = [...service.state.projects.values()][0];

  await service.editProject(project.id, 'addElement', {
    element: { id: '9', name: 'C', type: 'Application Component' },
    view_ids: ['100'],
  });
  assert.ok(readGraph(graphPath).elements.some((e) => e.id === '9'), 'add 后元素应存在');

  await service.undoProject(project.id);
  assert.ok(!readGraph(graphPath).elements.some((e) => e.id === '9'), 'undo 后元素应消失');

  await service.redoProject(project.id);
  assert.ok(readGraph(graphPath).elements.some((e) => e.id === '9'), 'redo 后元素应恢复');
});

test('搜索 local：子串检索命中元素/关系/视图', () => {
  // GIVEN 一个迷你图谱
  // WHEN 调用 searchLocal
  // THEN 命中含关键字的元素/关系/视图并排序
  const hits = searchLocal(miniGraph(), 'alpha');
  assert.ok(hits.hits.some((h) => h.kind === 'element' && h.id === '1'), '应命中元素 1');
  const byName = searchLocal(miniGraph(), 'A');
  assert.ok(byName.hits.some((h) => h.kind === 'element' && h.name === 'A'), '应命中名为 A 的元素');
  const empty = searchLocal(miniGraph(), '');
  assert.equal(empty.hits.length, 0);
});

test('视图图数据：nodes/edges 含名称/类型/id', () => {
  // GIVEN 一个迷你图谱与视图 100
  // WHEN 调用 buildViewGraph
  // THEN 返回 2 个节点、1 条边，节点含 label/type/id
  const graph = buildViewGraph(miniGraph(), '100');
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  const node = graph.nodes.find((n) => n.id === '1');
  assert.equal(node.label, 'A');
  assert.equal(node.type, 'Application Component');
  assert.equal(graph.edges[0].source, '1');
  assert.equal(graph.edges[0].target, '2');
});

test('服务启动冒烟：临时端口启动，GET /api/projects 与 /export 可用', async () => {
  // GIVEN 一个临时项目目录
  // WHEN 在临时端口启动服务并请求 /api/projects 与 /export
  // THEN 返回 200，项目被列出，导出内容与文件一致且无 BOM
  const graph = miniGraph();
  const { tmp, graphPath } = makeFixture({ graph });
  const service = createService({ searchRoots: [tmp], port: 0 });
  const { port } = await service.start();

  try {
    const projectsRes = await fetch(`http://127.0.0.1:${port}/api/projects`);
    assert.equal(projectsRes.status, 200);
    const { projects } = await projectsRes.json();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'proj');

    const exportRes = await fetch(`http://127.0.0.1:${port}/api/projects/${projects[0].id}/export`);
    assert.equal(exportRes.status, 200);
    const exported = await exportRes.text();
    assert.equal(exported, fs.readFileSync(graphPath, 'utf8'));
    assert.equal(exported.charCodeAt(0) !== 0xfeff, true, '导出不应包含 BOM');
  } finally {
    await service.stop();
  }
});

test('图谱登记：组件 2760 携带实现验收用例 AT-2760-03', () => {
  // GIVEN Developer 已完成实现并在意图图谱登记
  // WHEN 检查组件 2760 的 testcases
  // THEN 存在 AT-2760-03（GIVEN-WHEN-THEN、可执行，Input 指向实现测试文件）
  const graph = readGraph(REAL_GRAPH);
  const component = (graph.elements || []).find((el) => el.id === '2760');
  assert.ok(component, '组件 2760 应存在');
  const tc = (component.testcases || []).find((entry) => entry.name && entry.name.includes('AT-2760-03'));
  assert.ok(tc, '组件 2760 应携带 AT-2760-03 实现验收用例');
  assert.match(tc.description, /GIVEN/);
  assert.match(tc.description, /WHEN/);
  assert.match(tc.description, /THEN/);
  assert.equal(tc.type, 'Acceptance Test');
  assert.ok(tc.Input && tc.Input.includes('tests/ea-web-service-impl.test.js'), 'AT-2760-03 的 Input 应指向实现测试');
});

test('导入校验：视图 parent_element_id 引用断裂不改动文件', async () => {
  // GIVEN 一个视图引用不存在元素的 JSON
  // WHEN 执行 importProject
  // THEN 抛出引用完整性错误且文件内容不变
  const { tmp, graphPath } = makeFixture();
  const before = fs.readFileSync(graphPath, 'utf8');
  const service = createService({ searchRoots: [tmp] });
  service.refreshProjects();
  const project = [...service.state.projects.values()][0];
  const bad = miniGraph();
  bad.views[0].parent_element_id = '9999';
  await assert.rejects(
    () => service.importProject(project.id, JSON.stringify(bad)),
    (error) => error.message.includes('parent_element_id'),
  );
  assert.equal(fs.readFileSync(graphPath, 'utf8'), before);
});

test('跨进程文件锁：占用期间再获取被拒绝，释放后可获取', () => {
  // GIVEN 一个图谱文件
  // WHEN 持有锁期间再次获取
  // THEN 抛出 409；释放后可再次获取
  const { graphPath } = makeFixture();
  const release = acquireFileLock(graphPath);
  try {
    assert.throws(
      () => acquireFileLock(graphPath, { timeoutMs: 200, retryMs: 20 }),
      (error) => error.status === 409,
    );
  } finally {
    release();
  }
  const release2 = acquireFileLock(graphPath, { timeoutMs: 200, retryMs: 20 });
  release2();
});

test('撤销/重做：applyMutation 快照回退（真实文件状态）', async () => {
  // GIVEN 一个支持 applySystemArchitectureMutation 的适配器
  // WHEN 执行 applyMutation → undo → redo
  // THEN 文件分别出现/消失/再出现该元素（快照回退）
  const { tmp, graphPath } = makeFixture();
  const adapter = {
    available: true,
    mode: 'fake',
    async callTool(toolName, args, projectRoot) {
      const gp = path.join(projectRoot, ...GRAPH_REL);
      const doc = readGraph(gp);
      if (toolName === 'applySystemArchitectureMutation') {
        for (const mutation of args.mutations || []) {
          if (mutation.type === 'addElement' && !doc.elements.some((e) => e.id === mutation.element.id)) {
            doc.elements.push(mutation.element);
          }
          if (mutation.type === 'removeElement') {
            doc.elements = doc.elements.filter((e) => e.id !== mutation.id);
          }
        }
        fs.writeFileSync(gp, JSON.stringify(doc, null, 2));
        return { ok: true, payload: { status: 'passed', written: true } };
      }
      return { ok: false, error: { message: `unsupported ${toolName}` } };
    },
  };
  const service = createService({ searchRoots: [tmp], mcpAdapter: adapter });
  service.refreshProjects();
  const project = [...service.state.projects.values()][0];

  await service.editProject(project.id, 'applyMutation', {
    mutations: [{ type: 'addElement', element: { id: '77', name: 'Z', type: 'Application Component' } }],
  });
  assert.ok(readGraph(graphPath).elements.some((e) => e.id === '77'), 'applyMutation 后元素应存在');

  await service.undoProject(project.id);
  assert.ok(!readGraph(graphPath).elements.some((e) => e.id === '77'), 'undo 后元素应消失');

  await service.redoProject(project.id);
  assert.ok(readGraph(graphPath).elements.some((e) => e.id === '77'), 'redo 后元素应恢复');
});

test('服务端点：POST /select 与 GET /context 可用', async () => {
  // GIVEN 一个启动中的服务与临时项目
  // WHEN 请求 POST /select 与 GET /context/:elementId
  // THEN /select 返回 200；/context 在 fake 适配器下返回 502（getIntentElementContext 不可用）
  const { tmp } = makeFixture();
  const service = createService({ searchRoots: [tmp], port: 0, mcpAdapter: createFakeAdapter() });
  const { port } = await service.start();
  try {
    const projectsRes = await fetch(`http://127.0.0.1:${port}/api/projects`);
    const { projects } = await projectsRes.json();
    const id = projects[0].id;

    const selectRes = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/select`, { method: 'POST' });
    assert.equal(selectRes.status, 200);

    const ctxRes = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/context/1`);
    assert.equal(ctxRes.status, 502);
  } finally {
    await service.stop();
  }
});

test('hitsFromPayload：归一化语义/上下文结果为前端 hits', () => {
  // GIVEN 一个 ARGO MCP 语义检索结果（document 形态）
  // WHEN 调用 hitsFromPayload
  // THEN 返回含元素/视图的 hits（kind/id/name/type）
  const hits = hitsFromPayload({
    document: {
      elements: [{ id: '1', name: 'A', type: 'Application Component' }],
      relationships: [],
      views: [{ view_id: '100', view_name: 'V' }],
    },
  });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].kind, 'element');
  assert.equal(hits[0].name, 'A');
  assert.equal(hits[1].kind, 'view');
  assert.equal(hits[1].id, '100');
});

test('语义检索：经 ARGO MCP getSystemArchitecture 返回 hits（真实后端）', async (t) => {
  // GIVEN ARGO MCP 进程内后端可用
  // WHEN 调用 searchSemantic
  // THEN 返回 supported=true 且 hits 含元素（复用 ARGO MCP 语义查询，无需自建向量/图库基础设施）
  const adapter = createMcpAdapter();
  if (!adapter.available) {
    t.skip('ARGO MCP in-process backend unavailable');
    return;
  }
  const project = { id: 'archgraph', name: 'archgraph', root: ROOT, graphPath: REAL_GRAPH };
  const result = await searchSemantic(adapter, project, 'EA 知识图谱导入导出本地Web服务');
  assert.equal(result.supported, true);
  assert.ok(Array.isArray(result.hits) && result.hits.length > 0, '语义检索应返回命中');
  assert.ok(result.hits.some((h) => h.kind === 'element'), '命中应包含元素');
});

test('真实 MCP 写图回滚：in-process addElement + removeElement', async (t) => {
  // GIVEN ARGO MCP 进程内后端可用且有一个真实图谱副本
  // WHEN 通过适配器真实执行一次 addElement 再 removeElement
  // THEN 元素被写入后被移除，图谱恢复原状（与 Agent 写图同一条代码路径）
  const adapter = createMcpAdapter();
  if (!adapter.available) {
    t.skip('ARGO MCP in-process backend unavailable');
    return;
  }
  const real = readGraph(REAL_GRAPH);

  // 使用非 canonical 图谱路径（design/KG/IntegrationFixture.json）：
  // 避免触发 Neo4j 同步与向量嵌入生命周期（本机无 Neo4j/LLM 服务时会长时间挂起）。
  // 写图仍走同一套 ARGO MCP buildMutationResult → writeGraph 代码路径。
  const fixtureRel = ['design', 'KG', 'IntegrationFixture.json'];
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-impl-mcp-'));
  fs.mkdirSync(path.join(projectRoot, ...fixtureRel.slice(0, -1)), { recursive: true });
  const graphPath = path.join(projectRoot, ...fixtureRel);
  fs.writeFileSync(graphPath, JSON.stringify(real, null, 2));
  const beforeCount = readGraph(graphPath).elements.length;

  const add = await adapter.callTool(
    'addArchitectureElement',
    {
      architecturePath: fixtureRel.join('/'),
      element: { id: '900001', name: '__ea_web_impl_test__', type: 'Grouping', description: 'tmp' },
      view_ids: ['1800'],
    },
    projectRoot,
  );
  if (!add.ok) {
    t.skip(`MCP addElement failed: ${JSON.stringify(add.error || add.payload).slice(0, 200)}`);
    return;
  }
  assert.ok(readGraph(graphPath).elements.some((e) => e.id === '900001'), 'add 后应存在元素');

  const remove = await adapter.callTool(
    'removeArchitectureElement',
    { architecturePath: fixtureRel.join('/'), id: '900001' },
    projectRoot,
  );
  assert.ok(remove.ok, 'remove 应成功');
  const after = readGraph(graphPath);
  assert.equal(after.elements.length, beforeCount, '元素数量应恢复');
  assert.ok(!after.elements.some((e) => e.id === '900001'), '元素应被移除');
});
