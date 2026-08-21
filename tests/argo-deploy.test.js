'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'install-argo.ps1');

const ENV_KEYS = [
  'ARGO_EMBEDDING_BASE_URL',
  'ARGO_EMBEDDING_MODEL',
  'ARGO_EMBEDDING_PROVIDER',
  'ARGO_EMBEDDING_MODEL_VERSION',
  'ARGO_EMBEDDING_DIMENSIONS',
  'ARGO_NEO4J_DATABASE_URL',
  'ARGO_NEO4J_DATABASE_USERNAME',
  'ARGO_NEO4J_DATABASE_PASSWORD',
  'QWEN_KEY',
  'ARGO_LIVE_PROVIDER_E2E',
  'ARGO_W31_LIVE_MUTATION_VECTOR_E2E',
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
    '-SkipDeps',
    ...(opts.skipEnv ? ['-SkipEnv'] : []),
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
    openCodeSkillsRoot: path.join(tmp, '.config', 'opencode', 'skills'),
    openCodeAgentsPath: path.join(tmp, '.config', 'opencode', 'AGENTS.md'),
    openCodeConfigPath: path.join(tmp, '.config', 'opencode', 'opencode.json'),
    copilotAgentsRoot: path.join(tmp, '.copilot', 'agents'),
    cursorAgentsRoot: path.join(tmp, '.cursor', 'agents'),
    cursorRulesRoot: path.join(tmp, '.cursor', 'rules'),
    openCodeAgentsRoot: path.join(tmp, '.config', 'opencode', 'agents'),
    pluginsRoot: path.join(tmp, '.argo', 'plugins'),
    dshHome: path.join(tmp, '.dsh'),
  };
}

function runInstall(opts) {
  const spawnOpts = { cwd: ROOT, encoding: 'utf8' };
  if (opts.timeout) {
    spawnOpts.timeout = opts.timeout;
  }
  return spawnSync('powershell.exe', buildInstallArgs(opts), spawnOpts);
}

test('install-argo.ps1 deploys toolchain, skill, and rules without secrets or temp', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-test-'));
  const paths = hostPaths(tmp);
  const {
    argoRoot, skillsRoot, promptsRoot, mcpPath,
    cursorSkillsRoot, cursorMcpPath,
    openCodeSkillsRoot, openCodeAgentsPath, openCodeConfigPath,
    copilotAgentsRoot, cursorAgentsRoot, openCodeAgentsRoot,
    pluginsRoot, cursorRulesRoot,
  } = paths;
  try {
    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    // 1) schema
    assert.ok(fs.existsSync(path.join(argoRoot, 'schema', 'SystemArchitecture.schema.json')));
    // 2) scripts
    assert.ok(fs.existsSync(path.join(argoRoot, 'scripts', 'argo-mcp-server.js')));
    // 2b) defaults (workspace bootstrap templates)
    assert.ok(fs.existsSync(path.join(argoRoot, 'defaults', 'design', 'KG', 'SystemArchitecture.json')));
    assert.ok(fs.existsSync(path.join(argoRoot, 'defaults', 'EA-model-template.feap')));
    // 3) argo-init skill
    assert.ok(fs.existsSync(path.join(skillsRoot, 'argo-init', 'SKILL.md')));
    // 4) global rule
    assert.ok(fs.existsSync(path.join(promptsRoot, 'archgraph.instructions.md')));

    // 5) dependency manifest is deployed so `npm install` can resolve neo4j-driver.
    const manifestPath = path.join(argoRoot, 'package.json');
    assert.ok(fs.existsSync(manifestPath), 'dependency manifest must be deployed');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.dependencies && manifest.dependencies['neo4j-driver']);

    // 5b) npm package manifest ships the defaults directory.
    const npmManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(Array.isArray(npmManifest.files) && npmManifest.files.includes('argo/defaults'));
    assert.ok(npmManifest.files.includes('argo/agents'), 'npm package must ship the agents directory');

    // temp stays in the repository, and no .env is written in non-interactive mode.
    assert.ok(!fs.existsSync(path.join(argoRoot, 'temp')), 'temp must not be deployed');
    assert.ok(!fs.existsSync(path.join(argoRoot, '.env')), '.env must only be generated interactively');

    // 6) VS Code (Copilot) MCP config registers the deployed argo server.
    assert.ok(fs.existsSync(mcpPath), 'VS Code MCP config must be written');
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(mcp.servers && mcp.servers.argo);
    assert.equal(mcp.servers.argo.type, 'stdio');
    assert.equal(mcp.servers.argo.command, 'node');
    assert.ok(mcp.servers.argo.args[0].endsWith('argo-mcp-server.js'));
    assert.ok(!mcp.servers.argo.cwd, 'cwd must be omitted; workspace is discovered dynamically via MCP roots');
    assert.ok(!mcp.servers.argo.env, 'env must be omitted; workspace is discovered dynamically via MCP roots');

    // 7) Cursor skill + MCP config.
    assert.ok(fs.existsSync(path.join(cursorSkillsRoot, 'argo-init', 'SKILL.md')), 'Cursor skill must be deployed');
    assert.ok(fs.existsSync(cursorMcpPath), 'Cursor MCP config must be written');
    const cursorMcp = JSON.parse(fs.readFileSync(cursorMcpPath, 'utf8'));
    assert.ok(cursorMcp.mcpServers && cursorMcp.mcpServers.argo);
    assert.equal(cursorMcp.mcpServers.argo.type, 'stdio');
    assert.equal(cursorMcp.mcpServers.argo.command, 'node');
    assert.ok(cursorMcp.mcpServers.argo.args[0].endsWith('argo-mcp-server.js'));
    assert.ok(!cursorMcp.mcpServers.argo.cwd, 'Cursor cwd must be omitted; roots resolve the workspace');
    assert.ok(!cursorMcp.mcpServers.argo.env, 'Cursor env must be omitted; roots resolve the workspace');

    // 7b) Cursor global rule: the full archgraph.instructions.md is converted to
    // a .mdc rule with alwaysApply so it is injected into every request.
    assert.ok(fs.existsSync(path.join(cursorRulesRoot, 'archgraph.mdc')), 'Cursor global rule must be deployed');
    const cursorRule = fs.readFileSync(path.join(cursorRulesRoot, 'archgraph.mdc'), 'utf8');
    assert.match(cursorRule, /alwaysApply: true/, 'Cursor rule must always apply');
    assert.match(cursorRule, /UNCONDITIONAL STARTUP GATE/, 'Cursor rule must carry the wakeup gate');

    // 8) OpenCode skill + global rule.
    assert.ok(fs.existsSync(path.join(openCodeSkillsRoot, 'argo-init', 'SKILL.md')), 'OpenCode skill must be deployed');
    assert.ok(fs.existsSync(openCodeAgentsPath), 'OpenCode global AGENTS.md must be written');
    assert.match(fs.readFileSync(openCodeAgentsPath, 'utf8'), /ArchGraph ARGO Workflow Rules/);

    // 9) OpenCode MCP config registers a local argo server without a hardcoded cwd.
    assert.ok(fs.existsSync(openCodeConfigPath), 'OpenCode MCP config must be written');
    const openCode = JSON.parse(fs.readFileSync(openCodeConfigPath, 'utf8'));
    assert.ok(openCode.mcp && openCode.mcp.argo);
    assert.equal(openCode.mcp.argo.type, 'local');
    assert.equal(openCode.mcp.argo.command[0], 'node');
    assert.ok(openCode.mcp.argo.command[1].endsWith('argo-mcp-server.js'));
    assert.equal(openCode.mcp.argo.enabled, true);
    assert.ok(!openCode.mcp.argo.cwd, 'OpenCode cwd must be omitted; default is the project directory');

    // 9b) argo plugins deploy to ~/.argo/plugins and the wakeup plugin is
    // registered in the OpenCode config plugin array.
    assert.ok(fs.existsSync(path.join(pluginsRoot, 'argo-wakeup.js')), 'argo-wakeup plugin must be deployed');
    assert.ok(Array.isArray(openCode.plugin), 'OpenCode config must declare a plugin array');
    assert.ok(
      openCode.plugin.some(entry => entry.endsWith('argo-wakeup.js')),
      'OpenCode config must register the argo-wakeup plugin',
    );

    // 10) custom agents deploy to user-level agent dirs for Copilot, Cursor, and OpenCode.
    assert.ok(
      fs.existsSync(path.join(copilotAgentsRoot, 'wechat-publisher.agent.md')),
      'Copilot user-level agent must be deployed',
    );
    assert.ok(
      fs.existsSync(path.join(cursorAgentsRoot, 'wechat-publisher.md')),
      'Cursor user-level agent must be deployed as .md',
    );
    assert.ok(
      fs.existsSync(path.join(openCodeAgentsRoot, 'wechat-publisher.md')),
      'OpenCode user-level agent must be deployed as .md',
    );

    const openCodeAgent = fs.readFileSync(path.join(openCodeAgentsRoot, 'wechat-publisher.md'), 'utf8');
    assert.match(openCodeAgent, /description:/, 'OpenCode agent must keep a description');
    assert.match(openCodeAgent, /model: "alibaba-cn\/qwen3\.7-plus"/, 'OpenCode agent must keep its pinned model');
    assert.match(openCodeAgent, /mode: all/, 'OpenCode agent must declare mode: all');
    assert.doesNotMatch(openCodeAgent, /^tools:\s*\[/m, 'OpenCode agent must not carry a tools array');

    const cursorAgent = fs.readFileSync(path.join(cursorAgentsRoot, 'wechat-publisher.md'), 'utf8');
    assert.match(cursorAgent, /name:/, 'Cursor agent must keep a name');
    assert.match(cursorAgent, /description:/, 'Cursor agent must keep a description');
    assert.match(cursorAgent, /model: "alibaba-cn\/qwen3\.7-plus"/, 'Cursor agent must keep its pinned model');
    assert.doesNotMatch(cursorAgent, /^tools:\s*\[/m, 'Cursor agent must not carry a tools array');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 deploys OpenCode AGENTS.md with intact UTF-8 non-ASCII content', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-utf8-'));
  const paths = hostPaths(tmp);
  try {
    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const agents = fs.readFileSync(paths.openCodeAgentsPath, 'utf8');
    // The rule body is English but contains non-ASCII UTF-8 (em dashes). They
    // must survive the deploy round-trip intact, not mojibake produced by
    // decoding UTF-8 bytes with the system ANSI code page (e.g. GBK on zh-CN).
    assert.match(agents, /—/, 'em dash (U+2014) must survive the deploy intact');
    assert.match(agents, /GIVEN-WHEN-THEN/);
    // U+FFFD replacement chars (corrupted multibyte sequences) must be absent.
    assert.doesNotMatch(agents, /\uFFFD/, 'no replacement characters may appear');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 updates an outdated OpenCode AGENTS.md block and preserves other content', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-update-'));
  const paths = hostPaths(tmp);
  try {
    fs.mkdirSync(path.dirname(paths.openCodeAgentsPath), { recursive: true });

    // Seed an outdated ArchGraph rules block (with the marker) plus unrelated
    // user content appended below it.
    fs.writeFileSync(paths.openCodeAgentsPath, [
      '---',
      'description: "outdated"',
      'name: "ArchGraph ARGO Workflow Rules"',
      'applyTo: "**"',
      '---',
      '<Ontology>',
      'stale relative path argo\\schema\\SystemArchitecture.schema.json',
      '</Ontology>',
      '</ToolsGuideline>',
      '',
      '# My OpenCode notes',
      'keep this line',
      '',
    ].join('\n'), 'utf8');

    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const agents = fs.readFileSync(paths.openCodeAgentsPath, 'utf8');
    // The outdated block must be replaced by the current rule content.
    assert.ok(
      agents.includes('~/.argo/schema/SystemArchitecture.schema.json'),
      'AGENTS.md must be updated to the current ~/.argo rule paths',
    );
    // Unrelated user content must be preserved.
    assert.match(agents, /# My OpenCode notes/);
    assert.match(agents, /keep this line/);
    // The rules block must appear exactly once (no duplication).
    assert.equal(
      (agents.match(/ArchGraph ARGO Workflow Rules/g) || []).length,
      1,
      'rules block must not be duplicated',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 keeps existing .env values and skips prompts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-env-'));
  const paths = hostPaths(tmp);
  fs.mkdirSync(paths.argoRoot, { recursive: true });

  const seeded = ENV_KEYS.map(key => `${key}=existing-${key}`).join('\n');
  fs.writeFileSync(path.join(paths.argoRoot, '.env'), `# Argo live-provider and Neo4j configuration.\n${seeded}\n`);

  try {
    // No -SkipEnv and no stdin: the script must not call Read-Host because
    // every known variable already holds a non-empty value. The timeout guards
    // against an accidental interactive prompt hanging the test.
    const result = runInstall({ ...paths, skipEnv: false, timeout: 30000 });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    const env = fs.readFileSync(path.join(paths.argoRoot, '.env'), 'utf8');
    for (const key of ENV_KEYS) {
      assert.match(env, new RegExp(`^${key}=existing-${key}$`, 'm'), `${key} must keep its existing value`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 deploys DeepSeek Harness integration from the single-source artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-install-dsh-'));
  const paths = hostPaths(tmp);
  const { dshHome } = paths;
  try {
    const result = runInstall({ ...paths, skipEnv: true });
    assert.equal(result.status, 0, `install script exited with ${result.status}: ${result.stderr}`);

    // 1) rule -> ~/.dsh/AGENTS.md: frontmatter stripped (DSH injects verbatim);
    //    the rule body is injected verbatim with NO adapter prose, so the
    //    working prompt matches the Copilot / Cursor / OpenCode rules exactly.
    const agents = fs.readFileSync(path.join(dshHome, 'AGENTS.md'), 'utf8');
    assert.ok(!agents.startsWith('---'), 'DSH AGENTS.md must not start with YAML frontmatter');
    assert.match(agents, /<WakeupGuideline>/, 'must carry the wakeup gate');
    assert.match(agents, /<CoreRules>/, 'must carry the core rules');
    assert.match(agents, /<ToolsGuideline>/, 'must carry the tools guideline');
    assert.match(agents, /UNCONDITIONAL STARTUP GATE/, 'must carry the rule body verbatim');
    assert.doesNotMatch(agents, /DSH adapter note|Multi-workspace note|DeepSeek Harness edition/,
      'must not inject adapter/deployment prose into the working rule');

    // 2) skill -> ~/.dsh/skills/argo-init (same single source as the others).
    const skill = fs.readFileSync(path.join(dshHome, 'skills', 'argo-init', 'SKILL.md'), 'utf8');
    assert.match(skill, /name: argo-init/, 'skill must keep its DSH-compatible frontmatter');

    // 3+4) bridge + wakeup rows -> ~/.dsh/cordis.patch.yml (managed block).
    // The dsh-argo-workspace bridge connects directly to the argo server; no
    // dsh-mcp-client row is needed, so no internal tool names exist.
    const patch = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
    assert.match(patch, /BEGIN ArchGraph ARGO deployment/, 'managed block marker must be present');
    assert.match(patch, /id: argo-workspace/, 'must insert the workspace bridge row');
    assert.match(patch, /dsh-argo-workspace\/index\.js/, 'bridge row must reference the generated bridge plugin');
    assert.match(patch, /serverPath:/, 'bridge row must pass the deployed argo MCP server path');
    assert.match(patch, /argo-mcp-server\.js/, 'must reference the deployed argo MCP server');
    assert.doesNotMatch(patch, /dsh-mcp-client/, 'must not require a dsh-mcp-client row');
    // No cwd is pinned by default (workspace following is per-call via the bridge).
    assert.doesNotMatch(patch, /cwd:/, 'must not pin cwd by default');
    assert.doesNotMatch(patch, /workspaces:/, 'must not set the allowlist unless -DshWorkspaces is passed');
    assert.match(patch, /id: argo-wakeup/, 'must insert the argo-wakeup row');
    assert.match(patch, /file:\/\/\//, 'must reference the generated plugin via file: URL');
    assert.match(patch, /END ArchGraph ARGO deployment/, 'managed block end marker must be present');

    // 4b) wakeup plugin generated from the rule's <WakeupGuideline> block.
    const wakeup = fs.readFileSync(
      path.join(dshHome, 'plugins', 'dsh-argo-wakeup', 'index.js'),
      'utf8',
    );
    assert.match(wakeup, /export const name = 'dsh-argo-wakeup'/, 'plugin must export its name');
    assert.match(wakeup, /export const inject = \['systemPrompt'\]/, 'plugin must inject the prompt registry');
    assert.match(wakeup, /order: -90/, 'gate section must sit right after the harness identity');
    assert.match(wakeup, /WAKEUP_GATE|STARTUP GATE/, 'plugin must carry the gate text from the rule');

    // 4c) workspace bridge plugin connects directly to the argo server and
    // injects the session workspace as the per-call workspaceRoot.
    const bridge = fs.readFileSync(
      path.join(dshHome, 'plugins', 'dsh-argo-workspace', 'index.js'),
      'utf8',
    );
    assert.match(bridge, /export const name = 'dsh-argo-workspace'/, 'bridge must export its name');
    assert.match(bridge, /export const inject = \['tools'\]/, 'bridge must inject the tools registry');
    assert.match(bridge, /spawn\('node', \[serverPath\]/, 'bridge must spawn the argo server directly');
    assert.match(bridge, /render: \(_args, value\) => value\.content/, 'bridge must declare output.render for the tool registry');
    assert.match(bridge, /mcp__argo__/, 'bridge must register the public mcp__argo__ tool names');
    assert.doesNotMatch(bridge, /mcp__argo-core__/, 'bridge must not create internal tool names');
    assert.match(bridge, /workspaceRoot/, 'bridge must inject workspaceRoot into every call');
    assert.match(bridge, /header\?\.cwd/, 'bridge must read the session workspace from the durable session header (SessionHeader.cwd, not requestHeader())');

    // 5) agents -> ~/.dsh/.agent-presets/<id>/ generated from argo/agents/*.agent.md.
    const preset = path.join(dshHome, '.agent-presets', 'wechat-publisher');
    assert.ok(fs.existsSync(path.join(preset, 'agent.cordis.yml')), 'agent.cordis.yml must exist');
    assert.ok(fs.existsSync(path.join(preset, 'persona.js')), 'persona.js must exist');
    assert.ok(fs.existsSync(path.join(preset, 'preset.yml')), 'preset.yml must exist');
    const personaMd = fs.readFileSync(path.join(preset, 'persona.md'), 'utf8');
    assert.match(personaMd, /公众号发布员/, 'persona must carry the publisher role from the agent file');
    assert.match(personaMd, /wechat:draft/, 'persona must keep the draft-only constraint');
    const cordis = fs.readFileSync(path.join(preset, 'agent.cordis.yml'), 'utf8');
    assert.match(cordis, /\.\/persona\.js/, 'preset must mount the local persona row');
    const presetMeta = fs.readFileSync(path.join(preset, 'preset.yml'), 'utf8');
    assert.match(presetMeta, /name: 公众号发布员/, 'preset metadata must name the publisher');

    // 6) idempotency: a second run must not duplicate the managed block.
    const second = runInstall({ ...paths, skipEnv: true });
    assert.equal(second.status, 0, `second install exited with ${second.status}: ${second.stderr}`);
    const patch2 = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
    assert.equal(
      (patch2.match(/BEGIN ArchGraph ARGO deployment/g) || []).length,
      1,
      'managed block must not be duplicated across re-installs',
    );
    const agents2 = fs.readFileSync(path.join(dshHome, 'AGENTS.md'), 'utf8');
    assert.equal(
      (agents2.match(/<WakeupGuideline>/g) || []).length,
      1,
      'DSH rule block must not be duplicated across re-installs',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install-argo.ps1 numbers the DeepSeek Harness conversion as deploy steps 15-19', () => {
  // GIVEN the installer publishes 19 numbered deploy steps (14 platform steps
  // plus 5 DeepSeek Harness conversion steps)
  // WHEN a reader scans install-argo.ps1 for step markers
  // THEN the five DSH steps are numbered [15/19]..[19/19] and carry the
  // rule / skill / wakeup plugin / MCP / agent preset conversions
  const script = fs.readFileSync(SCRIPT, 'utf8');
  for (let i = 1; i <= 19; i++) {
    assert.ok(script.includes(`[${i}/19]`), `step marker [${i}/19] must exist`);
  }
  assert.match(script, /\[15\/19\][^\n]*AGENTS\.md/, 'step 15 must convert the rule to AGENTS.md');
  assert.match(script, /\[16\/19\][^\n]*skills\\argo-init/, 'step 16 must deploy the argo-init skill');
  assert.match(script, /\[17\/19\][^\n]*WakeupGuideline/, 'step 17 must generate the wakeup plugin from the rule');
  assert.match(script, /\[18\/19\][^\n]*argo-workspace/, 'step 18 must write the MCP bridge + wakeup rows');
  assert.match(script, /\[19\/19\][^\n]*agent-presets/, 'step 19 must generate the agent presets');
});
