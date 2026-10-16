"""Job queue: a single GPU worker processes generate/transcribe jobs; everything
else (UI) talks to it asynchronously and watches progress over SSE."""
from __future__ import annotations

import queue
import threading
import time
import uuid
from typing import Any, Callable

from . import events, store
from .audio import (apply_effects, chunk_text, compute_peaks, duration_of, export_audio,
                    normalize_loudness, stitch, trim_silence)
from .config import OUTPUTS_DIR, UPLOADS_DIR, VOICES_DIR, load_settings
from .engines import CATALOG, ENGINES, get_engine, model_state
from .engines.base import GenRequest


class Job:
    def __init__(self, type_: str, label: str, payload: dict) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.type = type_
        self.label = label
        self.payload = payload
        self.status = "queued"       # queued | running | done | error
        self.progress = 0.0
        self.note = ""
        self.error: str | None = None
        self.result: Any = None
        self.done = threading.Event()
        self.created_at = time.strftime("%Y-%m-%dT%H:%M:%S")

    def set_progress(self, progress: float, note: str = "") -> None:
        self.progress = max(0.0, min(1.0, float(progress)))
        if note:
            self.note = note
        events.emit("job", self.to_dict())

    def to_dict(self) -> dict:
        return {
            "id": self.id, "type": self.type, "label": self.label, "status": self.status,
            "progress": round(self.progress, 3), "note": self.note, "error": self.error,
            "result": self.result, "created_at": self.created_at,
        }


_queue: "queue.Queue[Job]" = queue.Queue()
JOBS: dict[str, Job] = {}
_worker_started = False


def submit(type_: str, label: str, **payload: Any) -> Job:
    job = Job(type_, label, payload)
    JOBS[job.id] = job
    _queue.put(job)
    events.emit("job", job.to_dict())
    return job


def get_job(job_id: str) -> Job | None:
    return JOBS.get(job_id)


def _worker() -> None:
    while True:
        job = _queue.get()
        job.status = "running"
        job.set_progress(0.02, "starting")
        try:
            HANDLERS[job.type](job, job.payload)
            job.status = "done"
            job.progress = 1.0
        except Exception as exc:  # noqa: BLE001
            job.status = "error"
            job.error = str(exc)
        finally:
            job.done.set()
            events.emit("job", job.to_dict())


def start_worker() -> None:
    global _worker_started
    if _worker_started:
        return
    t = threading.Thread(target=_worker, name="heyvoice-worker", daemon=True)
    t.start()
    _worker_started = True


# ---------------------------------------------------------------- resolution
def _is_ready(model_id: str) -> bool:
    return model_state(model_id).get("state") in ("ready", "loaded")


def resolve_engine(voice: dict | None, req_engine: str | None, req_model: str | None,
                   design: bool = False) -> tuple[str, str]:
    """Pick (engine_id, model_key) for a generation request."""
    if req_model:
        meta = CATALOG.get(req_model)
        if not meta:
            raise RuntimeError(f"Unknown model: {req_model}")
        return meta["engine"], req_model

    if design:
        key = "qwen3-tts-1.7b-voicedesign"
        if not _is_ready(key):
            raise RuntimeError("VoiceDesign model not downloaded. Open the Models page "
                               "and download 'Qwen3-TTS 1.7B VoiceDesign'.")
        return "qwen3-tts", key

    if voice is None:
        raise RuntimeError("A voice is required (or use design mode with an instruct description).")

    meta = voice.get("meta") or {}
    speaker = meta.get("speaker", "")
    engine_hint = req_engine or voice.get("engine") or ""
    is_clone = voice.get("kind") in ("cloned", "designed") and bool(voice.get("samples"))

    plans: list[tuple[str, list[str]]] = []
    if engine_hint == "kokoro" or voice.get("kind") == "preset" and meta.get("kokoro"):
        plans = [("kokoro", ["kokoro-82m"])]
    elif speaker and engine_hint != "chatterbox":
        plans = [("qwen3-tts", ["qwen3-tts-0.6b-customvoice", "qwen3-tts-1.7b-customvoice"])]
    elif engine_hint == "chatterbox":
        plans = [("chatterbox", ["chatterbox-multilingual", "chatterbox-turbo"])]
    elif is_clone or engine_hint == "qwen3-tts":
        plans = [
            ("qwen3-tts", ["qwen3-tts-0.6b-base", "qwen3-tts-1.7b-base"]),
            ("chatterbox", ["chatterbox-multilingual", "chatterbox-turbo"]),
        ]
    else:
        plans = [("qwen3-tts", ["qwen3-tts-0.6b-customvoice", "qwen3-tts-0.6b-base"])]

    for engine_id, candidates in plans:
        for mid in candidates:
            if mid in CATALOG and CATALOG[mid]["engine"] == engine_id and _is_ready(mid):
                return engine_id, mid

    want = plans[0][1][0] if plans else "qwen3-tts-0.6b-base"
    nice = CATALOG.get(want, {}).get("name", want)
    raise RuntimeError(f"No usable model is installed for this voice. Open the Models page "
                       f"and download a recommended model (try '{nice}').")


def ensure_model(engine_id: str, model_key: str) -> None:
    engine = get_engine(engine_id)
    if engine.is_loaded(model_key):
        return
    settings = load_settings()
    if settings.get("auto_unload", True):
        for other_id, other in ENGINES.items():
            if other.model is not None and not (other_id == engine_id and other.loaded_key == model_key):
                other.unload()
                events.emit("engine", {"engine": other_id, "loaded": False})
    engine.load(model_key)
    events.emit("engine", {"engine": engine_id, "model": model_key, "loaded": True})


# ---------------------------------------------------------------- handlers
def h_generate(job: Job, p: dict) -> None:
    settings = load_settings()
    voice = store.get_voice(p["voice_id"]) if p.get("voice_id") else None
    engine_id, model_key = resolve_engine(voice, p.get("engine"), p.get("model"),
                                          design=bool(p.get("design")))
    ensure_model(engine_id, model_key)
    engine = get_engine(engine_id)

    text = (p.get("text") or "").strip()
    if not text:
        raise RuntimeError("Text is empty")

    # voice reference wiring
    speaker = ""
    ref_audio = None
    ref_text = None
    voice_key = ""
    if voice:
        meta = voice.get("meta") or {}
        speaker = meta.get("speaker", "")
        voice_key = voice["id"]
        if voice.get("samples") and not speaker:
            sample = voice["samples"][0]
            ref_audio = str(VOICES_DIR / voice["id"] / sample["file"])
            ref_text = sample.get("transcript") or None

    language = p.get("language") or (voice or {}).get("language") or settings["default_language"]
    chunks = chunk_text(text, int(settings["chunk_max_chars"]))
    if not chunks:
        raise RuntimeError("Nothing to synthesize after chunking")

    parts = []
    pauses: list[int] = []
    sr = 24000
    for i, ch in enumerate(chunks):
        req = GenRequest(
            text=ch["text"], language=language, instruct=p.get("instruct", ""),
            exaggeration=p.get("exaggeration"), speaker=speaker,
            temperature=p.get("temperature"), seed=p.get("seed"),
            ref_audio=ref_audio, ref_text=ref_text, voice_key=voice_key,
        )
        audio, sr = engine.generate(req)
        if audio.size == 0:
            raise RuntimeError("Engine returned empty audio")
        parts.append(audio)
        if i > 0:
            pauses.append(ch["pause_before_ms"])
        job.set_progress(0.05 + 0.80 * (i + 1) / len(chunks),
                         f"chunk {i + 1}/{len(chunks)}")

    job.set_progress(0.88, "stitching")
    full = stitch(parts, sr, int(settings["crossfade_ms"]), pauses)
    full = trim_silence(full, sr)

    fx = p.get("effects") or {}
    if fx:
        job.set_progress(0.9, "effects")
        full = apply_effects(full, sr, fx)

    do_norm = p.get("normalize")
    if do_norm is None:
        do_norm = settings["normalize_loudness"]
    if do_norm:
        job.set_progress(0.93, "normalizing")
        full = normalize_loudness(full, sr, float(settings["target_lufs"]))

    job.set_progress(0.95, "writing files")
    gid = store.new_id()
    master = OUTPUTS_DIR / f"{gid}.wav"
    from .audio import save_wav

    save_wav(master, full, sr)
    fmt = (p.get("output_format") or settings["output_format"] or "wav").lower()
    final = export_audio(master, OUTPUTS_DIR / f"{gid}.{fmt}", fmt)

    gen = store.add_generation(
        id_=gid, voice_id=(voice or {}).get("id", ""), voice_name=(voice or {}).get("name", "Voice design"),
        text=text, engine=engine_id, model=model_key, language=language,
        params={"instruct": p.get("instruct", ""), "exaggeration": p.get("exaggeration"),
                "effects": fx, "format": fmt},
        file=final.name, duration=duration_of(master), peaks=compute_peaks(full),
        batch_id=p.get("batch_id", ""),
    )
    job.result = {"generation": gen}
    events.emit("generation", gen)


def h_transcribe(job: Job, p: dict) -> None:
    from .engines.whisper_asr import asr

    job.set_progress(0.2, "loading whisper")
    asr.load(size=p.get("size", "small"))
    job.set_progress(0.5, "transcribing")
    text = asr.transcribe(p["path"], language=p.get("language"))
    job.result = {"text": text}
    job.set_progress(1.0, "done")


HANDLERS: dict[str, Callable[[Job, dict], None]] = {
    "generate": h_generate,
    "transcribe": h_transcribe,
}


def transcribe_sync(path: str, size: str = "small", timeout: int = 240) -> str:
    job = submit("transcribe", "Transcribe", path=str(path), size=size)
    if not job.done.wait(timeout):
        raise RuntimeError("Transcription timed out")
    if job.status == "error":
        raise RuntimeError(job.error or "Transcription failed")
    return (job.result or {}).get("text", "")
