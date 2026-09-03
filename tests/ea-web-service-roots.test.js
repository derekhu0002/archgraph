'use strict';

// AT-2787-01（WP2787）：WEB 手动选择项目根目录与切换。
// GIVEN 本地 Web 服务运行（临时环境，显式工具配置路径）；
// WHEN 经 API 添加含 design/KG/SystemArchitecture.json 的本地目录；
// THEN /api/projects 列出新项目且可选中正常查看视图与布局，添加的 root 持久化且
//      服务重启后仍在，可经 API 移除；
// WHEN 添加不含 marker 的目录；THEN 明确报错且不加入。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  createService,
  resolveProjectsConfigPath,
  loadManualRoots,
  saveManualRoots,
} = require(path.join(ROOT, 'scripts', 'ea-web-service.js'));

const GRAPH_REL = ['design', 'KG', 'SystemArchitecture.json'];

function miniGraph(name) {
  return {
    name,
    description: `${name} fixture`,
    elements: [
      { id: '1', name: 'A', type: 'Application Component', description: 'alpha' },
      { id: '2', name: 'B', type: 'Application Service', parent: '1', description: 'beta' },
    ],
    relationships: [
      { id: '10', statement: 'A serves B', name: 'Serving', type: 'Serving', source_id: '1', target_id: '2' },
    ],
    views: [{ view_id: '100', view_name: 'Main', included_elements: ['1', '2'], included_relationships: ['10'] }],
  };
}

function seedProject(base, name) {
  const projectRoot = path.join(base, name);
  fs.mkdirSync(path.join(projectRoot, 'design', 'KG'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ...GRAPH_REL), JSON.stringify(miniGraph(name), null, 2));
  return projectRoot;
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function sendRoots(method, port, root) {
  const res = await fetch(`http://127.0.0.1:${port}/api/roots`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function startService(opts) {
  const service = createService(opts);
  return service.start().then(({ port }) => ({ service, port }));
}

test('配置：路径解析优先级与读写/容错', () => {
  // GIVEN 显式选项 / 环境变量 / 默认三种来源
  // WHEN 解析配置路径
  // THEN 显式选项 > EA_PROJECTS_CONFIG > 默认 ~/.argo/ea-tool/projects.json
  const explicit = path.join(os.tmpdir(), 'explicit-projects.json');
  assert.equal(resolveProjectsConfigPath(explicit), path.resolve(explicit));
  const previous = process.env.EA_PROJECTS_CONFIG;
  try {
    process.env.EA_PROJECTS_CONFIG = path.join(os.tmpdir(), 'env-projects.json');
    assert.equal(resolveProjectsConfigPath(), path.resolve(process.env.EA_PROJECTS_CONFIG));
  } finally {
    if (previous === undefined) {
      delete process.env.EA_PROJECTS_CONFIG;
    } else {
      process.env.EA_PROJECTS_CONFIG = previous;
    }
  }
  const before = process.env.EA_PROJECTS_CONFIG;
  delete process.env.EA_PROJECTS_CONFIG;
  try {
    assert.ok(resolveProjectsConfigPath().endsWith(path.join('.argo', 'ea-tool', 'projects.json')));
  } finally {
    if (before !== undefined) {
      process.env.EA_PROJECTS_CONFIG = before;
    }
  }

  // 读写回环 + 损坏文件容错
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-roots-cfg-'));
  const cfg = path.join(tmp, 'projects.json');
  saveManualRoots(cfg, [path.join(tmp, 'a'), path.join(tmp, 'b')]);
  assert.deepEqual(loadManualRoots(cfg), [path.join(tmp, 'a'), path.join(tmp, 'b')]);
  const doc = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  assert.equal(doc.version, 1);
  fs.writeFileSync(cfg, '{ not json');
  assert.deepEqual(loadManualRoots(cfg), [], '损坏配置应按空集处理');
});

test('AT-2787-01：手动添加项目根、切换查看、持久化重启恢复、移除与非法根报错', async () => {
  // GIVEN 临时扫描范围内的项目 projA + 扫描范围外的项目 projB + 临时工具配置路径
  // WHEN 经 /api/roots 添加 projB
  // THEN 项目列表含 projB，选中后视图/图数据/布局侧车正常，配置持久化且重启后恢复，
  //      可移除；无 marker / 不存在 / 重复 / 自动发现根分别明确报错
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-roots-'));
  const scanRoot = path.join(tmp, 'scan');
  const manualBase = path.join(tmp, 'manual');
  fs.mkdirSync(scanRoot, { recursive: true });
  fs.mkdirSync(manualBase, { recursive: true });
  const projA = seedProject(scanRoot, 'projA');
  const projB = seedProject(manualBase, 'projB');
  const configPath = path.join(tmp, 'projects.json');
  const opts = { searchRoots: [scanRoot], projectsConfigPath: configPath, port: 0 };

  let handle = await startService(opts);
  try {
    const { port } = handle;

    // 初始：仅自动发现的 projA；手动根为空
    let projects = (await getJson(`http://127.0.0.1:${port}/api/projects`)).body.projects;
    assert.deepEqual(projects.map((p) => p.name).sort(), ['projA']);
    assert.deepEqual((await getJson(`http://127.0.0.1:${port}/api/roots`)).body.roots, []);

    // WHEN 添加合法根（扫描范围外）
    const add = await sendRoots('POST', port, projB);
    assert.equal(add.status, 200, `添加应成功：${JSON.stringify(add.body)}`);
    assert.equal(add.body.ok, true);
    assert.equal(add.body.project.name, 'projB');
    assert.equal(add.body.project.valid, true);

    // THEN 项目列表含 projB
    projects = (await getJson(`http://127.0.0.1:${port}/api/projects`)).body.projects;
    assert.deepEqual(projects.map((p) => p.name).sort(), ['projA', 'projB']);
    const idB = projects.find((p) => p.name === 'projB').id;

    // THEN 选中后视图 / 图数据 / 布局侧车正常（切换联动既有逻辑）
    const views = await getJson(`http://127.0.0.1:${port}/api/projects/${idB}/views`);
    assert.equal(views.status, 200);
    assert.equal(views.body.views.length, 1);
    assert.equal(views.body.views[0].view_id, '100');
    const graph = await getJson(`http://127.0.0.1:${port}/api/projects/${idB}/views/100/graph`);
    assert.equal(graph.status, 200);
    assert.equal(graph.body.nodes.length, 2);
    assert.equal(graph.body.edges.length, 1);
    const layout = await getJson(`http://127.0.0.1:${port}/api/projects/${idB}/views/100/layout`);
    assert.equal(layout.status, 200);
    assert.ok(layout.body.elements['1'] && Number.isFinite(layout.body.elements['1'].x));

    // THEN 手动根持久化：配置落盘且可查
    const roots = (await getJson(`http://127.0.0.1:${port}/api/roots`)).body.roots;
    assert.deepEqual(roots, [path.resolve(projB)]);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(saved.version, 1);
    assert.deepEqual(saved.roots, [path.resolve(projB)]);

    // WHEN 重启服务（同配置）
  } finally {
    await handle.service.stop();
  }

  handle = await startService(opts);
  try {
    const { port } = handle;

    // THEN 重启后手动项目自动恢复
    let projects = (await getJson(`http://127.0.0.1:${port}/api/projects`)).body.projects;
    assert.deepEqual(projects.map((p) => p.name).sort(), ['projA', 'projB'], '重启后手动根应恢复');
    assert.deepEqual((await getJson(`http://127.0.0.1:${port}/api/roots`)).body.roots, [path.resolve(projB)]);

    // WHEN 添加非法根：无 marker / 不存在 / 空 / 重复
    const noMarker = path.join(tmp, 'no-marker');
    fs.mkdirSync(noMarker, { recursive: true });
    const badMarker = await sendRoots('POST', port, noMarker);
    assert.equal(badMarker.status, 400);
    assert.match(badMarker.body.error, /图谱标记/, '错误信息应说明缺少 marker');
    const missing = await sendRoots('POST', port, path.join(tmp, 'does-not-exist'));
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /目录不存在/);
    const empty = await sendRoots('POST', port, '');
    assert.equal(empty.status, 400);
    const dup = await sendRoots('POST', port, projB);
    assert.equal(dup.status, 409);
    projects = (await getJson(`http://127.0.0.1:${port}/api/projects`)).body.projects;
    assert.equal(projects.filter((p) => p.name === 'projB').length, 1, '非法添加不得产生重复项目');

    // WHEN 移除自动发现的项目根
    const removeAuto = await sendRoots('DELETE', port, projA);
    assert.equal(removeAuto.status, 404, '自动发现的项目不可移除');

    // WHEN 移除手动根
    const removed = await sendRoots('DELETE', port, projB);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.roots, []);
    projects = (await getJson(`http://127.0.0.1:${port}/api/projects`)).body.projects;
    assert.deepEqual(projects.map((p) => p.name), ['projA'], '移除后项目列表只剩自动发现项目');
    assert.deepEqual((await getJson(`http://127.0.0.1:${port}/api/roots`)).body.roots, []);
    const savedAfter = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(savedAfter.roots, [], '移除应持久化');
  } finally {
    await handle.service.stop();
  }
});
