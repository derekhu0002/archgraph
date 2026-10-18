'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SENDER = path.join(ROOT, 'scripts', 'send-html-email.js');

test('html email sender: prepares local article images as inline MIME resources', (t) => {
  // GIVEN an HTML email with a local image asset
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archgraph-inline-mail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const imagePath = path.join(dir, 'blueprint.png');
  const htmlPath = path.join(dir, 'article.html');
  fs.writeFileSync(imagePath, Buffer.from('small image payload'));
  fs.writeFileSync(htmlPath, '<!doctype html><html><body><img src="./blueprint.png" alt="Blueprint"></body></html>');

  // WHEN the existing sender validates the message in dry-run mode
  const result = spawnSync(process.execPath, [SENDER, '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SMTP_USER: 'sender@example.test',
      SMTP_PASS: 'not-a-real-secret',
      MAIL_TO: 'reader@example.test',
      MAIL_HTML: htmlPath,
      MAIL_SUBJECT: 'inline image acceptance',
    },
  });

  // THEN it recognizes the local image without exposing credentials or sending mail
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run ok/);
  assert.match(result.stdout, /inline images\s+: 1/);
  assert.doesNotMatch(result.stdout, /not-a-real-secret/);
});
