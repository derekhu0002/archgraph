#!/bin/sh
# Full write-path e2e wrapper: install the vendored neo4j-driver the MCP needs,
# then run the harness. Runs in the isolated real-engine container; /repo and
# /env/argo.env are read-only mounts.
set -e
mkdir -p /root/.argo
npm install --no-save --no-audit --no-fund /repo/vendor/neo4j-driver-6.2.0.tgz --prefix /root/.argo >/dev/null 2>&1 || true
export NODE_PATH=/root/.argo/node_modules
node /repo/sandbox/ontology-projection/e2e-write-full.js
