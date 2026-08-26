# ArchGraph framework sandbox — tests the framework exactly as a user installs it
# (`npm install archgraph-argo` + `npx argo-deploy`), inside a disposable container
# fully isolated from the host. Everything deploys under the container HOME (/root);
# the host configuration (VS Code/Cursor/OpenCode/OpenClaw dirs) is never touched.
#
# Requirements: node (>=18, engines) + PowerShell Core (pwsh) — `npx argo-deploy`
# runs install-argo.ps1 via pwsh on non-Windows.
#
# Base image is configurable via --build-arg BASE_IMAGE. Default is the official
# node image; on restricted networks where the Docker registry is unreachable,
# pass a locally-available Debian base (e.g. python:3.13-slim-bookworm) and node
# is installed from the Debian apt repo (bookworm ships nodejs 18.x) instead.
ARG BASE_IMAGE=node:20-bookworm-slim
FROM ${BASE_IMAGE}

# Ensure node (+ npm) is present, then install pwsh prerequisites.
# - official node images already ship node, so the `node` branch is a no-op.
# - Debian bases (restricted networks) get nodejs/npm from the apt repo.
# Only libicu72 is required at runtime by the pwsh static tarball — keep the apt
# footprint tiny. The flaky deb.debian.org security repo may 502; tolerate update
# failures (`|| true`) and install from the main repo with --fix-missing.
RUN set -eux; \
    apt-get update -o Acquire::Retries=5 || true; \
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then \
      echo "node + npm already present"; \
    else \
      apt-get install -y --no-install-recommends -o Acquire::Retries=5 --fix-missing nodejs npm || true; \
    fi; \
    apt-get install -y --no-install-recommends -o Acquire::Retries=5 --fix-missing libicu72 ca-certificates || \
      apt-get install -y --no-install-recommends -o Acquire::Retries=10 libicu72 ca-certificates; \
    rm -rf /var/lib/apt/lists/*

# PowerShell Core (pwsh) — linux-x64 static tarball from github (reachable even
# when the Docker registry is not). Download with Node's built-in fetch so no
# curl/wget dependency is needed. Required by `npx argo-deploy` on Linux.
RUN node -e "fetch('https://github.com/PowerShell/PowerShell/releases/download/v7.4.5/powershell-7.4.5-linux-x64.tar.gz').then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.arrayBuffer()}).then(b=>require('fs').writeFileSync('/tmp/pwsh.tar.gz',Buffer.from(b))).then(()=>console.log('pwsh tarball downloaded'))"
RUN mkdir -p /opt/microsoft/powershell/7 \
    && tar zxf /tmp/pwsh.tar.gz -C /opt/microsoft/powershell/7 \
    && chmod +x /opt/microsoft/powershell/7/pwsh \
    && ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/pwsh \
    && pwsh --version \
    && node --version \
    && npm --version \
    && rm -f /tmp/pwsh.tar.gz

# OpenCode CLI (the agent harness that runs on top of the deployed ARGO MCP) —
# full-stack agent evaluation: OpenCode -> agent -> in-sandbox ARGO MCP.
RUN npm install -g opencode-ai@1.18.23 --no-audit --no-fund \
    && opencode --version

# install-argo.ps1 resolves harness dirs from $env:USERPROFILE — pin it to the
# container HOME so no host path can leak in.
ENV USERPROFILE=/root \
    NODE_ENV=production \
    ARGO_REPO_ROOT=/workspace

WORKDIR /opt/sandbox
COPY entrypoint.sh smoke.js ./
RUN chmod +x entrypoint.sh

ENTRYPOINT ["/opt/sandbox/entrypoint.sh"]
