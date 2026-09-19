'use strict';

const base = (process.env.EMBED_BASE_URL || 'http://127.0.0.1:8080/v1').replace(/\/$/, '');
const model = process.env.EMBED_MODEL || 'Alibaba-NLP/gte-Qwen2-1.5B-instruct';
const dimensions = Number(process.env.EMBED_DIMENSIONS || 1536);

async function embed(input) {
  const response = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, model, dimensions }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data.map(item => item.embedding);
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}

(async () => {
  const health = await (await fetch(`${base.replace(/\/v1$/, '')}/health`)).json();
  console.log('health:', health);

  const [relatedEn, relatedZh, unrelated] = await embed([
    'The authentication component validates access tokens before requests reach the service.',
    '登录认证组件在请求到达服务前校验访问令牌。',
    'A recipe for banana bread with walnuts and cinnamon.',
  ]);
  console.log('dimensions:', relatedEn.length, relatedZh.length, unrelated.length);
  console.log('related_cosine:', cosine(relatedEn, relatedZh).toFixed(4));
  console.log('unrelated_cosine:', cosine(relatedEn, unrelated).toFixed(4));
})().catch(error => {
  console.error('ERR', error.message);
  process.exit(1);
});
