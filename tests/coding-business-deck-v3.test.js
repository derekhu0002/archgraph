'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const PPTX = path.join(ROOT, 'docs', 'ppt', 'output', 'archgraph-coding-business-deck-v3-final.pptx');
const PYTHON = 'C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';

test('AT coding-business-deck-v3-01: exported deck presents the framework-first narrative with scoped evidence', () => {
  // GIVEN the final PPTX as the audience receives it
  // WHEN its actual Open XML package is opened
  const script = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET, json
p=sys.argv[1]
with zipfile.ZipFile(p) as z:
    slides=[n for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml')]
    slides=sorted(slides, key=lambda n:int(n.rsplit('slide',1)[1].split('.')[0]))
    ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
    texts=[]; editable=0
    for name in slides:
        root=ET.fromstring(z.read(name))
        texts.append(' '.join(e.text or '' for e in root.findall('.//a:t',ns)))
        editable += len(root.findall('.//p:sp',ns))
    notes=' '.join(' '.join((e.text or '') for e in ET.fromstring(z.read(n)).findall('.//a:t',ns)) for n in z.namelist() if n.startswith('ppt/notesSlides/notesSlide') and n.endswith('.xml'))
    print(json.dumps({'slideCount':len(slides),'editableShapes':editable,'slides':texts,'notes':notes}, ensure_ascii=False))
`;
  const result = spawnSync(PYTHON, ['-c', script, PPTX], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(result.status, 0, result.stderr || 'PPTX package could not be opened');
  const pkg = JSON.parse(result.stdout.trim());
  assert.equal(pkg.slideCount, 9);
  assert.ok(pkg.editableShapes > 200, 'architecture diagrams should remain native editable shapes');
  const content = `${pkg.slides.join('\n')}\n${pkg.notes}`;
  const sequence = ['Coding Agent 如何把需求变成可验收的价值', '通用应用框架', 'ArchGraph 把', '指标体系', 'Graph RAG', '测评结果', '联邦把领域知识库', '20 项指标', '业界信号'];
  let cursor = -1;
  for (const phrase of sequence) {
    const next = pkg.slides.findIndex((slide, i) => i > cursor && slide.includes(phrase));
    assert.ok(next > cursor, `narrative is missing or out of order: ${phrase}`);
    cursor = next;
  }
  for (const phrase of ['AwaitingResult', 'AwaitingUser', 'Stopped', 'ArchiMate 3.2', '知识库质量', '覆盖 · 结构 · 溯源', 'Graph RAG 是应用框架', '94.6', '98.7', '10/10', '386', '不同研究口径']) {
    assert.ok(content.includes(phrase), `deck is missing required explanation/evidence: ${phrase}`);
  }
  assert.ok(!pkg.slides.join('\n').includes('Arcanate'), 'unsupported ontology name must not be presented as audience-facing content');
  assert.ok(!content.includes('99% 的代码'), 'unverified 99% claim must not be presented as fact');
});
