'use strict';

// canonical graph JSON -> RDF (N-Triples). A pure, read-only projection:
// stable element ids become IRIs, element types become classes, relationship
// types become object properties. Deterministic (sorted) so re-projection is
// byte-identical (idempotent).

const { iri, literal, triple, hashString } = require('./rdf.js');

const NS = 'https://archgraph.local/';

function localName(value) {
  return String(value).replace(/[^A-Za-z0-9]/g, '_');
}

function typeIri(type) {
  return iri(`${NS}class/${localName(type)}`);
}

function indIri(id) {
  return iri(`${NS}id/${id}`);
}

function relIri(type) {
  return iri(`${NS}rel/${localName(type)}`);
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

function projectGraph(graph) {
  const lines = [];
  for (const el of graph.elements || []) {
    lines.push(triple(indIri(el.id), iri(RDF_TYPE), typeIri(el.type)));
    if (el.name) {
      lines.push(triple(indIri(el.id), iri(`${NS}name`), literal(el.name)));
    }
  }
  for (const rel of graph.relationships || []) {
    lines.push(triple(indIri(rel.source_id), relIri(rel.type), indIri(rel.target_id)));
  }
  lines.sort();
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function projectHash(graph) {
  return hashString(projectGraph(graph));
}

module.exports = { projectGraph, projectHash, NS, localName, typeIri, indIri, relIri, RDF_TYPE };
