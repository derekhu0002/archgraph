'use strict';

// AT-2788-S2-01（WP2788-S2）：三栏编辑器外壳与全区域自适应（真实浏览器验收）。
// GIVEN 本地 Web 服务运行且本机具备 Playwright+Chromium；
// WHEN 在真实浏览器中以不同视口尺寸（宽屏≥1440 / 中屏≈1024 / 窄屏≤700）打开应用；
// THEN 编辑器呈三栏外壳（左模型树 / 中画布 / 右属性面板）且全部区域随视口自适应
//      （无固定宽高溢出，画布随窗口 resize，窄屏面板折叠/堆叠降级）；
//      模型树列出选中项目的视图与成员元素，点视图打开画布，点树中元素在画布定位/高亮；
//      既有添加/移除项目、检索、编辑、导入导出、undo/redo 入口保持可用。
// 环境无浏览器/缺 Playwright 时显式消息 skip 计通过。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const { createService } = require(path.join(ROOT, 'scripts', 'ea-web-service.js'));

const GRAPH_REL = ['design', 'KG', 'SystemArchitecture.json'];
const VIEW_ID = 'v100';

function fixtureGraph() {
  return {
    name: 'ShellFixture',
    description: 'shell acceptance fixture',
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

function attachDiagnostics(page, sink) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      sink.consoleErrors.push({ text: msg.text(), url: (msg.location() || {}).url || '' });
    }
  });
  page.on('pageerror', (err) => sink.pageErrors.push(String(err)));
  page.on('response', (res) => {
    if (res.status() === 404) {
      sink.notFounds.push(res.url());
    }
  });
}

async function openProjectAndView(page, port) {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForSelector('#project-list li');
  await page.click('#project-list li:has-text("proj")');
  await page.waitForSelector('#view-list li:has-text("V100")');
  await page.click('#view-list .tree-view-row:has-text("V100")');
  await page.waitForSelector('#graph-container svg', { timeout: 20000 });
  await page.waitForSelector('#graph-container svg rect[rx]', { timeout: 20000 });
}

async function assertNoHorizontalOverflow(page, label) {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dims.scrollWidth <= dims.clientWidth + 1,
    `${label} 不应有横向溢出（scrollWidth ${dims.scrollWidth} > clientWidth ${dims.clientWidth}）`,
  );
}

test('AT-2788-S2-01：三栏外壳全区域自适应（1600/1024/640 三档视口）+ 模型树/属性面板/画布联动 + 既有入口可用', async (t) => {
  const probe = probeBrowser();
  if (!probe.ok) {
    t.skip(`浏览器环境不可用，跳过真实浏览器验收：${probe.reason}`);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-shell-'));
  const projectRoot = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(projectRoot, 'design', 'KG'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ...GRAPH_REL), JSON.stringify(fixtureGraph(), null, 2));
  const service = createService({ searchRoots: [tmp], projectsConfigPath: path.join(tmp, 'projects.json'), port: 0 });
  const { port } = await service.start();
  const browser = await probe.pw.chromium.launch({ headless: true, executablePath: probe.executablePath });
  const sink = { consoleErrors: [], pageErrors: [], notFounds: [] };
  try {
    // ---------------- 宽屏 1600×900：完整交互链路 ----------------
    const wideCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await wideCtx.newPage();
    attachDiagnostics(page, sink);

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForSelector('#project-list li');

    // ① 三栏外壳区域均存在
    for (const selector of ['#topbar', '#left-panel', '#center-panel', '#right-panel']) {
      assert.ok(await page.locator(selector).isVisible(), `外壳区域应存在且可见: ${selector}`);
    }
    await page.click('#project-list li:has-text("proj")');
    await page.waitForSelector('#view-list li:has-text("V100")');

    // 模型树列出视图与成员（打开视图前：视图行已列出）
    assert.ok(await page.locator('#view-list .tree-view-row:has-text("V100")').isVisible(), '模型树应列出视图');

    // ② 无横向溢出
    await assertNoHorizontalOverflow(page, '宽屏 1600×900');
    const canvasWide = await page.locator('#graph-container').boundingBox();

    // 点视图 → 画布渲染顶点
    await page.click('#view-list .tree-view-row:has-text("V100")');
    await page.waitForSelector('#graph-container svg', { timeout: 20000 });
    await page.waitForSelector('#graph-container svg rect[rx]', { timeout: 20000 });
    const vertexCount = await page.locator('#graph-container svg rect[rx]').count();
    assert.ok(vertexCount >= 3, `画布应渲染 3 个顶点（实际 ${vertexCount}）`);

    // 打开的视图展开成员元素
    await page.waitForSelector('#view-list .tree-member:has-text("AlphaComponent")');
    assert.ok(await page.locator('#view-list .tree-member:has-text("BetaDevice")').isVisible(), '模型树应展开成员');

    // 点树中元素 → 画布定位/选中该顶点 → 右栏显示详情
    await page.click('#view-list .tree-member:has-text("AlphaComponent")');
    await page.waitForFunction(
      () => document.getElementById('properties-detail').textContent.includes('AlphaComponent'),
      null,
      { timeout: 10000 },
    );
    const propsText = await page.locator('#properties-detail').textContent();
    assert.ok(propsText.includes('Application Component'), '右栏应显示元素类型');
    assert.ok(await page.locator('#view-list .tree-member.selected').count() >= 1, '模型树应高亮选中成员');

    // 画布点选 → 右栏联动（反向联动）
    const betaBox = await page.locator('#graph-container svg rect[fill="#fef3c7"]').first().boundingBox();
    assert.ok(betaBox, 'BetaDevice 顶点应可见');
    await page.mouse.click(betaBox.x + betaBox.width / 2, betaBox.y + betaBox.height / 2);
    await page.waitForFunction(
      () => document.getElementById('properties-detail').textContent.includes('BetaDevice'),
      null,
      { timeout: 10000 },
    );

    // 既有入口可用：添加项目输入/检索/导入导出/undo/redo/刷新/移除项目
    for (const selector of ['#add-project-path', '#btn-add-project', '#btn-remove-project', '#refresh-projects', '#search-input', '#search-mode', '#btn-search', '#btn-export', '#btn-import', '#btn-undo', '#btn-redo']) {
      assert.ok(await page.locator(selector).isVisible(), `既有入口应可见: ${selector}`);
    }
    // 高级编辑页签（手填 JSON 编辑区保留）
    await page.click('#tab-advanced');
    assert.ok(await page.locator('#advanced-tab').isVisible(), '高级编辑页签应可切换');
    assert.ok(await page.locator('#edit-op').isVisible(), '高级编辑 op 选择应可用');
    assert.ok(await page.locator('#btn-edit').isVisible(), '高级编辑执行按钮应可用');
    await page.click('#tab-properties');
    assert.ok(await page.locator('#properties-tab').isVisible(), '属性页签应可切回');

    // 桌面折叠：左栏可收缩（宽度→0），再展开恢复
    const leftBefore = await page.locator('#left-panel').boundingBox();
    assert.ok(leftBefore.width > 100, '宽屏左栏应有合理宽度');
    await page.click('#btn-toggle-left');
    await page.waitForTimeout(300);
    const leftCollapsed = await page.locator('#left-panel').boundingBox();
    assert.ok(leftCollapsed.width < 2, '折叠后左栏宽度应收缩为 0');
    await assertNoHorizontalOverflow(page, '宽屏折叠左栏后');
    await page.click('#btn-toggle-left');
    await page.waitForTimeout(300);

    // ---------------- 中屏 1024×768：三栏自适应 ----------------
    const midCtx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const midPage = await midCtx.newPage();
    attachDiagnostics(midPage, sink);
    await openProjectAndView(midPage, port);
    for (const selector of ['#left-panel', '#center-panel', '#right-panel']) {
      assert.ok(await midPage.locator(selector).isVisible(), `中屏外壳区域应可见: ${selector}`);
    }
    await assertNoHorizontalOverflow(midPage, '中屏 1024×768');
    // ③ 画布容器尺寸随视口变化
    const canvasMid = await midPage.locator('#graph-container').boundingBox();
    assert.ok(canvasMid.width < canvasWide.width - 100, `画布宽度应随视口缩小（宽屏 ${canvasWide.width} → 中屏 ${canvasMid.width}）`);

    // ---------------- 窄屏 640×800：堆叠降级 ----------------
    const narrowCtx = await browser.newContext({ viewport: { width: 640, height: 800 } });
    const narrowPage = await narrowCtx.newPage();
    attachDiagnostics(narrowPage, sink);
    await openProjectAndView(narrowPage, port);
    await assertNoHorizontalOverflow(narrowPage, '窄屏 640×800');
    // ④ 窄屏降级：面板堆叠（宽度≈视口宽，远超桌面 clamp 上限 320）
    const leftNarrow = await narrowPage.locator('#left-panel').boundingBox();
    const rightNarrow = await narrowPage.locator('#right-panel').boundingBox();
    assert.ok(leftNarrow.width > 500, `窄屏左栏应堆叠为全宽（实际 ${leftNarrow.width}）`);
    assert.ok(rightNarrow.width > 500, `窄屏右栏应堆叠为全宽（实际 ${rightNarrow.width}）`);
    // 画布仍可用
    assert.ok(await narrowPage.locator('#graph-container svg rect[rx]').count() >= 3, '窄屏画布仍应渲染顶点');
    // 折叠控件可操作：收起左栏 → 不可见（display:none 降级）
    await narrowPage.click('#btn-toggle-left');
    await narrowPage.waitForSelector('#left-panel', { state: 'hidden', timeout: 5000 });
    assert.ok(!(await narrowPage.locator('#left-panel').isVisible()), '窄屏折叠后左栏应隐藏');
    await assertNoHorizontalOverflow(narrowPage, '窄屏折叠左栏后');
    await narrowPage.click('#btn-toggle-left');
    await narrowPage.waitForSelector('#left-panel', { state: 'visible', timeout: 5000 });

    // ---------------- 资源与控制台断言（全部页面汇总） ----------------
    const vendor404 = sink.notFounds.filter((url) => url.includes('/vendor/'));
    assert.deepEqual(vendor404, [], '/vendor 资源不应出现 404');
    assert.deepEqual(sink.pageErrors, [], '页面不应有未捕获错误');
    const resourceFailureErrors = sink.consoleErrors.filter((e) => /Failed to load resource.*404/i.test(e.text));
    const vendorConsoleErrors = resourceFailureErrors.filter((e) => e.url.includes('/vendor/'));
    assert.deepEqual(vendorConsoleErrors.map((e) => e.url), [], '/vendor 资源不应出现 404（含浏览器层请求）');
    const unexpectedConsoleErrors = sink.consoleErrors.filter((e) => !/Failed to load resource.*404/i.test(e.text));
    assert.deepEqual(unexpectedConsoleErrors.map((e) => e.text), [], '除资源 404 提示外不应有控制台 error');
    const tolerated = resourceFailureErrors.filter((e) => !e.url.includes('/vendor/'));
    if (tolerated.length > 0 || sink.notFounds.length > 0) {
      console.log(`[ea-web-shell] 容忍的非 vendor 资源 404: ${JSON.stringify([...tolerated.map((e) => e.url), ...sink.notFounds])}`);
    }
  } finally {
    await browser.close();
    await service.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
