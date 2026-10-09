'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function slice(fromId, toId) {
  const a = HTML.indexOf('id="' + fromId + '"');
  const b = HTML.indexOf('id="' + toId + '"');
  return a >= 0 && b > a ? HTML.slice(a, b) : '';
}

test('layout-style: tech-simple dark layout with nav, hero and sections', () => {
  // GIVEN the project website is published
  // WHEN a visitor opens the homepage in a browser
  // THEN the page renders a dark tech-simple layout: nav bar, hero, title and sectioned content
  assert.match(HTML, /<nav\b/, 'page should have a top navigation bar');
  assert.match(HTML, /class="hero"/, 'page should have a hero section');
  assert.match(HTML, /<h1[\s\S]*?ArchGraph/, 'hero should show the project name');
  const sections = HTML.match(/<section\b/g) || [];
  assert.ok(sections.length >= 4, 'page should have at least 4 content sections');
  assert.match(HTML, /data-theme="dark"/, 'page should declare a dark tech theme');
});

test('hero-positioning: homepage headlines the knowledge-graph framework and own-ontology value', () => {
  // GIVEN the homepage is the primary landing page
  // WHEN a visitor reads the hero
  // THEN it names the knowledge-graph framework, the ontology-you-define differentiator, and MCP
  assert.match(HTML, /knowledge-graph framework/i, 'hero should name the knowledge-graph framework');
  assert.match(HTML, /ontology you define/i, 'hero should headline the customizable ontology');
  assert.match(HTML, /MCP/, 'hero should name the MCP interface');
});

test('about-image: homepage embeds the core-model diagram under What is this?', () => {
  // GIVEN the project positions itself as one model for the agent memory and the product design
  // WHEN a visitor opens the homepage
  // THEN the What is this? section embeds the core-model diagram
  assert.match(HTML, /docs\/diagrams\/core-model\.svg/, 'homepage should embed the core-model diagram');
  assert.ok(
    HTML.indexOf('docs/diagrams/core-model.svg') > HTML.indexOf('id="about"') &&
    HTML.indexOf('docs/diagrams/core-model.svg') < HTML.indexOf('id="install"'),
    'diagram should appear inside the What is this? section'
  );
});

test('install-section: homepage shows npm install/deploy and the semantic prerequisite', () => {
  // GIVEN the ARGO toolchain is published as an npm package
  // WHEN a visitor opens the homepage
  // THEN the Install section appears after About and before How to use, showing the commands and the Neo4j + embedding note
  assert.match(HTML, /id="install"/, 'page should have an Install section');
  assert.ok(
    HTML.indexOf('id="install"') > HTML.indexOf('id="about"') &&
    HTML.indexOf('id="install"') < HTML.indexOf('id="howto"'),
    'Install section should appear after About and before How to use'
  );
  const section = slice('install', 'howto');
  assert.match(section, /npm install -g archgraph-argo/, 'should show the npm install command');
  assert.match(section, /argo-deploy/, 'should show the deploy command');
  assert.match(section, /Neo4j/, 'should mention Neo4j');
  assert.match(section, /embedding/i, 'should mention the embedding endpoint');
  assert.match(section, /OpenClaw/, 'should mention OpenClaw');
});

test('why-teaser: homepage teases the ONE canonical comparison instead of duplicating it', () => {
  // GIVEN docs/capabilities.html#compare is the single canonical comparison
  // WHEN a visitor opens the homepage
  // THEN #why is a short teaser linking that page and does NOT re-inline the full table
  assert.match(HTML, /id="why"/, 'homepage should keep a Why section as an anchor');
  const section = slice('why', 'ontology');
  assert.ok(section, 'homepage should keep a Why section');
  assert.match(section, /docs\/capabilities\.html#compare/, 'Why must link the canonical comparison');
  assert.doesNotMatch(section, /<table/, 'Why must not duplicate the full comparison table');
  assert.doesNotMatch(section, /Where it falls short/, 'Why must not re-inline the comparison rows');
  assert.doesNotMatch(section, /locked single-ontology/i, 'Why must not use the locked-ontology straw man');
});

test('install-init-honesty: homepage scopes Node.js-only use, discloses the failed init steps, and adds the restart', () => {
  // GIVEN argo init reports failed structural sync + semantic lifecycle without Neo4j + embedding
  // WHEN a visitor reads Install and How to use
  // THEN Node.js-only scope is stated, the failed steps are disclosed, and the host restart is present
  const install = slice('install', 'howto');
  assert.match(install, /Node\.js is all you need/i, 'Install must scope what Node.js alone covers');
  assert.match(install, /report failed/i, 'Install must disclose the failed init steps without Neo4j');
  assert.match(install, /restart your editor \/ host/i, 'Install must include the host-restart step');
  const howto = slice('howto', 'community');
  assert.match(howto, /report failed until Neo4j/i, 'How to use must qualify the argo init sync/lifecycle steps');
});

test('capabilities-teaser: homepage outlines capabilities and links the detail page', () => {
  // GIVEN capabilities detail has moved to a dedicated page
  // WHEN a visitor opens the homepage
  // THEN a Capabilities section (after About, before Install) names the key capabilities and links the detail page
  assert.match(HTML, /id="capabilities"/, 'page should have a Capabilities section');
  assert.ok(
    HTML.indexOf('id="capabilities"') > HTML.indexOf('id="about"') &&
    HTML.indexOf('id="capabilities"') < HTML.indexOf('id="install"'),
    'Capabilities should appear after About and before Install'
  );
  const section = slice('capabilities', 'install');
  assert.match(section, /long-term memory/i, 'should frame the graph as an agent long-term memory');
  assert.match(section, /deduplicat/i, 'should state write deduplication');
  assert.match(section, /semantic/i, 'should mention semantic retrieval');
  assert.match(section, /Enterprise Architect|\.qea/, 'should mention Enterprise Architect interop');
  assert.match(section, /docs\/capabilities\.html/, 'should link the capabilities detail page');
  for (const host of ['Copilot', 'Cursor', 'OpenCode', 'DeepSeek', 'OpenClaw', 'Codex']) {
    assert.match(section, new RegExp(host), `should mention ${host}`);
  }
});

test('ontology-section: homepage headlines pluggable ontology without the placeholder name', () => {
  // GIVEN the ontology is the headline differentiator
  // WHEN a visitor opens the homepage
  // THEN an Ontology section names schema bundles + extends and links the worked case
  assert.match(HTML, /id="ontology"/, 'page should have an Ontology section');
  const section = slice('ontology', 'capabilities');
  assert.match(section, /schema bundle/i, 'should name the schema bundle');
  assert.match(section, /\.argo\/schema/, 'should point at .argo/schema/');
  assert.match(section, /extends/, 'should mention the extends mechanism');
  assert.match(section, /docs\/case-team-graph\.html/, 'should link the worked case page');
  assert.doesNotMatch(HTML, /Acme/, 'homepage should not surface the internal placeholder bundle name');
});

test('capability-diagrams: homepage spotlights the capability illustrations', () => {
  // GIVEN federation, three-tier memory and lean reads have dedicated dark illustrations
  // WHEN a visitor opens the homepage
  // THEN the Capabilities section embeds all three SVGs
  for (const file of ['cap-federation.svg', 'cap-memory-tiers.svg', 'cap-lean-reads.svg']) {
    assert.match(HTML, new RegExp('docs/diagrams/' + file.replace('.', '\\.')), `homepage should embed ${file}`);
  }
});

test('readme-sync: home page mirrors README how-to-use', () => {
  // GIVEN the README documents how to use the framework
  // WHEN a visitor opens the homepage in a browser
  // THEN the page mirrors the How to use section
  assert.match(HTML, /id="howto"/, 'page should have a How to use section');
  assert.match(HTML, /argo init/, 'How to use should mention the argo init workspace bootstrap');
  assert.match(HTML, /ArchiMate 3\.2/, 'How to use should mention ArchiMate 3.2');
  assert.match(HTML, /coding agent/i, 'How to use should describe the coding-agent workflow');
  assert.match(HTML, /single source of truth/i, 'How to use should state the graph is the single source of truth');
});

test('community-linkage: homepage links the community site and graph-wiki asset repo', () => {
  // GIVEN a dedicated ArchGraph community hub and graph-wiki asset repository exist
  // WHEN a visitor opens the homepage
  // THEN the nav and a Community section link to the community site and the graph-wiki repo
  assert.match(HTML, /#community/, 'nav should link to the Community section');
  assert.match(HTML, /argo\.derekworkspacev5\.com\/archgraph\//, 'homepage should link the ArchGraph community site');
  assert.match(HTML, /github\.com\/derekhu0002\/graph-wiki/, 'homepage should link the graph-wiki asset repository');
  assert.ok(
    HTML.indexOf('id="community"') > HTML.indexOf('id="howto"') &&
    HTML.indexOf('id="community"') < HTML.indexOf('id="links"'),
    'Community section should appear after How to use and before Links'
  );
});

test('outline-links: homepage links every detail page', () => {
  // GIVEN the homepage is an outline that points at detail pages
  // WHEN a visitor looks for more detail
  // THEN it links the getting-started, capabilities and worked-case pages, which exist
  for (const rel of ['docs/getting-started.html', 'docs/capabilities.html', 'docs/case-team-graph.html']) {
    assert.match(HTML, new RegExp(rel.replace(/\./g, '\\.')), `homepage should link ${rel}`);
    assert.ok(existsSync(path.join(ROOT, rel)), `${rel} must exist`);
  }
});

test('reference-library-removed: homepage no longer exposes a KGlibrary reference library', () => {
  // GIVEN the reference library role moved to the community hub / graph-wiki
  // WHEN a visitor opens the homepage
  // THEN no Reference Library / KGlibrary entry remains
  assert.doesNotMatch(HTML, /kglibrary/i, 'homepage should not reference KGlibrary');
  assert.doesNotMatch(HTML, /Reference Library/i, 'homepage should not have a Reference Library link');
});

test('insight-subpage: home page links to the insights list page', () => {
  // GIVEN the industry insight report has been archived
  // WHEN a visitor opens the homepage and clicks the Insights link
  // THEN a standalone insights list page opens and links to each insight article
  assert.match(HTML, /docs\/insights\.html/, 'home page should link to the insights list page');
  const insightsPage = readFileSync(path.join(ROOT, 'docs', 'insights.html'), 'utf8');
  assert.match(insightsPage, /id="insights"/, 'insights page should have an Insights area');
  assert.match(insightsPage, /industry-insight-graph-driven-agent\.html/, 'insights page should link to the insight article');
});

test('insight-report-archived: industry insight report archived under docs/', () => {
  // GIVEN the industry insight report on knowledge-graph-driven agents has been produced
  // WHEN a reader opens the docs/ directory
  // THEN the report is archived as Markdown with key sections and cited sources
  const report = readFileSync(path.join(ROOT, 'docs', 'industry-insight-graph-driven-agent.md'), 'utf8');
  assert.match(report, /GraphRAG/, 'report should discuss GraphRAG');
  assert.match(report, /知识图谱/, 'report should discuss knowledge graphs');
  assert.match(report, /80% more truthful/, 'report should cite the NICD study');
  assert.match(report, /参考文献/, 'report should have a references section');
});

test('english-quickstart: homepage has a two-route build recipe with Node>=18 and agent-phrased steps', () => {
  // GIVEN a non-Chinese newcomer can only start from the English homepage
  // WHEN they read the build recipe
  // THEN it offers the default-ontology and own-ontology routes, names Node, and
  //      phrases each step as an instruction to the coding agent
  assert.match(HTML, /id="quickstart"/, 'homepage should have a quickstart section');
  const section = slice('quickstart', 'howto');
  assert.ok(section, 'quickstart section should sit before How to use');
  assert.match(section, /npm install -g archgraph-argo/, 'step 1 should show the install');
  assert.match(section, /argo init/, 'Route A should use argo init');
  assert.match(section, /Node\.js\s*(?:≥|>=)\s*18/, 'Node.js >= 18 must be stated');
  assert.match(section, /Route A[^\n]*default ontology/i, 'must label Route A as the default-ontology route');
  assert.match(section, /Route B[^\n]*your own ontology/i, 'must label Route B as the own-ontology route');
  assert.match(section, /schema-bundle\.config\.json|SystemArchitecture\.schema\.json/, 'Route B should show the ontology change');
  assert.match(section, /NO_DEFAULT_GRAPH/, 'Route B must state fail-closed graph authoring');
  assert.match(section, /applySystemArchitectureMutation/, 'should build through the MCP mutation');
  assert.match(section, /validateSystemArchitecture/, 'should verify');
  assert.match(section, /docs\/case-team-graph\.html/, 'should link the illustrated walkthrough');
  assert.match(section, /Ask your coding agent to (?:call|run)/i, 'steps must be instructions to the agent');
  assert.doesNotMatch(section, /"view_id"\s*:\s*"view-root"/, 'must not pre-create a view colliding with the default root view');
});

test('no-shell-prompt-init: argo init is shown as an agent instruction, not a shell $ command', () => {
  // GIVEN argo init maps to the initializeWorkspace MCP call, not a shell binary
  // WHEN a newcomer reads the homepage terminal
  // THEN it is not presented with a shell prompt (checked on tag-stripped text, so inline
  //      markup such as <span>$ </span> cannot hide a prompt), and says so explicitly
  const text = HTML.replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(text, /\$\s*argo init/, 'argo init must not carry a shell prompt');
  assert.match(text, /not a shell command/i, 'the init panel should say argo init is not a shell command');
});

test('english-quickstart: Route B makes the config mandatory for a standalone schema (fail-closed)', () => {
  // GIVEN a custom schema authored exactly as the homepage instructs must not fail closed unexpectedly
  // WHEN a visitor reads Route B
  // THEN it states the config is MANDATORY (declare actorElementType) and the consequence of omitting it
  const section = slice('quickstart', 'howto');
  assert.match(section, /standalone/i, 'Route B must distinguish a standalone bundle');
  assert.match(section, /actorElementType/, 'Route B must name the actor contract');
  assert.match(section, /schema-bundle\.config\.json/, 'Route B must require the config for a standalone bundle');
  assert.match(section, /fails closed|failed/i, 'Route B must state the fail-closed consequence');
  assert.doesNotMatch(section, /optional\s+<code[^>]*>schema-bundle\.config\.json/, 'must not call the config optional for a standalone schema');
});
