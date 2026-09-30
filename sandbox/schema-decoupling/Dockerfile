# Docker verification environment for the schema/ontology decoupling
# (branch develop-separate-schema).
#
# Base image carries Node + the OpenCode runtime (opencode-ai). We deliberately
# do NOT deploy the branch on the host: everything runs inside this disposable
# container, fully isolated from the machine's existing ARGO framework.
#
# Build:  docker build -t archgraph-schema-verify sandbox/schema-decoupling
# Run:    docker run --rm -v "<repo>:/repo:ro" -v "<repo>/results:/results archgraph-schema-verify
ARG BASE_IMAGE=opencode-sandbox:1.18.29
FROM ${BASE_IMAGE}

ENV HOME=/root \
    USERPROFILE=/root \
    NODE_ENV=production \
    ARGO_REPO_ROOT=/ws-custom

WORKDIR /opt/verify
COPY verify.js verify-all.js /opt/verify/
ENTRYPOINT ["node", "/opt/verify/verify.js"]
