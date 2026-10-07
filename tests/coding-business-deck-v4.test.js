'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const PPTX = path.join(ROOT, 'docs', 'ppt', 'output', 'archgraph-coding-business-deck-v4-final.pptx');
const V3 = path.join(ROOT, 'docs', 'ppt', 'output', 'archgraph-coding-business-deck-v3-final.pptx');
const PYTHON = 'C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';

test('AT coding-business-deck-v4-01: business/application layers and optional RAG modes remain distinct and mapped', () => {
  // GIVEN the v3 historical deck and new v4 audience deliverable
  assert.ok(fs.existsSync(V3), 'v3 must remain available as the historical baseline');
  const script = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET, json
p=sys.argv[1]
with zipfile.ZipFile(p) as z:
    names=[n for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml')]
    names=sorted(names,key=lambda n:int(n.rsplit('slide',1)[1].split('.')[0]))
    ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
    slides=[]; shapes=0
    for n in names:
        root=ET.fromstring(z.read(n)); slides.append(' '.join(e.text or '' for e in root.findall('.//a:t',ns))); shapes+=len(root.findall('.//p:sp',ns))
    notes=' '.join(' '.join(e.text or '' for e in ET.fromstring(z.read(n)).findall('.//a:t',ns)) for n in z.namelist() if n.startswith('ppt/notesSlides/notesSlide') and n.endswith('.xml'))
    print(json.dumps({'slides':slides,'shapeCount':shapes,'notes':notes},ensure_ascii=False))
`;
  const result = spawnSync(PYTHON, ['-c', script, PPTX], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(result.status, 0, result.stderr || 'v4 PPTX package could not be opened');
  const pkg = JSON.parse(result.stdout.trim());
  assert.equal(pkg.slides.length, 9);
  assert.ok(pkg.shapeCount > 250, 'the layered architecture should use editable native PowerPoint shapes');

  // WHEN the audience follows the main story
  const order = ['Coding Agent 业务价值流：从需求到可验证交付', '通用 Coding Agent 应用框架', 'ArchGraph 在两层中的构建点', '业务环节 → 应用能力 → 指标', 'RAG 是应用层的可选知识访问能力', '哪些能力已有提升', '联邦把领域知识库组合成组织级知识图谱'];
  let previous = -1;
  for (const phrase of order) {
    const next = pkg.slides.findIndex((slide, i) => i > previous && slide.includes(phrase));
    assert.ok(next > previous, `required slide title or mapping is absent/out of order: ${phrase}`);
    previous = next;
  }
  const p1 = pkg.slides[0], p2 = pkg.slides[1], p4 = pkg.slides[3], p5 = pkg.slides[4], p6 = pkg.slides[5];
  assert.ok(p1.includes('Business Layer'), 'business value flow should be explicitly labeled as the business layer');
  assert.ok(!p1.includes('Graph RAG'), 'a retrieval implementation should not be embedded as a business workflow stage');
  for (const phrase of ['Application Layer', '普通检索', 'RAG', 'Graph RAG', '按需选择']) assert.ok(p2.includes(phrase), `application architecture is missing an optional knowledge access mode: ${phrase}`);
  assert.ok(p4.includes('Business Layer') && p4.includes('Application Layer') && p4.includes('指标'), 'metrics should map business stages to application capabilities');
  for (const phrase of ['本体', '图谱', '写入治理', 'Graph MCP']) assert.ok(p5.includes(phrase), `Graph-specific build point is missing: ${phrase}`);
  for (const phrase of ['94.6', '98.7', '10 / 10', '未运行', '同任务', '基准']) assert.ok(p6.includes(phrase), `results page is missing measured values or comparability limits: ${phrase}`);
  assert.ok(pkg.notes.includes('RAG / Graph RAG 是应用层按需选择的知识访问能力'));
});
