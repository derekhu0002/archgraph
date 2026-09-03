'use strict';

// AT-2788-S1B-02（WP2788-S1B）：Playwright 真实浏览器验收 — MaxGraph 画布渲染与拖动落盘。
// GIVEN 本地 Web 服务运行且本机具备 Playwright+Chromium；
// WHEN 在真实浏览器中打开任一视图；
// THEN MaxGraph 画布挂载成功（嵌套 vendor 资源无 404），视图成员渲染为顶点并按层着色、
//      关系呈现为带箭头边；
// WHEN 拖动某顶点；THEN 坐标落盘到该项目 design/KG/ea-layouts/ 侧车。
// 环境无浏览器/缺 Playwright 时用例显式消息 skip 计通过（保障无浏览器环境基线不破）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const { createService } = require(path.join(ROOT, 'scripts', 'ea-web-service.js'));

const GRAPH_REL = ['design', 'KG', 'SystemArchitecture.json'];
const VIEW_ID = 'v100';
// 每层各一个元素，便于按层着色断言（Business/Application/Technology 三层色值互异）。
function fixtureGraph() {
  return {
    name: 'BrowserFixture',
    description: 'browser acceptance fixture',
    elements: [
      { id: 'A', name: 'AlphaComponent', type: 'Application Component', description: 'application 层' },
      { id: 'B', name: 'BetaDevice', type: 'Device', description: 'technology 层' },
      { id: 'C', name: 'GammaActor', type: 'Business Actor', description: 'business 层' },
    ],
    relationships: [
      { id: 'R1', statement: 'A serves B', name: 'Serving', type: 'Serving', source_id: 'A', target_id: 'B' },
      { id: 'R2', statement: 'C assigns A', name: 'Assignment', type: 'Assignment', source_id: 'C', target_id: 'A' },
    ],
    views: [{ view_id: VIEW_ID, view_name: 'V100', included_elements: ['A', 'B', 'C'], included_relationships: ['R1', 'R2'] }],
  };
}

// colorForLayer 同值：顶点填充色（SVG DOM 断言目标，比像素稳）。
const LAYER_COLORS = {
  Application: '#d1fae5',
  Technology: '#fef3c7',
  Business: '#dbeafe',
};
const EDGE_COLOR = '#868e96';

// 能力探测：缺 playwright 模块或本机无 chromium 可执行文件 → 返回原因供 skip。
function probeBrowser() {
  let pw;
  try {
    // eslint-disable-next-line global-require
    pw = require('playwright');
  } catch {
    return { ok: false, reason: 'playwright 模块不可用（未安装或加载失败）' };
  }
  let registryPath = null;
  try {
    registryPath = pw.chromium.executablePath();
  } catch {
    registryPath = null;
  }
  if (registryPath && fs.existsSync(registryPath)) {
    return { ok: true, pw, executablePath: registryPath };
  }
  const base = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(base)) {
    const dirs = fs.readdirSync(base).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
    for (const dir of dirs) {
      const candidate = path.join(base, dir, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(candidate)) {
        return { ok: true, pw, executablePath: candidate };
      }
    }
  }
  return { ok: false, reason: `未找到 chromium 可执行文件（registry 期望 ${registryPath || '未知'}）` };
}

test('AT-2788-S1B-02：真实浏览器打开视图 → MaxGraph SVG 挂载/按层着色/箭头边/资源零 404，拖动顶点坐标落侧车', async (t) => {
  const probe = probeBrowser();
  if (!probe.ok) {
    t.skip(`浏览器环境不可用，跳过真实浏览器验收：${probe.reason}`);
    return;
  }

  // 临时环境：项目 + 工具配置 + 服务（默认按项目侧车，落盘到项目自己的 design/KG/ea-layouts/）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-browser-'));
  const projectRoot = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(projectRoot, 'design', 'KG'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ...GRAPH_REL), JSON.stringify(fixtureGraph(), null, 2));
  const service = createService({ searchRoots: [tmp], projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  const browser = await probe.pw.chromium.launch({ headless: true, executablePath: probe.executablePath });
  try {
    const { projects } = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
    const projectId = projects.find((p) => p.name === 'proj').id;

    // 预置侧车坐标（视口内确定位置），并确认侧车端点可用。
    const seed = { A: { x: 120, y: 100 }, B: { x: 420, y: 100 }, C: { x: 270, y: 320 } };
    const putRes = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}/views/${VIEW_ID}/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: seed }),
    });
    assert.equal(putRes.status, 200);
    await putRes.text();
    const sidecarPath = path.join(projectRoot, 'design', 'KG', 'ea-layouts', `${VIEW_ID}.json`);
    assert.ok(fs.existsSync(sidecarPath), '预置后侧车文件应存在');

    const page = await browser.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const notFounds = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // 浏览器层资源错误（如 favicon.ico）不经过页面网络栈，
        // 只能从 console 消息的 location.url 拿到失败 URL。
        consoleErrors.push({ text: msg.text(), url: (msg.location() || {}).url || '' });
      }
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('response', (res) => {
      if (res.status() === 404) {
        notFounds.push(res.url());
      }
    });

    // 打开页面 → 选中项目 → 打开视图 → 等待 MaxGraph SVG 挂载
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForSelector('#project-list li');
    await page.click('#project-list li:has-text("proj")');
    await page.waitForSelector('#view-list li:has-text("V100")');
    await page.click('#view-list li:has-text("V100")');
    await page.waitForSelector('#graph-container svg', { timeout: 20000 });

    // 视图成员渲染为顶点并按层着色：SVG 中存在对应填充色的矩形（SVG DOM 断言，比像素稳）
    for (const [layer, color] of Object.entries(LAYER_COLORS)) {
      const rect = page.locator(`#graph-container svg rect[fill="${color}"]`);
      await rect.first().waitFor({ state: 'attached', timeout: 20000 });
      assert.ok(await rect.count() >= 1, `${layer} 层顶点应按 ${color} 填充渲染`);
    }
    // 顶点数 = 视图成员数（3）
    const vertexCount = await page.locator('#graph-container svg rect[rx]').count();
    assert.ok(vertexCount >= 3, `应渲染 3 个圆角顶点（实际 ${vertexCount}）`);

    // 标签文本：name + type 双行（SVG <text>）
    const svgText = await page.locator('#graph-container svg').first().textContent();
    for (const label of ['AlphaComponent', 'BetaDevice', 'GammaActor', 'Application Component', 'Device', 'Business Actor']) {
      assert.ok(svgText.includes(label), `SVG 应含标签文本: ${label}`);
    }

    // 关系呈现为带箭头边：正交路径（描边色）+ 箭头（同色填充）
    const edgePaths = page.locator(`#graph-container svg path[stroke="${EDGE_COLOR}"]`);
    assert.ok(await edgePaths.count() >= 2, '两条关系应渲染为边路径');
    const arrowHeads = page.locator(`#graph-container svg path[fill="${EDGE_COLOR}"]`);
    assert.ok(await arrowHeads.count() >= 2, '边应带箭头（同色填充路径）');
    // 边标签（关系类型）
    for (const label of ['Serving', 'Assignment']) {
      assert.ok(svgText.includes(label), `SVG 应含边标签: ${label}`);
    }

    // 拖动落盘：对 A 顶点（Application 色）执行指针拖动
    const sidecarBefore = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    const beforeA = sidecarBefore.elements.A;
    assert.deepEqual(beforeA, seed.A, '拖动前 A 坐标应为预置值');

    const vertexBox = await page.locator(`#graph-container svg rect[fill="${LAYER_COLORS.Application}"]`).first().boundingBox();
    assert.ok(vertexBox, 'A 顶点应有 bounding盒');
    const startX = vertexBox.x + vertexBox.width / 2;
    const startY = vertexBox.y + vertexBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 50, { steps: 10 });
    await page.mouse.up();
    // 等防抖（400ms）+ PUT 落盘
    await page.waitForTimeout(1500);

    const sidecarAfter = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    const afterA = sidecarAfter.elements.A;
    assert.ok(afterA, '拖动后侧车仍应含 A 坐标');
    assert.ok(
      Math.abs(afterA.x - beforeA.x - 80) <= 25 && Math.abs(afterA.y - beforeA.y - 50) <= 25,
      `A 坐标应按拖动位移更新（期望 ≈+80/+50，实际 ${afterA.x - beforeA.x}/${afterA.y - beforeA.y}）`,
    );
    assert.deepEqual(sidecarAfter.elements.B, sidecarBefore.elements.B, '未拖动的 B 坐标不应变化');
    assert.deepEqual(sidecarAfter.elements.C, sidecarBefore.elements.C, '未拖动的 C 坐标不应变化');

    // 资源与控制台断言：/vendor 嵌套资源零 404；无页面错误
    const vendor404 = notFounds.filter((url) => url.includes('/vendor/'));
    assert.deepEqual(vendor404, [], '/vendor 资源不应出现 404');
    assert.deepEqual(pageErrors, [], '页面不应有未捕获错误');
    // 控制台「资源 404」错误按失败 URL 甄别：/vendor 下零容忍；
    // 非 /vendor（如浏览器自动请求的 favicon.ico，服务未提供图标属预期）容忍并如实记录。
    const resourceFailureErrors = consoleErrors.filter((e) => /Failed to load resource.*404/i.test(e.text));
    const vendorConsoleErrors = resourceFailureErrors.filter((e) => e.url.includes('/vendor/'));
    assert.deepEqual(
      vendorConsoleErrors.map((e) => e.url),
      [],
      '/vendor 资源不应出现 404（含浏览器层请求）',
    );
    const unexpectedConsoleErrors = consoleErrors.filter((e) => !/Failed to load resource.*404/i.test(e.text));
    assert.deepEqual(
      unexpectedConsoleErrors.map((e) => e.text),
      [],
      '除资源 404 提示外不应有控制台 error',
    );
    const tolerated = resourceFailureErrors.filter((e) => !e.url.includes('/vendor/'));
    if (tolerated.length > 0 || notFounds.length > 0) {
      console.log(`[ea-web-browser] 容忍的非 vendor 资源 404: ${JSON.stringify([...tolerated.map((e) => e.url), ...notFounds])}`);
    }
  } finally {
    await browser.close();
    await service.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
