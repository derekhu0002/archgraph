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

test('install-section: homepage shows npm install/deploy near the top', () => {
  // GIVEN the ARGO toolchain is published as an npm package
  // WHEN a visitor opens the homepage
  // THEN an Install section appears right after About, showing the install/deploy commands and a one-line Neo4j + vector engine note
  assert.match(HTML, /id="install"/, 'page should have an Install section');
  assert.ok(
    HTML.indexOf('id="install"') > HTML.indexOf('id="about"') &&
    HTML.indexOf('id="install"') < HTML.indexOf('id="howto"'),
    'Install section should appear right after About'
  );
  assert.match(HTML, /npm install -g archgraph-argo/, 'should show the npm install command');
  assert.match(HTML, /argo-deploy/, 'should show the deploy command');
  assert.match(HTML, /Neo4j/, 'should mention Neo4j');
  assert.match(HTML, /vector engine/, 'should mention the vector engine');
});

test('about-image: homepage embeds the core-model image under What is this?', () => {
  // GIVEN the project positions itself as a unified language for harness and product design
  // WHEN a visitor opens the homepage
  // THEN the What is this? section embeds the core-model image
  assert.match(HTML, /docs\/diagrams\/image-1\.png/, 'homepage should embed the core-model image');
  assert.ok(
    HTML.indexOf('docs/diagrams/image-1.png') > HTML.indexOf('id="about"') &&
    HTML.indexOf('docs/diagrams/image-1.png') < HTML.indexOf('id="install"'),
    'image should appear inside the What is this? section'
  );
});

test('kglibrary-area: lists every KGlibrary reference project', () => {
  // GIVEN the KGlibrary directory contains reference projects
  // WHEN a visitor opens the Reference Library page
  // THEN the page has a KGlibrary area listing each project name, description and repo link
  assert.match(HTML, /docs\/kglibrary\.html/, 'homepage should link to the Reference Library page');
  const kglPage = readFileSync(path.join(ROOT, 'docs', 'kglibrary.html'), 'utf8');
  assert.match(kglPage, /id="kglibrary"/, 'page should have a KGlibrary reference area');

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
      kglPage.includes(meta.name),
      `page should list project name "${meta.name}" from KGlibrary/${project}`
    );
    assert.ok(
      kglPage.includes(meta.repo),
      `page should link to repo "${meta.repo}" from KGlibrary/${project}`
    );
    if (meta.description) {
      assert.ok(
        kglPage.includes(meta.description),
        `page should show description of "${meta.name}" from KGlibrary/${project}`
      );
    }
  }
});

test('readme-sync: home page mirrors README how-to-use', () => {
  // GIVEN the README documents how to use the framework
  // WHEN a visitor opens the homepage in a browser
  // THEN the page mirrors the How to use section
  assert.match(HTML, /id="howto"/, 'page should have a How to use section');
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
