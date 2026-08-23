// 媒体艺术家 (media-artist-001) — 生成《AI 的技能，不能拿来就用》公众号配图
// 调用阿里云 DashScope 原生 text2image 接口 (qwen-image)，异步提交→轮询→下载 PNG 到 docs/diagrams/
// 凭据仅从 argo/.env 的 QWEN_KEY 读取，不写入文件、不打印。
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'argo', '.env');
const OUT_DIR = path.join(ROOT, 'docs', 'diagrams');
const REPORT_FILE = path.join(__dirname, 'skill-coevolution-jobs.json');

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
    const options = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers,
    };
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

// ---- 任务 ----
const JOBS = [
  {
    id: 'skill-coevolution-banner',
    file: 'skill-coevolution-banner.png',
    size: '1280*720',
    prompt:
      '写实摄影风格，暖色调科技感氛围，电影级光线。画面中央是一个半透明发光的人形 AI 智能体（机器人轮廓由柔和蓝白辉光构成，轮廓清晰，站在未来感工作台前，微微低头专注）。工作台上摊开一本发光的厚重技能手册（类似工程手册/魔法书，书页边缘有淡金色辉光），书页正向上飘散出无数细小光点，形成金色与蓝白色的光粒子流，源源不断地融入智能体的身体，仿佛技能正在被它内化、长在身上；智能体的身体随着光点融入而微微发光。背景是暗色半透明的科技知识图谱：许多发光节点由细线连成网络，呈现淡蓝色科技网格。整体庄重大气，柔和体积光，高细节，画面中不出现任何文字、字母、数字或水印。',
  },
  {
    id: 'skill-coevolution-mount',
    file: 'skill-coevolution-mount.png',
    size: '1280*720',
    prompt:
      '写实摄影风格，明亮温馨的现代 AI 工作间。一面墙上整齐挂着一排可摘取的发光技能卡片（每张卡片像挂在挂钩上的证件软卡，卡片边缘微微发光，表面只有抽象图标无文字）。一个半透明发光的人形 AI 智能体站在墙前，正用一只手轻轻取下一张与当前工作相关的技能卡片，其余卡片仍然挂在墙上，暗示技能不占上下文、按需取用。旁边一张现代办公桌上放着一台亮着蓝色界面的显示器与几件办公物品。柔和自然光与暖色灯光混合，浅景深，写实摄影质感，高细节，画面中不出现任何文字、字母、数字或水印。',
  },
  {
    id: 'skill-coevolution-refine',
    file: 'skill-coevolution-refine.png',
    size: '1280*720',
    prompt:
      '写实摄影风格，偏暗的复盘打磨氛围，电影感光线。一个半透明发光的人形 AI 智能体坐在电脑桌前，专注地盯着屏幕上显示的报错信息（屏幕上一片柔和红色警示线、红色提示框与界面元素，红色辉光映在智能体面部）。智能体的手正握着一支发光笔，在一本摊开在桌面上的技能手册里写下笔记，手册边缘微微发出金色光芒，暗示技能正在进化；桌面上散落几页写满笔迹的纸张。光线冷蓝与暖金交织，浅景深，写实摄影质感，高细节，屏幕与手册上不出现任何清晰可读的文字、字母、数字或水印。',
  },
  {
    id: 'skill-coevolution-export',
    file: 'skill-coevolution-export.png',
    size: '1280*720',
    prompt:
      '写实摄影风格，暖色科技感。画面中一个半透明发光的人形 AI 智能体正把一个收拾好的技能包递给另一个人（另一个半透明发光智能体的侧影，微微俯身伸手接过）。技能包是一个手提箱样式的发光礼盒（旅行箱造型，带发光边条与发光卡扣，箱盖半开，内部隐约可见发光的文件夹与卡片，表面无文字）。技能包上方漂浮着一叠避坑清单纸张，纸张边缘发光，页面上无清晰文字。背景是暗色半透明的知识图谱：发光节点由细线连成网络。柔和体积光，写实摄影质感，高细节，画面中不出现任何文字、字母、数字或水印。',
  },
];

// ---- 提交并轮询 ----
async function submit(job) {
  const body = JSON.stringify({
    model: 'qwen-image',
    input: { prompt: job.prompt },
    parameters: { size: job.size, n: 1, water_mark: false },
  });
  const headers = {
    'Authorization': 'Bearer ' + API_KEY,
    'Content-Type': 'application/json; charset=utf-8',
    'X-DashScope-Async': 'enable',
  };
  const res = await request('POST', 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', headers, Buffer.from(body, 'utf8'));
  if (res.status !== 200) {
    throw new Error(`submit failed (${job.id}) HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  }
  const taskId = res.data && res.data.output && res.data.output.task_id;
  if (!taskId) throw new Error(`no task_id for ${job.id}: ${JSON.stringify(res.data)}`);
  return taskId;
}

async function poll(job, taskId) {
  const headers = { 'Authorization': 'Bearer ' + API_KEY };
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const res = await request('GET', `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, headers);
    if (res.status !== 200) {
      throw new Error(`poll failed (${job.id}) HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }
    const st = res.data && res.data.output && res.data.output.task_status;
    if (st === 'SUCCEEDED') {
      const url = res.data.output.results && res.data.output.results[0] && res.data.output.results[0].url;
      if (!url) throw new Error(`SUCCEEDED but no url for ${job.id}`);
      return url;
    }
    if (st === 'FAILED' || st === 'CANCELED') {
      throw new Error(`task ${st} for ${job.id}: ${JSON.stringify(res.data)}`);
    }
  }
  throw new Error(`timeout polling ${job.id}`);
}

async function download(url, filePath) {
  const res = await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'Authorization': 'Bearer ' + API_KEY } }, (r) => resolve(r));
    req.on('error', reject);
  });
  const chunks = [];
  for await (const c of res) chunks.push(c);
  const buf = Buffer.concat(chunks);
  fs.writeFileSync(filePath, buf);
  return buf.length;
}

// ---- 主流程 ----
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = { generated_at: new Date().toISOString(), model: 'qwen-image', jobs: [] };
  for (const job of JOBS) {
    const entry = { id: job.id, file: job.file, prompt: job.prompt };
    try {
      const taskId = await submit(job);
      const url = await poll(job, taskId);
      const filePath = path.join(OUT_DIR, job.file);
      const bytes = await download(url, filePath);
      entry.status = 'OK';
      entry.bytes = bytes;
      entry.task_id = taskId;
      console.log(`OK ${job.id} -> ${job.file} (${bytes} bytes)`);
    } catch (e) {
      entry.status = 'ERROR';
      entry.error = String(e.message || e);
      console.error(`ERROR ${job.id}: ${e.message}`);
    }
    report.jobs.push(entry);
  }
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log('report written to', REPORT_FILE);
})().catch((e) => { console.error(e); process.exit(1); });
