// 媒体艺术家 (media-artist-001) — 生成 view 169「Application Cooperation」的架构/协作关系配图
// 调用阿里云 DashScope 原生 text2image 接口 (qwen-image)，异步提交→轮询→下载 PNG 到 docs/diagrams/application-cooperation.png
// 凭据仅从 argo/.env 的 QWEN_KEY 读取，不写入文件、不打印。
// 用法:
//   node scripts/gen-application-cooperation.js            # 只生成图片
//   node scripts/gen-application-cooperation.js --inspect  # 生成图片后调用 qwen3-vl-plus 验收
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'argo', '.env');
const OUT_DIR = path.join(ROOT, 'docs', 'diagrams');
const OUT_FILE = 'application-cooperation.png';
const REPORT_FILE = path.join(__dirname, 'application-cooperation-inspection.json');

// ---- 读取 QWEN_KEY（不打印） ----
function readQwenKey() {
  const txt = fs.readFileSync(ENV_FILE, 'utf8');
  const m = txt.split(/\r?\n/).find((l) => /^QWEN_KEY\s*=/.test(l));
  if (!m) throw new Error('QWEN_KEY not found in ' + ENV_FILE);
  return m.split('=').slice(1).join('=').trim();
}
const API_KEY = readQwenKey();

// ---- HTTP 工具 ----
function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = { method, hostname: u.hostname, path: u.pathname + u.search, headers };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let data;
        try { data = JSON.parse(buf.toString('utf8')); } catch { data = buf.toString('utf8'); }
        resolve({ status: res.statusCode, data, raw: buf });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DashScope 原生 text2image 提交端点（公共域名；argo/.env 无 workspace-id 键，沿用仓库既有脚本同款端点）
const T2I_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';

// ---- 提示词（内容事实来自意图图 view 169，全部中文标签保真） ----
// v4：单行文本版——每个框尽量少文字、字号大；角色与姓名合并单行；加大留白。
const PROMPT =
  '极简扁平、专业的业务架构协作图（business architecture diagram），纯白背景，浅蓝填充的圆角矩形框，深灰边框与文字，实线 + 实心三角箭头。' +
  '画面只允许出现下列内容，绝对禁止头像、图标、序号、徽章、圆点、虚线、阴影、渐变、照片、Logo、水印以及任何多余文字。' +
  '每个框内文字只占一行或两行、字号尽量大、清晰、居中，逐字精确，禁止错别字、禁止改字、禁止丢括号、禁止乱码、禁止把两个框的文字合并写进一个框。\n' +
  '布局自上而下：\n' +
  '【顶部】两个框左右并排、之间留足空白：\n' +
  '  左框一行大字：GitHub Discussions\n' +
  '  右框一行大字：ArchGraph开发者社区\n' +
  '  一条实线实心箭头从左框右边缘水平指向右框左边缘；箭头中段下方标一行小字：Serving\n' +
  '【中部】正下方一个大框（尺寸明显大于其它框），框内两行：第一行大字「开发者社区开发交付」，第二行小字「交付工作，实现 ArchGraph 开发者社区」；' +
  '一条实线实心箭头从大框上边缘竖直向上指向顶部右框「ArchGraph开发者社区」的下边缘；箭头旁标一行小字：Realization\n' +
  '【底部】五个宽度相同的小框在同一水平线上均匀排开，相邻框之间留出足够空隙；每个小框内只写一行居中文字（姓名＋中文或英文角色，直接写成一串，中间不加换行）：\n' +
  '  第1框：chenlin（验证测试工程师）\n' +
  '  第2框：adam（Reviewer）\n' +
  '  第3框：Xiaoming（Developer）\n' +
  '  第4框：caoyang（系统设计师）\n' +
  '  第5框：xiaoniu（产品经理）\n' +
  '从这五个小框中每一个的上边缘，各自单独画一条实线实心箭头竖直向上指向大框「开发者社区开发交付」的下边缘；一共五条彼此独立的箭头，不要共线、不要汇聚成一条、不要画虚线；箭头不写文字。\n' +
  '拼写精确性要求（最后再强调一遍）：GitHub 必须 G 大写、H 大写；Xiaoming、Developer、Reviewer、xiaoniu、caoyang 大小写照抄；中文“产品经理”“系统设计师”“验证测试工程师”“开发者社区开发交付”“ArchGraph开发者社区”逐字照抄，五个底部框都必须出现、一个都不能少。';

// ---- 提交并轮询（单个任务） ----
// 模型可用 env IMG_MODEL 覆盖（默认 qwen-image；可用 qwen-image-plus）。
async function submit() {
  const model = process.env.IMG_MODEL || 'qwen-image';
  const body = JSON.stringify({
    model,
    input: { prompt: PROMPT },
    parameters: { size: '1280*720', n: 1, water_mark: false },
  });
  const headers = {
    'Authorization': 'Bearer ' + API_KEY,
    'Content-Type': 'application/json; charset=utf-8',
    'X-DashScope-Async': 'enable',
  };
  const res = await request('POST', T2I_ENDPOINT, headers, Buffer.from(body, 'utf8'));
  if (res.status !== 200) {
    throw new Error(`submit failed HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  }
  const taskId = res.data && res.data.output && res.data.output.task_id;
  if (!taskId) throw new Error(`no task_id: ${JSON.stringify(res.data)}`);
  return taskId;
}

async function poll(taskId) {
  const headers = { 'Authorization': 'Bearer ' + API_KEY };
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    const res = await request('GET', `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, headers);
    if (res.status !== 200) throw new Error(`poll failed HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    const st = res.data && res.data.output && res.data.output.task_status;
    if (st === 'SUCCEEDED') {
      const url = res.data.output.results && res.data.output.results[0] && res.data.output.results[0].url;
      if (!url) throw new Error('SUCCEEDED but no url');
      return { url, raw: res.data };
    }
    if (st === 'FAILED' || st === 'CANCELED') throw new Error(`task ${st}: ${JSON.stringify(res.data)}`);
  }
  throw new Error('timeout polling task');
}

function download(url, filePath) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'Authorization': 'Bearer ' + API_KEY } }, (r) => resolve(r));
    req.on('error', reject);
  }).then(async (res) => {
    const chunks = [];
    for await (const c of res) chunks.push(c);
    const buf = Buffer.concat(chunks);
    fs.writeFileSync(filePath, buf);
    return buf.length;
  });
}

// ---- PNG 有效性/尺寸检查（不依赖 PIL） ----
function pngInfo(filePath) {
  const buf = fs.readFileSync(filePath);
  // PNG signature + IHDR width/height at bytes 16..24 (big-endian)
  if (buf.length < 24 || buf.toString('utf8', 1, 4) !== 'PNG') return { valid: false };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { valid: true, width, height, bytes: buf.length };
}

// ---- 视觉验收（qwen3-vl-plus compatible-mode，写 UTF-8 JSON） ----
const VL_ENDPOINT = 'https://llm-clids9mqc5o1mbvb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';
const VL_QUESTION =
  '请仔细看这张业务架构协作关系图，用中文逐项回答（每项回答「有/没有」并简述所见）：\n' +
  '① 图中是否有中央框「开发者社区开发交付」；\n' +
  '② 顶部是否有「ArchGraph开发者社区」框，以及一条从中央框向上指向它的箭头（Realization 方向）；\n' +
  '③ 顶部左侧是否有「GitHub Discussions」框，以及一条从它指向「ArchGraph开发者社区」的箭头（Serving 方向）；\n' +
  '④ 底部是否有一排五个角色框，分别对应 chenlin(验证测试工程师)、adam(Reviewer)、Xiaoming(Developer)、caoyang(系统设计师)、xiaoniu(产品经理)；\n' +
  '⑤ 每个角色框是否有一条向上指向中央框的箭头（Assignment 方向）；\n' +
  '⑥ 图中所有中文文字是否清晰可读、无乱码/无错别字，文字是否被遮挡或重叠；\n' +
  '最后给出结论：整体是否是一张干净、布局正确的架构协作图，指出任何缺失元素、箭头方向错误、乱码文字或明显构图问题。';

async function inspect(filePath) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  const body = JSON.stringify({
    model: 'qwen3-vl-plus',
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
      { type: 'text', text: VL_QUESTION },
    ] }],
  });
  const headers = { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json; charset=utf-8' };
  const resp = await request('POST', VL_ENDPOINT, headers, Buffer.from(body, 'utf8'));
  const content = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  return content || JSON.stringify(resp).slice(0, 500);
}

// ---- 主流程 ----
(async () => {
  const doInspect = process.argv.includes('--inspect');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, OUT_FILE);
  const report = {
    generated_at: new Date().toISOString(),
    method: 'dashscope native text2image (qwen-image)',
    endpoint: T2I_ENDPOINT,
    view: { view_id: '169', view_name: 'Application Cooperation' },
    prompt: PROMPT,
  };

  try {
    const taskId = await submit();
    const { url, raw } = await poll(taskId);
    const bytes = await download(url, filePath);
    report.job = { status: 'SUCCEEDED', task_id: taskId, bytes, output: raw && raw.output };
    report.png = pngInfo(filePath);
    console.log(`OK -> ${OUT_FILE} (${bytes} bytes) ${JSON.stringify(report.png)}`);
  } catch (e) {
    report.job = { status: 'ERROR', error: String(e.message || e) };
    console.error('ERROR:', e.message);
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
    process.exit(1);
  }

  if (doInspect) {
    try {
      report.inspection = { model: 'qwen3-vl-plus', verdict: await inspect(filePath) };
      console.log('inspection done');
    } catch (e) {
      report.inspection = { error: String(e.message || e) };
      console.error('inspection ERROR:', e.message);
    }
  }
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log('report written to', REPORT_FILE);
})().catch((e) => { console.error(e); process.exit(1); });
