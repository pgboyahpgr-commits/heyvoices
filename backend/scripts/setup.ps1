# HeyVoice backend setup - creates the Python environment and installs everything.
# Usage:  powershell -ExecutionPolicy Bypass -File backend\scripts\setup.ps1
# Packaged app:  -VenvDir <userData>\venv -ModelsDir <userData>\models -LogFile <userData>\setup.log
param(
  [string]$VenvDir = "",
  [string]$ModelsDir = "",
  [string]$LogFile = ""
)
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$backendDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot   = Resolve-Path (Join-Path $backendDir "..")
Set-Location $backendDir

if (-not $VenvDir)   { $VenvDir   = Join-Path $backendDir ".venv" }
if (-not $ModelsDir) { $ModelsDir = Join-Path $repoRoot "models" }
if ($LogFile) { try { Start-Transcript -Path $LogFile -Force | Out-Null } catch {} }

Write-Host "=== HeyVoice setup ===" -ForegroundColor Cyan
Write-Host "Backend: $backendDir"
Write-Host "Venv:    $VenvDir"
Write-Host "Models:  $ModelsDir"

# Model cache lives inside the project (packaged installs pass a user-writable dir)
$env:HF_HOME = Join-Path $ModelsDir "hf"
$env:HEYVOICE_MODELS_DIR = $ModelsDir
New-Item -ItemType Directory -Force -Path $env:HF_HOME | Out-Null
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

# 0) uv — the only prerequisite; installs its own Python 3.12 if the system has none
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host "`n=== Installing uv (Python toolchain) ===" -ForegroundColor Cyan
  powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host "FATAL: uv could not be installed - internet connection required." -ForegroundColor Red
  exit 1
}

# 1) venv (Python 3.12 - uv downloads a managed interpreter if needed)
if (-not (Test-Path $VenvDir)) {
  Write-Host "`n=== Creating Python 3.12 venv ===" -ForegroundColor Cyan
  uv venv --python 3.12 $VenvDir
  if ($LASTEXITCODE -ne 0) {
    Write-Host "3.12 install failed, retrying with uv-managed python..." -ForegroundColor Yellow
    uv python install 3.12
    uv venv --python 3.12 $VenvDir
  }
} else {
  Write-Host "`nvenv already exists, reusing."
}
$py = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Host "FATAL: venv python missing"; exit 1 }

# 2) PyTorch with CUDA - try newest wheels first, fall back until one works
Write-Host "`n=== Installing PyTorch (CUDA) ===" -ForegroundColor Cyan
$torchOk = $false
foreach ($idx in @("cu129", "cu128", "cu126")) {
  Write-Host "--- torch index: $idx ---"
  uv pip install --python $py torch torchaudio --index-url "https://download.pytorch.org/whl/$idx"
  if ($LASTEXITCODE -eq 0) { $torchOk = $true; Write-Host "torch installed from $idx" -ForegroundColor Green; break }
  Write-Host "index $idx failed, trying next..." -ForegroundColor Yellow
}
if (-not $torchOk) {
  Write-Host "Falling back to CPU-only torch (GPU will not be used!)" -ForegroundColor Red
  uv pip install --python $py torch torchaudio
}

# 3) Everything else
Write-Host "`n=== Installing backend requirements ===" -ForegroundColor Cyan
uv pip install --python $py -r requirements.txt
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n!!! requirements resolution failed - retrying engine packages with --no-deps" -ForegroundColor Yellow
  uv pip install --python $py qwen-tts --no-deps
  uv pip install --python $py chatterbox-tts --no-deps
  uv pip install --python $py kokoro "misaki[en]" --no-deps
  uv pip install --python $py -r requirements.txt
}

# 4) Prefetch the flagship models into the model cache (Qwen3-TTS 0.6B Base + tokenizer)
Write-Host "`n=== Prefetching Qwen3-TTS 0.6B Base + tokenizer ===" -ForegroundColor Cyan
& $py "scripts\prefetch_models.py"

# 5) Verify
Write-Host "`n=== Verifying environment ===" -ForegroundColor Cyan
& $py "scripts\check_env.py"

Write-Host "`n=== SETUP COMPLETE ===" -ForegroundColor Green
if ($LogFile) { try { Stop-Transcript | Out-Null } catch {} }
exit 0
