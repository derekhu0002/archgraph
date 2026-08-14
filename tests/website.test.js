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
    /<h1[\s\S]*?open_knowledge_graph_engineering/,
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
