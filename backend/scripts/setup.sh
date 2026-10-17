#!/usr/bin/env bash
# HeyVoices backend setup for Linux / macOS.
# Creates the Python environment and installs everything the backend needs.
#
# Usage:
#   bash backend/scripts/setup.sh                      # dev checkout
#   bash backend/scripts/setup.sh --venv DIR --models DIR [--log FILE]
set -euo pipefail

VENV_DIR=""
MODELS_DIR=""
LOG_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --venv)   VENV_DIR="$2"; shift 2 ;;
    --models) MODELS_DIR="$2"; shift 2 ;;
    --log)    LOG_FILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"
cd "$BACKEND_DIR"

[ -z "$VENV_DIR" ]   && VENV_DIR="$BACKEND_DIR/.venv"
[ -z "$MODELS_DIR" ] && MODELS_DIR="$REPO_ROOT/models"

if [ -n "$LOG_FILE" ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
fi

echo "=== HeyVoices setup ==="
echo "Backend: $BACKEND_DIR"
echo "Venv:    $VENV_DIR"
echo "Models:  $MODELS_DIR"

export HF_HOME="$MODELS_DIR/hf"
export HEYVOICE_MODELS_DIR="$MODELS_DIR"
export PYTHONUTF8=1

# ---- 1. uv (fast Python toolchain) ------------------------------------------
if ! command -v uv >/dev/null 2>&1; then
  if [ -x "$HOME/.local/bin/uv" ]; then
    export PATH="$HOME/.local/bin:$PATH"
  else
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi
fi
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"

# ---- 2. Python 3.12 venv ----------------------------------------------------
if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "Creating Python 3.12 environment..."
  "$UV" venv --python 3.12 "$VENV_DIR"
fi
PY="$VENV_DIR/bin/python"

# ---- 3. PyTorch -------------------------------------------------------------
# Linux: CUDA wheels (falls back through known-good index versions).
# macOS: default wheels include MPS acceleration.
OS="$(uname -s)"
if [ "$OS" = "Linux" ]; then
  echo "Installing PyTorch (CUDA)..."
  "$UV" pip install --python "$PY" torch torchaudio \
      --index-url https://download.pytorch.org/whl/cu128 || \
  "$UV" pip install --python "$PY" torch torchaudio \
      --index-url https://download.pytorch.org/whl/cu126 || \
  "$UV" pip install --python "$PY" torch torchaudio
else
  echo "Installing PyTorch (Metal / CPU)..."
  "$UV" pip install --python "$PY" torch torchaudio
fi

# ---- 4. Backend requirements ------------------------------------------------
echo "Installing backend requirements..."
"$UV" pip install --python "$PY" -r "$BACKEND_DIR/requirements.txt"

# ---- 5. Prefetch + self-check (best effort) ---------------------------------
echo "Prefetching baseline models (best effort)..."
"$PY" "$BACKEND_DIR/scripts/prefetch_models.py" || echo "prefetch skipped"

echo "Environment check:"
"$PY" "$BACKEND_DIR/scripts/check_env.py" || true

echo
echo "=== Done. Start the backend with:  $PY -m heyvoice ==="
