'use strict';

// Minimal N-Triples helpers (dependency-free) for the projection sidecar.

const crypto = require('node:crypto');

function iri(value) {
  return `<${value}>`;
}

function escapeLiteral(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function literal(value) {
  return `"${escapeLiteral(value)}"`;
}

function triple(subject, predicate, object) {
  return `${subject} ${predicate} ${object} .`;
}

function hashString(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = { iri, literal, escapeLiteral, triple, hashString };
