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
    [string]$OpenCodeAgentsRoot = "$env:USERPROFILE\.config\opencode\agents",
    [switch]$SkipEnv,
    [switch]$SkipDeps,
    [switch]$SkipMcp,
    [string]$McpPath
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
    $nm = [regex]::Match($front, '(?m)^name:\s*(.*)$')
    if ($nm.Success) { $name = $nm.Groups[1].Value.Trim().Trim('"').Trim("'") }
    $dm = [regex]::Match($front, '(?m)^description:\s*(.*)$')
    if ($dm.Success) { $desc = $dm.Groups[1].Value.Trim().Trim('"').Trim("'") }

    if ($Target -eq 'opencode') {
        # OpenCode markdown agent: description is required; mode: all keeps it
        # usable as primary and subagent. Drop VS Code-only fields (tools array,
        # model, user-invocable, argument-hint) which OpenCode rejects.
        $newFront = "---`r`n"
        if ($desc) { $newFront += "description: `"$($desc -replace '"','\"')`"`r`n" }
        $newFront += "mode: all`r`n---`r`n"
    } else {
        # Cursor markdown agent: name + description; drop VS Code-only fields.
        $newFront = "---`r`n"
        if ($name) { $newFront += "name: `"$name`"`r`n" }
        if ($desc) { $newFront += "description: `"$($desc -replace '"','\"')`"`r`n" }
        $newFront += "---`r`n"
    }

    $result = $newFront + "`r`n" + $body
    [System.IO.File]::WriteAllText($DestinationFile, $result, (New-Object System.Text.UTF8Encoding $false))
}

function Write-McpConfig {
    param(
        [string]$Path,
        [string]$ServersKey,
        $ServerConfig
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
    $root[$ServersKey] = $servers

    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    $json = $root | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding $false))
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

Write-Host '==> Deploying Argo toolchain'

$schemaSrc = Join-Path $argoDir 'schema'
$schemaDest = Join-Path $ArgoRoot 'schema'
Write-Host "[1/12] argo\schema -> $schemaDest"
Copy-Tree -Source $schemaSrc -Destination $schemaDest

$scriptsSrc = Join-Path $argoDir 'scripts'
$scriptsDest = Join-Path $ArgoRoot 'scripts'
Write-Host "[2/12] argo\scripts -> $scriptsDest"
Copy-Tree -Source $scriptsSrc -Destination $scriptsDest

$defaultsSrc = Join-Path $argoDir 'defaults'
$defaultsDest = Join-Path $ArgoRoot 'defaults'
Write-Host "[3/12] argo\defaults -> $defaultsDest"
Copy-Tree -Source $defaultsSrc -Destination $defaultsDest

$skillSrc = Join-Path (Join-Path $argoDir 'skills') 'argo-init'
$skillDest = Join-Path $SkillsRoot 'argo-init'
Write-Host "[4/12] argo\skills\argo-init -> $skillDest"
Copy-Tree -Source $skillSrc -Destination $skillDest

$ruleSrc = Join-Path (Join-Path $argoDir 'rules') 'archgraph.instructions.md'
$ruleDest = Join-Path $PromptsRoot 'archgraph.instructions.md'
Write-Host "[5/12] argo\rules\archgraph.instructions.md -> $ruleDest"
New-Item -ItemType Directory -Force -Path $PromptsRoot | Out-Null
Copy-Item -Force -Path $ruleSrc -Destination $ruleDest

$depsSrc = Join-Path $argoDir 'package.json'
$depsDest = Join-Path $ArgoRoot 'package.json'
Write-Host "[6/12] argo\package.json -> $depsDest"
Copy-Item -Force -Path $depsSrc -Destination $depsDest

$cursorSkillDest = Join-Path $CursorSkillsRoot 'argo-init'
Write-Host "[7/12] argo\skills\argo-init -> $cursorSkillDest (Cursor)"
Copy-Tree -Source $skillSrc -Destination $cursorSkillDest

$openCodeSkillDest = Join-Path $OpenCodeSkillsRoot 'argo-init'
Write-Host "[8/12] argo\skills\argo-init -> $openCodeSkillDest (OpenCode)"
Copy-Tree -Source $skillSrc -Destination $openCodeSkillDest

Write-Host "[9/12] argo\rules\archgraph.instructions.md -> $OpenCodeAgentsPath (OpenCode global AGENTS.md)"
Add-AgentsRule -AgentsPath $OpenCodeAgentsPath -RulePath $ruleSrc

$agentsSrc = Join-Path $argoDir 'agents'
Write-Host "[10/12] argo\agents -> $CopilotAgentsRoot (Copilot user-level)"
Copy-Agents -Source $agentsSrc -Destination $CopilotAgentsRoot

Write-Host "[11/12] argo\agents -> $CursorAgentsRoot (Cursor user-level, converted to .md)"
Copy-Agents -Source $agentsSrc -Destination $CursorAgentsRoot -Target cursor

Write-Host "[12/12] argo\agents -> $OpenCodeAgentsRoot (OpenCode user-level, converted to .md)"
Copy-Agents -Source $agentsSrc -Destination $OpenCodeAgentsRoot -Target opencode

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

    Write-Host '==> Registering argo MCP server in VS Code (GitHub Copilot)'
    $mcpPath = if ($McpPath) { $McpPath } else { Join-Path $env:APPDATA 'Code\User\mcp.json' }
    Write-McpConfig -Path $mcpPath -ServersKey 'servers' -ServerConfig ([ordered]@{
        type    = 'stdio'
        command = 'node'
        args    = @($argoServer)
    })
    Write-Host "argo MCP config written -> $mcpPath"

    Write-Host '==> Registering argo MCP server in Cursor'
    Write-McpConfig -Path $CursorMcpPath -ServersKey 'mcpServers' -ServerConfig ([ordered]@{
        type    = 'stdio'
        command = 'node'
        args    = @($argoServer)
    })
    Write-Host "argo MCP config written -> $CursorMcpPath"

    Write-Host '==> Registering argo MCP server in OpenCode'
    Write-McpConfig -Path $OpenCodeConfigPath -ServersKey 'mcp' -ServerConfig ([ordered]@{
        type    = 'local'
        command = @('node', $argoServer)
        enabled = $true
    })
    Write-Host "argo MCP config written -> $OpenCodeConfigPath"
}

Write-Host ''
Write-Host 'Argo deployment complete.'
