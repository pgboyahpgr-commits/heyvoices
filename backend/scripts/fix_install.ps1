# Fix-pass installer: resolves the qwen-tts vs chatterbox-tts dependency conflict.
#
# Background (learned the hard way):
#   - qwen-tts pins transformers==4.57.3, which needs huggingface-hub < 1.0
#   - chatterbox-tts pins transformers==5.2.0 and diffusers==0.29.0
#   - latest diffusers demands huggingface-hub >= 1.32 (breaks transformers/qwen)
#   => install qwen + core normally, then chatterbox with --no-deps and pin
#      diffusers==0.29.0 + huggingface-hub < 1.0 manually.
$ErrorActionPreference = "Continue"
$backendDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot   = Resolve-Path (Join-Path $backendDir "..")
Set-Location $backendDir
$env:HF_HOME = Join-Path $repoRoot "models\hf"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:UV_LINK_MODE = "copy"
$py = Join-Path $backendDir ".venv\Scripts\python.exe"

Write-Host "=== Removing partially installed engine packages ===" -ForegroundColor Cyan
uv pip uninstall --python $py qwen-tts chatterbox-tts kokoro misaki diffusers

Write-Host "`n=== Installing core requirements (qwen-tts -> transformers 4.57.3, hf-hub < 1.0) ===" -ForegroundColor Cyan
uv pip install --python $py -r requirements-core.txt

Write-Host "`n=== Installing chatterbox-tts without its transformers pin ===" -ForegroundColor Cyan
uv pip install --python $py chatterbox-tts --no-deps
Write-Host "--- chatterbox companion deps ---"
uv pip install --python $py "diffusers==0.29.0" "huggingface-hub<1.0" s3tokenizer "conformer==0.3.2" safetensors pykakasi pydub resemble-perth einops spacy-pkuseg omegaconf

Write-Host "`n=== Prefetching Qwen3-TTS 0.6B Base + tokenizer ===" -ForegroundColor Cyan
& $py "scripts\prefetch_models.py"

Write-Host "`n=== Verifying environment ===`n" -ForegroundColor Cyan
& $py "scripts\check_env.py"

Write-Host "`n=== FIX INSTALL DONE ===`n" -ForegroundColor Green
