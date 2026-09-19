#requires -Version 5.1
<#
.SYNOPSIS
  Bootstrap the self-hosted OpenAI-compatible embedding server (native, no container).
.DESCRIPTION
  Idempotent: creates the venv, installs pinned deps, installs the CPU flash_attn
  stub (required by gte-Qwen2 remote code), and downloads the model weights.
.PARAMETER PythonExe
  Path to a Python 3.10-3.12 interpreter. Auto-detected via the py launcher when omitted.
.PARAMETER Proxy
  HTTP(S) proxy for pip and Hugging Face, e.g. http://127.0.0.1:7890. Optional.
.PARAMETER PipIndex
  pip index URL (e.g. an internal mirror). Optional.
.PARAMETER HfEndpoint
  Hugging Face endpoint; use https://hf-mirror.com when huggingface.co is slow/blocked. Optional.
.PARAMETER SkipModel
  Skip the model download (only set up the venv/deps).
#>
[CmdletBinding()]
param(
  [string]$PythonExe = "",
  [string]$Proxy = "",
  [string]$PipIndex = "",
  [string]$HfEndpoint = "",
  [switch]$SkipModel
)

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $dir ".venv"
$venvPy = Join-Path $venv "Scripts\python.exe"

if ($Proxy) {
  $env:HTTP_PROXY = $Proxy
  $env:HTTPS_PROXY = $Proxy
  Write-Host "[setup] proxy = $Proxy"
}
if ($PipIndex) { $env:PIP_INDEX_URL = $PipIndex }
$env:HF_HOME = Join-Path $dir "hf"
if ($HfEndpoint) { $env:HF_ENDPOINT = $HfEndpoint }

function Find-Python {
  param([string]$Explicit)
  if ($Explicit) { return $Explicit }
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($launcher) {
    foreach ($tag in @("-3.12", "-3.11", "-3.10")) {
      $out = & $launcher.Source $tag -c "import sys;print(sys.executable)" 2>$null
      if ($LASTEXITCODE -eq 0 -and $out) { return $out.Trim() }
    }
  }
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    $ver = (& $python.Source -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null)
    if ($LASTEXITCODE -eq 0 -and @("3.10", "3.11", "3.12") -contains $ver.Trim()) { return $python.Source }
  }
  throw "Python 3.10-3.12 not found. Install it, or pass -PythonExe <path>."
}

if (-not (Test-Path $venvPy)) {
  $py = Find-Python -Explicit $PythonExe
  Write-Host "[setup] creating venv with $py"
  & $py -m venv $venv
}

Write-Host "[setup] installing dependencies"
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r (Join-Path $dir "requirements.txt")

# gte-Qwen2 remote code statically imports flash_attn (a CUDA-only package) even
# though the CPU path never calls it. transformers' import check needs the module
# to exist; the stub version (<2.1.0) keeps is_flash_attn_2_available() false.
$site = (& $venvPy -c "import site;print(site.getsitepackages()[0])").Trim()
$faDir = Join-Path $site "flash_attn"
New-Item -ItemType Directory -Force -Path $faDir | Out-Null
$faInit = @'
"""CPU stub for the CUDA-only flash_attn package (never called on CPU)."""

__version__ = "0.0.0"


def _unavailable(*_args, **_kwargs):
    raise RuntimeError("flash_attn stub: CUDA flash attention is unavailable on this CPU host")


flash_attn_func = _unavailable
flash_attn_varlen_func = _unavailable
flash_attn_qkvpacked_func = _unavailable
flash_attn_kvpacked_func = _unavailable
'@
$faPad = @'
"""CPU stub for flash_attn.bert_padding (see the package __init__)."""


def _unavailable(*_args, **_kwargs):
    raise RuntimeError("flash_attn stub: CUDA flash attention is unavailable on this CPU host")


index_first_axis = _unavailable
pad_input = _unavailable
unpad_input = _unavailable
'@
Set-Content -Path (Join-Path $faDir "__init__.py") -Value $faInit -Encoding utf8
Set-Content -Path (Join-Path $faDir "bert_padding.py") -Value $faPad -Encoding utf8
Write-Host "[setup] flash_attn CPU stub installed"

if (-not $SkipModel) {
  Write-Host "[setup] downloading model weights"
  & $venvPy (Join-Path $dir "download_model.py")
}

Write-Host ""
Write-Host "[setup] done. Next:"
Write-Host "  start : powershell -ExecutionPolicy Bypass -File `"$dir\run_server.ps1`""
Write-Host "  health: Invoke-WebRequest http://127.0.0.1:8080/health"
Write-Host "  probe : powershell -ExecutionPolicy Bypass -File `"$dir\probe.ps1`""
