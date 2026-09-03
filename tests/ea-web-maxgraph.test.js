'use strict';

// AT-2788-S1B-01（WP2788-S1B）：MaxGraph 画布内核（替换 Excalidraw，vendored，Apache-2.0）
// GIVEN 本地 Web 服务运行；WHEN 打开某视图画布；
// THEN 页面以 MaxGraph 渲染（vendor 资源加载），布局坐标仍经侧车端点，
//      Excalidraw 资产与渲染路径移除，既有 /api 端点契约与测试基线不退化。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const { createService } = require(path.join(ROOT, 'scripts', 'ea-web-service.js'));

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

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-maxgraph-'));
  const projectRoot = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(projectRoot, ...GRAPH_REL.slice(0, -1)), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ...GRAPH_REL), JSON.stringify(miniGraph(), null, 2));
  return { tmp };
}

test('S1B vendor：MaxGraph bundle/css 可服务，Apache-2.0 合规文件齐备', async () => {
  // GIVEN web/vendor/maxgraph/ 随仓库提交（一次性 esbuild，含许可横幅）
  // WHEN 服务运行并请求各资源
  // THEN bundle 为 JS 且暴露 MaxGraphLib、携带 Apache 许可横幅；LICENSE/NOTICE 在库
  const vendorDir = path.join(ROOT, 'web', 'vendor', 'maxgraph');
  assert.ok(fs.existsSync(path.join(vendorDir, 'maxgraph.js')), 'maxgraph.js 应随仓库提交');
  assert.ok(fs.existsSync(path.join(vendorDir, 'maxgraph.css')), 'maxgraph.css 应随仓库提交');
  assert.ok(fs.existsSync(path.join(vendorDir, 'LICENSE')), 'Apache-2.0 LICENSE 全文应随仓库提交');
  assert.ok(fs.existsSync(path.join(vendorDir, 'NOTICE')), 'NOTICE（来源与许可说明）应随仓库提交');
  const bundleHead = fs.readFileSync(path.join(vendorDir, 'maxgraph.js'), 'utf8').slice(0, 2000);
  assert.match(bundleHead, /Apache License/i, 'bundle 头部应保留许可注释');
  assert.match(bundleHead, /maxGraph/i, 'bundle 头部应注明 maxGraph 来源');
  const notice = fs.readFileSync(path.join(vendorDir, 'NOTICE'), 'utf8');
  assert.match(notice, /Apache/i, 'NOTICE 应注明 Apache-2.0');
  assert.match(notice, /@maxgraph\/core/, 'NOTICE 应注明来源包');

  const { tmp } = makeFixture();
  const service = createService({ searchRoots: [tmp], projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  try {
    const jsRes = await fetch(`http://127.0.0.1:${port}/vendor/maxgraph/maxgraph.js`);
    assert.equal(jsRes.status, 200);
    assert.ok((jsRes.headers.get('content-type') || '').includes('text/javascript'), 'bundle Content-Type 应为 JS');
    const jsText = await jsRes.text();
    assert.ok(jsText.length > 100000, 'MaxGraph bundle 体量应非平凡');
    assert.ok(jsText.includes('MaxGraphLib'), 'bundle 应暴露 MaxGraphLib 全局');

    const cssRes = await fetch(`http://127.0.0.1:${port}/vendor/maxgraph/maxgraph.css`);
    assert.equal(cssRes.status, 200);
    assert.ok((cssRes.headers.get('content-type') || '').includes('text/css'));
    await cssRes.text();
  } finally {
    await service.stop();
  }
});

test('S1B 页面：index.html 加载 MaxGraph vendor 资源，无 Excalidraw/G6 残留', () => {
  // GIVEN web/index.html
  // WHEN 静态检查
  // THEN 引入 maxgraph module/css 与 #graph-container；无 excalidraw/g6 残留
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  assert.ok(html.includes('<script type="module" src="/vendor/maxgraph/maxgraph.js"></script>'), '应以 module 加载 MaxGraph bundle');
  assert.ok(html.includes('/vendor/maxgraph/maxgraph.css'), '应引入 MaxGraph 样式');
  assert.ok(html.includes('id="graph-container"'), '图形区应为画布容器');
  for (const legacy of ['excalidraw', 'g6', 'EXCALIDRAW_ASSET_PATH']) {
    assert.ok(!html.toLowerCase().includes(legacy), `不应再包含旧内核残留: ${legacy}`);
  }
});

test('S1B 前端：app.js 使用 MaxGraph API，无 Excalidraw/G6 残留', () => {
  // GIVEN web/app.js
  // WHEN 静态检查
  // THEN 使用 MaxGraphLib（insertVertex/insertEdge/MOVE_CELLS/禁用编辑）；无旧内核路径残留
  const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
  assert.ok(app.includes('window.MaxGraphLib'), '应通过 MaxGraphLib 全局使用内核');
  assert.ok(app.includes('insertVertex'), '成员应渲染为顶点');
  assert.ok(app.includes('insertEdge'), '关系应渲染为边');
  assert.ok(app.includes('MOVE_CELLS'), '应监听顶点移动事件落侧车');
  assert.ok(app.includes('setCellsEditable(false)'), '应禁用单元格内文字编辑');
  assert.ok(app.includes('orthogonalEdgeStyle'), '边应使用正交路由');
  assert.ok(app.includes('colorForLayer'), '层着色应沿用 colorForLayer');
  for (const legacy of ['ExcalidrawLib', 'G6.Graph', 'g6.min.js', 'createElementNS', 'getElementPosition', 'EXCALIDRAW_ASSET_PATH', 'convertToExcalidrawElements']) {
    assert.ok(!app.includes(legacy), `不应再包含旧内核残留: ${legacy}`);
  }
});

test('S1B 下线：web/vendor/excalidraw 已删除', () => {
  // GIVEN 画布内核改选 MaxGraph
  // WHEN 检查旧资产
  // THEN excalidraw vendor 目录不存在于仓库
  assert.ok(!fs.existsSync(path.join(ROOT, 'web', 'vendor', 'excalidraw')), 'web/vendor/excalidraw 应已从仓库移除');
});

test('S1B 契约：既有 /api 端点形状不退化（/projects、/views、/views/:id/graph、/views/:id/layout）', async () => {
  // GIVEN 启动中的服务与临时项目
  // WHEN 抽样请求既有端点
  // THEN 响应形状与既有契约一致（字段不缺失、类型不变）
  const { tmp } = makeFixture();
  const service = createService({ searchRoots: [tmp], projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  try {
    const projectsRes = await fetch(`http://127.0.0.1:${port}/api/projects`);
    assert.equal(projectsRes.status, 200);
    const { projects } = await projectsRes.json();
    assert.equal(projects.length, 1);
    for (const key of ['id', 'name', 'graphPath', 'root', 'valid', 'elements', 'relationships', 'views', 'mtime']) {
      assert.ok(key in projects[0], `/api/projects 应含字段 ${key}`);
    }
    const id = projects[0].id;

    const viewsRes = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views`);
    assert.equal(viewsRes.status, 200);
    const viewsBody = await viewsRes.json();
    assert.equal(viewsBody.project, id);
    for (const key of ['view_id', 'view_name', 'parent_element_id', 'element_count', 'relationship_count']) {
      assert.ok(key in viewsBody.views[0], `/views 应含字段 ${key}`);
    }

    const graphRes = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/100/graph`);
    assert.equal(graphRes.status, 200);
    const graph = await graphRes.json();
    assert.ok(graph.project && typeof graph.project.id === 'string' && typeof graph.project.name === 'string');
    assert.deepEqual(graph.view, { view_id: '100', view_name: 'Main' });
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);
    for (const key of ['id', 'label', 'type', 'layer', 'x', 'y', 'fx', 'fy', 'data']) {
      assert.ok(key in graph.nodes[0], `graph.nodes 应含字段 ${key}`);
    }
    for (const key of ['id', 'source', 'target', 'label', 'type']) {
      assert.ok(key in graph.edges[0], `graph.edges 应含字段 ${key}`);
    }

    const layoutRes = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/100/layout`);
    assert.equal(layoutRes.status, 200);
    const layout = await layoutRes.json();
    assert.ok(typeof layout.signature === 'string' && layout.signature.length === 64, 'layout 应含成员身份签名');
    assert.ok(layout.elements && Number.isFinite(layout.elements['1'].x), 'layout 应含全体成员坐标');

    const missing = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/999/graph`);
    assert.equal(missing.status, 404);
    await missing.text();
  } finally {
    await service.stop();
  }
});
