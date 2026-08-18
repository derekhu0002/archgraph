'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ASSETS_ROOT = path.resolve(__dirname, '..', 'assets');

function userPromptsDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Code', 'User', 'prompts');
}

function parseArgs(argv) {
  const options = {
    mode: 'global',
    workspace: process.cwd(),
    argoDir: null,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--global' || arg === '-g') {
      options.mode = 'global';
    } else if (arg === '--workspace' || arg === '-w') {
      options.mode = 'workspace';
      const next = argv[index + 1];
      if (next && !next.startsWith('-')) {
        options.workspace = path.resolve(next);
        index += 1;
      } else {
        options.workspace = process.cwd();
      }
    } else if (arg === '--argo-dir') {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error('--argo-dir requires a directory path');
      }
      options.argoDir = path.resolve(next);
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function resolveTargets(options) {
  if (options.mode === 'workspace') {
    return {
      argoDir: options.argoDir || path.join(options.workspace, '.argo'),
      skillsDir: path.join(options.workspace, '.github', 'skills'),
      rulesDir: path.join(options.workspace, '.github'),
    };
  }

  return {
    argoDir: options.argoDir || path.join(os.homedir(), '.argo'),
    skillsDir: path.join(os.homedir(), '.copilot', 'skills'),
    rulesDir: userPromptsDir(),
  };
}

function copyFile(src, dest, dryRun) {
  if (dryRun) {
    return { from: src, to: dest };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { from: src, to: dest };
}

function copyDir(src, dest, dryRun) {
  const copied = [];
  if (!fs.existsSync(src)) {
    return copied;
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyDir(from, to, dryRun));
    } else if (entry.isFile()) {
      copied.push(copyFile(from, to, dryRun));
    }
  }
  return copied;
}

function deploy(options) {
  const targets = resolveTargets(options);
  const copied = [
    ...copyDir(path.join(ASSETS_ROOT, 'argo'), targets.argoDir, options.dryRun),
    ...copyDir(path.join(ASSETS_ROOT, 'skills'), targets.skillsDir, options.dryRun),
    ...copyDir(path.join(ASSETS_ROOT, 'rules'), targets.rulesDir, options.dryRun),
  ];

  return {
    mode: options.mode,
    dryRun: options.dryRun,
    targets,
    copiedCount: copied.length,
    copied,
  };
}

function helpText() {
  return [
    'Usage: argo-deploy [options]',
    '',
    'Deploy the ArchGraph ARGO toolchain, skills, and rules.',
    '',
    'Options:',
    '  --global, -g       Deploy to user-level global locations (default):',
    '                       .argo  -> ~/.argo',
    '                       skills -> ~/.copilot/skills',
    '                       rules  -> %APPDATA%\\Code\\User\\prompts',
    '  --workspace [dir]  Deploy into a workspace (default: current directory):',
    '                       .argo  -> <dir>/.argo',
    '                       skills -> <dir>/.github/skills',
    '                       rules  -> <dir>/.github',
    '  --argo-dir <dir>   Override the toolchain target directory.',
    '  --dry-run          Print planned copies without writing anything.',
    '  --help, -h         Show this help.',
    '',
  ].join('\n');
}

async function runCli(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const result = deploy(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = {
  ASSETS_ROOT,
  copyDir,
  copyFile,
  deploy,
  helpText,
  parseArgs,
  resolveTargets,
  runCli,
  userPromptsDir,
};
