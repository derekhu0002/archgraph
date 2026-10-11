'use strict';

// Emit the declared axioms as OWL/RDFS triples and run a minimal, dependency-free
// consistency check for the deterministic subset: rdfs domain/range typing
// closure + owl:disjointWith + owl:FunctionalProperty + transitive/irreflexive
// closure. This is the sidecar's skeleton engine; a real reasoner (ELK/HermiT)
// or SHACL engine can replace checkConsistency behind the same interface.

const { iri, triple } = require('./rdf.js');
const { typeIri, relIri, RDF_TYPE } = require('./project.js');

const OWL = 'http://www.w3.org/2002/07/owl#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

function buildOwlTriples(model) {
  const a = model.axioms;
  const lines = [];
  for (const [c1, c2] of a.disjointClasses) {
    lines.push(triple(typeIri(c1), iri(`${OWL}disjointWith`), typeIri(c2)));
  }
  for (const p of a.functionalProperties) {
    lines.push(triple(relIri(p), iri(RDF_TYPE), iri(`${OWL}FunctionalProperty`)));
  }
  for (const p of a.transitiveProperties) {
    lines.push(triple(relIri(p), iri(RDF_TYPE), iri(`${OWL}TransitiveProperty`)));
  }
  for (const p of a.irreflexiveProperties) {
    lines.push(triple(relIri(p), iri(RDF_TYPE), iri(`${OWL}IrreflexiveProperty`)));
  }
  for (const p of a.asymmetricProperties) {
    lines.push(triple(relIri(p), iri(RDF_TYPE), iri(`${OWL}AsymmetricProperty`)));
  }
  for (const [p, c] of Object.entries(a.objectPropertyDomain)) {
    lines.push(triple(relIri(p), iri(`${RDFS}domain`), typeIri(c)));
  }
  for (const [p, c] of Object.entries(a.objectPropertyRange)) {
    lines.push(triple(relIri(p), iri(`${RDFS}range`), typeIri(c)));
  }
  lines.sort();
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function checkConsistency(model, graph) {
  const a = model.axioms;
  const types = new Map();
  const props = [];

  const addType = (id, type) => {
    if (!types.has(id)) types.set(id, new Set());
    types.get(id).add(type);
  };

  for (const el of graph.elements || []) addType(el.id, el.type);
  for (const rel of graph.relationships || []) {
    props.push({ s: rel.source_id, p: rel.type, o: rel.target_id, id: rel.id, derived: false });
  }

  // rdfs domain/range typing inference to fixpoint.
  let changed = true;
  while (changed) {
    changed = false;
    for (const { s, o, p } of props) {
      const d = a.objectPropertyDomain[p];
      const r = a.objectPropertyRange[p];
      if (d) {
        const before = types.get(s) ? types.get(s).size : 0;
        addType(s, d);
        if (types.get(s).size !== before) changed = true;
      }
      if (r) {
        const before = types.get(o) ? types.get(o).size : 0;
        addType(o, r);
        if (types.get(o).size !== before) changed = true;
      }
    }
  }

  const inconsistencies = [];

  // Transitive closure (declared transitive properties) -> new derived edges.
  for (const p of a.transitiveProperties) {
    let grew = true;
    while (grew) {
      grew = false;
      const edges = props.filter((x) => x.p === p);
      for (const e1 of edges) {
        for (const e2 of edges) {
          if (e1.o === e2.s && !props.some((x) => x.p === p && x.s === e1.s && x.o === e2.o)) {
            props.push({ s: e1.s, p, o: e2.o, derived: true });
            grew = true;
          }
        }
      }
    }
  }

  // disjointness
  const disjoint = new Set();
  for (const [c1, c2] of a.disjointClasses) {
    disjoint.add(`${c1}|${c2}`);
    disjoint.add(`${c2}|${c1}`);
  }
  for (const [id, set] of types) {
    const arr = [...set];
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        if (disjoint.has(`${arr[i]}|${arr[j]}`)) {
          inconsistencies.push({
            code: 'OWL_DISJOINT',
            subject: id,
            types: [arr[i], arr[j]],
            message: `'${id}' is both ${arr[i]} and ${arr[j]} (declared disjoint)`,
          });
        }
      }
    }
  }

  // irreflexive / asymmetric (over the closure)
  const irreflexive = new Set(a.irreflexiveProperties);
  const asymmetric = new Set(a.asymmetricProperties);
  for (const { s, p, o, derived } of props) {
    if (irreflexive.has(p) && s === o) {
      inconsistencies.push({
        code: 'OWL_IRREFLEXIVE',
        subject: s,
        property: p,
        derived,
        message: derived
          ? `'${s}' ${p} '${s}' holds after transitive closure (property is irreflexive)`
          : `'${s}' ${p} itself (property is irreflexive)`,
      });
    }
    if (asymmetric.has(p) && props.some((x) => x.p === p && x.s === o && x.o === s)) {
      inconsistencies.push({
        code: 'OWL_ASYMMETRIC',
        subject: s,
        property: p,
        message: `'${s}' ${p} '${o}' and '${o}' ${p} '${s}' (property is asymmetric)`,
      });
    }
  }

  // functional properties (closed-world distinctness)
  const functional = new Set(a.functionalProperties);
  const bySP = new Map();
  for (const { s, p, o } of props) {
    if (!functional.has(p)) continue;
    const key = `${s}|${p}`;
    if (!bySP.has(key)) bySP.set(key, new Set());
    bySP.get(key).add(o);
  }
  for (const [key, values] of bySP) {
    if (values.size > 1) {
      const [s, p] = key.split('|');
      inconsistencies.push({
        code: 'OWL_FUNCTIONAL',
        subject: s,
        property: p,
        values: [...values],
        message: `functional '${p}' of '${s}' has ${values.size} distinct values: ${[...values].join(', ')}`,
      });
    }
  }

  return inconsistencies;
}

function entailedTransitive(model, graph) {
  const out = [];
  for (const prop of model.axioms.transitiveProperties) {
    const asserted = new Set(
      (graph.relationships || []).filter((r) => r.type === prop).map((r) => `${r.source_id}|${r.target_id}`),
    );
    const closure = new Set(asserted);
    let changed = true;
    while (changed) {
      changed = false;
      for (const x of [...closure]) {
        for (const y of [...closure]) {
          const [xs, xo] = x.split('|');
          const [ys, yo] = y.split('|');
          if (xo === ys && !closure.has(`${xs}|${yo}`)) {
            closure.add(`${xs}|${yo}`);
            changed = true;
          }
        }
      }
    }
    for (const key of closure) {
      if (!asserted.has(key)) {
        const [source, target] = key.split('|');
        out.push({ property: prop, source, target });
      }
    }
  }
  return out;
}

module.exports = { buildOwlTriples, checkConsistency, entailedTransitive, OWL, RDFS };
