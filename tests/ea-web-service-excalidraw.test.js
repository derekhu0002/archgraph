'use strict';

// AT-2788-S1-01（WP2788-S1）：Excalidraw 画布内核（替换 G6 v5，vendored 零构建）
// GIVEN 本地 Web 服务运行；WHEN 打开某视图画布；
// THEN 页面以 Excalidraw 渲染（vendor 资源加载），布局坐标仍经侧车端点，
//      原 G6 渲染路径与 g6.min.js 移除，既有 /api 端点契约与测试基线不退化。

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-excalidraw-'));
  const projectRoot = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(projectRoot, ...GRAPH_REL.slice(0, -1)), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ...GRAPH_REL), JSON.stringify(miniGraph(), null, 2));
  return { tmp };
}

test('S1 vendor：Excalidraw bundle / css / 字体资源可服务且非空', async () => {
  // GIVEN web/vendor/excalidraw/ 随仓库提交
  // WHEN 服务运行并请求各资源
  // THEN bundle 为 JS 且暴露 ExcalidrawLib，css 为样式，字体为 font/woff2 且非空
  const vendorDir = path.join(ROOT, 'web', 'vendor', 'excalidraw');
  assert.ok(fs.existsSync(path.join(vendorDir, 'excalidraw.js')), 'excalidraw.js 应随仓库提交');
  assert.ok(fs.existsSync(path.join(vendorDir, 'excalidraw.css')), 'excalidraw.css 应随仓库提交');

  const { tmp } = makeFixture();
  const service = createService({ searchRoots: [tmp], projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  try {
    const jsRes = await fetch(`http://127.0.0.1:${port}/vendor/excalidraw/excalidraw.js`);
    assert.equal(jsRes.status, 200);
    assert.ok((jsRes.headers.get('content-type') || '').includes('text/javascript'), 'bundle Content-Type 应为 JS');
    const jsText = await jsRes.text();
    assert.ok(jsText.length > 1000000, 'Excalidraw bundle 体量应非平凡（含 React/ReactDOM）');
    assert.ok(jsText.includes('ExcalidrawLib'), 'bundle 应暴露 ExcalidrawLib 全局');
    assert.ok(jsText.includes('EXCALIDRAW_ASSET_PATH'), 'bundle 应支持资产基址机制');

    const cssRes = await fetch(`http://127.0.0.1:${port}/vendor/excalidraw/excalidraw.css`);
    assert.equal(cssRes.status, 200);
    assert.ok((cssRes.headers.get('content-type') || '').includes('text/css'));
    await cssRes.text();

    // CSS 依赖的 Assistant 资产 + Excalidraw 运行时字体（EXCALIDRAW_ASSET_PATH 指向本目录）
    const assetFile = fs.readdirSync(path.join(vendorDir, 'assets')).find((name) => name.endsWith('.woff2'));
    assert.ok(assetFile, 'assets/ 下应有 woff2 资产');
    const assetRes = await fetch(`http://127.0.0.1:${port}/vendor/excalidraw/assets/${assetFile}`);
    assert.equal(assetRes.status, 200);
    assert.ok((assetRes.headers.get('content-type') || '').includes('font/woff2'));
    assert.ok((await assetRes.arrayBuffer()).byteLength > 0);

    const xiaolaiDir = path.join(vendorDir, 'fonts', 'Xiaolai');
    const fontFile = fs.readdirSync(xiaolaiDir).find((name) => name.endsWith('.woff2'));
    assert.ok(fontFile, 'fonts/Xiaolai 下应有 woff2 字体（CJK 标签渲染）');
    const fontRes = await fetch(`http://127.0.0.1:${port}/vendor/excalidraw/fonts/Xiaolai/${fontFile}`);
    assert.equal(fontRes.status, 200);
    assert.ok((await fontRes.arrayBuffer()).byteLength > 0);
  } finally {
    await service.stop();
  }
});

test('S1 页面：index.html 加载 Excalidraw vendor 资源，不再引用 G6', () => {
  // GIVEN web/index.html
  // WHEN 静态检查
  // THEN 引入 excalidraw module/css/资产基址与 #graph-container；无 g6 引用
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  assert.ok(html.includes('<script type="module" src="/vendor/excalidraw/excalidraw.js"></script>'), '应以 module 加载 Excalidraw bundle');
  assert.ok(html.includes('/vendor/excalidraw/excalidraw.css'), '应引入 Excalidraw 样式');
  assert.ok(html.includes('EXCALIDRAW_ASSET_PATH'), '应设置资产基址');
  assert.ok(html.includes('id="graph-container"'), '图形区应为画布容器');
  assert.ok(!html.includes('g6'), '不应再引用 G6');
});

test('S1 前端：app.js 使用 Excalidraw API，无 G6 残留', () => {
  // GIVEN web/app.js
  // WHEN 静态检查
  // THEN 使用 ExcalidrawLib/convertToExcalidrawElements/customData 身份映射；无 G6 渲染路径残留
  const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
  assert.ok(app.includes('window.ExcalidrawLib'), '应通过 ExcalidrawLib 全局使用内核');
  assert.ok(app.includes('convertToExcalidrawElements'), '应使用骨架转换 API 构造场景');
  assert.ok(app.includes('customData'), '应以 customData 维护图形元素身份映射');
  assert.ok(app.includes('colorForLayer'), '层着色应沿用 colorForLayer');
  assert.ok(app.includes('regenerateIds: false'), '应保留确定性元素 id');
  for (const legacy of ['G6.Graph', 'g6.min.js', 'createElementNS', 'getElementPosition']) {
    assert.ok(!app.includes(legacy), `不应再包含 G6 路径残留: ${legacy}`);
  }
});

test('S1 下线：web/vendor/g6.min.js 已删除', () => {
  // GIVEN G6 内核被 Excalidraw 取代
  // WHEN 检查旧产物
  // THEN g6.min.js 不存在于仓库
  assert.ok(!fs.existsSync(path.join(ROOT, 'web', 'vendor', 'g6.min.js')), 'g6.min.js 应已从仓库移除');
});

test('S1 契约：既有 /api 端点形状不退化（/projects、/views、/views/:id/graph、/views/:id/layout）', async () => {
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
