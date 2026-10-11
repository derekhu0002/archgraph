# Isolated Docker verification environment for the ontology-projection sidecar.
#
# Base image carries Node + the OpenCode runtime (opencode-ai). Nothing is
# deployed on the host; everything runs inside this disposable container, fully
# isolated from the host's ARGO framework and from the archgraph project itself.
#
# Build:  docker build -t archgraph-ontology-projection sandbox/ontology-projection
# Run:    docker run --rm -v "<repo>:/repo:ro" -v "<repo>/results:/results" archgraph-ontology-projection

ARG BASE_IMAGE=opencode-sandbox:1.18.29
FROM ${BASE_IMAGE}

ENV HOME=/root \
    USERPROFILE=/root \
    NODE_ENV=production \
    TEST_PROJECT=/test-project

WORKDIR /opt/ontology-projection
COPY lib lib
COPY samples samples
COPY tests tests
COPY run.js run.js

ENTRYPOINT ["node", "/opt/ontology-projection/run.js"]
