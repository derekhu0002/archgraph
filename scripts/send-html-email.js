'use strict';

/*
 * Minimal HTML email sender over implicit-TLS SMTP (default smtp.126.com:465).
 * Credentials are read from environment variables only — never hard-code secrets.
 *
 * Required env:
 *   SMTP_USER   sender account / login (e.g. hdhscu@126.com)
 *   SMTP_PASS   SMTP authorization code (NOT the mailbox password)
 *   MAIL_TO     recipient address(es), comma-separated
 *   MAIL_HTML   path to the HTML body file
 * Optional env:
 *   SMTP_HOST   default smtp.126.com
 *   SMTP_PORT   default 465 (implicit TLS)
 *   MAIL_FROM   default SMTP_USER
 *   MAIL_NAME   sender display name (default: SMTP_USER)
 *   MAIL_SUBJECT
 *
 * Usage:
 *   node scripts/send-html-email.js [--dry-run]
 */

const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.SMTP_HOST || 'smtp.126.com';
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM || USER;
const NAME = process.env.MAIL_NAME || FROM;
const TO = (process.env.MAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
const HTML_PATH = process.env.MAIL_HTML;
const SUBJECT = process.env.MAIL_SUBJECT || 'ArchGraph 上手介绍';
const DRY_RUN = process.argv.includes('--dry-run');

function fail(msg) {
  console.error('[send-html-email] ' + msg);
  process.exit(1);
}

function b64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function encodeWord(value) {
  return '=?UTF-8?B?' + b64(value) + '?=';
}

function wrap76(base64) {
  return base64.replace(/.{1,76}/g, '$&\r\n').replace(/\r\n$/, '');
}

function rfc2822Date() {
  return new Date().toUTCString().replace(/GMT$/, '+0000');
}

function assertConfig() {
  const missing = [];
  if (!USER) missing.push('SMTP_USER');
  if (!PASS) missing.push('SMTP_PASS');
  if (!TO.length) missing.push('MAIL_TO');
  if (!HTML_PATH) missing.push('MAIL_HTML');
  if (missing.length) fail('missing required env: ' + missing.join(', '));
  if (!fs.existsSync(HTML_PATH)) fail('HTML body not found: ' + HTML_PATH);
}

class SmtpClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.lines = [];
    this.waiters = [];
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this.pump();
    });
    socket.on('error', (err) => {
      const w = this.waiters.shift();
      if (w) w.reject(err);
    });
  }

  pump() {
    while (this.waiters.length) {
      const idx = this.buffer.indexOf('\r\n');
      if (idx < 0) return;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.lines.push(line);
      if (/^\d{3} /.test(line)) {
        const waiter = this.waiters.shift();
        const out = this.lines;
        this.lines = [];
        waiter.resolve(out);
      }
    }
  }

  read() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.pump();
    });
  }

  async command(line, expected) {
    if (line !== null) this.socket.write(line + '\r\n');
    const reply = await this.read();
    const code = Number(reply[reply.length - 1].slice(0, 3));
    if (expected && !expected.includes(code)) {
      throw new Error(`SMTP expected ${expected.join('/')} but got: ${reply.join(' | ')}`);
    }
    return reply;
  }
}

async function connect() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: HOST, port: PORT, servername: HOST, rejectUnauthorized: true },
      () => resolve(socket)
    );
    socket.setTimeout(30000, () => reject(new Error('connection timeout')));
    socket.once('error', reject);
  });
}

async function main() {
  assertConfig();
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const body = wrap76(b64(html));
  const headers = [
    'From: ' + encodeWord(NAME) + ' <' + FROM + '>',
    'To: ' + TO.join(', '),
    'Subject: ' + encodeWord(SUBJECT),
    'Date: ' + rfc2822Date(),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ].join('\r\n');
  const message = headers + '\r\n\r\n' + body + '\r\n';

  if (DRY_RUN) {
    console.log('[send-html-email] dry-run ok');
    console.log('  host     :', HOST + ':' + PORT);
    console.log('  from     :', NAME + ' <' + FROM + '>');
    console.log('  to       :', TO.join(', '));
    console.log('  subject  :', SUBJECT);
    console.log('  html     :', HTML_PATH, '(' + html.length + ' chars)');
    return;
  }

  const socket = await connect();
  const smtp = new SmtpClient(socket);
  try {
    await smtp.command(null, [220]);
    await smtp.command('EHLO ' + (HOST || 'localhost'), [250]);
    await smtp.command('AUTH LOGIN', [334]);
    await smtp.command(b64(USER), [334]);
    await smtp.command(b64(PASS), [235]);
    await smtp.command('MAIL FROM:<' + FROM + '>', [250]);
    for (const rcpt of TO) await smtp.command('RCPT TO:<' + rcpt + '>', [250, 251]);
    await smtp.command('DATA', [354]);
    await smtp.command(message + '.', [250]);
    await smtp.command('QUIT', [221]);
    console.log('[send-html-email] sent to ' + TO.join(', '));
  } finally {
    socket.end();
  }
}

main().catch((err) => fail(err && err.message ? err.message : String(err)));
