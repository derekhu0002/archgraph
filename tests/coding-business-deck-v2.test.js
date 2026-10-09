'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const PPTX = path.join(ROOT, 'docs', 'ppt', 'output', 'archgraph-coding-business-deck-v2-final4.pptx');
const PYTHON = 'C:/Users/remoteadmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';

test('AT coding-business-deck-v2-01: exported deck preserves the nine-slide narrative and critical caveats', () => {
  // GIVEN the delivered PPTX as the audience receives it
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
    print(json.dumps({'slideCount':len(slides),'editableShapes':editable,'text':'\n'.join(texts),'notes':notes}, ensure_ascii=False))
`;
  const result = spawnSync(PYTHON, ['-c', script, PPTX], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(result.status, 0, result.stderr || 'PPTX package could not be opened');
  const packageInfo = JSON.parse(result.stdout.trim());
  assert.equal(packageInfo.slideCount, 9, 'the finished deck must contain nine slides');
  assert.ok(packageInfo.editableShapes > 150, 'slides should contain editable native PowerPoint shapes');
  const content = `${packageInfo.text}\n${packageInfo.notes}`;
  for (const phrase of ['AwaitingResult', 'AwaitingUser', 'Stopped', '结果另判', 'Graph RAG', '不是完整的 Coding Agent', '10 题试跑', '基线受污染', 'AgentBench']) {
    assert.ok(content.includes(phrase), `delivered deck is missing required audience-facing content: ${phrase}`);
  }
});
