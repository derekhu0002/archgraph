#!/bin/sh
# End-to-end proof that the framework's INIT validation timing runs the REAL
# ontology engine through the generic, opt-in extension point. Runs in the
# isolated container against a throwaway workspace; archgraph is read-only (/repo).
set -e

CLI=/repo/argo/scripts/ontology-projection/cli.js
EXT='[{"name":"ontology","timings":["write","init"],"command":["node","'"$CLI"'","--workspace","{workspaceRoot}","--graph","{graphPath}","--mode","{mode}"]}]'
export ARGO_VALIDATION_EXTENSIONS="$EXT"

run_case() {
  NAME="$1"; GRAPH="$2"
  WS="/ws-$NAME"
  rm -rf "$WS"; mkdir -p "$WS/design/KG"
  cp -r /opt/ontology-projection/samples/team-graph/.argo "$WS/.argo"
  cp "/opt/ontology-projection/samples/team-graph/graphs/$GRAPH" "$WS/design/KG/SystemArchitecture.json"
  export ARGO_REPO_ROOT="$WS"
  echo "=== case: $NAME (graph=$GRAPH) ==="
  if node /repo/argo/scripts/validateSystemArchitecture.js; then
    echo "RESULT[$NAME]=passed"
  else
    echo "RESULT[$NAME]=failed (exit $?)"
  fi
}

run_case valid valid.json
run_case axiom-contradiction axiom-contradiction.json

echo "=== default-off control (no extension env) ==="
unset ARGO_VALIDATION_EXTENSIONS
WS=/ws-off; rm -rf "$WS"; mkdir -p "$WS/design/KG"
cp -r /opt/ontology-projection/samples/team-graph/.argo "$WS/.argo"
cp /opt/ontology-projection/samples/team-graph/graphs/axiom-contradiction.json "$WS/design/KG/SystemArchitecture.json"
export ARGO_REPO_ROOT="$WS"
if node /repo/argo/scripts/validateSystemArchitecture.js; then echo "RESULT[off]=passed"; else echo "RESULT[off]=failed (exit $?)"; fi
