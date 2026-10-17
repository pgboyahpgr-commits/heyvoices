"""Central configuration: paths, ports, settings persistence."""
from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock

# repo root = .../hey voive pros   (backend/heyvoice/config.py -> parents[2])
ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = Path(os.environ.get("HEYVOICE_DATA_DIR", ROOT / "data"))
MODELS_DIR = Path(os.environ.get("HEYVOICE_MODELS_DIR", ROOT / "models"))
HF_HOME = MODELS_DIR / "hf"
WHISPER_DIR = MODELS_DIR / "whisper"

OUTPUTS_DIR = DATA_DIR / "outputs"
VOICES_DIR = DATA_DIR / "voices"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "heyvoice.db"
SETTINGS_PATH = DATA_DIR / "settings.json"

HOST = os.environ.get("HEYVOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("HEYVOICE_PORT", "17300"))
VERSION = "0.2.0"

# Make every HuggingFace-based engine cache into models/hf so the whole app
# is self-contained inside the project folder.
os.environ.setdefault("HF_HOME", str(HF_HOME))
os.environ.setdefault("PYTHONUTF8", "1")

for _d in (DATA_DIR, MODELS_DIR, HF_HOME, WHISPER_DIR, OUTPUTS_DIR, VOICES_DIR, UPLOADS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

DEFAULT_SETTINGS: dict = {
    "output_format": "wav",          # wav | mp3 | ogg | flac
    "normalize_loudness": True,
    "target_lufs": -16.0,
    "chunk_max_chars": 280,
    "crossfade_ms": 60,
    "default_engine": "qwen3-tts",
    "default_language": "en",
    "auto_unload": True,
    "vram_budget_gb": 6.5,
    "transcribe_size": "small",      # whisper model used for reference transcripts
    "hf_token": "",                  # optional Hugging Face token (gated models like IndicF5)
    "pronunciations": [],            # [{"from": "HeyVoices", "to": "Hey Voice"}, ...]
}

_lock = Lock()


def load_settings() -> dict:
    with _lock:
        if SETTINGS_PATH.exists():
            try:
                data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
                return {**DEFAULT_SETTINGS, **data}
            except Exception:
                pass
        return dict(DEFAULT_SETTINGS)


def save_settings(patch: dict) -> dict:
    settings = load_settings()
    settings.update(patch)
    with _lock:
        SETTINGS_PATH.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    return settings
