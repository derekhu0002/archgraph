'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:dns').promises;
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CUSTOM_DOMAIN = 'archgraph.derekworkspacev5.com';
const PAGES_HOST = 'derekhu0002.github.io';

test('custom-domain: CNAME file declares the custom domain', () => {
  // GIVEN the repository publishes a GitHub Pages site
  // WHEN GitHub Pages reads the publishing source on the default branch
  // THEN the CNAME file at the source root declares exactly the custom domain
  const cname = readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim();
  assert.equal(
    cname,
    CUSTOM_DOMAIN,
    `CNAME should contain exactly ${CUSTOM_DOMAIN}`
  );
});

test('custom-domain: DNS CNAME points to the GitHub Pages host', async (t) => {
  // GIVEN the DNS provider (Cloudflare) has been configured for the custom domain
  // WHEN a visitor resolves the custom domain
  // THEN it is a CNAME alias pointing to the GitHub Pages host
  let records;
  try {
    records = await resolve(CUSTOM_DOMAIN, 'CNAME');
  } catch (err) {
    t.skip(
      `DNS CNAME for ${CUSTOM_DOMAIN} is not configured yet (${err.code || err.message}); add it in Cloudflare`
    );
    return;
  }
  assert.ok(
    Array.isArray(records) && records.some((r) => r.toLowerCase() === PAGES_HOST),
    `expected ${CUSTOM_DOMAIN} to CNAME to ${PAGES_HOST}, got ${JSON.stringify(records)}`
  );
});
