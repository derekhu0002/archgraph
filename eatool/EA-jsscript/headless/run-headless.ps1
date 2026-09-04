<#
  EA headless runner wrapper (AT-2100-OPT-05).
  Usage:
    .\run-headless.ps1 -Feap <isolated feap> -Mode import -Graph <graphJson> [-Response <file>] [-KillEA]
    .\run-headless.ps1 -Feap <isolated feap> -Mode export -Output <outJson> [-Diagram <id>] [-KillEA]
  Returns: JSON { ok, exitCode, timedOut, log }
  Process management only targets EA.exe / cscript.exe; never kills unrelated processes.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Feap,
    [Parameter(Mandatory=$true)][ValidateSet('import','export')][string]$Mode,
    [string]$Graph = '',
    [string]$Output = '',
    [int]$Diagram = 0,
    [string]$Response = '',
    [int]$TimeoutSec = 300,
    [switch]$KillEA
)

$ErrorActionPreference = 'Stop'
$bootstrap = Join-Path $PSScriptRoot 'bootstrap.js'
$cs = 'C:\Windows\SysWOW64\cscript.exe'
if (-not (Test-Path $bootstrap)) { throw "bootstrap not found: $bootstrap" }
if (-not (Test-Path $cs)) { throw 'SysWOW64 cscript missing' }

# headless requires no interactive EA instance holding the file
if (Get-Process EA -ErrorAction SilentlyContinue) {
    if ($KillEA) {
        Get-Process EA -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
    } else {
        throw 'interactive EA is running; pass -KillEA to stop it (task-authorized for isolated headless runs)'
    }
}

$log = Join-Path ([IO.Path]::GetTempPath()) ("ea-headless-" + $Mode + "-" + [guid]::NewGuid().ToString('N') + ".log")
$scriptJs = if ($Mode -eq 'import') { Join-Path $PSScriptRoot '..\import-from-kg.js' } else { Join-Path $PSScriptRoot '..\export-to-kg.js' }

# bootstrap positional: feap script mode graph output diagram response log
$argList = New-Object System.Collections.Generic.List[string]
$argList.Add('//nologo')
$argList.Add($bootstrap)
$argList.Add($Feap)
$argList.Add($scriptJs)
$argList.Add($Mode)
$argList.Add($(if ($Graph) { $Graph } else { "-" }))
$argList.Add($(if ($Output) { $Output } else { "-" }))
$argList.Add($(if ($Diagram -gt 0) { [string]$Diagram } else { "" }))
$argList.Add($(if ($Response) { $Response } else { "-" }))
$argList.Add($log)
$proc = Start-Process -FilePath $cs -ArgumentList $argList -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput ($log + '.out') -RedirectStandardError ($log + '.err')
$timedOut = $false
if (-not $proc.WaitForExit(($TimeoutSec * 1000))) {
    $timedOut = $true
    Get-Process EA -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch { }
}
$exitCode = 0
if ($timedOut) { $exitCode = -1 } else { $exitCode = $proc.ExitCode }
$logText = ''
if (Test-Path $log) { $logText = Get-Content $log -Raw -ErrorAction SilentlyContinue }

$result = [ordered]@{
    ok       = (-not $timedOut) -and ($exitCode -eq 0)
    exitCode = $exitCode
    timedOut = $timedOut
    logPath  = $log
    log      = $logText
}
$result | ConvertTo-Json -Depth 4
