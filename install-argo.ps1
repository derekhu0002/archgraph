#Requires -Version 5.1
param(
    [string]$ArgoRoot = "$env:USERPROFILE\.argo",
    [string]$SkillsRoot = "$env:USERPROFILE\.copilot\skills",
    [string]$PromptsRoot = "$env:APPDATA\Code\User\prompts",
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

Write-Host '==> Deploying Argo toolchain'

$schemaSrc = Join-Path $argoDir 'schema'
$schemaDest = Join-Path $ArgoRoot 'schema'
Write-Host "[1/4] argo\schema -> $schemaDest"
Copy-Tree -Source $schemaSrc -Destination $schemaDest

$scriptsSrc = Join-Path $argoDir 'scripts'
$scriptsDest = Join-Path $ArgoRoot 'scripts'
Write-Host "[2/4] argo\scripts -> $scriptsDest"
Copy-Tree -Source $scriptsSrc -Destination $scriptsDest

$skillSrc = Join-Path (Join-Path $argoDir 'skills') 'argo-init'
$skillDest = Join-Path $SkillsRoot 'argo-init'
Write-Host "[3/4] argo\skills\argo-init -> $skillDest"
Copy-Tree -Source $skillSrc -Destination $skillDest

$ruleSrc = Join-Path (Join-Path $argoDir 'rules') 'archgraph.instructions.md'
$ruleDest = Join-Path $PromptsRoot 'archgraph.instructions.md'
Write-Host "[4/4] argo\rules\archgraph.instructions.md -> $ruleDest"
New-Item -ItemType Directory -Force -Path $PromptsRoot | Out-Null
Copy-Item -Force -Path $ruleSrc -Destination $ruleDest

$depsSrc = Join-Path $argoDir 'package.json'
$depsDest = Join-Path $ArgoRoot 'package.json'
Write-Host "[5/5] argo\package.json -> $depsDest"
Copy-Item -Force -Path $depsSrc -Destination $depsDest

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
    Write-Host '==> Registering argo MCP server in VS Code'
    $mcpPath = if ($McpPath) { $McpPath } else { Join-Path $env:APPDATA 'Code\User\mcp.json' }
    $argoServer = (Join-Path $ArgoRoot 'scripts\argo-mcp-server.js').Replace('\', '/')

    $servers = [ordered]@{}
    if (Test-Path $mcpPath) {
        try {
            $existing = Get-Content $mcpPath -Raw | ConvertFrom-Json
            if ($existing.PSObject.Properties.Name -contains 'servers') {
                foreach ($p in $existing.servers.PSObject.Properties) {
                    $servers[$p.Name] = $p.Value
                }
            }
        } catch {
            # Ignore an unparseable existing file and start fresh.
        }
    }

    $servers['argo'] = [ordered]@{
        type    = 'stdio'
        command = 'node'
        args    = @($argoServer)
        cwd     = '${workspaceFolder}'
        env     = [ordered]@{ ARGO_REPO_ROOT = '${workspaceFolder}' }
    }

    $config = [ordered]@{ servers = $servers }
    New-Item -ItemType Directory -Force -Path (Split-Path $mcpPath) | Out-Null
    $json = $config | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($mcpPath, $json, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "argo MCP config written -> $mcpPath"
}

Write-Host ''
Write-Host 'Argo deployment complete.'
