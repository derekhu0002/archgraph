<#
  Focused EA COM INSERT diagnostic driver (bounded). AT-2100-OPT-05 continuation.
  Usage: .\diag-ea.ps1 -Feap <isolated copy> -Variant A|B|C|D|E [-MaxWaitSec 60]
  Outputs probe log + top-level window titles of the EA process observed during the run.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Feap,
    [ValidateSet('A','B','C','D','E')][string]$Variant = 'A',
    [int]$MaxWaitSec = 60
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WinList {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  public static string[] Titles(uint target) {
    System.Collections.Generic.List<string> outList = new System.Collections.Generic.List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == target && IsWindowVisible(h)) {
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(h, sb, 512);
        if (sb.Length > 0) { outList.Add(sb.ToString()); }
      }
      return true;
    }, IntPtr.Zero);
    return outList.ToArray();
  }
}
"@

# headless prerequisite: stop interactive EA (and leftover cscript from aborted runs)
Get-Process EA -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$probe = Join-Path $PSScriptRoot 'probe2.js'
$cs = 'C:\Windows\SysWOW64\cscript.exe'
$log = Join-Path ([IO.Path]::GetTempPath()) ("ea-diag-" + $Variant + '-' + [guid]::NewGuid().ToString('N') + '.log')

$p = Start-Process -FilePath $cs -ArgumentList @('//nologo', $probe, $Feap, $Variant) -WindowStyle Hidden -PassThru `
     -RedirectStandardOutput ($log + '.out') -RedirectStandardError ($log + '.err')
$started = Get-Date
$seen = New-Object System.Collections.Generic.List[string]
while ((Get-Date) -lt $started.AddSeconds($MaxWaitSec)) {
  if ($p.HasExited) { break }
  $ea = Get-Process EA -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($ea) {
    try {
      $titles = [WinList]::Titles([uint32]$ea.Id)
      foreach ($t in $titles) { if (-not $seen.Contains($t)) { $seen.Add($t) } }
    } catch { }
  }
  Start-Sleep -Seconds 3
}
$timedOut = -not $p.HasExited
if ($timedOut) {
  Get-Process EA -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
}
$exitCode = if ($p.HasExited) { $p.ExitCode } else { -1 }

Write-Output ("VARIANT=" + $Variant + " timedOut=" + $timedOut + " exitCode=" + $exitCode)
Write-Output '--- probe output:'
if (Test-Path ($log + '.out')) { Get-Content ($log + '.out') -Raw }
Write-Output '--- probe stderr:'
if (Test-Path ($log + '.err')) { Get-Content ($log + '.err') -Raw }
Write-Output '--- EA window titles observed:'
if ($seen.Count -eq 0) { Write-Output '(none)' } else { $seen }
Get-Process EA -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
