// 媒体艺术家 (media-artist-001) — 用 qwen3-vl-plus 视觉模型逐张验收生成的配图
// 接口: POST https://llm-clids9mqc5o1mbvb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions
// 凭据仅从 argo/.env 的 QWEN_KEY 读取，不写入文件、不打印。
// 用法: node scripts/inspect-skill-coevolution.js [imageFile ...]
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'argo', '.env');
const DIAGRAMS = path.join(ROOT, 'docs', 'diagrams');

function readQwenKey() {
  const txt = fs.readFileSync(ENV_FILE, 'utf8');
  const m = txt.split(/\r?\n/).find((l) => /^QWEN_KEY\s*=/.test(l));
  if (!m) throw new Error('QWEN_KEY not found in ' + ENV_FILE);
  return m.split('=').slice(1).join('=').trim();
}
const API_KEY = readQwenKey();
const ENDPOINT = 'https://llm-clids9mqc5o1mbvb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';

function request(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (e) { reject(new Error('bad json response')); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const QUESTIONS = {
  'skill-coevolution-banner.png':
    '请仔细看这张图片，用中文回答。画面里是否有：①一个半透明发光的人形AI智能体；②一本摊开并发光、有光点/光粒子飘出的技能手册；③光点融入智能体身体（技能被内化）；④背景有节点连线的知识图谱感。请逐项回答「有/没有」并简要描述所见。最后给出结论：整体构图是否自然，有无明显错误或奇怪元素（如多余的人物、错乱肢体、碍眼的文字或水印）。',
  'skill-coevolution-mount.png':
    '请仔细看这张图片，用中文回答。画面里是否有：①一个AI智能体；②墙上挂着一排可摘取的发光技能卡片（多张）；③智能体正取下一张卡片、其余卡片仍挂在墙上；④工作台/显示器等办公场景。请逐项回答「有/没有」并简要描述。最后给出结论：整体构图是否自然，有无明显错误或奇怪元素（如错乱肢体、多余人物、碍眼的文字或水印）。',
  'skill-coevolution-refine.png':
    '请仔细看这张图片，用中文回答。画面里是否有：①一个AI智能体坐在电脑桌前；②屏幕上出现红色报错/警示类元素（红线、提示框等）；③智能体在一本技能手册上写笔记，手册边缘微微发光；④整体有复盘、打磨的氛围。请逐项回答「有/没有」并简要描述。最后给出结论：整体构图是否自然，有无明显错误或奇怪元素（如错乱肢体、多余人物、碍眼的文字或水印）。',
  'skill-coevolution-export.png':
    '请仔细看这张图片，用中文回答。画面里是否有：①一个AI智能体；②手提箱样式的发光技能包/礼盒（带发光边条或卡扣）；③递送/交接动作（递给另一个智能体或人）；④一叠漂浮或附着的「避坑清单」纸张；⑤背景有节点连线。请逐项回答「有/没有」并简要描述。最后给出结论：整体构图是否自然，有无明显错误或奇怪元素（如错乱肢体、多余人物、碍眼的文字或水印）。',
};

(async () => {
  const args = process.argv.slice(2);
  const files = args.length ? args : Object.keys(QUESTIONS);
  const reportFile = path.join(__dirname, 'skill-coevolution-inspection.json');
  const results = { inspected_at: new Date().toISOString(), model: 'qwen3-vl-plus', files: {} };
  for (const f of files) {
    const filePath = path.join(DIAGRAMS, f);
    if (!fs.existsSync(filePath)) { console.log(`SKIP ${f}: missing`); continue; }
    const b64 = fs.readFileSync(filePath).toString('base64');
    const question = QUESTIONS[f] || '请用中文详细描述这张图片的画面内容，并指出任何构图错误或奇怪元素。';
    const body = JSON.stringify({
      model: 'qwen3-vl-plus',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
            { type: 'text', text: question },
          ],
        },
      ],
    });
    const headers = {
      'Authorization': 'Bearer ' + API_KEY,
      'Content-Type': 'application/json; charset=utf-8',
    };
    const resp = await request(ENDPOINT, headers, Buffer.from(body, 'utf8'));
    const content = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
    results.files[f] = content || JSON.stringify(resp).slice(0, 500);
    console.log('inspected ' + f);
  }
  fs.writeFileSync(reportFile, JSON.stringify(results, null, 2), 'utf8');
  console.log('report written to ' + reportFile);
})().catch((e) => { console.error(e); process.exit(1); });
