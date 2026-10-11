#!/usr/bin/env python3
"""Real ontology engine for ArchGraph graphs (SHACL constraints + OWL consistency).

Inputs mirror the sidecar contract:
  --bundle <dir>   framework bundle dir (.argo/schema): schema-bundle.rules.json
                   (types + endpoint matrix) + ontology-axioms.json (OWL axioms)
  --graph  <file>  canonical graph JSON (design/KG/SystemArchitecture.json)
  --out    <file>  findings JSON

Engines (real, not a skeleton):
  * SHACL  : pySHACL  (constraints compiled from the endpoint matrix)
  * OWL    : owlready2 + HermiT  (disjoint / functional / transitive / irreflexive
             / rdfs domain-range, with owl:AllDifferent for closed-world distinctness)

It never writes the canonical graph; findings are a derived read-model.
"""

import argparse
import json
import os
import sys
import tempfile

from rdflib import Graph, Namespace, URIRef, Literal, BNode, RDF, RDFS, OWL
from rdflib.collection import Collection

EX = Namespace("https://archgraph.local/")
REL = Namespace("https://archgraph.local/rel/")
CLS = Namespace("https://archgraph.local/class/")
IDNS = Namespace("https://archgraph.local/id/")
SH = Namespace("http://www.w3.org/ns/shacl#")


def local(value):
    return "".join(ch if ch.isalnum() else "_" for ch in str(value))


def load_json(path, default):
    if not path or not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def read_model(bundle_dir):
    rules = load_json(os.path.join(bundle_dir, "schema-bundle.rules.json"), {})
    axioms = load_json(os.path.join(bundle_dir, "ontology-axioms.json"), {})
    return {
        "elementTypes": list((rules.get("elementTypeMetadata") or {}).keys()),
        "relationshipTypes": list((rules.get("relationshipCategoryByType") or {}).keys()),
        "matrix": rules.get("relationshipTargetMatrix") or {},
        # display name -> class token (e.g. "Business Object" -> "BusinessObject").
        # The endpoint matrix / axioms use the CLASS vocabulary; the canonical graph
        # stores DISPLAY names. Bundles already in the display vocabulary have no map.
        "classByType": rules.get("archimateClassByElementType") or {},
        "axioms": axioms,
    }


def type_class(class_by_type, value):
    return class_by_type.get(value, value)


def build_data_graph(graph, class_by_type):
    g = Graph()
    for el in graph.get("elements", []):
        s = IDNS[el["id"]]
        g.add((s, RDF.type, CLS[local(type_class(class_by_type, el["type"]))]))
        if el.get("name"):
            g.add((s, EX.name, Literal(el["name"])))
    for rel in graph.get("relationships", []):
        g.add((IDNS[rel["source_id"]], REL[local(rel["type"])], IDNS[rel["target_id"]]))
    return g


def build_shapes_graph(matrix):
    g = Graph()
    for rel_type, by_source in matrix.items():
        for source_type, targets in by_source.items():
            # '*' is the wildcard "any target" token: the endpoint is UNCONSTRAINED,
            # so emit no shape for it. Without this, local('*') -> '_' makes the shape
            # require a non-existent class and every edge is a false violation (the
            # deterministic JS engine already treats '*' as unconstrained).
            if "*" in targets:
                continue
            node = EX["shape_" + local(source_type) + "_" + local(rel_type)]
            prop = BNode()
            g.add((node, RDF.type, SH.NodeShape))
            g.add((node, SH.targetClass, CLS[local(source_type)]))
            g.add((node, SH.property, prop))
            g.add((prop, SH.path, REL[local(rel_type)]))
            g.add((prop, SH.message, Literal(f"{source_type} --{rel_type}--> must target {targets}")))
            alts = [BNode() for _ in targets]
            lst = BNode()
            Collection(g, lst, alts)
            g.add((prop, SH["or"], lst))
            for alt, target in zip(alts, targets):
                g.add((alt, SH["class"], CLS[local(target)]))
    return g


def run_shacl(data_graph, shapes_graph):
    from pyshacl import validate as shacl_validate

    conforms, results_graph, _ = shacl_validate(
        data_graph, shacl_graph=shapes_graph, inference="rdfs",
        abort_on_first=False, allow_infos=True, allow_warnings=True,
    )
    violations = []
    for result in results_graph.subjects(RDF.type, SH.ValidationResult):
        focus = results_graph.value(result, SH.focusNode)
        path = results_graph.value(result, SH.resultPath)
        message = results_graph.value(result, SH.resultMessage)
        violations.append({
            "focusNode": str(focus) if focus is not None else None,
            "path": str(path) if path is not None else None,
            "message": str(message) if message is not None else None,
        })
    return {"conforms": bool(conforms), "violations": violations}


def build_ontology_graph(data_graph, axioms, class_by_type):
    g = Graph()
    for triple in data_graph:
        g.add(triple)

    classes = set()
    properties = set()

    def prop_iri(name):
        properties.add(name)
        return REL[local(name)]

    for c1, c2 in axioms.get("disjointClasses", []):
        classes.add(type_class(class_by_type, c1))
        classes.add(type_class(class_by_type, c2))
        g.add((CLS[local(type_class(class_by_type, c1))], OWL.disjointWith, CLS[local(type_class(class_by_type, c2))]))
    for name in axioms.get("functionalProperties", []):
        g.add((prop_iri(name), RDF.type, OWL.FunctionalProperty))
    for name in axioms.get("transitiveProperties", []):
        g.add((prop_iri(name), RDF.type, OWL.TransitiveProperty))
    for name in axioms.get("irreflexiveProperties", []):
        g.add((prop_iri(name), RDF.type, OWL.IrreflexiveProperty))
    for name in axioms.get("asymmetricProperties", []):
        g.add((prop_iri(name), RDF.type, OWL.AsymmetricProperty))
    for name, c in axioms.get("objectPropertyDomain", {}).items():
        classes.add(type_class(class_by_type, c))
        g.add((prop_iri(name), RDFS.domain, CLS[local(type_class(class_by_type, c))]))
    for name, c in axioms.get("objectPropertyRange", {}).items():
        classes.add(type_class(class_by_type, c))
        g.add((prop_iri(name), RDFS.range, CLS[local(type_class(class_by_type, c))]))

    # declare the element types used in the data as owl:Class too
    for type_iri in set(data_graph.objects(None, RDF.type)):
        if isinstance(type_iri, URIRef):
            classes_iri = type_iri
            g.add((classes_iri, RDF.type, OWL.Class))
    for c in classes:
        g.add((CLS[local(c)], RDF.type, OWL.Class))
    for name in properties:
        g.add((REL[local(name)], RDF.type, OWL.ObjectProperty))

    if axioms.get("distinctIndividuals"):
        individuals = sorted(
            str(s) for s in set(data_graph.subjects(RDF.type, None))
            if isinstance(s, URIRef) and str(s).startswith(str(IDNS))
        )
        if len(individuals) > 1:
            all_diff = BNode()
            lst = BNode()
            g.add((all_diff, RDF.type, OWL.AllDifferent))
            Collection(g, lst, [URIRef(i) for i in individuals])
            g.add((all_diff, OWL.distinctMembers, lst))
    return g


def run_owl(ontology_graph):
    import owlready2

    tmp = tempfile.NamedTemporaryFile(suffix=".owl", delete=False)
    tmp.close()
    ontology_graph.serialize(destination=tmp.name, format="xml")
    world = owlready2.World()
    try:
        ontology = world.get_ontology("file://" + tmp.name).load()
        inconsistent = False
        inconsistent_classes = []
        try:
            with ontology:
                owlready2.sync_reasoner(world, infer_property_values=False)
        except owlready2.OwlReadyInconsistentOntologyError:
            inconsistent = True
            try:
                inconsistent_classes = [c.name for c in world.inconsistent_classes()]
            except Exception:  # noqa: BLE001 - best effort detail
                inconsistent_classes = []
        return {"consistent": not inconsistent, "inconsistentClasses": inconsistent_classes}
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def transitive_entailment(data_graph, axioms):
    """OWL transitive-property entailment: the closure of asserted edges.
    Reported as non-asserted derived edges (multi-hop implied knowledge)."""
    entailed = {}
    for prop in axioms.get("transitiveProperties", []):
        puri = REL[local(prop)]
        asserted = set(data_graph.subject_objects(puri))
        closure = set(asserted)
        changed = True
        while changed:
            changed = False
            for a, b in list(closure):
                for c, d in list(closure):
                    if b == c and (a, d) not in closure:
                        closure.add((a, d))
                        changed = True
        derived = sorted(
            [str(s).rsplit("/", 1)[-1], str(o).rsplit("/", 1)[-1]]
            for s, o in (closure - asserted)
        )
        entailed[prop] = derived
    return entailed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--graph", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    model = read_model(args.bundle)
    graph = load_json(args.graph, {})
    data_graph = build_data_graph(graph, model["classByType"])

    findings = {"shacl": None, "owl": None}
    try:
        findings["shacl"] = run_shacl(data_graph, build_shapes_graph(model["matrix"]))
    except Exception as error:  # noqa: BLE001
        findings["shacl"] = {"error": f"{type(error).__name__}: {error}"}
    try:
        findings["owl"] = run_owl(build_ontology_graph(data_graph, model["axioms"], model["classByType"]))
    except Exception as error:  # noqa: BLE001
        findings["owl"] = {"error": f"{type(error).__name__}: {error}"}
    if isinstance(findings["owl"], dict):
        findings["owl"].setdefault("entailed", transitive_entailment(data_graph, model["axioms"]))

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(findings, handle, indent=2)
    print(json.dumps(findings))


if __name__ == "__main__":
    main()
