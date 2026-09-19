#requires -Version 5.1
[CmdletBinding()]
param([int]$Port = 8080)

$ErrorActionPreference = "SilentlyContinue"
$connections = Get-NetTCPConnection -LocalPort $Port -State Listen
if (-not $connections) {
  Write-Host "no listener on :$Port"
  exit 0
}
$connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
  Stop-Process -Id $_ -Force
  Write-Host "stopped pid $_ (port $Port)"
}
