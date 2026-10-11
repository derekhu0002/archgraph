'use strict';

// Compile the bundle's endpoint matrix into SHACL NodeShapes (closed-world
// constraints) and apply the SAME semantics the framework uses:
//   matrix[relationshipType][sourceType] = allowed target types;
//   a missing entry means "unconstrained" (allowed).
// The generated SHACL text is a real artifact (pySHACL/Jena can consume it);
// checkEndpoints is the sidecar's dependency-free engine for the same subset.

const { localName } = require('./project.js');

const SH = 'http://www.w3.org/ns/shacl#';

function buildShapes(model) {
  const blocks = [];
  for (const relType of model.relationshipTypes) {
    const bySource = model.matrix[relType];
    if (!bySource) continue;
    for (const [sourceType, targets] of Object.entries(bySource)) {
      const node = `${localName(sourceType)}_${localName(relType)}`;
      blocks.push(
        [
          `ex:${node} a sh:NodeShape ;`,
          `  sh:targetClass ex:${localName(sourceType)} ;`,
          '  sh:property [',
          `    sh:path ex:${localName(relType)} ;`,
          `    sh:class ${targets.map((t) => `ex:${localName(t)}`).join(', ')} ;`,
          `    sh:message "${sourceType} --${relType}--> must target { ${targets.join(', ')} }" ;`,
          '  ] .',
        ].join('\n'),
      );
    }
  }
  const header = '@prefix ex: <https://archgraph.local/> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n\n';
  return header + (blocks.length ? `${blocks.join('\n\n')}\n` : '');
}

function checkEndpoints(model, graph) {
  const violations = [];
  const byId = new Map((graph.elements || []).map((e) => [e.id, e]));
  for (const rel of graph.relationships || []) {
    const bySource = model.matrix[rel.type];
    if (!bySource) continue;
    const src = byId.get(rel.source_id);
    const tgt = byId.get(rel.target_id);
    if (!src || !tgt) continue;
    const allowed = bySource[src.type];
    if (!allowed) continue;
    if (!allowed.some((t) => t === tgt.type || t === '*')) {
      violations.push({
        code: 'SHACL_ENDPOINT',
        relationshipId: rel.id,
        subjectType: src.type,
        targetType: tgt.type,
        allowed,
        message: `${src.type} '${src.name}' cannot ${rel.type} ${tgt.type} '${tgt.name}'`,
      });
    }
  }
  return violations;
}

module.exports = { buildShapes, checkEndpoints, SH };
