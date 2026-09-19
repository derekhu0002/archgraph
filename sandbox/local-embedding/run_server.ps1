$ErrorActionPreference = "Stop"

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:HF_HOME = Join-Path $dir "hf"
$env:HF_HUB_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"
$env:TOKENIZERS_PARALLELISM = "false"
if (-not $env:EMBED_MODEL_ID) { $env:EMBED_MODEL_ID = "Alibaba-NLP/gte-Qwen2-1.5B-instruct" }

Set-Location $dir
& (Join-Path $dir ".venv\Scripts\python.exe") -m uvicorn server:app --host 127.0.0.1 --port 8080
