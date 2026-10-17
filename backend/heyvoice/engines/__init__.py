"""Engine registry + the full model catalog (download manager data)."""
from __future__ import annotations

import shutil
from pathlib import Path

from ..config import MODELS_DIR
from .base import EngineBase, EngineCaps, GenRequest  # noqa: F401
from .chatterbox import ChatterboxEngine
from .indicf5 import INDIC_LANGS, IndicF5Engine
from .kokoro import KokoroEngine
from .qwen3tts import Qwen3TTSEngine

# ------------------------------------------------------------------ registry
ENGINES: dict[str, EngineBase] = {
    "qwen3-tts": Qwen3TTSEngine(),
    "chatterbox": ChatterboxEngine(),
    "kokoro": KokoroEngine(),
    "indicf5": IndicF5Engine(),
}


def get_engine(engine_id: str) -> EngineBase:
    if engine_id not in ENGINES:
        raise KeyError(f"Unknown engine: {engine_id}")
    return ENGINES[engine_id]


def unload_all() -> None:
    for engine in ENGINES.values():
        engine.unload()


# ------------------------------------------------------------------ catalog
# id -> metadata used by the Models page + download manager
CATALOG: dict[str, dict] = {
    "qwen3-tts-0.6b-base": {
        "name": "Qwen3-TTS 0.6B Base", "engine": "qwen3-tts",
        "repo": "Qwen/Qwen3-TTS-12Hz-0.6B-Base", "params": "0.6B",
        "size_gb": 1.4, "vram_gb": 2.5, "license": "Apache-2.0",
        "role": "Voice cloning (3-second samples)",
        "description": "Flagship cloning model. Highest quality-per-VRAM for 8 GB cards.",
        "languages": ["en", "zh", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
        "recommended": True,
    },
    "qwen3-tts-1.7b-base": {
        "name": "Qwen3-TTS 1.7B Base", "engine": "qwen3-tts",
        "repo": "Qwen/Qwen3-TTS-12Hz-1.7B-Base", "params": "1.7B",
        "size_gb": 3.6, "vram_gb": 6.5, "license": "Apache-2.0",
        "role": "Voice cloning (max quality)",
        "description": "Same cloning quality tier as the 0.6B but richer prosody. Tight on 8 GB — auto-unloads other models.",
        "languages": ["en", "zh", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
    },
    "qwen3-tts-0.6b-customvoice": {
        "name": "Qwen3-TTS 0.6B CustomVoice", "engine": "qwen3-tts",
        "repo": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", "params": "0.6B",
        "size_gb": 1.4, "vram_gb": 2.5, "license": "Apache-2.0",
        "role": "9 preset voices + delivery instructions",
        "description": "Preset speakers (Vivian, Ryan, Aiden...) steered with natural language: 'speak slowly', 'excited'.",
        "languages": ["en", "zh", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
    },
    "qwen3-tts-1.7b-customvoice": {
        "name": "Qwen3-TTS 1.7B CustomVoice", "engine": "qwen3-tts",
        "repo": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", "params": "1.7B",
        "size_gb": 3.6, "vram_gb": 6.5, "license": "Apache-2.0",
        "role": "9 preset voices + delivery instructions (1.7B)",
        "description": "Higher quality preset voices with instruction control.",
        "languages": ["en", "zh", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
    },
    "qwen3-tts-1.7b-voicedesign": {
        "name": "Qwen3-TTS 1.7B VoiceDesign", "engine": "qwen3-tts",
        "repo": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", "params": "1.7B",
        "size_gb": 3.6, "vram_gb": 6.5, "license": "Apache-2.0",
        "role": "Invent voices from descriptions",
        "description": "Describe a voice in words ('calm, middle-aged male, slight husky tone') and generate it. Save the result as a sample and clone it forever.",
        "languages": ["en", "zh", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
    },
    "chatterbox-multilingual": {
        "name": "Chatterbox Multilingual v3", "engine": "chatterbox",
        "repo": "ResembleAI/chatterbox", "params": "0.5B",
        "size_gb": 1.2, "vram_gb": 3.0, "license": "MIT",
        "role": "25-language cloning + emotion",
        "description": "Broadest open language coverage with zero-shot cloning and emotion exaggeration. Outputs carry an inaudible PerTh watermark.",
        "languages": ["en", "ar", "da", "de", "el", "es", "fi", "fr", "he", "hi", "it", "ja",
                       "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh", "cs", "hu"],
        "recommended": True,
    },
    "chatterbox-turbo": {
        "name": "Chatterbox Turbo", "engine": "chatterbox",
        "repo": "ResembleAI/chatterbox-turbo", "params": "350M",
        "size_gb": 1.0, "vram_gb": 2.5, "license": "MIT",
        "role": "Fast expressive English + [tags]",
        "description": "350M speed demon. Insert [laugh], [sigh], [whisper] and delivery tags like [angry] directly in text.",
        "languages": ["en"],
        "recommended": True,
    },
    "kokoro-82m": {
        "name": "Kokoro 82M", "engine": "kokoro",
        "repo": "hexgrad/Kokoro-82M", "params": "82M",
        "size_gb": 0.4, "vram_gb": 0.0, "license": "Apache-2.0",
        "role": "Instant preset voices (CPU)",
        "description": "54 preset voices, runs on CPU at realtime. No cloning, but unbeatable for quick lines.",
        "languages": ["en", "es", "fr", "hi", "it", "pt", "ja", "zh"],
        "recommended": True,
    },
    "indicf5": {
        "name": "IndicF5 (AI4Bharat)", "engine": "indicf5",
        "repo": "ai4bharat/IndicF5", "params": "0.3B",
        "size_gb": 1.6, "vram_gb": 2.2, "license": "MIT",
        "role": "11 Indian languages + zero-shot cloning",
        "description": "Telugu, Tamil, Odia, Kannada, Malayalam, Marathi, Gujarati, Bengali, Assamese, "
                       "Punjabi and Hindi (IIT Madras). Clone a voice once — it speaks all 11. "
                       "Gated on Hugging Face: needs a free account and one click on 'Agree and access "
                       "repository', then download here.",
        "languages": ["as", "bn", "gu", "hi", "kn", "ml", "mr", "or", "pa", "ta", "te"],
        "recommended": True,
        "gated": True,
        # pinned revisions so the bytes verified here are the bytes shipped
        "revision": "fb652a96e508091045890dae5bb99fe511facbcf",
        "extra_repos": [
            {"repo": "charactr/vocos-mel-24khz", "revision": "0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21"},
        ],
    },
}


def _hf_repo_dir(repo: str) -> Path:
    # huggingface_hub cache layout: models/hf/hub/models--Org--Name
    return MODELS_DIR / "hf" / "hub" / ("models--" + repo.replace("/", "--"))


def model_dir_for(model_id: str) -> Path | None:
    meta = CATALOG.get(model_id)
    return _hf_repo_dir(meta["repo"]) if meta else None


# ------------------------------------------------- local snapshot lookup
def local_snapshot_repo(repo: str, revision: str | None = None) -> Path | None:
    """Resolved local snapshot directory of a downloaded HF repo (None if absent)."""
    try:
        from huggingface_hub import snapshot_download

        return Path(snapshot_download(repo, revision=revision, local_files_only=True))
    except Exception:
        return None


def local_snapshot(model_id: str) -> Path | None:
    """Local snapshot directory of a catalog model (None if not downloaded)."""
    meta = CATALOG.get(model_id)
    if not meta:
        return None
    return local_snapshot_repo(meta["repo"], meta.get("revision"))


def local_extra_snapshot(model_id: str, repo: str) -> Path | None:
    """Local snapshot of one of a model's extra_repos (vocoders etc.)."""
    meta = CATALOG.get(model_id) or {}
    for extra in meta.get("extra_repos") or []:
        if extra.get("repo") == repo:
            return local_snapshot_repo(repo, extra.get("revision"))
    return None


# ------------------------------------------------- model integrity / repair
def _manifest_path(model_id: str) -> Path:
    return MODELS_DIR / f"{model_id}.manifest.json"


def _model_files(path: Path) -> dict[str, int]:
    """Content files worth verifying: HF blob payloads (fall back to everything)."""
    blobs = path / "blobs"
    root = blobs if blobs.exists() else path
    files: dict[str, int] = {}
    for f in root.rglob("*"):
        if not f.is_file() or f.name.endswith((".lock", ".incomplete")):
            continue
        try:
            files[str(f.relative_to(path)).replace("\\", "/")] = f.stat().st_size
        except OSError:
            pass
    return files


def _write_model_manifest(model_id: str) -> None:
    import json as _json
    import time as _time

    path = model_dir_for(model_id)
    if not path or not path.exists():
        return
    try:
        _manifest_path(model_id).write_text(
            _json.dumps({"files": _model_files(path),
                         "recorded_at": _time.strftime("%Y-%m-%dT%H:%M:%S")}),
            encoding="utf-8")
    except Exception:
        pass


def verify_model(model_id: str) -> dict:
    """Check a model against its file manifest (recorded at download time, or
    captured now as a baseline). Catches files missing/truncated after an
    interrupted download — repair = re-run the download (HF resumes partials)."""
    import json as _json
    import time as _time

    path = model_dir_for(model_id)
    if not path or not path.exists():
        return {"ok": False, "reason": "not downloaded", "missing": [], "mismatched": [],
                "missing_count": 0}
    current = _model_files(path)
    manifest = None
    mp = _manifest_path(model_id)
    if mp.exists():
        try:
            manifest = _json.loads(mp.read_text(encoding="utf-8"))
        except Exception:
            manifest = None
    if not manifest:
        try:
            mp.write_text(_json.dumps(
                {"files": current, "recorded_at": _time.strftime("%Y-%m-%dT%H:%M:%S")}),
                encoding="utf-8")
        except Exception:
            pass
        return {"ok": True, "baseline": True, "files": len(current),
                "size_gb": round(sum(current.values()) / 1e9, 2),
                "missing": [], "mismatched": [], "missing_count": 0}
    files = manifest.get("files") or {}
    missing = [rel for rel in files if rel not in current]
    mismatched = [rel for rel, size in files.items() if rel in current and current[rel] != size]
    try:
        incomplete = sum(1 for _ in path.rglob("*.incomplete"))
    except Exception:
        incomplete = 0
    return {"ok": not (missing or mismatched or incomplete), "baseline": False,
            "files": len(files), "missing": missing[:20], "mismatched": mismatched[:20],
            "incomplete": incomplete, "missing_count": len(missing) + len(mismatched) + incomplete,
            "size_gb": round(sum(current.values()) / 1e9, 2)}


def model_state(model_id: str) -> dict:
    meta = CATALOG.get(model_id)
    if not meta:
        return {"state": "unknown", "progress": 0.0}
    engine = get_engine(meta["engine"])
    loaded = engine.model is not None and engine.loaded_key == model_id
    path = _hf_repo_dir(meta["repo"])

    # whisper/kokoro special paths
    if model_id == "kokoro-82m":
        path = MODELS_DIR / "hf" / "hub" / "models--hexgrad--Kokoro-82M"

    downloaded = path.exists() and any(path.rglob("*.safetensors")) or (path.exists() and any(path.rglob("*.pth")))
    if model_id == "kokoro-82m":
        downloaded = path.exists() and (any(path.rglob("*.pth")) or any(path.rglob("*.safetensors")))

    size = meta["size_gb"] * 1e9
    on_disk = 0
    if path.exists():
        on_disk = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())

    state = "absent"
    progress = 0.0
    if loaded:
        state = "loaded"
    elif downloaded:
        state = "ready"
    elif on_disk > 0:
        state = "downloading"
        progress = min(0.99, on_disk / size)

    return {**meta, "id": model_id, "state": state, "progress": round(progress, 3),
            "on_disk_gb": round(on_disk / 1e9, 2)}


def list_catalog() -> list[dict]:
    return [model_state(mid) for mid in CATALOG]


def disk_free_gb() -> float:
    return round(shutil.disk_usage(str(MODELS_DIR)).free / 1e9, 1)
