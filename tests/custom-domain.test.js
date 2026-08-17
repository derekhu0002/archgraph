'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:dns').promises;
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CUSTOM_DOMAIN = 'archgraph.org';
const GITHUB_PAGES_IPS = new Set([
  '185.199.108.153',
  '185.199.109.153',
  '185.199.110.153',
  '185.199.111.153',
]);

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

test('custom-domain: DNS resolves to GitHub Pages', async (t) => {
  // GIVEN the DNS provider has configured A records for the apex custom domain
  // WHEN a visitor resolves the custom domain
  // THEN it resolves to the GitHub Pages IP addresses
  let addresses;
  try {
    addresses = await resolve(CUSTOM_DOMAIN, 'A');
  } catch (err) {
    t.skip(
      `DNS for ${CUSTOM_DOMAIN} is not configured yet (${err.code || err.message}); add the GitHub Pages A records in your DNS provider`
    );
    return;
  }
  assert.ok(
    Array.isArray(addresses) && addresses.length > 0,
    `expected ${CUSTOM_DOMAIN} to resolve to at least one A record`
  );
  assert.ok(
    addresses.every((ip) => GITHUB_PAGES_IPS.has(ip)),
    `expected ${CUSTOM_DOMAIN} to resolve to GitHub Pages IPs ${[...GITHUB_PAGES_IPS].join(', ')}, got ${JSON.stringify(addresses)}`
  );
});
