'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function parseInfoFrontmatter(md) {
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!m) {
    throw new Error('info.md is missing a YAML frontmatter block');
  }
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) {
      let value = kv[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      meta[kv[1]] = value;
    }
  }
  return meta;
}

test('layout-style: tech-simple light layout with nav, hero and sections', () => {
  // GIVEN the project website is published
  // WHEN a visitor opens the homepage in a browser
  // THEN the page renders a tech-simple layout: nav bar, hero, title and sectioned content in a light theme
  assert.match(HTML, /<nav\b/, 'page should have a top navigation bar');
  assert.match(HTML, /class="hero"/, 'page should have a hero section');
  assert.match(
    HTML,
    /<h1[\s\S]*?ArchGraph/,
    'hero should show the project name'
  );
  const sections = HTML.match(/<section\b/g) || [];
  assert.ok(sections.length >= 4, 'page should have at least 4 content sections');
  assert.match(HTML, /data-theme="light"/, 'page should declare a light tech theme');
});

test('kglibrary-area: lists every KGlibrary reference project', () => {
  // GIVEN the KGlibrary directory contains reference projects
  // WHEN a visitor opens the homepage in a browser
  // THEN the page has a Reference Library (KGlibrary) area listing each project name, description and repo link
  assert.match(HTML, /id="kglibrary"/, 'page should have a KGlibrary reference area');

  const kgDir = path.join(ROOT, 'KGlibrary');
  const projects = readdirSync(kgDir).filter((entry) =>
    statSync(path.join(kgDir, entry)).isDirectory()
  );
  assert.ok(projects.length >= 1, 'KGlibrary should contain at least one reference project');

  for (const project of projects) {
    const info = readFileSync(path.join(kgDir, project, 'info.md'), 'utf8');
    const meta = parseInfoFrontmatter(info);

    assert.ok(meta.name, `project ${project} should declare a name`);
    assert.ok(meta.repo, `project ${project} should declare a repo URL`);

    assert.ok(
      HTML.includes(meta.name),
      `page should list project name "${meta.name}" from KGlibrary/${project}`
    );
    assert.ok(
      HTML.includes(meta.repo),
      `page should link to repo "${meta.repo}" from KGlibrary/${project}`
    );
    if (meta.description) {
      assert.ok(
        HTML.includes(meta.description),
        `page should show description of "${meta.name}" from KGlibrary/${project}`
      );
    }
  }
});

test('readme-sync: home page mirrors README (architecture + how to use)', () => {
  // GIVEN the README documents the global architecture and how to adopt the framework
  // WHEN a visitor opens the homepage in a browser
  // THEN the page mirrors those sections: an Architecture section with the diagram, and a How to use section
  assert.match(HTML, /id="architecture"/, 'page should have an Architecture section');
  assert.match(
    HTML,
    /docs\/diagrams\/global-architecture\.svg/,
    'Architecture section should embed the global architecture diagram'
  );
  assert.match(HTML, /id="howto"/, 'page should have a How to use section');
  assert.match(HTML, /ArchiMate 3\.2/, 'How to use should mention ArchiMate 3.2');
  assert.match(HTML, /\.argo\//, 'How to use should mention .argo/');
  assert.match(
    HTML,
    /\.github\/|\.opencode\/|\.cursor\//,
    'How to use should mention the agent config directories'
  );
});

test('insight-report-archived: industry insight report archived under docs/', () => {
  // GIVEN the industry insight report on knowledge-graph-driven agents has been produced
  // WHEN a reader opens the docs/ directory
  // THEN the report is archived as Markdown with key sections and cited sources
  const report = readFileSync(
    path.join(ROOT, 'docs', 'industry-insight-graph-driven-agent.md'),
    'utf8'
  );
  assert.match(report, /GraphRAG/, 'report should discuss GraphRAG');
  assert.match(report, /知识图谱/, 'report should discuss knowledge graphs');
  assert.match(report, /80% more truthful/, 'report should cite the NICD study');
  assert.match(report, /参考文献/, 'report should have a references section');
});

test('insight-subpage: home page links to the insight report subpage', () => {
  // GIVEN the industry insight report has been archived
  // WHEN a visitor opens the homepage and clicks the Insights link
  // THEN a standalone subpage renders the full report
  assert.match(
    HTML,
    /docs\/industry-insight-graph-driven-agent\.html/,
    'home page should link to the insight subpage'
  );
  const subpage = readFileSync(
    path.join(ROOT, 'docs', 'industry-insight-graph-driven-agent.html'),
    'utf8'
  );
  assert.match(
    subpage,
    /知识图谱驱动的 Agent 构建/,
    'subpage should show the report title'
  );
  assert.match(subpage, /GraphRAG/, 'subpage should discuss GraphRAG');
  assert.match(subpage, /80% more truthful/, 'subpage should cite the NICD study');
});

test('what-for-section: home page explains the problems ArchGraph solves', () => {
  // GIVEN the project homepage presents its purpose and architecture
  // WHEN a visitor opens the homepage
  // THEN a "What is it for" section follows "What is this" and graphically lists the solved problems
  assert.match(HTML, /id="what-for"/, 'page should have a What is it for section');
  const aboutIdx = HTML.indexOf('id="about"');
  const whatForIdx = HTML.indexOf('id="what-for"');
  assert.ok(
    aboutIdx !== -1 && whatForIdx !== -1 && whatForIdx > aboutIdx,
    'What is it for should appear after What is this'
  );
  assert.match(HTML, /cross-platform orchestration/i, 'should mention cross-platform orchestration');
  assert.match(HTML, /long-term memory/i, 'should mention long-term memory');
  assert.match(HTML, /minimal context/i, 'should mention minimal context assembly');
  assert.match(HTML, /single source of truth/i, 'should mention single source of truth');
  assert.match(HTML, /acceptance-test/i, 'should mention acceptance-test-driven delivery');
  assert.match(HTML, /traceab/i, 'should mention traceability');
});

test('how-section: home page explains how ArchGraph will realize the AML standard', () => {
  // GIVEN the project homepage presents the roadmap after "What is it for"
  // WHEN a visitor opens the homepage
  // THEN a "How we're going to do it" section follows "What is it for" and lists the five AML workstreams
  assert.match(HTML, /id="how"/, 'page should have a How we do it section');
  const whatForIdx = HTML.indexOf('id="what-for"');
  const howIdx = HTML.indexOf('id="how"');
  assert.ok(
    whatForIdx !== -1 && howIdx !== -1 && howIdx > whatForIdx,
    'How section should appear after What is it for'
  );
  assert.match(HTML, /AML/, 'should mention AML');
  assert.match(HTML, /conformance/i, 'should mention the conformance suite');
  assert.match(HTML, /reference implementation/i, 'should mention the reference implementation');
  assert.match(HTML, /upstream/i, 'should mention the upstream consumers');
  assert.match(HTML, /downstream/i, 'should mention the downstream vendors');
  assert.match(
    HTML,
    /docs\/agent-programming-language\.md/,
    'How section should link to the AML language spec'
  );
});
