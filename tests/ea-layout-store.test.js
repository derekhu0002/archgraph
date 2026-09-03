'use strict';

// AT-2785-L1~L5（WP2785 M1-S2，2026-09-03 修订：默认按项目隔离）：
// 布局侧车（坐标独立持久化，成员身份签名失效）
// L1：内容级修改（name/description/attributes）不改变成员集合 → signature 不变 → 坐标不动，
//     图谱 JSON 无任何 layout 字段；
// L2：新增成员 B → B 自动补位写入侧车，A 坐标原样保留；
// L3：移除成员 B → B 坐标被清理，A 坐标保留；
// L4：全程图谱 JSON 未被侧车写入/污染，侧车文件只落在配置的独立存储根目录；
// L5：未配置 layoutRoot/EA_LAYOUT_ROOT 时，侧车默认落在各项目自己的
//     <projectRoot>/design/KG/ea-layouts/<view_id>.json，不写 ~/.argo、不写
//     SystemArchitecture.json，多项目坐标互不串扰。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const { createService } = require(path.join(ROOT, 'scripts', 'ea-web-service.js'));
const {
  computeViewSignature,
  defaultPosition,
  createLayoutStore,
  resolveLayoutRoot,
} = require(path.join(ROOT, 'scripts', 'ea-layout-store.js'));

const GRAPH_REL = ['design', 'KG', 'SystemArchitecture.json'];

function fixtureGraph() {
  return {
    name: 'LayoutFixture',
    description: 'layout sidecar fixture',
    elements: [
      { id: 'A', name: 'Alpha', type: 'Application Component', description: 'alpha' },
      { id: 'B', name: 'Beta', type: 'Application Service', description: 'beta' },
    ],
    relationships: [
      { id: 'R1', statement: 'A serves B', name: 'Serving', type: 'Serving', source_id: 'A', target_id: 'B' },
    ],
    views: [
      { view_id: 'v1', view_name: 'V1', included_elements: ['A'], included_relationships: [] },
    ],
  };
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-layout-'));
  const layoutRoot = path.join(tmp, 'layout-root');
  const projectRoot = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(projectRoot, 'design', 'KG'), { recursive: true });
  const graphPath = path.join(projectRoot, ...GRAPH_REL);
  fs.writeFileSync(graphPath, JSON.stringify(fixtureGraph(), null, 2));
  return { tmp, layoutRoot, projectRoot, graphPath };
}

function readDoc(graphPath) {
  return JSON.parse(fs.readFileSync(graphPath, 'utf8'));
}

function writeDoc(graphPath, doc) {
  fs.writeFileSync(graphPath, JSON.stringify(doc, null, 2));
}

// 递归收集 JSON 文档中的所有对象键名。
function collectKeys(value, acc = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, acc);
    }
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      acc.add(key);
      collectKeys(value[key], acc);
    }
  }
  return acc;
}

function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

test('签名：仅成员身份决定——内容变更不变，成员/关系成员变更则变', () => {
  // GIVEN 两个仅内容字段不同的视图定义
  // WHEN 计算成员身份签名
  // THEN 内容差异不影响签名；成员集合差异改变签名
  const base = { view_id: 'v', view_name: 'V', included_elements: ['A', 'B'], included_relationships: ['R1'] };
  const contentChanged = {
    view_id: 'v-RENAMED',
    view_name: '另一个名字',
    description: '新增描述',
    included_elements: ['B', 'A'], // 顺序不同但集合相同
    included_relationships: ['R1'],
  };
  assert.equal(computeViewSignature(base), computeViewSignature(contentChanged), '内容/顺序变化不应改变签名');

  const memberAdded = { ...base, included_elements: ['A', 'B', 'C'] };
  assert.notEqual(computeViewSignature(base), computeViewSignature(memberAdded), '新增成员应改变签名');

  const relAdded = { ...base, included_relationships: ['R1', 'R2'] };
  assert.notEqual(computeViewSignature(base), computeViewSignature(relAdded), '新增关系成员应改变签名');
});

test('补位：默认位置确定性（沿用圆形布局公式）', () => {
  // GIVEN 相同索引与成员数
  // WHEN 多次调用 defaultPosition
  // THEN 结果一致且为有限数值
  const p1 = defaultPosition(1, 4);
  const p2 = defaultPosition(1, 4);
  assert.deepEqual(p1, p2);
  assert.ok(Number.isFinite(p1.x) && Number.isFinite(p1.y));
});

test('存储根：显式覆盖为 选项 > EA_LAYOUT_ROOT；无覆盖则按项目隔离（无全局默认根）', () => {
  // GIVEN 不同的根配置来源
  // WHEN 解析存储根
  // THEN 显式选项 > 环境变量；两者皆无时返回 null（= 默认按项目隔离存储）
  const explicit = path.join(os.tmpdir(), 'explicit-root');
  assert.equal(resolveLayoutRoot(explicit), path.resolve(explicit));

  const previous = process.env.EA_LAYOUT_ROOT;
  try {
    process.env.EA_LAYOUT_ROOT = path.join(os.tmpdir(), 'env-root');
    assert.equal(resolveLayoutRoot(), path.resolve(process.env.EA_LAYOUT_ROOT), '环境变量次之');
    const store = createLayoutStore({ layoutRoot: explicit });
    assert.equal(store.root, path.resolve(explicit), '显式选项优先于环境变量');
  } finally {
    if (previous === undefined) {
      delete process.env.EA_LAYOUT_ROOT;
    } else {
      process.env.EA_LAYOUT_ROOT = previous;
    }
  }

  const before = process.env.EA_LAYOUT_ROOT;
  delete process.env.EA_LAYOUT_ROOT;
  try {
    assert.equal(resolveLayoutRoot(), null, '无任何覆盖时应为按项目隔离（无全局默认根）');
    assert.equal(createLayoutStore().root, null);
  } finally {
    if (before !== undefined) {
      process.env.EA_LAYOUT_ROOT = before;
    }
  }
});

test('L1：内容级修改不扰动坐标与签名，图谱 JSON 无 layout 字段', async () => {
  // GIVEN 本地 Web 服务运行中，元素 A 的手动坐标已 PUT 存于布局侧车
  // WHEN Agent 仅修改图谱中 A 的内容（description），再 GET 布局
  // THEN A 坐标不变、signature 不变，图谱 JSON 无任何 layout 字段，图谱文件未被侧车写入
  const { tmp, layoutRoot, graphPath } = makeFixture();
  const service = createService({ searchRoots: [tmp], layoutRoot, projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  try {
    const { projects } = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
    const id = projects[0].id;

    const putRes = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/v1/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: { A: { x: 123, y: 45 } } }),
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.ok, true);
    const signatureBefore = putBody.signature;
    assert.ok(typeof signatureBefore === 'string' && signatureBefore.length === 64, '签名应为 sha256 hex');

    // 模拟 Agent 经 ARGO MCP 仅做内容级修改（此处为测试夹具：直接写临时图谱文件）。
    const doc = readDoc(graphPath);
    doc.elements.find((e) => e.id === 'A').description = 'alpha v2（内容级修改）';
    writeDoc(graphPath, doc);
    const bytesAfterContentEdit = fs.readFileSync(graphPath, 'utf8');

    const getRes = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/v1/layout`);
    assert.equal(getRes.status, 200);
    const layout = await getRes.json();
    assert.deepEqual(layout.elements.A, { x: 123, y: 45 }, 'A 坐标应原样保留');
    assert.equal(layout.signature, signatureBefore, '内容级修改不应改变成员身份签名');

    // 图谱 JSON 无任何 layout/坐标字段；GET 不得写图谱文件。
    const docAfter = readDoc(graphPath);
    const keys = collectKeys(docAfter);
    for (const forbidden of ['layout', 'layouts', 'x', 'y', 'fx', 'fy', 'signature']) {
      assert.ok(!keys.has(forbidden), `图谱 JSON 不应出现字段 '${forbidden}'`);
    }
    assert.equal(fs.readFileSync(graphPath, 'utf8'), bytesAfterContentEdit, '侧车操作不得写图谱文件');
  } finally {
    await service.stop();
  }
});

test('L2→L4：成员新增补位 / 移除清理 / 图谱零污染、侧车只落配置根', async () => {
  // GIVEN 元素 A 坐标已存于侧车
  // WHEN 向视图新增成员 B（L2）→ 再移除 B（L3）→ 全程结束检查（L4）
  // THEN B 补位写入且 A 保留；随后 B 坐标被清理、A 保留；
  //      图谱 JSON 未被侧车写入/污染，侧车文件只存在于配置的 layoutRoot 下
  const { tmp, layoutRoot, graphPath } = makeFixture();
  const service = createService({ searchRoots: [tmp], layoutRoot, projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  try {
    const { projects } = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
    const id = projects[0].id;
    const base = `http://127.0.0.1:${port}/api/projects/${id}/views/v1/layout`;

    await fetch(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: { A: { x: 100, y: 200 } } }),
    });
    const signatureA = (await (await fetch(base)).json()).signature;

    // ---- L2：新增成员 B（成员结构变化）----
    const doc2 = readDoc(graphPath);
    doc2.views.find((v) => v.view_id === 'v1').included_elements.push('B');
    writeDoc(graphPath, doc2);
    const bytesBeforeGet2 = fs.readFileSync(graphPath, 'utf8');

    const layout2 = await (await fetch(base)).json();
    assert.deepEqual(layout2.elements.A, { x: 100, y: 200 }, 'L2：A 坐标应原样保留');
    const posB = layout2.elements.B;
    assert.ok(posB && Number.isFinite(posB.x) && Number.isFinite(posB.y), 'L2：B 应被确定性补位');
    assert.notEqual(layout2.signature, signatureA, 'L2：成员变化应改变签名');
    assert.equal(fs.readFileSync(graphPath, 'utf8'), bytesBeforeGet2, 'L2：GET 补位不得写图谱文件');

    // 补位结果应已写回侧车文件（含 B）。
    const sidecarFiles = listFilesRecursive(layoutRoot).filter((f) => f.endsWith('.json'));
    assert.equal(sidecarFiles.length, 1, '侧车文件应只有一个视图文件');
    const sidecar2 = JSON.parse(fs.readFileSync(sidecarFiles[0], 'utf8'));
    assert.ok(sidecar2.elements.B, '侧车文件应含补位后的 B');
    assert.deepEqual(sidecar2.elements.A, { x: 100, y: 200 });
    assert.equal(sidecar2.view_id, 'v1');
    assert.equal(sidecar2.version, 1);

    // ---- L3：移除成员 B ----
    const doc3 = readDoc(graphPath);
    const view3 = doc3.views.find((v) => v.view_id === 'v1');
    view3.included_elements = view3.included_elements.filter((x) => x !== 'B');
    writeDoc(graphPath, doc3);
    const bytesBeforeGet3 = fs.readFileSync(graphPath, 'utf8');

    const layout3 = await (await fetch(base)).json();
    assert.ok(!('B' in layout3.elements), 'L3：B 坐标应被清理');
    assert.deepEqual(layout3.elements.A, { x: 100, y: 200 }, 'L3：A 坐标应保留');
    assert.equal(fs.readFileSync(graphPath, 'utf8'), bytesBeforeGet3, 'L3：GET 清理不得写图谱文件');

    // ---- L4：全局零污染检查 ----
    // 图谱文件内容 = L3 夹具编辑后的快照（侧车全程未写入图谱）。
    const finalDoc = readDoc(graphPath);
    const keys = collectKeys(finalDoc);
    for (const forbidden of ['layout', 'layouts', 'x', 'y', 'fx', 'fy', 'signature', 'coordinates']) {
      assert.ok(!keys.has(forbidden), `L4：图谱 JSON 不应出现字段 '${forbidden}'`);
    }
    assert.equal(sidecarFiles.length, 1);
    // 侧车文件只落在配置的 layoutRoot 下：项目目录内不存在任何侧车/布局文件。
    const projectFiles = listFilesRecursive(path.join(tmp, 'proj'));
    assert.deepEqual(projectFiles, [graphPath], '项目目录内应只有图谱文件，无任何侧车文件');
    for (const file of listFilesRecursive(layoutRoot)) {
      assert.ok(path.resolve(file).startsWith(path.resolve(layoutRoot) + path.sep), '侧车文件必须在配置根内');
    }
    // 侧车模块可执行代码不得引用图谱文件名（物理隔离静态断言；剔除注释后检查）。
    const storeSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'ea-layout-store.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert.ok(!storeSrc.includes('SystemArchitecture.json'), '布局侧车模块不得引用图谱文件');
  } finally {
    await service.stop();
  }
});

test('L5：默认存储按项目隔离（design/KG/ea-layouts/），不写 ~/.argo、不写图谱、多项目不串扰', async () => {
  // GIVEN 未配置 layoutRoot 选项与 EA_LAYOUT_ROOT 环境变量，临时项目（可多个）各含最小图谱
  // WHEN 对各项目读写视图布局
  // THEN 侧车文件落在各项目自己的 <projectRoot>/design/KG/ea-layouts/<view_id>.json，
  //      不写 ~/.argo/ea-tool/layouts、不写 SystemArchitecture.json，多项目坐标互不串扰
  const previousEnv = process.env.EA_LAYOUT_ROOT;
  delete process.env.EA_LAYOUT_ROOT;
  const homeLayoutDir = path.join(os.homedir(), '.argo', 'ea-tool', 'layouts');
  const homeBefore = listFilesRecursive(homeLayoutDir);
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-layout-l5-'));
    function makeProject(name) {
      const projectRoot = path.join(tmp, name);
      fs.mkdirSync(path.join(projectRoot, 'design', 'KG'), { recursive: true });
      const graphPath = path.join(projectRoot, ...GRAPH_REL);
      fs.writeFileSync(graphPath, JSON.stringify(fixtureGraph(), null, 2));
      return { projectRoot, graphPath };
    }
    const { projectRoot, graphPath } = makeProject('proj');
    const service = createService({ searchRoots: [tmp], projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
    const { port } = await service.start();
    try {
      const { projects } = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
      const id = projects.find((p) => p.name === 'proj').id;
      const base = `http://127.0.0.1:${port}/api/projects/${id}/views/v1/layout`;

      // WHEN 读写视图布局
      const bytesBefore = fs.readFileSync(graphPath, 'utf8');
      const putRes = await fetch(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: { A: { x: 11, y: 22 } } }),
      });
      assert.equal(putRes.status, 200);
      await putRes.text();
      const layout = await (await fetch(base)).json();
      assert.deepEqual(layout.elements.A, { x: 11, y: 22 });

      // THEN 侧车落在项目自己的 design/KG/ea-layouts/ 下
      const sidecarPath = path.join(projectRoot, 'design', 'KG', 'ea-layouts', 'v1.json');
      assert.ok(fs.existsSync(sidecarPath), `侧车文件应位于 ${sidecarPath}`);
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
      assert.equal(sidecar.view_id, 'v1');
      assert.equal(sidecar.version, 1);
      assert.deepEqual(sidecar.elements.A, { x: 11, y: 22 });

      // THEN 不写 SystemArchitecture.json
      assert.equal(fs.readFileSync(graphPath, 'utf8'), bytesBefore, '侧车操作不得写图谱文件');
      for (const forbidden of ['layout', 'layouts', 'x', 'y', 'signature']) {
        assert.ok(!collectKeys(readDoc(graphPath)).has(forbidden), `图谱 JSON 不应出现字段 '${forbidden}'`);
      }

      // THEN 不写全局 ~/.argo 存储根
      assert.deepEqual(listFilesRecursive(homeLayoutDir), homeBefore, '不应写 ~/.argo/ea-tool/layouts');

      // WHEN 第二个项目使用相同 view_id 写入不同坐标
      const { projectRoot: projectRoot2 } = makeProject('proj2');
      service.refreshProjects();
      const { projects: projects2 } = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
      const id2 = projects2.find((p) => p.name === 'proj2').id;
      assert.notEqual(id2, id);
      const base2 = `http://127.0.0.1:${port}/api/projects/${id2}/views/v1/layout`;
      const putRes2 = await fetch(base2, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: { A: { x: 333, y: 444 } } }),
      });
      assert.equal(putRes2.status, 200);
      await putRes2.text();

      // THEN 多项目坐标互不串扰，各自落在各自项目目录
      const layout1 = await (await fetch(base)).json();
      const layout2 = await (await fetch(base2)).json();
      assert.deepEqual(layout1.elements.A, { x: 11, y: 22 }, 'proj 的坐标不应被 proj2 覆盖');
      assert.deepEqual(layout2.elements.A, { x: 333, y: 444 });
      assert.ok(fs.existsSync(path.join(projectRoot2, 'design', 'KG', 'ea-layouts', 'v1.json')));
      assert.deepEqual(listFilesRecursive(homeLayoutDir), homeBefore, '全程不应写 ~/.argo/ea-tool/layouts');
    } finally {
      await service.stop();
    }
  } finally {
    if (previousEnv !== undefined) {
      process.env.EA_LAYOUT_ROOT = previousEnv;
    }
  }
});

test('端点：视图不存在 → 404；非法载荷 → 400', async () => {
  // GIVEN 启动中的服务与临时项目
  // WHEN 请求不存在视图的布局 / 提交非法坐标载荷
  // THEN 分别返回 404 / 400
  const { tmp, layoutRoot } = makeFixture();
  const service = createService({ searchRoots: [tmp], layoutRoot, projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  try {
    const { projects } = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
    const id = projects[0].id;

    const missing = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/nope/layout`);
    assert.equal(missing.status, 404);
    await missing.text(); // 消费响应体，避免 keep-alive 连接挂住 server.close()

    const bad = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/v1/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: { A: { x: 'not-a-number', y: 1 } } }),
    });
    assert.equal(bad.status, 400);
    await bad.text();

    const missingElements = await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/v1/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missingElements.status, 400);
    await missingElements.text();
  } finally {
    await service.stop();
  }
});

test('端点：GET 首访自动补位全体成员并写回（确定性圆形布局）', async () => {
  // GIVEN 无任何侧车文件
  // WHEN 首次 GET 布局
  // THEN 全部成员获得确定性坐标，签名可复算，侧车文件被创建
  const { tmp, layoutRoot, graphPath } = makeFixture();
  const service = createService({ searchRoots: [tmp], layoutRoot, projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  try {
    const { projects } = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
    const id = projects[0].id;
    const layout = await (await fetch(`http://127.0.0.1:${port}/api/projects/${id}/views/v1/layout`)).json();
    assert.ok(layout.elements.A && Number.isFinite(layout.elements.A.x) && Number.isFinite(layout.elements.A.y));
    const doc = readDoc(graphPath);
    assert.equal(layout.signature, computeViewSignature(doc.views[0]), '签名应等于按当前成员复算值');
    assert.equal(listFilesRecursive(layoutRoot).filter((f) => f.endsWith('.json')).length, 1, '首访应写回侧车');
  } finally {
    await service.stop();
  }
});
