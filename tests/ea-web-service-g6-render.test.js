'use strict';

// AT-2785-S1-01（WP2785 M1-S1）：G6 v5 图形内核
// GIVEN 本地 Web 服务运行中；WHEN 打开某视图画布；
// THEN 以 G6 v5 渲染（本地 vendor /vendor/g6.min.js），原基础 SVG 渲染路径被移除，
// 且既有 /api 端点契约与既有测试基线不退化。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const { createService, buildViewGraph } = require(path.join(ROOT, 'scripts', 'ea-web-service.js'));

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-g6-'));
  const projectRoot = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(projectRoot, ...GRAPH_REL.slice(0, -1)), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ...GRAPH_REL), JSON.stringify(miniGraph(), null, 2));
  return { tmp };
}

test('M1-S1 vendor：/vendor/g6.min.js 可服务且为 JS（本地 vendor，零构建）', async () => {
  // GIVEN 本地 Web 服务运行中且 web/vendor/g6.min.js 存在
  // WHEN GET /vendor/g6.min.js
  // THEN 200、text/javascript、UMD 全局 G6、体量非平凡
  const vendorFile = path.join(ROOT, 'web', 'vendor', 'g6.min.js');
  assert.ok(fs.existsSync(vendorFile), 'web/vendor/g6.min.js 应随仓库提交');

  const { tmp } = makeFixture();
  const service = createService({ searchRoots: [tmp], projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/vendor/g6.min.js`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('text/javascript'), 'Content-Type 应为 JS');
    const text = await res.text();
    assert.ok(text.length > 100000, 'G6 UMD 产物体量应非平凡');
    assert.ok(text.includes('G6'), '应暴露 G6 全局');
  } finally {
    await service.stop();
  }
});

test('M1-S1 vendor：路径穿越被拒绝（/vendor/.. 不能逃逸静态目录）', async () => {
  // GIVEN 本地 Web 服务运行中
  // WHEN GET /vendor/../app.js 之外的穿越路径（如 /vendor/../package.json 的编码变体不可达）
  // THEN 逃逸静态目录的请求被 403 拒绝
  const { tmp } = makeFixture();
  const service = createService({ searchRoots: [tmp], projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/vendor/../scripts/ea-web-service.js`, { redirect: 'manual' });
    // serveStatic 路径解析后逃逸 → 403；若被 URL 规范化为 /scripts/... → 404。两者都可接受，绝不能 200。
    assert.ok([403, 404].includes(res.status), `穿越请求不应成功（实际 ${res.status}）`);
    await res.text();
  } finally {
    await service.stop();
  }
});

test('M1-S1 页面：index.html 引用 vendor G6 与 G6 容器，不再含基础 SVG 图区', () => {
  // GIVEN web/index.html
  // WHEN 静态检查
  // THEN 引用 /vendor/g6.min.js 与 #graph-container，且不再包含 #graph-svg
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="/vendor/g6.min.js"></script>'), '应引用本地 vendor G6');
  assert.ok(html.includes('id="graph-container"'), '图形区应为 G6 容器');
  assert.ok(!html.includes('graph-svg'), '不应再包含基础 SVG 图区');
});

test('M1-S1 前端：app.js 使用 G6 v5 内核，原基础 SVG 渲染路径被移除', () => {
  // GIVEN web/app.js
  // WHEN 静态检查
  // THEN 使用 G6.Graph + 四个 behaviors + 层着色；不再包含 SVG 渲染/拖动路径
  const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
  assert.ok(app.includes('new G6.Graph'), '应使用 G6 v5 Graph');
  for (const behavior of ['drag-canvas', 'zoom-canvas', 'drag-element', 'click-select']) {
    assert.ok(app.includes(behavior), `应启用 behavior: ${behavior}`);
  }
  assert.ok(app.includes('colorForLayer'), '层着色应沿用 colorForLayer');
  for (const legacy of ['createElementNS', 'onSvgMouseMove', 'onSvgMouseUp', 'graph-svg', 'dragNodeId']) {
    assert.ok(!app.includes(legacy), `不应再包含基础 SVG 路径: ${legacy}`);
  }
});

test('M1-S1 契约：既有 /api 端点形状不退化（/projects、/views、/views/:id/graph）', async () => {
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
    assert.equal(viewsBody.views.length, 1);
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

    const missing = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/999/graph`);
    assert.equal(missing.status, 404);
    await missing.text();
  } finally {
    await service.stop();
  }
});

test('M1-S1 纯函数：buildViewGraph 默认圆形布局形状不变（前端回退依赖）', () => {
  // GIVEN 迷你图谱
  // WHEN 调用 buildViewGraph
  // THEN 节点仍带默认圆形布局 x/y 与 fx/fy=null（既有契约）
  const graph = buildViewGraph(miniGraph(), '100');
  for (const node of graph.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), '默认布局应有数值坐标');
    assert.equal(node.fx, null);
    assert.equal(node.fy, null);
  }
});
