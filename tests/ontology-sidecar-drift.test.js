'use strict';

// Guard against sidecar drift. `sandbox/ontology-projection/` keeps a copy of the
// production ontology-projection lib/python so its standalone ATs can run isolated.
// A stale copy silently re-introduces the exact class of bug fixed in issue #10
// (the vocabulary mismatch lived in a copy whose ATs never run in `npm test`).
// This keeps the copy byte-identical: edit production, then re-copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.resolve(__dirname, '..');
const PROD = path.join(REPO, 'argo', 'scripts', 'ontology-projection');
const SANDBOX = path.join(REPO, 'sandbox', 'ontology-projection');
const FILES = Object.freeze([
  'lib/rdf.js',
  'lib/model.js',
  'lib/project.js',
  'lib/shapes.js',
  'lib/owl.js',
  'lib/validate.js',
  'python/validate_ontology.py',
]);

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('AT-ovx-drift: the sandbox sidecar copy is byte-identical to production', () => {
  for (const rel of FILES) {
    const prod = path.join(PROD, rel);
    const sandbox = path.join(SANDBOX, rel);
    assert.ok(fs.existsSync(prod), `missing production file ${rel}`);
    assert.ok(fs.existsSync(sandbox), `missing sandbox copy ${rel}`);
    assert.equal(
      sha(sandbox),
      sha(prod),
      `sandbox/ontology-projection/${rel} drifted from argo/scripts/ontology-projection/${rel} — re-copy it`,
    );
  }
});
