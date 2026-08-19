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
    $ruleContent = Get-Content $RulePath -Raw
    $marker = 'ArchGraph ARGO Workflow Rules'

    if (Test-Path $AgentsPath) {
        $existing = Get-Content $AgentsPath -Raw
        if ($existing -like "*$marker*") {
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
Write-Host "[1/6] argo\schema -> $schemaDest"
Copy-Tree -Source $schemaSrc -Destination $schemaDest

$scriptsSrc = Join-Path $argoDir 'scripts'
$scriptsDest = Join-Path $ArgoRoot 'scripts'
Write-Host "[2/6] argo\scripts -> $scriptsDest"
Copy-Tree -Source $scriptsSrc -Destination $scriptsDest

$defaultsSrc = Join-Path $argoDir 'defaults'
$defaultsDest = Join-Path $ArgoRoot 'defaults'
Write-Host "[3/6] argo\defaults -> $defaultsDest"
Copy-Tree -Source $defaultsSrc -Destination $defaultsDest

$skillSrc = Join-Path (Join-Path $argoDir 'skills') 'argo-init'
$skillDest = Join-Path $SkillsRoot 'argo-init'
Write-Host "[4/6] argo\skills\argo-init -> $skillDest"
Copy-Tree -Source $skillSrc -Destination $skillDest

$ruleSrc = Join-Path (Join-Path $argoDir 'rules') 'archgraph.instructions.md'
$ruleDest = Join-Path $PromptsRoot 'archgraph.instructions.md'
Write-Host "[5/6] argo\rules\archgraph.instructions.md -> $ruleDest"
New-Item -ItemType Directory -Force -Path $PromptsRoot | Out-Null
Copy-Item -Force -Path $ruleSrc -Destination $ruleDest

$depsSrc = Join-Path $argoDir 'package.json'
$depsDest = Join-Path $ArgoRoot 'package.json'
Write-Host "[6/6] argo\package.json -> $depsDest"
Copy-Item -Force -Path $depsSrc -Destination $depsDest

$cursorSkillDest = Join-Path $CursorSkillsRoot 'argo-init'
Write-Host "[7/10] argo\skills\argo-init -> $cursorSkillDest (Cursor)"
Copy-Tree -Source $skillSrc -Destination $cursorSkillDest

$openCodeSkillDest = Join-Path $OpenCodeSkillsRoot 'argo-init'
Write-Host "[8/10] argo\skills\argo-init -> $openCodeSkillDest (OpenCode)"
Copy-Tree -Source $skillSrc -Destination $openCodeSkillDest

Write-Host "[9/10] argo\rules\archgraph.instructions.md -> $OpenCodeAgentsPath (OpenCode global AGENTS.md)"
Add-AgentsRule -AgentsPath $OpenCodeAgentsPath -RulePath $ruleSrc

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
    Write-Host ''
    Write-Host '==> Configure .env (press Enter to leave a value empty and fill it later)'
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
        $value = Read-Host $key
        $lines += "$key=$value"
    }

    $envPath = Join-Path $ArgoRoot '.env'
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
