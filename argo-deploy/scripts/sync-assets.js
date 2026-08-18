'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ASSETS = path.resolve(__dirname, '..', 'assets');

function rmrf(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source directory: ${src}`);
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source file: ${src}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  rmrf(ASSETS);

  // Toolchain (install assets only; exclude secrets and runtime state).
  copyDir(path.join(ROOT, 'argo', 'scripts'), path.join(ASSETS, 'argo', 'scripts'));
  copyDir(path.join(ROOT, 'argo', 'schema'), path.join(ASSETS, 'argo', 'schema'));
  copyDir(
    path.join(ROOT, 'argo', 'skills', '@ai-chen2050'),
    path.join(ASSETS, 'argo', 'skills', '@ai-chen2050'),
  );
  copyFile(path.join(ROOT, 'argo', '.env.example'), path.join(ASSETS, 'argo', '.env.example'));

  // Copilot / project skills.
  copyDir(path.join(ROOT, 'argo', 'skills', 'argo-init'), path.join(ASSETS, 'skills', 'argo-init'));
  copyDir(
    path.join(ROOT, '.github', 'skills', 'create-github-repository-page'),
    path.join(ASSETS, 'skills', 'create-github-repository-page'),
  );
  copyDir(
    path.join(ROOT, '.github', 'skills', 'diagram-draw'),
    path.join(ASSETS, 'skills', 'diagram-draw'),
  );
  copyDir(
    path.join(ROOT, '.github', 'skills', 'optimize-web-layout-style'),
    path.join(ASSETS, 'skills', 'optimize-web-layout-style'),
  );

  // Rules.
  copyFile(
    path.join(ROOT, 'argo', 'rules', 'intent-architecture-global-rule.md'),
    path.join(ASSETS, 'rules', 'intent-architecture-global-rule.md'),
  );
  copyFile(
    path.join(ROOT, '.github', 'kglibrary.instructions.md'),
    path.join(ASSETS, 'rules', 'kglibrary.instructions.md'),
  );

  console.log(`Synced assets into ${ASSETS}`);
}

main();
