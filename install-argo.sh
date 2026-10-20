#!/usr/bin/env bash
#
# install-argo.sh — deploy the ArchGraph ARGO toolchain on Linux and WSL.
#
# `argo-deploy` runs this on every non-Windows platform (see bin/argo-deploy.js).
# It is the POSIX counterpart of install-argo.ps1: both drive the same installer,
# but this wrapper first resolves the Linux/WSL home + XDG base directories and
# then passes a COMPLETE, forward-slash set of path parameters.
#
# Why the wrapper exists: install-argo.ps1 defaults its destinations to Windows
# environment variables (%USERPROFILE%, %APPDATA%, %LOCALAPPDATA%) and some of its
# registrations join paths with a backslash. On Linux/WSL those variables are
# empty and a backslash is an ordinary character, so an un-parameterised run
# would deploy to "/.argo" and create file names such as
# "/root\.config\opencode\opencode.json". Supplying explicit forward-slash paths
# removes both failure modes without duplicating the installer's logic.
#
# Usage:
#   ./install-argo.sh [-SkipEnv] [-SkipDeps] [-SkipOntologyEngine] [-SkipDsh] \
#                     [-SkipOpenClaw] [-SkipDoubao] [-SkipCodex] [-EnableOntologyValidation]
#   Every flag install-argo.ps1 accepts is forwarded verbatim.
#   Override a destination through the environment (ARGO_ROOT, OPENCODE_CONFIG_PATH,
#   OPENCODE_SYSTEM_CONFIG_PATH, CURSOR_MCP_PATH, ...), never through a command-line
#   path flag, so this wrapper can always supply a full parameter set without
#   colliding with the caller. OPENCODE_SYSTEM_CONFIG_PATH is opt-in: leave it
#   empty (default) and no system-level managed config (/etc/opencode) is written.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PS1="$SCRIPT_DIR/install-argo.ps1"

if [ ! -f "$PS1" ]; then
  echo "install-argo.sh: cannot find install-argo.ps1 next to this script ($PS1)" >&2
  exit 1
fi

# --- resolve the Linux/WSL home and XDG base directories -------------------
HOME_DIR="${HOME:-}"
if [ -z "$HOME_DIR" ]; then
  HOME_DIR="$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6 || true)"
fi
HOME_DIR="${HOME_DIR:-/root}"
XDG_CONFIG="${XDG_CONFIG_HOME:-$HOME_DIR/.config}"
XDG_DATA="${XDG_DATA_HOME:-$HOME_DIR/.local/share}"

# Keep the Windows-named variables consistent with the POSIX home so any
# installer code that still consults them (rather than the explicit parameters)
# resolves under the real home instead of the filesystem root.
export HOME="$HOME_DIR"
export USERPROFILE="${USERPROFILE:-$HOME_DIR}"
export APPDATA="${APPDATA:-$XDG_CONFIG}"
export LOCALAPPDATA="${LOCALAPPDATA:-$XDG_DATA}"

# --- default destinations (override via environment) -----------------------
ARGO_ROOT="${ARGO_ROOT:-$HOME_DIR/.argo}"
SKILLS_ROOT="${SKILLS_ROOT:-$HOME_DIR/.copilot/skills}"
PROMPTS_ROOT="${PROMPTS_ROOT:-$XDG_CONFIG/Code/User/prompts}"
MCP_PATH="${MCP_PATH:-$XDG_CONFIG/Code/User/mcp.json}"
CURSOR_SKILLS_ROOT="${CURSOR_SKILLS_ROOT:-$HOME_DIR/.cursor/skills}"
CURSOR_MCP_PATH="${CURSOR_MCP_PATH:-$HOME_DIR/.cursor/mcp.json}"
CURSOR_MCP_BRIDGES_ROOT="${CURSOR_MCP_BRIDGES_ROOT:-$HOME_DIR/.cursor/mcp-bridges}"
CURSOR_AGENTS_ROOT="${CURSOR_AGENTS_ROOT:-$HOME_DIR/.cursor/agents}"
CURSOR_RULES_ROOT="${CURSOR_RULES_ROOT:-$HOME_DIR/.cursor/rules}"
OPENCODE_SKILLS_ROOT="${OPENCODE_SKILLS_ROOT:-$XDG_CONFIG/opencode/skills}"
OPENCODE_AGENTS_PATH="${OPENCODE_AGENTS_PATH:-$XDG_CONFIG/opencode/AGENTS.md}"
OPENCODE_AGENTS_ROOT="${OPENCODE_AGENTS_ROOT:-$XDG_CONFIG/opencode/agents}"
OPENCODE_CONFIG_PATH="${OPENCODE_CONFIG_PATH:-$XDG_CONFIG/opencode/opencode.json}"
# System-level managed config (OpenCode merges /etc/opencode on Linux/WSL).
# Opt-in on purpose: empty means "skip", so an ordinary deploy never writes /etc.
OPENCODE_SYSTEM_CONFIG_PATH="${OPENCODE_SYSTEM_CONFIG_PATH:-}"
COPILOT_AGENTS_ROOT="${COPILOT_AGENTS_ROOT:-$HOME_DIR/.copilot/agents}"
PLUGINS_ROOT="${PLUGINS_ROOT:-$ARGO_ROOT/plugins}"
DSH_HOME="${DSH_HOME:-$HOME_DIR/.dsh}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME_DIR/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
DOUBAO_HOME="${DOUBAO_HOME:-$HOME_DIR/Doubao}"
DOUBAO_WORKSPACE="${DOUBAO_WORKSPACE:-$XDG_DATA/Doubao/User Data/Default/.doubao/agent_mode/workspace}"
CODEX_HOME="${CODEX_HOME:-$HOME_DIR/.codex}"

# --- locate a PowerShell to execute install-argo.ps1 -----------------------
if command -v pwsh >/dev/null 2>&1; then
  POWERSHELL="pwsh"
elif command -v powershell >/dev/null 2>&1; then
  POWERSHELL="powershell"
else
  echo "install-argo.sh: PowerShell 7+ (pwsh) is required to run install-argo.ps1." >&2
  echo "  Install it, e.g.: sudo apt-get install -y powershell" >&2
  echo "  (https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-linux)" >&2
  exit 1
fi

# --- assemble the parameter set, skipping any the caller already supplied --
CALLER_ARGS=("$@")

provided() { # provided <flag>  -> true (0) when the caller already passed it
  local flag="$1" arg
  for arg in "${CALLER_ARGS[@]}"; do
    if [ "$arg" = "$flag" ]; then
      return 0
    fi
  done
  return 1
}

ARGS=()
add() { # add <flag> <value>
  if ! provided "$1"; then
    ARGS+=("$1" "$2")
  fi
}

add -ArgoRoot "$ARGO_ROOT"
add -SkillsRoot "$SKILLS_ROOT"
add -PromptsRoot "$PROMPTS_ROOT"
add -McpPath "$MCP_PATH"
add -CursorSkillsRoot "$CURSOR_SKILLS_ROOT"
add -CursorMcpPath "$CURSOR_MCP_PATH"
add -CursorMcpBridgesRoot "$CURSOR_MCP_BRIDGES_ROOT"
add -CursorAgentsRoot "$CURSOR_AGENTS_ROOT"
add -CursorRulesRoot "$CURSOR_RULES_ROOT"
add -OpenCodeSkillsRoot "$OPENCODE_SKILLS_ROOT"
add -OpenCodeAgentsPath "$OPENCODE_AGENTS_PATH"
add -OpenCodeAgentsRoot "$OPENCODE_AGENTS_ROOT"
add -OpenCodeConfigPath "$OPENCODE_CONFIG_PATH"
add -OpenCodeSystemConfigPath "$OPENCODE_SYSTEM_CONFIG_PATH"
add -CopilotAgentsRoot "$COPILOT_AGENTS_ROOT"
add -PluginsRoot "$PLUGINS_ROOT"
add -DshHome "$DSH_HOME"
add -OpenClawHome "$OPENCLAW_HOME"
add -OpenClawWorkspace "$OPENCLAW_WORKSPACE"
add -DoubaoHome "$DOUBAO_HOME"
add -DoubaoWorkspace "$DOUBAO_WORKSPACE"
add -CodexHome "$CODEX_HOME"

exec "$POWERSHELL" -NoProfile -ExecutionPolicy Bypass -File "$PS1" \
  "${ARGS[@]}" ${CALLER_ARGS[@]+"${CALLER_ARGS[@]}"}
