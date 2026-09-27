'use strict';

// Acceptance tests for the Doubao (desktop agent mode) adaptation of the ARGO
// deployment script (Work Package doubao-harness-adaptation-001). Each testcase
// mirrors the GIVEN-WHEN-THEN acceptance criteria registered in the intent graph:
//   AT-doubao-01 skills -> <workspace>/.user_skills/<name> and ~/Doubao/skills/<name>,
//                          frontmatter normalized to name + description only
//   AT-doubao-02 -SkipDoubao skips the Doubao deployment entirely
//   AT-doubao-03 UTF-8 -> non-ASCII survives the deploy intact (no U+FFFD)
//   AT-doubao-04 idempotent refresh -> a re-deploy updates the skill in place

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'install-argo.ps1');

// The Doubao skill spec (Anthropic Agent Skills) allows ONLY these frontmatter
// fields; the ArchGraph skills carry VS Code / OpenCode-only fields that must be
// stripped at deploy time.
const FORBIDDEN_FRONTMATTER = [
  'argument-hint',
  'disable-model-invocation',
  'license',
  'allowed-tools',
];

function buildInstallArgs(opts) {
  return [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT,
    '-ArgoRoot', opts.argoRoot,
    '-SkillsRoot', opts.skillsRoot,
    '-PromptsRoot', opts.promptsRoot,
    '-McpPath', opts.mcpPath,
    '-CursorSkillsRoot', opts.cursorSkillsRoot,
    '-CursorMcpPath', opts.cursorMcpPath,
    '-CursorRulesRoot', opts.cursorRulesRoot,
    '-OpenCodeSkillsRoot', opts.openCodeSkillsRoot,
    '-OpenCodeAgentsPath', opts.openCodeAgentsPath,
    '-OpenCodeConfigPath', opts.openCodeConfigPath,
    '-CopilotAgentsRoot', opts.copilotAgentsRoot,
    '-CursorAgentsRoot', opts.cursorAgentsRoot,
    '-OpenCodeAgentsRoot', opts.openCodeAgentsRoot,
    '-PluginsRoot', opts.pluginsRoot,
    '-DshHome', opts.dshHome,
    '-OpenClawHome', opts.openClawHome,
    '-OpenClawWorkspace', opts.openClawWorkspace,
    '-DoubaoHome', opts.doubaoHome,
    '-DoubaoWorkspace', opts.doubaoWorkspace,
    '-SkipDsh',
    '-SkipOpenClaw',
    '-SkipDeps',
    '-SkipMcp',
    ...(opts.skipEnv ? ['-SkipEnv'] : []),
    ...(opts.skipDoubao ? ['-SkipDoubao'] : []),
  ];
}

function hostPaths(tmp) {
  return {
    argoRoot: path.join(tmp, '.argo'),
    skillsRoot: path.join(tmp, '.copilot', 'skills'),
    promptsRoot: path.join(tmp, 'Code', 'User', 'prompts'),
    mcpPath: path.join(tmp, 'vscode', 'mcp.json'),
    cursorSkillsRoot: path.join(tmp, '.cursor', 'skills'),
    cursorMcpPath: path.join(tmp, '.cursor', 'mcp.json'),
    cursorRulesRoot: path.join(tmp, '.cursor', 'rules'),
    openCodeSkillsRoot: path.join(tmp, '.config', 'opencode', 'skills'),
    openCodeAgentsPath: path.join(tmp, '.config', 'opencode', 'AGENTS.md'),
    openCodeConfigPath: path.join(tmp, '.config', 'opencode', 'opencode.json'),
    copilotAgentsRoot: path.join(tmp, '.copilot', 'agents'),
    cursorAgentsRoot: path.join(tmp, '.cursor', 'agents'),
    openCodeAgentsRoot: path.join(tmp, '.config', 'opencode', 'agents'),
    pluginsRoot: path.join(tmp, '.argo', 'plugins'),
    dshHome: path.join(tmp, '.dsh'),
    openClawHome: path.join(tmp, '.openclaw'),
    openClawWorkspace: path.join(tmp, '.openclaw', 'workspace'),
    doubaoHome: path.join(tmp, 'Doubao'),
    doubaoWorkspace: path.join(tmp, 'Doubao', 'agent_mode', 'workspace'),
  };
}

function runInstall(opts) {
  return spawnSync('powershell.exe', buildInstallArgs(opts), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeout,
  });
}

function readFrontmatter(file) {
  const content = fs.readFileSync(file, 'utf8');
  const m = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  assert.ok(m, `SKILL.md must start with YAML frontmatter: ${file}`);
  return { frontmatter: m[1], body: content.slice(m[0].length), content };
}

test('install-argo.ps1 deploys the ArchGraph skills into both Doubao skill roots', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-doubao-'));
  const paths = hostPaths(tmp);
  try {
    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const workspaceSkills = path.join(paths.doubaoWorkspace, '.user_skills');
    const globalSkills = path.join(paths.doubaoHome, 'skills');
    const skills = ['argo-init', 'ea-human-reconcile', 'agent-search-diagnosis'];

    // AT-doubao-01: every skill is deployed to BOTH the workspace .user_skills
    // root and the global ~/Doubao/skills root.
    for (const skill of skills) {
      const ws = path.join(workspaceSkills, skill, 'SKILL.md');
      const gl = path.join(globalSkills, skill, 'SKILL.md');
      assert.ok(fs.existsSync(ws), `workspace .user_skills/${skill}/SKILL.md must be deployed`);
      assert.ok(fs.existsSync(gl), `global skills/${skill}/SKILL.md must be deployed`);
    }

    // AT-doubao-01: the frontmatter is normalized to name + description only;
    // the ArchGraph-only fields (argument-hint, disable-model-invocation) are
    // stripped because Doubao rejects any other field.
    for (const skill of skills) {
      const { frontmatter, body } = readFrontmatter(path.join(workspaceSkills, skill, 'SKILL.md'));
      assert.match(frontmatter, new RegExp(`^name:\\s*${skill}\\s*$`, 'm'),
        `frontmatter must keep name: ${skill}`);
      assert.match(frontmatter, /^description:\s*\S/m, 'frontmatter must keep a description');
      for (const field of FORBIDDEN_FRONTMATTER) {
        assert.doesNotMatch(frontmatter, new RegExp(`^${field}:`, 'm'),
          `Doubao SKILL.md must not carry the "${field}" field`);
      }
      // The body survives verbatim (the argo-init body starts with "# ARGO INIT").
      assert.ok(body.trim().length > 0, 'the skill body must survive the deploy');
    }
    assert.match(readFrontmatter(path.join(workspaceSkills, 'argo-init', 'SKILL.md')).body,
      /ARGO INIT/, 'the argo-init body must be kept verbatim');

    // AT-doubao-03: non-ASCII survives; no replacement characters.
    const argoInit = fs.readFileSync(path.join(workspaceSkills, 'argo-init', 'SKILL.md'), 'utf8');
    assert.match(argoInit, /[\u4e00-\u9fff]/, 'CJK characters must survive the deploy');
    assert.doesNotMatch(argoInit, /\uFFFD/, 'no U+FFFD replacement characters may appear');

    // AT-doubao-05: Doubao registers MCP servers through its in-app custom
    // connector UI (STDIO), not a config file, so the installer emits a
    // copy-paste recipe: argo (stdio node argo-mcp-server.js, pinned to the
    // repository root via ARGO_REPO_ROOT) and the graph-mcp stdio bridge.
    const recipePath = path.join(paths.argoRoot, 'doubao-mcp.json');
    assert.ok(fs.existsSync(recipePath), 'the Doubao MCP connector recipe must be written');
    const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
    assert.ok(Array.isArray(recipe.connectors) && recipe.connectors.length >= 1,
      'the recipe must list the connectors to register');
    const argo = recipe.connectors.find((c) => c.serverName === 'argo');
    assert.ok(argo, 'the recipe must include the argo connector');
    assert.equal(argo.transport, 'STDIO');
    assert.equal(argo.command, 'node');
    assert.ok(argo.args[0].endsWith('argo-mcp-server.js'));
    assert.equal(argo.env.ARGO_REPO_ROOT, ROOT,
      'the argo connector must pin ARGO_REPO_ROOT to the repository root');
    const graphMcp = recipe.connectors.find((c) => c.serverName === 'graph-mcp');
    assert.ok(graphMcp, 'the recipe must include the graph-mcp connector');
    assert.equal(graphMcp.env.GRAPH_MCP_URL, 'https://argo.derekworkspacev5.com/mcp');
    assert.ok(graphMcp.args[0].endsWith('graph-mcp-stdio.js'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 -SkipDoubao skips the Doubao deployment entirely', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-doubao-skip-'));
  const paths = hostPaths(tmp);
  try {
    // AT-doubao-02: with -SkipDoubao nothing is written to either skill root.
    const result = runInstall({ ...paths, skipEnv: true, skipDoubao: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    assert.ok(!fs.existsSync(path.join(paths.doubaoWorkspace, '.user_skills', 'argo-init', 'SKILL.md')),
      'workspace skill must not be deployed when skipped');
    assert.ok(!fs.existsSync(path.join(paths.doubaoHome, 'skills', 'argo-init', 'SKILL.md')),
      'global skill must not be deployed when skipped');
    assert.ok(!fs.existsSync(path.join(paths.argoRoot, 'doubao-mcp.json')),
      'the Doubao MCP connector recipe must not be written when skipped');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 refreshes an existing Doubao skill in place (idempotent)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-doubao-update-'));
  const paths = hostPaths(tmp);
  try {
    // AT-doubao-04: seed a stale deployment (with a forbidden extra field and a
    // stale body), then re-deploy and assert it is refreshed in place.
    const seed = path.join(paths.doubaoWorkspace, '.user_skills', 'argo-init');
    fs.mkdirSync(seed, { recursive: true });
    fs.writeFileSync(path.join(seed, 'SKILL.md'), [
      '---',
      'name: argo-init',
      'description: "stale"',
      'argument-hint: stale',
      '---',
      '',
      'stale body content',
      '',
    ].join('\n'), 'utf8');

    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const { frontmatter, body } = readFrontmatter(path.join(seed, 'SKILL.md'));
    assert.doesNotMatch(frontmatter, /^argument-hint:/m, 'the stale extra field must be removed');
    assert.doesNotMatch(frontmatter, /stale/, 'the stale description must be refreshed');
    assert.doesNotMatch(body, /stale body content/, 'the stale body must be replaced');
    assert.match(body, /ARGO INIT/, 'the current body must be written');
    // No duplicate skill folders created by the refresh.
    assert.deepEqual(
      fs.readdirSync(path.join(paths.doubaoWorkspace, '.user_skills')).sort(),
      ['agent-search-diagnosis', 'argo-init', 'ea-human-reconcile'],
      'the skill root must contain exactly the three ArchGraph skills',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
