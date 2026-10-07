'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const PPTX = path.join(ROOT, 'docs', 'ppt', 'output', 'archgraph-coding-business-deck-v5-final-aligned.pptx');
const V4 = path.join(ROOT, 'docs', 'ppt', 'output', 'archgraph-coding-business-deck-v4-final.pptx');
const PYTHON = 'C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';

test('AT coding-business-deck-v5-01: architecture drawings align to canonical model and position Graph precisely', () => {
  // GIVEN v4 remains available and v5 is the revised deck
  assert.ok(fs.existsSync(V4), 'v4 must remain available as the historical baseline');
  const script = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET, json
with zipfile.ZipFile(sys.argv[1]) as z:
    ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
    files=sorted([n for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml')], key=lambda n:int(n.rsplit('slide',1)[1].split('.')[0]))
    slides=[]; shapes=0
    for n in files:
        root=ET.fromstring(z.read(n)); slides.append(' '.join(x.text or '' for x in root.findall('.//a:t',ns))); shapes+=len(root.findall('.//p:sp',ns))
    notes=' '.join(' '.join(x.text or '' for x in ET.fromstring(z.read(n)).findall('.//a:t',ns)) for n in z.namelist() if n.startswith('ppt/notesSlides/notesSlide') and n.endswith('.xml'))
    print(json.dumps({'slides':slides,'shapeCount':shapes,'notes':notes},ensure_ascii=False))
`;
  const result = spawnSync(PYTHON, ['-c', script, PPTX], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(result.status, 0, result.stderr || 'v5 package could not be opened');
  const pkg = JSON.parse(result.stdout.trim());
  assert.equal(pkg.slides.length, 9);
  assert.ok(pkg.shapeCount > 220, 'architecture diagrams should remain editable native shapes');

  // WHEN following the story from generic layers through ArchGraph contribution and evidence
  const order = ['Coding Agent 业务价值流程', '通用 Coding Agent 应用架构', 'ArchGraph 在业务层与应用层中的位置', '业务阶段、应用能力与指标映射', 'Graph RAG 通用检索流程', '测评结果', '联邦式意图图谱'];
  let previous = -1;
  for (const phrase of order) {
    const next = pkg.slides.findIndex((slide, i) => i > previous && slide.includes(phrase));
    assert.ok(next > previous, `required slide title is absent or out of order: ${phrase}`);
    previous = next;
  }
  const [business, app, graph, metrics, rag, results] = pkg.slides;
  assert.ok(business.includes('Business Layer') && !business.includes('Graph RAG 检索'), 'retrieval implementations belong to the application layer, not the business flow');
  for (const term of ['Application Layer', '普通检索', 'RAG 检索', 'Graph RAG 检索', '通用 Harness 本身不要求部署 RAG']) assert.ok(app.includes(term), `missing app layer option ${term}`);
  for (const term of ['项目意图图谱', 'Graph MCP Tool Interface', '项目图谱上下文服务', '上下文访问']) assert.ok(graph.includes(term), `Graph architecture is missing ${term}`);
  assert.ok(metrics.includes('Assessment') && metrics.includes('会话编排') && metrics.includes('上下文访问'));
  assert.ok(rag.includes('写入') && rag.includes('检索') && rag.includes('查询')); 
  for (const term of ['94.6', '98.7', '10 / 10', '整体 Coding', '方向观察']) assert.ok(results.includes(term), `measurement evidence/caveat missing ${term}`);
  assert.ok(pkg.notes.includes('低年资工程师') && pkg.notes.includes('Graph RAG'));
});
