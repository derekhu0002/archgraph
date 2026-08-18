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

test('install-section: homepage shows npm install/deploy at the top', () => {
  // GIVEN the ARGO toolchain is published as an npm package
  // WHEN a visitor opens the homepage
  // THEN an Install section appears at the top (before About), showing the install/deploy commands and a one-line Neo4j + vector engine note
  assert.match(HTML, /id="install"/, 'page should have an Install section');
  assert.ok(
    HTML.indexOf('id="install"') < HTML.indexOf('id="about"'),
    'Install section should appear before the About section'
  );
  assert.match(HTML, /npm install -g archgraph-argo/, 'should show the npm install command');
  assert.match(HTML, /argo-deploy/, 'should show the deploy command');
  assert.match(HTML, /Neo4j/, 'should mention Neo4j');
  assert.match(HTML, /vector engine/, 'should mention the vector engine');
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
  assert.ok(
    HTML.indexOf('id="howto"') < HTML.indexOf('id="about"'),
    'How to use should appear before About (right after Install)'
  );
  assert.match(HTML, /ArchiMate 3\.2/, 'How to use should mention ArchiMate 3.2');
  assert.match(HTML, /coding agent/, 'How to use should describe the coding-agent workflow');
  assert.match(HTML, /single source of truth/, 'How to use should state the graph is the single source of truth');
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
  // THEN a standalone insights list page opens and links to each insight article
  assert.match(HTML, /docs\/insights\.html/, 'home page should link to the insights list page');
  const insightsPage = readFileSync(path.join(ROOT, 'docs', 'insights.html'), 'utf8');
  assert.match(insightsPage, /id="insights"/, 'insights page should have an Insights area');
  assert.match(
    insightsPage,
    /industry-insight-graph-driven-agent\.html/,
    'insights page should link to the insight article'
  );
  const subpage = readFileSync(
    path.join(ROOT, 'docs', 'industry-insight-graph-driven-agent.html'),
    'utf8'
  );
  assert.match(subpage, /知识图谱驱动的 Agent 构建/, 'subpage should show the report title');
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
