'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SH_SCRIPT = path.join(ROOT, 'install-argo.sh');
const PG_SCRIPT = path.join(ROOT, 'install-argo.ps1');

function haveCommand(command, args) {
  try {
    const result = spawnSync(command, args, { stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function findBackslashNamedEntries(dir) {
  const hits = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.name.includes('\\')) {
        hits.push(full);
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(full);
      }
    }
  }
  return hits;
}

// --- contract: the POSIX deployer and its wiring ---------------------------

test('install-argo.sh is a POSIX deployer that resolves XDG/home and drives install-argo.ps1', () => {
  // GIVEN the framework ships a Windows installer (install-argo.ps1) whose
  //   defaults rely on %USERPROFILE%/%APPDATA%/%LOCALAPPDATA% and backslash joins
  // WHEN a Linux/WSL user deploys the toolchain
  // THEN a POSIX wrapper resolves the home + XDG dirs, exports the Windows-named
  //   variables for safety, and passes explicit forward-slash path parameters to
  //   the same installer.
  assert.ok(fs.existsSync(SH_SCRIPT), 'install-argo.sh must exist at the repository root');
  const script = fs.readFileSync(SH_SCRIPT, 'utf8');

  assert.match(script, /^#!\/usr\/bin\/env bash/, 'must be a bash script');
  assert.match(script, /set -euo pipefail/, 'must fail fast');

  // Home + XDG resolution, and the Windows-named variables kept consistent.
  assert.match(script, /HOME_DIR=/, 'must resolve a POSIX home');
  assert.match(script, /XDG_CONFIG_HOME/, 'must honor XDG_CONFIG_HOME');
  assert.match(script, /XDG_DATA_HOME/, 'must honor XDG_DATA_HOME');
  assert.match(script, /export USERPROFILE=/, 'must export USERPROFILE for the installer');
  assert.match(script, /export APPDATA=/, 'must export APPDATA for the installer');
  assert.match(script, /export LOCALAPPDATA=/, 'must export LOCALAPPDATA for the installer');

  // Drives the shared installer rather than reimplementing it (no drift).
  assert.match(script, /install-argo\.ps1/, 'must invoke install-argo.ps1');
  assert.ok(fs.existsSync(PG_SCRIPT), 'install-argo.ps1 must still exist');

  // Every destination the installer needs is supplied explicitly, forward-slash.
  for (const param of [
    '-ArgoRoot', '-SkillsRoot', '-PromptsRoot', '-McpPath',
    '-CursorSkillsRoot', '-CursorMcpPath', '-CursorMcpBridgesRoot',
    '-CursorAgentsRoot', '-CursorRulesRoot',
    '-OpenCodeSkillsRoot', '-OpenCodeAgentsPath', '-OpenCodeAgentsRoot', '-OpenCodeConfigPath',
    '-OpenCodeSystemConfigPath',
    '-CopilotAgentsRoot', '-PluginsRoot',
    '-DshHome', '-OpenClawHome', '-OpenClawWorkspace', '-DoubaoHome', '-DoubaoWorkspace', '-CodexHome',
  ]) {
    assert.ok(script.includes(param), `must pass ${param}`);
  }

  // The system-level managed config (/etc/opencode/opencode.json) is opt-in:
  // the wrapper forwards the env var verbatim and defaults it to empty, so a
  // plain deploy never creates /etc/opencode.
  assert.ok(
    script.includes('OPENCODE_SYSTEM_CONFIG_PATH="${OPENCODE_SYSTEM_CONFIG_PATH:-}"'),
    'OPENCODE_SYSTEM_CONFIG_PATH must default to empty (opt-in)',
  );

  // Caller flags are forwarded verbatim; caller-supplied path flags are not
  // duplicated (PowerShell rejects a parameter bound twice).
  assert.match(script, /CALLER_ARGS=\(/, 'must capture caller arguments');
  assert.match(script, /CALLER_ARGS\[@\]/, 'must forward caller arguments');
  assert.match(script, /provided\(/, 'must detect caller-supplied flags');
});

test('argo-deploy dispatches to the POSIX wrapper on non-Windows platforms', () => {
  // GIVEN `argo-deploy` must work on Linux/WSL as well as Windows
  // WHEN it runs on a non-Windows platform with the wrapper present
  // THEN it executes install-argo.sh through bash, falling back to pwsh only if
  //   bash is unavailable.
  const script = fs.readFileSync(path.join(ROOT, 'bin', 'argo-deploy.js'), 'utf8');
  assert.match(script, /install-argo\.sh/, 'bin dispatch must reference install-argo.sh');
  assert.match(script, /isWindows/, 'must branch on platform');
  assert.match(script, /spawnSync\('bash'/, 'must run the wrapper via bash');
  assert.match(script, /ENOENT/, 'must fall back when bash is unavailable');
});

test('the npm package ships the POSIX deployer', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(
    Array.isArray(manifest.files) && manifest.files.includes('install-argo.sh'),
    'package.json files must include install-argo.sh',
  );
  assert.ok(manifest.files.includes('install-argo.ps1'), 'package.json files must still include install-argo.ps1');
});

test('install-argo.ps1 installs the ontology python deps on externally-managed Linux/macOS', () => {
  // GIVEN the ontology-validation engine needs pyshacl + owlready2 via pip
  // WHEN the installer provisions them on a PEP 668 system (Debian/Ubuntu)
  // THEN it passes --break-system-packages on non-Windows so the default deploy
  //   does NOT abort with "externally-managed-environment".
  const script = fs.readFileSync(PG_SCRIPT, 'utf8');
  assert.match(script, /--break-system-packages/, 'pip step must pass --break-system-packages off Windows');
  assert.match(script, /IsWindows/, 'pip step must branch on the platform');
  assert.match(script, /pyshacl/, 'must still install pyshacl');
  assert.match(script, /owlready2/, 'must still install owlready2');
});

// --- behaviour: a real deploy into a throwaway Linux home -------------------

const IS_WINDOWS = process.platform === 'win32';
const HAVE_BASH = !IS_WINDOWS && haveCommand('bash', ['-c', 'exit 0']);
const HAVE_PWSH = !IS_WINDOWS && haveCommand('pwsh', ['-NoProfile', '-Command', 'exit 0']);

if (HAVE_BASH && HAVE_PWSH) {
  test('install-argo.sh deploys the toolchain into a Linux home with no literal-backslash artifacts', () => {
    // GIVEN a Linux/WSL user with an empty HOME
    // WHEN they run install-argo.sh (non-interactive, no deps, core integrations)
    // THEN the toolchain lands under that HOME on forward-slash paths and no file
    //   with a backslash in its name is created anywhere.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argo-sh-deploy-'));
    const systemConfigPath = path.join(tmp, 'etc', 'opencode', 'opencode.json');
    try {
      const result = spawnSync('bash', [
        SH_SCRIPT,
        '-SkipEnv', '-SkipDeps', '-SkipOntologyEngine',
        '-SkipDsh', '-SkipOpenClaw', '-SkipDoubao', '-SkipCodex',
      ], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          ...process.env,
          HOME: tmp,
          XDG_CONFIG_HOME: path.join(tmp, '.config'),
          XDG_DATA_HOME: path.join(tmp, '.local', 'share'),
          USERPROFILE: '',
          APPDATA: '',
          LOCALAPPDATA: '',
          OPENCODE_SYSTEM_CONFIG_PATH: systemConfigPath,
        },
      });
      assert.equal(result.status, 0, `install-argo.sh exited with ${result.status}: ${result.stderr}`);

      // Core artifacts land under the throwaway HOME.
      assert.ok(fs.existsSync(path.join(tmp, '.argo', 'scripts', 'argo-mcp-server.js')), 'argo scripts must deploy');
      assert.ok(fs.existsSync(path.join(tmp, '.argo', 'schema', 'SystemArchitecture.schema.json')), 'schema must deploy');

      // OpenCode config is valid JSON wired to the deployed MCP server.
      const openCodeConfig = path.join(tmp, '.config', 'opencode', 'opencode.json');
      assert.ok(fs.existsSync(openCodeConfig), 'OpenCode MCP config must be written');
      const cfg = JSON.parse(fs.readFileSync(openCodeConfig, 'utf8'));
      assert.ok(cfg.mcp && cfg.mcp.argo, 'OpenCode config must register the argo MCP server');
      assert.ok(cfg.mcp.argo.command[1].startsWith(tmp), 'MCP command must point into the deployed HOME');

      const userAgentsPath = path.join(tmp, '.config', 'opencode', 'AGENTS.md');
      assert.ok(
        !fs.existsSync(userAgentsPath) ||
          !fs.readFileSync(userAgentsPath, 'utf8').includes('ArchGraph ARGO Workflow Rules'),
        'the rule must not be duplicated in the user-level AGENTS.md when the system layer is enabled',
      );
      assert.ok(fs.existsSync(path.join(tmp, '.cursor', 'mcp.json')), 'Cursor MCP config must be written under HOME');

      // OPENCODE_SYSTEM_CONFIG_PATH opts in to the system-level managed config;
      // the wrapper forwards it so external control planes launched as root see
      // the same framework config as the user-level layer: MCP, rules, skills.
      assert.ok(fs.existsSync(systemConfigPath), 'OPENCODE_SYSTEM_CONFIG_PATH must be honoured');
      const systemCfg = JSON.parse(fs.readFileSync(systemConfigPath, 'utf8'));
      assert.ok(systemCfg.mcp && systemCfg.mcp.argo, 'system managed config must register argo');
      assert.equal(systemCfg.mcp.argo.command[0], 'node');
      assert.ok(systemCfg.mcp['graph-mcp'], 'system managed config must register graph-mcp');
      const systemDir = path.dirname(systemConfigPath);
      assert.ok(fs.existsSync(path.join(systemDir, 'AGENTS.md')), 'system AGENTS.md must be deployed');
      assert.ok(
        fs.existsSync(path.join(systemDir, 'skills', 'argo-init', 'SKILL.md')),
        'system skills must be deployed',
      );
      assert.ok(
        systemCfg.instructions.includes(path.join(systemDir, 'AGENTS.md').replace(/\\/g, '/')),
        'system AGENTS.md must be registered as an instruction',
      );

      // No .env in non-interactive mode.
      assert.ok(!fs.existsSync(path.join(tmp, '.argo', '.env')), '.env must not be generated when -SkipEnv is set');

      // The regression this wrapper exists to prevent: backslash-named files.
      const strays = findBackslashNamedEntries(tmp);
      assert.deepEqual(strays, [], `no file name may contain a backslash: ${strays.join(', ')}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}
