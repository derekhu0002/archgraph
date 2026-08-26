#!/usr/bin/env bash
# End-to-end test of the ArchGraph framework AS A USER INSTALLS IT, inside an
# isolated container:
#
#   npm install archgraph-argo.tgz   (local tarball from `npm pack`, NO publish)
#   npx argo-deploy                  (deploy to container HOME only)
#   node smoke.js                    (verify deployed artifacts + MCP works)
#
# Everything happens under $HOME (/root); the host is never modified.
set -euo pipefail

TARBALL="${TARBALL:-/tarball/archgraph-argo.tgz}"
WORKSPACE="${ARGO_REPO_ROOT:-/workspace}"

export USERPROFILE="${USERPROFILE:-/root}"
export ARGO_REPO_ROOT="$WORKSPACE"
export NODE_ENV=production

# 干净空工作区——初始图谱由框架自身的 argo init（initializeWorkspace）生成，
# 绝不复制生产图（真实新用户不会拿到生产数据）。
echo "[sandbox] 1/3 准备干净空工作区（容器内，可随时丢弃；初始图谱由 argo init 生成）"
rm -rf "$WORKSPACE" /tmp/install
mkdir -p "$WORKSPACE" /tmp/install

echo "[sandbox] 2/3 模拟用户安装：npm install archgraph-argo.tgz（本地 tarball，无 publish）"
cd /tmp/install
npm init -y >/dev/null 2>&1
npm install --no-audit --no-fund "$TARBALL"

echo "[sandbox] 3/3 部署框架：npx argo-deploy（核心工具链；跳过 DSH/OpenClaw/交互式 .env）"
npx --no-install argo-deploy \
  -SkipDsh -SkipOpenClaw -SkipEnv \
  -ArgoRoot /root/.argo \
  -SkillsRoot /root/.copilot/skills \
  -PromptsRoot /root/prompts \
  -McpPath /root/mcp.json \
  -CursorSkillsRoot /root/.cursor/skills \
  -CursorMcpPath /root/.cursor/mcp.json \
  -OpenCodeSkillsRoot /root/.config/opencode/skills \
  -OpenCodeAgentsPath /root/.config/opencode/AGENTS.md \
  -OpenCodeConfigPath /root/.config/opencode/opencode.json \
  -CopilotAgentsRoot /root/.copilot/agents \
  -CursorAgentsRoot /root/.cursor/agents \
  -CursorRulesRoot /root/.cursor/rules \
  -OpenCodeAgentsRoot /root/.config/opencode/agents \
  -PluginsRoot /root/.argo/plugins

echo "[sandbox] smoke 验证已安装框架"
node /opt/sandbox/smoke.js
