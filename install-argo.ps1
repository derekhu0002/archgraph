#Requires -Version 5.1
param(
    [string]$ArgoRoot = "$env:USERPROFILE\.argo",
    [string]$SkillsRoot = "$env:USERPROFILE\.copilot\skills",
    [string]$PromptsRoot = "$env:APPDATA\Code\User\prompts",
    [string]$CursorSkillsRoot = "$env:USERPROFILE\.cursor\skills",
    [string]$CursorMcpPath = "$env:USERPROFILE\.cursor\mcp.json",
    [string]$OpenCodeSkillsRoot = "$env:USERPROFILE\.config\opencode\skills",
    [string]$OpenCodeAgentsPath = "$env:USERPROFILE\.config\opencode\AGENTS.md",
    [string]$OpenCodeConfigPath = "$env:USERPROFILE\.config\opencode\opencode.json",
    [string]$CopilotAgentsRoot = "$env:USERPROFILE\.copilot\agents",
    [string]$CursorAgentsRoot = "$env:USERPROFILE\.cursor\agents",
    [string]$CursorRulesRoot = "$env:USERPROFILE\.cursor\rules",
    [string]$OpenCodeAgentsRoot = "$env:USERPROFILE\.config\opencode\agents",
    [string]$PluginsRoot = "$env:USERPROFILE\.argo\plugins",
    [switch]$SkipEnv,
    [switch]$SkipDeps,
    [switch]$SkipMcp,
    [switch]$SkipDsh,
    [string]$DshHome = "$env:USERPROFILE\.dsh",
    [string]$DshCwd = '',
    [string]$DshWorkspaces = '',
    [string]$OpenClawHome = "$env:USERPROFILE\.openclaw",
    [string]$OpenClawWorkspace = "$env:USERPROFILE\.openclaw\workspace",
    [string]$OpenClawRepoRoot = '',
    [switch]$SkipOpenClaw,
    [string]$McpPath,
    [string]$GraphMcpUrl = 'https://argo.derekworkspacev5.com/mcp'
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$argoDir = Join-Path $repoRoot 'argo'

function Copy-Tree {
    param([string]$Source, [string]$Destination)
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item -Recurse -Force -Path (Join-Path $Source '*') -Destination $Destination
}

function Copy-Agents {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$Target
    )
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    $files = @(Get-ChildItem -Path (Join-Path $Source '*.agent.md') -ErrorAction SilentlyContinue)
    foreach ($file in $files) {
        if (-not $Target) {
            # Copilot: VS Code format, keep the .agent.md extension verbatim.
            Copy-Item -Force -Path $file.FullName -Destination (Join-Path $Destination $file.Name)
            continue
        }
        $targetName = ($file.BaseName -replace '\.agent$', '') + '.md'
        Convert-AgentFile -SourceFile $file.FullName -DestinationFile (Join-Path $Destination $targetName) -Target $Target
    }
}

function Convert-AgentFile {
    param(
        [string]$SourceFile,
        [string]$DestinationFile,
        [string]$Target
    )
    $content = Get-Content $SourceFile -Raw -Encoding UTF8
    $m = [regex]::Match($content, '(?s)^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)$')
    if (-not $m.Success) {
        Copy-Item -Force -Path $SourceFile -Destination $DestinationFile
        return
    }
    $front = $m.Groups[1].Value
    $body = $m.Groups[2].Value

    $name = ''
    $desc = ''
    $model = ''
    $nm = [regex]::Match($front, '(?m)^name:\s*(.*)$')
    if ($nm.Success) { $name = $nm.Groups[1].Value.Trim().Trim('"').Trim("'") }
    $dm = [regex]::Match($front, '(?m)^description:\s*(.*)$')
    if ($dm.Success) { $desc = $dm.Groups[1].Value.Trim().Trim('"').Trim("'") }
    $mm = [regex]::Match($front, '(?m)^model:\s*(.*)$')
    if ($mm.Success) { $model = $mm.Groups[1].Value.Trim().Trim('"').Trim("'") }

    if ($Target -eq 'opencode') {
        # OpenCode markdown agent: description is required; mode: all keeps it
        # usable as primary and subagent. Keep model so each agent pins its
        # required model; drop VS Code-only fields (tools array, user-invocable,
        # argument-hint) which OpenCode rejects.
        $newFront = "---`r`n"
        if ($desc) { $newFront += "description: `"$($desc -replace '"','\"')`"`r`n" }
        if ($model) { $newFront += "model: `"$model`"`r`n" }
        $newFront += "mode: all`r`n---`r`n"
    } else {
        # Cursor markdown agent: name + description + model; drop VS Code-only fields.
        $newFront = "---`r`n"
        if ($name) { $newFront += "name: `"$name`"`r`n" }
        if ($desc) { $newFront += "description: `"$($desc -replace '"','\"')`"`r`n" }
        if ($model) { $newFront += "model: `"$model`"`r`n" }
        $newFront += "---`r`n"
    }

    $result = $newFront + "`r`n" + $body
    [System.IO.File]::WriteAllText($DestinationFile, $result, (New-Object System.Text.UTF8Encoding $false))
}

function Convert-RuleFile {
    param(
        [string]$SourceFile,
        [string]$DestinationFile
    )
    $content = Get-Content $SourceFile -Raw -Encoding UTF8
    $m = [regex]::Match($content, '(?s)^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)$')
    if (-not $m.Success) {
        Copy-Item -Force -Path $SourceFile -Destination $DestinationFile
        return
    }
    $front = $m.Groups[1].Value
    $body = $m.Groups[2].Value

    $desc = ''
    $dm = [regex]::Match($front, '(?m)^description:\s*(.*)$')
    if ($dm.Success) { $desc = $dm.Groups[1].Value.Trim().Trim('"').Trim("'") }

    # Cursor .mdc rule: description + alwaysApply so it is injected into every
    # request. The rule body (WakeupGuideline + CoreRules + ...) is kept verbatim.
    $newFront = "---`r`n"
    if ($desc) { $newFront += "description: `"$($desc -replace '"','\"')`"`r`n" }
    $newFront += "alwaysApply: true`r`n---`r`n"

    $result = $newFront + "`r`n" + $body
    [System.IO.File]::WriteAllText($DestinationFile, $result, (New-Object System.Text.UTF8Encoding $false))
}

function Write-McpConfig {
    param(
        [string]$Path,
        [string]$ServersKey,
        $ServerConfig,
        [System.Collections.IDictionary]$ExtraServers = $null
    )

    $root = [ordered]@{}
    if (Test-Path $Path) {
        try {
            $existing = Get-Content $Path -Raw | ConvertFrom-Json
            foreach ($p in $existing.PSObject.Properties) {
                $root[$p.Name] = $p.Value
            }
        } catch {
            # Ignore an unparseable existing file and start fresh.
        }
    }

    $servers = [ordered]@{}
    if ($root.Contains($ServersKey)) {
        $serversValue = $root[$ServersKey]
        if ($null -ne $serversValue) {
            foreach ($p in $serversValue.PSObject.Properties) {
                $servers[$p.Name] = $p.Value
            }
        }
    }
    $servers['argo'] = $ServerConfig
    if ($null -ne $ExtraServers) {
        foreach ($name in $ExtraServers.Keys) {
            $servers[$name] = $ExtraServers[$name]
        }
    }
    $root[$ServersKey] = $servers

    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    $json = $root | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding $false))
}

function Register-OpenCodePlugin {
    param(
        [string]$ConfigPath,
        [string]$PluginFilePath
    )

    $root = [ordered]@{}
    if (Test-Path $ConfigPath) {
        try {
            $existing = Get-Content $ConfigPath -Raw | ConvertFrom-Json
            foreach ($p in $existing.PSObject.Properties) {
                $root[$p.Name] = $p.Value
            }
        } catch {
            # Ignore an unparseable existing file and start fresh.
        }
    }

    $url = 'file:///' + (($PluginFilePath -replace '\\', '/').TrimStart('/'))
    $plugins = @()
    if ($root.Contains('plugin') -and $null -ne $root['plugin']) {
        $plugins = @($root['plugin'])
    }
    if ($plugins -notcontains $url) {
        $plugins += $url
    }
    $root['plugin'] = $plugins

    New-Item -ItemType Directory -Force -Path (Split-Path $ConfigPath) | Out-Null
    $json = $root | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding $false))
}

function Add-AgentsRule {
    param(
        [string]$AgentsPath,
        [string]$RulePath
    )

    New-Item -ItemType Directory -Force -Path (Split-Path $AgentsPath) | Out-Null
    $ruleContent = Get-Content $RulePath -Raw -Encoding UTF8
    $marker = 'ArchGraph ARGO Workflow Rules'

    if (Test-Path $AgentsPath) {
        $existing = Get-Content $AgentsPath -Raw -Encoding UTF8
        if ($existing -like "*$marker*") {
            # An existing ArchGraph rules block is present. Replace it with the
            # current rule content while preserving any unrelated content that
            # surrounds it (e.g. user-authored OpenCode instructions).
            $endTag = '</ToolsGuideline>'
            $markerIdx = $existing.IndexOf($marker)
            if ($markerIdx -lt 0) { $markerIdx = 0 }
            $startIdx = $existing.LastIndexOf('---', $markerIdx)
            if ($startIdx -lt 0) { $startIdx = 0 }
            $endIdx = $existing.IndexOf($endTag, $markerIdx)

            $before = $existing.Substring(0, $startIdx).TrimEnd()
            if ($endIdx -lt 0) {
                $combined = $ruleContent
            } else {
                $after = $existing.Substring($endIdx + $endTag.Length)
                $combined = $before
                if ($combined.Length -gt 0) { $combined += "`n`n" }
                $combined += $ruleContent
                if ($after.Length -gt 0) { $combined += $after }
            }
            [System.IO.File]::WriteAllText($AgentsPath, $combined, (New-Object System.Text.UTF8Encoding $false))
            return
        }
        $combined = $existing.TrimEnd() + "`n`n" + $ruleContent
        [System.IO.File]::WriteAllText($AgentsPath, $combined, (New-Object System.Text.UTF8Encoding $false))
    } else {
        [System.IO.File]::WriteAllText($AgentsPath, $ruleContent, (New-Object System.Text.UTF8Encoding $false))
    }
}

# ---- DeepSeek Harness (dsh) conversion helpers ----
# The ArchGraph repository keeps ONE source file per artifact (rule / skill /
# mcp / plugin / agent). The targets below convert that single source into the
# DeepSeek Harness shape at deploy time, exactly like Convert-AgentFile and
# Convert-RuleFile do for Cursor / OpenCode.

function Get-MarkdownBody {
    # Strip a leading YAML frontmatter block (--- ... ---) from markdown text.
    # DeepSeek Harness injects AGENTS.md-style instruction files verbatim, so
    # the frontmatter must not reach the model prompt.
    param([string]$Content)
    $m = [regex]::Match($Content, '(?s)^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)$')
    if (-not $m.Success) { return $Content }
    return $m.Groups[2].Value
}

function Get-WakeupGuideline {
    # Extract the <WakeupGuideline>...</WakeupGuideline> block from the rule
    # text, so the DSH wakeup plugin is generated from the same source the
    # Copilot / Cursor / OpenCode rules use.
    param([string]$RuleText)
    $m = [regex]::Match($RuleText, '(?s)<WakeupGuideline>(.*?)</WakeupGuideline>')
    if (-not $m.Success) { return '' }
    return $m.Groups[1].Value.Trim()
}

function Write-ArchGraphRuleBlock {
    # Merge the frontmatter-stripped ArchGraph rule into a target AGENTS.md
    # file (DSH home or OpenClaw workspace), replacing the previous ArchGraph
    # block while preserving surrounding user content. The rule body is
    # injected verbatim - no adapter prose - so the working prompt stays
    # identical to the Copilot / Cursor / OpenCode rules.
    param(
        [string]$DestPath,
        [string]$RuleText,
        [string]$Label
    )
    $ruleContent = Get-MarkdownBody -Content $RuleText
    $marker = '<WakeupGuideline>'
    New-Item -ItemType Directory -Force -Path (Split-Path $DestPath) | Out-Null
    if (Test-Path $DestPath) {
        $existing = Get-Content $DestPath -Raw -Encoding UTF8
        if ($existing -like "*$marker*") {
            $endTag = '</ToolsGuideline>'
            $startIdx = $existing.IndexOf($marker)
            if ($startIdx -lt 0) { $startIdx = 0 }
            $endIdx = $existing.IndexOf($endTag, $startIdx)
            $before = $existing.Substring(0, $startIdx).TrimEnd()
            $after = ''
            if ($endIdx -ge 0) { $after = $existing.Substring($endIdx + $endTag.Length).TrimStart() }
            $combined = $before
            if ($combined.Length -gt 0) { $combined += "`n`n" }
            $combined += $ruleContent
            if ($after.Length -gt 0) { $combined += "`n`n" + $after }
            [System.IO.File]::WriteAllText($DestPath, $combined, (New-Object System.Text.UTF8Encoding $false))
        } else {
            $combined = $existing.TrimEnd() + "`n`n" + $ruleContent
            [System.IO.File]::WriteAllText($DestPath, $combined, (New-Object System.Text.UTF8Encoding $false))
        }
    } else {
        [System.IO.File]::WriteAllText($DestPath, $ruleContent, (New-Object System.Text.UTF8Encoding $false))
    }
    Write-Host "  $Label installed -> $DestPath"
}

function Write-DshAgentRule {
    # Merge the frontmatter-stripped ArchGraph rule into ~/.dsh/AGENTS.md
    # (DeepSeek Harness user-global rule), replacing the previous ArchGraph
    # block while preserving surrounding user content.
    param(
        [string]$DshHome,
        [string]$RuleText
    )
    Write-ArchGraphRuleBlock -DestPath (Join-Path $DshHome 'AGENTS.md') -RuleText $RuleText -Label 'DSH rule'
}

function Write-OpenClawAgentRule {
    # Deploy the ArchGraph rules into the OpenClaw agent workspace AGENTS.md.
    # OpenClaw injects AGENTS.md into Project Context on every session (the
    # same mechanism as the DSH / OpenCode AGENTS.md rules), so the
    # UNCONDITIONAL STARTUP GATE is always active for OpenClaw agents.
    param(
        [string]$OpenClawWorkspace,
        [string]$RuleText
    )
    Write-ArchGraphRuleBlock -DestPath (Join-Path $OpenClawWorkspace 'AGENTS.md') -RuleText $RuleText -Label 'OpenClaw rule'
}

function Write-OpenClawMcpConfig {
    # Register the argo MCP server under mcp.servers.argo in
    # ~/.openclaw/openclaw.json. OpenClaw is a fixed-workspace host: its
    # embedded MCP client does not advertise MCP roots, so the workspace is
    # pinned explicitly via env.ARGO_REPO_ROOT to the repository root this
    # installer runs from. Only a real ArchGraph workspace (one that contains
    # design/KG/SystemArchitecture.json) is pinned; when the installer runs
    # from a non-workspace location (e.g. the npm-global archgraph-argo package
    # dir via `argo-deploy`), an existing ARGO_REPO_ROOT is preserved instead
    # of being clobbered, and a missing one is left unpinned with a hint.
    # Existing config keys are preserved; a JSON5 (non strict JSON) config is
    # left untouched with a manual-registration hint.
    param(
        [string]$OpenClawHome,
        [string]$RepoRoot,
        [string]$ArgoServer,
        $GraphMcpServer
    )
    $configPath = Join-Path $OpenClawHome 'openclaw.json'
    $root = [ordered]@{}
    $existingArgoRoot = ''
    if (Test-Path $configPath) {
        try {
            $existing = Get-Content $configPath -Raw | ConvertFrom-Json
            foreach ($p in $existing.PSObject.Properties) {
                $root[$p.Name] = $p.Value
            }
            # Capture any previously pinned ARGO_REPO_ROOT so a non-workspace
            # refresh (e.g. npm-global argo-deploy) cannot clobber a correct pin.
            if ($null -ne $existing.mcp -and $null -ne $existing.mcp.servers `
                -and $null -ne $existing.mcp.servers.argo -and $null -ne $existing.mcp.servers.argo.env `
                -and $null -ne $existing.mcp.servers.argo.env.ARGO_REPO_ROOT) {
                $existingArgoRoot = [string]$existing.mcp.servers.argo.env.ARGO_REPO_ROOT
            }
        } catch {
            Write-Warning "  $configPath is not strict JSON (JSON5 with comments?); skipping argo MCP registration."
            Write-Warning "  Register manually: openclaw mcp add argo --command node --arg `"$ArgoServer`" --env ARGO_REPO_ROOT=$RepoRoot"
            return
        }
    }
    $repoIsWorkspace = Test-Path (Join-Path $RepoRoot 'design\KG\SystemArchitecture.json')
    # Only preserve an existing ARGO_REPO_ROOT that is itself a real ArchGraph
    # workspace. A stale value from a previous non-workspace install (e.g. the
    # npm-global archgraph-argo package dir) must NOT be preserved, otherwise
    # OpenClaw keeps resolving the wrong Neo4j database (basename-derived).
    $existingIsWorkspace = $false
    if ($existingArgoRoot) {
        $existingIsWorkspace = Test-Path (Join-Path $existingArgoRoot 'design\KG\SystemArchitecture.json')
    }
    $envBlock = [ordered]@{}
    if ($repoIsWorkspace) {
        $envBlock.ARGO_REPO_ROOT = $RepoRoot
    } elseif ($existingIsWorkspace) {
        $envBlock.ARGO_REPO_ROOT = $existingArgoRoot
        Write-Host "  $RepoRoot is not an ArchGraph workspace; preserving existing ARGO_REPO_ROOT=$existingArgoRoot"
    } else {
        if ($existingArgoRoot) {
            Write-Warning "  Cleared stale non-workspace ARGO_REPO_ROOT=$existingArgoRoot from the OpenClaw MCP config."
        }
        Write-Warning "  $RepoRoot is not an ArchGraph workspace; not pinning ARGO_REPO_ROOT for OpenClaw."
        Write-Warning "  Run install-argo.ps1 from the repository you want OpenClaw to serve, or set mcp.servers.argo.env.ARGO_REPO_ROOT manually (e.g. -OpenClawRepoRoot <repo>)."
    }
    $mcp = [ordered]@{}
    if ($root.Contains('mcp') -and $null -ne $root['mcp']) {
        foreach ($p in $root['mcp'].PSObject.Properties) { $mcp[$p.Name] = $p.Value }
    }
    $servers = [ordered]@{}
    if ($mcp.Contains('servers') -and $null -ne $mcp['servers']) {
        foreach ($p in $mcp['servers'].PSObject.Properties) { $servers[$p.Name] = $p.Value }
    }
    $argoServerObj = [ordered]@{
        command = 'node'
        args    = @($ArgoServer)
    }
    if ($envBlock.Count -gt 0) {
        $argoServerObj.env = $envBlock
    }
    $servers['argo'] = $argoServerObj
    if ($null -ne $GraphMcpServer) {
        $servers['graph-mcp'] = $GraphMcpServer
    }
    $mcp['servers'] = $servers
    $root['mcp'] = $mcp
    New-Item -ItemType Directory -Force -Path $OpenClawHome | Out-Null
    $json = $root | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($configPath, $json, (New-Object System.Text.UTF8Encoding $false))
}

function Write-DshManagedBlock {
    # Text-level upsert of a marker-delimited block into a file (used for the
    # managed rows in ~/.dsh/cordis.patch.yml): replaces the previous managed
    # block and preserves surrounding content. No YAML dependency needed.
    param(
        [string]$Path,
        [string]$Block,
        [string]$MarkerStart,
        [string]$MarkerEnd
    )
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    $existing = if (Test-Path $Path) { Get-Content $Path -Raw -Encoding UTF8 } else { '' }
    $startIdx = $existing.IndexOf($MarkerStart)
    $endIdx = if ($startIdx -ge 0) { $existing.IndexOf($MarkerEnd, $startIdx) } else { -1 }
    if ($startIdx -ge 0 -and $endIdx -ge 0) {
        $endIdx += $MarkerEnd.Length
        $combined = $existing.Substring(0, $startIdx).TrimEnd()
        if ($combined.Length -gt 0) { $combined += "`n`n" }
        $combined += $Block
        $after = $existing.Substring($endIdx).TrimStart()
        if ($after.Length -gt 0) { $combined += "`n`n" + $after }
        [System.IO.File]::WriteAllText($Path, $combined, (New-Object System.Text.UTF8Encoding $false))
    } else {
        $combined = $existing.TrimEnd()
        if ($combined.Length -gt 0) { $combined += "`n`n" }
        $combined += $Block + "`n"
        [System.IO.File]::WriteAllText($Path, $combined, (New-Object System.Text.UTF8Encoding $false))
    }
}

function New-DshWakeupPlugin {
    # Generate the DSH wakeup-gate Cordis plugin under ~/.dsh/plugins from the
    # <WakeupGuideline> block of the rule file. This is the DeepSeek Harness
    # equivalent of the OpenCode hook plugin argo/plugins/argo-wakeup.js: it
    # registers the gate as the first system-prompt section after the harness
    # identity (order -100), before the deployment persona (order 0).
    param(
        [string]$DshHome,
        [string]$RuleText
    )
    $gate = Get-WakeupGuideline -RuleText $RuleText
    if (-not $gate) {
        Write-Warning '  <WakeupGuideline> not found in the rule file; DSH wakeup plugin skipped.'
        return $null
    }
    $dir = Join-Path (Join-Path $DshHome 'plugins') 'dsh-argo-wakeup'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $gateJson = $gate | ConvertTo-Json
    $plugin = @"
// dsh-argo-wakeup - generated by install-argo.ps1 from
// argo/rules/archgraph.instructions.md (single source of truth: the rule file;
// this file is a deployment artifact, do not edit by hand).
// DeepSeek Harness equivalent of the OpenCode hook argo/plugins/argo-wakeup.js:
// registers the unconditional wakeup gate as the first system-prompt section
// after the harness identity, so every session identifies its Business Actor
// through the argo MCP server before responding.
export const name = 'dsh-argo-wakeup'
export const inject = ['systemPrompt']
const WAKEUP_GATE = $gateJson
export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'argo:wakeup',
    order: -90,
    text: WAKEUP_GATE,
  }), 'argo:wakeup.section()')
}
"@
    $indexPath = Join-Path $dir 'index.js'
    [System.IO.File]::WriteAllText($indexPath, $plugin, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  DSH wakeup plugin generated -> $indexPath"
    return $indexPath
}

function New-DshWorkspaceBridge {
    # Generate the DSH workspace bridge plugin under ~/.dsh/plugins. It
    # connects directly to the argo MCP server (no dsh-mcp-client row needed)
    # with a zero-dependency minimal MCP stdio client, registers every tool as
    # mcp__argo__* and injects the current session's workspace directory
    # (SessionHeader.cwd) as the per-call `workspaceRoot`, so ONE dsh instance
    # follows whichever workspace the user switched to - no model-visible
    # parameters, no internal tool names, no restart. The argo server honors
    # the injected workspaceRoot unconditionally.
    param(
        [string]$DshHome
    )
    $dir = Join-Path (Join-Path $DshHome 'plugins') 'dsh-argo-workspace'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $plugin = @'
// dsh-argo-workspace - generated by install-argo.ps1 (single source of truth:
// the installer; this file is a deployment artifact, do not edit by hand).
//
// Direct MCP bridge to the argo server for DeepSeek Harness. Registers every
// argo tool as mcp__argo__* and injects the current session's workspace
// directory (SessionHeader.cwd) as the per-call `workspaceRoot` argument, so
// one dsh instance follows whichever workspace the user switched to - the
// model sees no extra parameters and no internal tool names. The argo server
// honors the injected workspaceRoot unconditionally.
//
// Zero dependencies on purpose: implements the minimal MCP stdio client
// (JSON-RPC 2.0, one JSON object per line) with Node built-ins only, so the
// plugin runs from any DSH layout without resolving @modelcontextprotocol/sdk.
import { spawn } from 'node:child_process'
import readline from 'node:readline'

export const name = 'dsh-argo-workspace'
export const inject = ['tools']

/** Minimal MCP stdio client over the argo server process. */
function createArgoClient(serverPath, env, cwd) {
  const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    ...(cwd ? { cwd } : {}),
  })
  const pending = new Map()
  let nextId = 1
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message && typeof message.id === 'number' && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    }
  })
  child.stderr.on('data', () => {}) // drain; the argo server logs to stderr
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  return {
    request,
    notify: (method, params) => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
    },
    close: () => child.kill(),
  }
}

/** Connect, list tools, register them, and keep the client until disposal. */
export async function apply(ctx, config) {
  const serverPath = config.serverPath
  const workspaces = Array.isArray(config.workspaces) ? config.workspaces : []
  const env = { ...process.env }
  if (workspaces.length > 0) env.ARGO_WORKSPACE_ROOTS = workspaces.join(';')
  const client = createArgoClient(serverPath, env, config.cwd)
  ctx.effect(() => () => client.close(), 'dsh-argo-workspace.dispose()')

  let tools = []
  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dsh-argo-workspace', version: '0.1.0' },
    })
    client.notify('notifications/initialized', {})
    const listed = await client.request('tools/list', {})
    tools = (listed && Array.isArray(listed.tools)) ? listed.tools : []
  } catch (error) {
    console.warn(`[dsh-argo-workspace] failed to connect to the argo MCP server (${serverPath}): ${error && error.message ? error.message : error}`)
    return
  }

  const disposers = []
  for (const tool of tools) {
    const publicName = 'mcp__argo__' + tool.name
    disposers.push(ctx.tools.register({
      name: publicName,
      description: tool.description ?? '',
      parameters: tool.inputSchema,
      output: {
        schema: {
          type: 'object',
          properties: {
            content: { type: 'array', items: {} },
            structuredContent: {},
          },
          required: ['content'],
          additionalProperties: false,
        },
        render: (_args, value) => value.content,
      },
      execute: async (args, exec) => {
        // SessionHeader.cwd (the durable session workspace), NOT
        // requestHeader() — that returns the request EpochHeader
        // (config/system/tools) which has no cwd field.
        const sessionCwd = exec && exec.agent && exec.agent.session
          ? exec.agent.session.header?.cwd
          : undefined
        const injected = { ...(args && typeof args === 'object' ? args : {}) }
        if (typeof sessionCwd === 'string' && sessionCwd !== '') {
          injected.workspaceRoot = sessionCwd
        }
        if (exec && exec.signal && exec.signal.aborted) {
          throw new Error('aborted')
        }
        const result = await client.request('tools/call', {
          name: tool.name,
          arguments: injected,
        })
        const text = Array.isArray(result.content)
          ? result.content
              .map((block) => block && block.type === 'text' && typeof block.text === 'string'
                ? block.text
                : JSON.stringify(block))
              .join('\n')
          : (result.toolResult !== undefined ? JSON.stringify(result.toolResult) : '(no output)')
        if (result.isError === true) throw new Error(text)
        return {
          content: [{ type: 'text', text }],
          ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
        }
      },
    }))
  }
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'dsh-argo-workspace.tools')
}
'@
    $indexPath = Join-Path $dir 'index.js'
    [System.IO.File]::WriteAllText($indexPath, $plugin, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  DSH workspace bridge generated -> $indexPath"
    return $indexPath
}

function New-DshAgentPresets {
    # Generate DSH agent presets under ~/.dsh/.agent-presets/<id>/ from
    # argo/agents/*.agent.md (the same single source the Copilot / Cursor /
    # OpenCode agent files are converted from). persona.md is a
    # frontmatter-stripped copy of the agent body; persona.js is a fixed
    # self-contained row that mounts it as the session persona
    # (deployment:persona section, order 0).
    param(
        [string]$DshHome,
        [string]$AgentsSrc
    )
    $files = @(Get-ChildItem -Path (Join-Path $AgentsSrc '*.agent.md') -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) {
        Write-Warning '  no *.agent.md files found; DSH agent presets skipped.'
        return
    }
    foreach ($file in $files) {
        $content = Get-Content $file.FullName -Raw -Encoding UTF8
        $m = [regex]::Match($content, '(?s)^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)$')
        $name = ''
        $desc = ''
        $body = $content
        if ($m.Success) {
            $front = $m.Groups[1].Value
            $body = $m.Groups[2].Value.TrimStart("`r", "`n")
            $nm = [regex]::Match($front, '(?m)^name:\s*(.*)$')
            if ($nm.Success) { $name = $nm.Groups[1].Value.Trim().Trim('"').Trim("'") }
            $dm = [regex]::Match($front, '(?m)^description:\s*(.*)$')
            if ($dm.Success) { $desc = $dm.Groups[1].Value.Trim().Trim('"').Trim("'") }
        }
        $id = $file.BaseName -replace '\.agent$', ''
        if (-not $name) { $name = $id }
        $dir = Join-Path (Join-Path $DshHome '.agent-presets') $id
        New-Item -ItemType Directory -Force -Path $dir | Out-Null

        # preset.yml: display metadata (name + description).
        $presetYml = "name: $name`n"
        if ($desc) { $presetYml += "description: `"$($desc -replace '"', '\"')`"`n" }
        [System.IO.File]::WriteAllText((Join-Path $dir 'preset.yml'), $presetYml, (New-Object System.Text.UTF8Encoding $false))

        # persona.md: the agent body verbatim (single source: the .agent.md file).
        [System.IO.File]::WriteAllText((Join-Path $dir 'persona.md'), $body, (New-Object System.Text.UTF8Encoding $false))

        # agent.cordis.yml: mount the local persona row.
        $cordisYml = @"
# ArchGraph agent preset "$name" - generated by install-argo.ps1 from
# argo/agents/$($file.Name) (single source of truth; this file is a deployment
# artifact, do not edit by hand). The persona is the frontmatter-stripped agent
# body (persona.md), mounted as the session's deployment:persona section.
- id: persona
  name: './persona.js'
"@
        [System.IO.File]::WriteAllText((Join-Path $dir 'agent.cordis.yml'), $cordisYml, (New-Object System.Text.UTF8Encoding $false))

        # persona.js: fixed row implementation.
        $personaJs = @'
// persona row for an ArchGraph agent preset (generated by install-argo.ps1).
// Loads persona.md next to this file and registers it as the
// deployment:persona system-prompt section (order 0), shadowing the
// deployment persona for the session that mounts this preset.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export const name = 'persona'
export const inject = ['systemPrompt']
export function apply(ctx) {
  const text = readFileSync(fileURLToPath(new URL('./persona.md', import.meta.url)), 'utf8')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'deployment:persona',
    order: 0,
    text,
  }), 'persona.section()')
}
'@
        [System.IO.File]::WriteAllText((Join-Path $dir 'persona.js'), $personaJs, (New-Object System.Text.UTF8Encoding $false))
        Write-Host "  DSH agent preset generated -> $dir"
    }
}

Write-Host '==> Deploying Argo toolchain'

$schemaSrc = Join-Path $argoDir 'schema'
$schemaDest = Join-Path $ArgoRoot 'schema'
Write-Host "[1/22] argo\schema -> $schemaDest"
Copy-Tree -Source $schemaSrc -Destination $schemaDest

$scriptsSrc = Join-Path $argoDir 'scripts'
$scriptsDest = Join-Path $ArgoRoot 'scripts'
Write-Host "[2/22] argo\scripts -> $scriptsDest"
Copy-Tree -Source $scriptsSrc -Destination $scriptsDest

$defaultsSrc = Join-Path $argoDir 'defaults'
$defaultsDest = Join-Path $ArgoRoot 'defaults'
Write-Host "[3/22] argo\defaults -> $defaultsDest"
Copy-Tree -Source $defaultsSrc -Destination $defaultsDest

$skillSrc = Join-Path (Join-Path $argoDir 'skills') 'argo-init'
$skillDest = Join-Path $SkillsRoot 'argo-init'
Write-Host "[4/22] argo\skills\argo-init -> $skillDest"
Copy-Tree -Source $skillSrc -Destination $skillDest

$ruleSrc = Join-Path (Join-Path $argoDir 'rules') 'archgraph.instructions.md'
$ruleDest = Join-Path $PromptsRoot 'archgraph.instructions.md'
Write-Host "[5/22] argo\rules\archgraph.instructions.md -> $ruleDest"
New-Item -ItemType Directory -Force -Path $PromptsRoot | Out-Null
Copy-Item -Force -Path $ruleSrc -Destination $ruleDest

$depsSrc = Join-Path $argoDir 'package.json'
$depsDest = Join-Path $ArgoRoot 'package.json'
Write-Host "[6/22] argo\package.json -> $depsDest"
Copy-Item -Force -Path $depsSrc -Destination $depsDest

$cursorSkillDest = Join-Path $CursorSkillsRoot 'argo-init'
Write-Host "[7/22] argo\skills\argo-init -> $cursorSkillDest (Cursor)"
Copy-Tree -Source $skillSrc -Destination $cursorSkillDest

$openCodeSkillDest = Join-Path $OpenCodeSkillsRoot 'argo-init'
Write-Host "[8/22] argo\skills\argo-init -> $openCodeSkillDest (OpenCode)"
Copy-Tree -Source $skillSrc -Destination $openCodeSkillDest

Write-Host "[9/22] argo\rules\archgraph.instructions.md -> $OpenCodeAgentsPath (OpenCode global AGENTS.md)"
Add-AgentsRule -AgentsPath $OpenCodeAgentsPath -RulePath $ruleSrc

$agentsSrc = Join-Path $argoDir 'agents'
Write-Host "[10/22] argo\agents -> $CopilotAgentsRoot (Copilot user-level)"
Copy-Agents -Source $agentsSrc -Destination $CopilotAgentsRoot

Write-Host "[11/22] argo\agents -> $CursorAgentsRoot (Cursor user-level, converted to .md)"
Copy-Agents -Source $agentsSrc -Destination $CursorAgentsRoot -Target cursor

Write-Host "[12/22] argo\agents -> $OpenCodeAgentsRoot (OpenCode user-level, converted to .md)"
Copy-Agents -Source $agentsSrc -Destination $OpenCodeAgentsRoot -Target opencode

$pluginsSrc = Join-Path $argoDir 'plugins'
Write-Host "[13/22] argo\plugins -> $PluginsRoot (Argo opencode plugins)"
Copy-Tree -Source $pluginsSrc -Destination $PluginsRoot

$cursorRuleSrc = Join-Path (Join-Path $argoDir 'rules') 'archgraph.instructions.md'
$cursorRuleDest = Join-Path $CursorRulesRoot 'archgraph.mdc'
Write-Host "[14/22] argo\rules\archgraph.instructions.md -> $cursorRuleDest (Cursor global rule, alwaysApply)"
New-Item -ItemType Directory -Force -Path $CursorRulesRoot | Out-Null
Convert-RuleFile -SourceFile $cursorRuleSrc -DestinationFile $cursorRuleDest

if ($SkipDsh) {
    Write-Host 'Skipped DeepSeek Harness integration (-SkipDsh).'
} else {
    $ruleSrcContent = Get-Content $ruleSrc -Raw -Encoding UTF8
    $dshSkillDest = Join-Path (Join-Path $DshHome 'skills') 'argo-init'
    $patchPath = Join-Path $DshHome 'cordis.patch.yml'
    $argoServer = (Join-Path $ArgoRoot 'scripts\argo-mcp-server.js').Replace('\', '/')

    Write-Host "[15/22] argo\rules\archgraph.instructions.md -> $DshHome\AGENTS.md (DeepSeek Harness user-global rule, frontmatter stripped)"
    Write-DshAgentRule -DshHome $DshHome -RuleText $ruleSrcContent

    Write-Host "[16/22] argo\skills\argo-init -> $dshSkillDest (DeepSeek Harness skill)"
    Copy-Tree -Source (Join-Path $argoDir 'skills\argo-init') -Destination $dshSkillDest

    Write-Host "[17/22] argo\rules\<WakeupGuideline> -> $DshHome\plugins\dsh-argo-wakeup\index.js (DeepSeek Harness wakeup plugin)"
    $wakeupDshPath = New-DshWakeupPlugin -DshHome $DshHome -RuleText $ruleSrcContent

    Write-Host "[18/22] argo-workspace + argo-wakeup rows -> $patchPath (DeepSeek Harness MCP bridge + wakeup plugin)"
    # The generated dsh-argo-workspace bridge connects directly to the argo
    # server (no dsh-mcp-client row), registers every tool as mcp__argo__* and
    # injects the current session's workspace (SessionHeader.cwd) as the
    # per-call workspaceRoot, so one dsh instance follows the workspace the
    # user switched to. The server honors the injected workspaceRoot
    # unconditionally.
    $bridgeDshPath = New-DshWorkspaceBridge -DshHome $DshHome
    if ($bridgeDshPath) {
        $bridgeUrl = 'file:///' + (($bridgeDshPath -replace '\\', '/').TrimStart('/'))
        $bridgeConfig = "    config:`n      serverPath: '$argoServer'`n"
        if ($DshWorkspaces) {
            $wsList = @($DshWorkspaces.Replace('\', '/').Split(';') | ForEach-Object { "        - $_" }) -join "`n"
            $bridgeConfig += "      workspaces:`n" + $wsList + "`n"
        }
        if ($DshCwd) {
            $bridgeConfig += "      cwd: $($DshCwd.Replace('\', '/'))`n"
        }
        $rows = "  - id: argo-workspace`n    name: '$bridgeUrl'`n" + $bridgeConfig
    } else {
        $rows = ''
    }
    if ($wakeupDshPath) {
        $pluginUrl = 'file:///' + (($wakeupDshPath -replace '\\', '/').TrimStart('/'))
        $rows += "  - id: argo-wakeup`n    name: '$pluginUrl'`n"
    }
    if ($rows) {
        $block = "# BEGIN ArchGraph ARGO deployment (managed by install-argo.ps1)`n- insert:`n" + $rows + "# END ArchGraph ARGO deployment"
        Write-DshManagedBlock -Path $patchPath -Block $block -MarkerStart '# BEGIN ArchGraph ARGO deployment' -MarkerEnd '# END ArchGraph ARGO deployment'
    }

    Write-Host "[19/22] argo\agents -> $DshHome\.agent-presets\<id> (DeepSeek Harness agent presets)"
    New-DshAgentPresets -DshHome $DshHome -AgentsSrc (Join-Path $argoDir 'agents')

    Write-Host "  note: graph-mcp remote ($GraphMcpUrl) is NOT registered for DeepSeek Harness -"
    Write-Host "  ~/.dsh/cordis.patch.yml only carries plugin rows (the dsh-argo-workspace bridge spawns"
    Write-Host "  the local argo server); an HTTP remote MCP server has no equivalent cordis row here."
    Write-Host "  Restart `dsh web` to activate the MCP bridge and the wakeup plugin;"
    Write-Host '  new sessions pick up the global rule and the argo-init skill automatically.'
    Write-Host '  The argo tools (mcp__argo__*) auto-follow the workspace the user switched to'
    Write-Host '  in one dsh instance - no restart needed between workspaces (the server honors'
    Write-Host '  the injected workspaceRoot unconditionally).'
}

if ($SkipOpenClaw) {
    Write-Host 'Skipped OpenClaw integration (-SkipOpenClaw).'
} else {
    $ruleSrcContent = Get-Content $ruleSrc -Raw -Encoding UTF8
    $openClawSkillDest = Join-Path $OpenClawHome 'skills\argo-init'
    $openClawAgentsDest = Join-Path $OpenClawWorkspace 'AGENTS.md'

    Write-Host '==> Deploying OpenClaw integration'
    Write-Host "[20/22] argo\rules\archgraph.instructions.md -> $openClawAgentsDest (OpenClaw workspace AGENTS.md, frontmatter stripped)"
    Write-OpenClawAgentRule -OpenClawWorkspace $OpenClawWorkspace -RuleText $ruleSrcContent

    Write-Host "[21/22] argo\skills\argo-init -> $openClawSkillDest (OpenClaw managed skill, all agents)"
    Copy-Tree -Source (Join-Path $argoDir 'skills\argo-init') -Destination $openClawSkillDest

    Write-Host '  OpenClaw injects AGENTS.md into Project Context on every session, so the wakeup'
    Write-Host '  gate (UNCONDITIONAL STARTUP GATE) is active on the next OpenClaw session; restart'
    Write-Host '  the OpenClaw gateway (openclaw gateway restart) if it is already running.'
}

if ($SkipDeps) {
    Write-Host 'Skipped dependency install (-SkipDeps).'
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "==> Installing Node dependencies in $ArgoRoot"
    $vendorDir = Join-Path $PSScriptRoot 'vendor'
    Push-Location $ArgoRoot
    try {
        $vendorTgzs = @(Get-ChildItem -Path $vendorDir -Filter '*.tgz' -ErrorAction SilentlyContinue)
        if ($vendorTgzs.Count -gt 0) {
            foreach ($tgz in $vendorTgzs) {
                Write-Host "  installing bundled $($tgz.Name)"
                npm install --no-save --omit=dev --no-audit --no-fund $tgz.FullName
                if ($LASTEXITCODE -ne 0) {
                    throw "npm install $($tgz.Name) failed with exit code $LASTEXITCODE"
                }
            }
        } else {
            npm install --omit=dev --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed with exit code $LASTEXITCODE"
            }
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Warning 'npm was not found on PATH; skipped dependency install.'
}

if ($SkipEnv) {
    Write-Host 'Skipped .env generation (-SkipEnv).'
} else {
    $envPath = Join-Path $ArgoRoot '.env'

    # Load existing values so we can skip prompting for variables that already
    # hold a non-empty value. Missing or empty variables still get prompted.
    $existing = @{}
    if (Test-Path $envPath) {
        foreach ($line in Get-Content $envPath) {
            $line = $line.Trim()
            if (-not $line -or $line.StartsWith('#')) { continue }
            $sep = $line.IndexOf('=')
            if ($sep -le 0) { continue }
            $key = $line.Substring(0, $sep).Trim()
            if ($key) {
                $existing[$key] = $line.Substring($sep + 1).Trim()
            }
        }
    }

    Write-Host ''
    Write-Host '==> Configure .env (existing non-empty values are kept; press Enter to leave a value empty)'
    $envKeys = @(
        'ARGO_EMBEDDING_BASE_URL',
        'ARGO_EMBEDDING_MODEL',
        'ARGO_EMBEDDING_PROVIDER',
        'ARGO_EMBEDDING_MODEL_VERSION',
        'ARGO_EMBEDDING_DIMENSIONS',
        'ARGO_NEO4J_DATABASE_URL',
        'ARGO_NEO4J_DATABASE_USERNAME',
        'ARGO_NEO4J_DATABASE_PASSWORD',
        'QWEN_KEY',
        'ARGO_LIVE_PROVIDER_E2E',
        'ARGO_W31_LIVE_MUTATION_VECTOR_E2E'
    )

    $lines = @('# Argo live-provider and Neo4j configuration.')
    foreach ($key in $envKeys) {
        $existingValue = $null
        if ($existing.ContainsKey($key)) {
            $existingValue = $existing[$key]
        }

        if ($null -ne $existingValue -and -not [string]::IsNullOrWhiteSpace([string]$existingValue)) {
            $value = $existingValue
        } else {
            $value = Read-Host $key
        }

        $lines += "$key=$value"
    }

    [System.IO.File]::WriteAllLines(
        $envPath,
        $lines,
        (New-Object System.Text.UTF8Encoding $false)
    )
    Write-Host "Wrote $envPath"
}

if ($SkipMcp) {
    Write-Host 'Skipped MCP configuration (-SkipMcp).'
} else {
    $argoServer = (Join-Path $ArgoRoot 'scripts\argo-mcp-server.js').Replace('\', '/')
    $graphMcpServer = [ordered]@{
        type    = 'remote'
        url     = $GraphMcpUrl
        enabled = $true
    }
    # OpenClaw MCP servers are keyed by `transport` (streamable-http / sse /
    # stdio), not by a `type: remote` alias: canonicalizeConfiguredMcpServer only
    # maps type http/streamable-http/sse/stdio to a transport, so a bare
    # {type:remote,url} entry would be dialed over SSE and the streamable-http
    # endpoint returns 404 (openclaw mcp probe graph-mcp: SSE error Non-200 404).
    $openClawGraphMcpServer = [ordered]@{
        url       = $GraphMcpUrl
        transport = 'streamable-http'
        enabled   = $true
    }

    Write-Host '==> Registering argo MCP server in VS Code (GitHub Copilot)'
    $mcpPath = if ($McpPath) { $McpPath } else { Join-Path $env:APPDATA 'Code\User\mcp.json' }
    Write-McpConfig -Path $mcpPath -ServersKey 'servers' -ServerConfig ([ordered]@{
        type    = 'stdio'
        command = 'node'
        args    = @($argoServer)
    }) -ExtraServers ([ordered]@{ 'graph-mcp' = $graphMcpServer })
    Write-Host "argo MCP config written -> $mcpPath"

    Write-Host '==> Registering argo MCP server in Cursor'
    Write-McpConfig -Path $CursorMcpPath -ServersKey 'mcpServers' -ServerConfig ([ordered]@{
        type    = 'stdio'
        command = 'node'
        args    = @($argoServer)
    }) -ExtraServers ([ordered]@{ 'graph-mcp' = $graphMcpServer })
    Write-Host "argo MCP config written -> $CursorMcpPath"

    Write-Host '==> Registering argo MCP server in OpenCode'
    Write-McpConfig -Path $OpenCodeConfigPath -ServersKey 'mcp' -ServerConfig ([ordered]@{
        type    = 'local'
        command = @('node', $argoServer)
        enabled = $true
    }) -ExtraServers ([ordered]@{ 'graph-mcp' = $graphMcpServer })
    Write-Host "argo MCP config written -> $OpenCodeConfigPath"

    if (-not $SkipOpenClaw) {
        # The repo root to pin for OpenClaw defaults to the installer's own
        # location; -OpenClawRepoRoot overrides it (e.g. for tests or when the
        # installer runs from a non-workspace npm-global package dir).
        $openClawRepoRoot = if ($OpenClawRepoRoot) { $OpenClawRepoRoot } else { $repoRoot }
        Write-Host "[22/22] argo MCP server -> $(Join-Path $OpenClawHome 'openclaw.json') (OpenClaw mcp.servers.argo, env.ARGO_REPO_ROOT pinned)"
        Write-OpenClawMcpConfig -OpenClawHome $OpenClawHome -RepoRoot $openClawRepoRoot -ArgoServer $argoServer -GraphMcpServer $openClawGraphMcpServer
    }
}

$wakeupPluginPath = Join-Path $PluginsRoot 'argo-wakeup.js'
if (Test-Path $wakeupPluginPath) {
    Write-Host '==> Registering argo-wakeup plugin in OpenCode'
    Register-OpenCodePlugin -ConfigPath $OpenCodeConfigPath -PluginFilePath $wakeupPluginPath
    Write-Host "argo-wakeup plugin registered -> $OpenCodeConfigPath"
}

Write-Host ''
Write-Host 'Argo deployment complete.'
