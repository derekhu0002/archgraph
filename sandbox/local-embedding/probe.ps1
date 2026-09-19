#requires -Version 5.1
# Verifies the running embedding server: OpenAI-compatible protocol + framework client.
[CmdletBinding()]
param(
  [string]$BaseUrl = "http://127.0.0.1:8080/v1",
  [string]$Model = "Alibaba-NLP/gte-Qwen2-1.5B-instruct"
)

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

$env:EMBED_BASE_URL = $BaseUrl
$env:EMBED_MODEL = $Model

Write-Host "[probe] protocol (OpenAI /v1/embeddings)"
node (Join-Path $dir "probe_http.js")
Write-Host ""
Write-Host "[probe] framework client + openai-compatible profile"
node (Join-Path $dir "verify_framework_client.js")
