#!/bin/sh
# Real write-path acceptance wrapper: mirror the standard acceptance setup
# (copy repo subset to /work, deploy ~/.argo, install the vendored neo4j-driver)
# then run the write verification against the real runtime.
set -e
rm -rf /work /root/.argo
mkdir -p /work /root/.argo
( cd /repo && tar --exclude=argo/.env -cf - argo custom-schema vendor ) | ( cd /work && tar -xf - )
( cd /work/argo && tar -cf - . ) | ( cd /root/.argo && tar -xf - )
cp /repo/sandbox/ontology-projection/samples/functional-open/.argo/schema/ontology-axioms.json /work/custom-schema/.argo/schema/ontology-axioms.json
npm install --no-save --no-audit --no-fund /work/vendor/neo4j-driver-6.2.0.tgz --prefix /root/.argo >/dev/null 2>&1 || true
export NODE_PATH=/root/.argo/node_modules
node /repo/sandbox/ontology-projection/verify-write.js
