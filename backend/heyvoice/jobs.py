"""Job queue: a single GPU worker processes generate/transcribe jobs; everything
else (UI) talks to it asynchronously and watches progress over SSE."""
from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Callable

from . import events, store
from .audio import (apply_effects, chunk_text, compute_peaks, duration_of, export_audio,
                    normalize_loudness, stitch, trim_silence)
from .config import OUTPUTS_DIR, UPLOADS_DIR, VOICES_DIR, load_settings
from .engines import CATALOG, ENGINES, INDIC_LANGS, get_engine, model_state
from .engines.base import GenRequest


class JobCanceled(Exception):
    """Raised inside handlers when the user cancels the running job."""


class Job:
    def __init__(self, type_: str, label: str, payload: dict) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.type = type_
        self.label = label
        self.payload = payload
        self.status = "queued"       # queued | running | done | error | canceled
        self.progress = 0.0
        self.note = ""
        self.error: str | None = None
        self.result: Any = None
        self.canceled = False        # cooperative cancel flag for the running job
        self.done = threading.Event()
        self.created_at = time.strftime("%Y-%m-%dT%H:%M:%S")

    def set_progress(self, progress: float, note: str = "") -> None:
        self.progress = max(0.0, min(1.0, float(progress)))
        if note:
            self.note = note
        events.emit("job", self.to_dict())

    def check_canceled(self) -> None:
        """Handlers call this between expensive steps to honor cancellations."""
        if self.canceled:
            raise JobCanceled()

    def to_dict(self) -> dict:
        return {
            "id": self.id, "type": self.type, "label": self.label, "status": self.status,
            "progress": round(self.progress, 3), "note": self.note, "error": self.error,
            "result": self.result, "created_at": self.created_at,
        }


_queue: list[Job] = []
_qcond = threading.Condition()
JOBS: dict[str, Job] = {}
_worker_started = False


def submit(type_: str, label: str, **payload: Any) -> Job:
    job = Job(type_, label, payload)
    JOBS[job.id] = job
    with _qcond:
        _queue.append(job)
        _qcond.notify_all()
    events.emit("job", job.to_dict())
    return job


def get_job(job_id: str) -> Job | None:
    return JOBS.get(job_id)


def active_jobs() -> list[Job]:
    """Running job first, then queued jobs in execution order."""
    running = [j for j in JOBS.values() if j.status == "running"]
    with _qcond:
        queued = [j for j in _queue if j.status == "queued"]
    return running + queued


def cancel_job(job_id: str) -> str:
    """Cancel a queued (instant) or running (cooperative) job."""
    job = JOBS.get(job_id)
    if job is None:
        raise KeyError(job_id)
    if job.status == "queued":
        job.status = "canceled"
        job.note = "canceled"
        job.done.set()
        events.emit("job", job.to_dict())
        return "canceled"
    if job.status == "running":
        job.canceled = True
        job.note = "canceling…"
        events.emit("job", job.to_dict())
        return "canceling"
    return job.status


def move_job(job_id: str, offset: int) -> bool:
    """Move a queued job up (-1) or down (+1) in the pending queue."""
    with _qcond:
        idx = next((i for i, j in enumerate(_queue)
                    if j.id == job_id and j.status == "queued"), None)
        if idx is None:
            return False
        target = max(0, min(len(_queue) - 1, idx + (1 if offset > 0 else -1)))
        if target == idx:
            return False
        _queue.insert(target, _queue.pop(idx))
    events.emit("queue", {"active": [j.to_dict() for j in active_jobs()]})
    return True


def clear_pending() -> int:
    """Cancel every still-queued job (the running one keeps going)."""
    with _qcond:
        pending = [j for j in _queue if j.status == "queued"]
    for j in pending:
        j.status = "canceled"
        j.note = "cleared"
        j.done.set()
        events.emit("job", j.to_dict())
    return len(pending)


def _worker() -> None:
    while True:
        with _qcond:
            while not _queue:
                _qcond.wait()
            job = _queue.pop(0)
        if job.status == "canceled":   # canceled while waiting in the queue
            continue
        job.status = "running"
        job.set_progress(0.02, "starting")
        try:
            HANDLERS[job.type](job, job.payload)
            job.status = "done"
            job.progress = 1.0
        except JobCanceled:
            job.status = "canceled"
            job.note = "canceled"
        except Exception as exc:  # noqa: BLE001
            job.status = "error"
            job.error = str(exc)
            import traceback as _tb

            print(f"[jobs] {job.type} {job.id} failed: {exc}\n{_tb.format_exc()}", flush=True)
        finally:
            job.canceled = False
            job.done.set()
            events.emit("job", job.to_dict())
            try:  # drop the "play so far" preview file if one was written
                (OUTPUTS_DIR / f"p_{job.id}.wav").unlink(missing_ok=True)
            except Exception:
                pass


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


# Indic script block -> language, used when the request language is "auto".
_SCRIPT_RANGES: list[tuple[str, int, int]] = [
    ("hi", 0x0900, 0x097F),   # Devanagari (Hindi / Marathi)
    ("bn", 0x0980, 0x09FF),   # Bengali / Assamese
    ("pa", 0x0A00, 0x0A7F),   # Gurmukhi
    ("gu", 0x0A80, 0x0AFF),   # Gujarati
    ("or", 0x0B00, 0x0B7F),   # Odia
    ("ta", 0x0B80, 0x0BFF),   # Tamil
    ("te", 0x0C00, 0x0C7F),   # Telugu
    ("kn", 0x0C80, 0x0CFF),   # Kannada
    ("ml", 0x0D00, 0x0D7F),   # Malayalam
]


def detect_script_language(text: str) -> str:
    """Best-effort language code from Indic script ranges ('' = none found)."""
    counts: dict[str, int] = {}
    for ch in text:
        cp = ord(ch)
        for lang, lo, hi in _SCRIPT_RANGES:
            if lo <= cp <= hi:
                counts[lang] = counts.get(lang, 0) + 1
                break
    if not counts:
        return ""
    lang = max(counts, key=counts.get)
    # Devanagari is shared by Hindi and Marathi — "ळ" (U+0933) is a strong
    # Marathi marker (standard Hindi doesn't use it), and routing cares.
    if lang == "hi" and "\u0933" in text:
        return "mr"
    return lang


def effective_language(payload_lang: str | None, voice: dict | None, settings: dict,
                       text: str = "") -> str:
    """Resolve 'auto' language: payload -> voice -> script detection -> default.

    When the request is auto, a clear script in the text overrides the voice's
    declared language (e.g. Telugu typed while an English preset is selected),
    so Indic text always reaches IndicF5. An explicit request always wins.
    """
    language = (payload_lang or "").strip()
    explicit = bool(language) and language != "auto"
    if not explicit:
        language = ((voice or {}).get("language") or "").strip()
        detected = detect_script_language(text)
        if detected and detected != language:
            language = detected
    if not language or language == "auto":
        language = settings.get("default_language") or "en"
    return language


def resolve_engine(voice: dict | None, req_engine: str | None, req_model: str | None,
                   design: bool = False, language: str = "") -> tuple[str, str]:
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
    indic = language in INDIC_LANGS

    plans: list[tuple[str, list[str]]] = []
    if engine_hint == "kokoro" or voice.get("kind") == "preset" and meta.get("kokoro"):
        if indic and language != "hi":
            raise RuntimeError(f"Kokoro preset voices don't speak {language.upper()} — clone a voice "
                               f"or pick an IndicF5 preset instead.")
        plans = [("kokoro", ["kokoro-82m"])]
    elif engine_hint == "indicf5":
        plans = [("indicf5", ["indicf5"])]
    elif speaker and engine_hint != "chatterbox":
        if indic:
            raise RuntimeError(f"'{voice.get('name', 'This preset')}' is an English/Chinese preset voice — "
                               f"clone a voice (or pick an IndicF5 preset) to speak {language.upper()}.")
        plans = [("qwen3-tts", ["qwen3-tts-0.6b-customvoice", "qwen3-tts-1.7b-customvoice"])]
    elif engine_hint == "chatterbox":
        if indic and language != "hi":
            raise RuntimeError(f"Chatterbox doesn't cover {language.upper()} — install IndicF5 "
                               f"(11 Indian languages) or pick an IndicF5 preset.")
        plans = [("chatterbox", ["chatterbox-multilingual", "chatterbox-turbo"])]
    elif indic and is_clone:
        # an Indic language + a cloned/designed voice: IndicF5 is the right engine
        plans = [("indicf5", ["indicf5"])]
        if language == "hi":
            plans.append(("chatterbox", ["chatterbox-multilingual"]))
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
    extra = ""
    if CATALOG.get(want, {}).get("gated"):
        extra = (" It is gated on Hugging Face — click 'Agree and access repository' there once "
                 "(free account), then download it here.")
    raise RuntimeError(f"No usable model is installed for this voice. Open the Models page "
                       f"and download a recommended model (try '{nice}').{extra}")


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
        # ASR sits outside the engine registry — free its VRAM before loading a
        # large TTS model (1.7B needs ~6.5 GB; an 8 GB card can't spare whisper).
        try:
            if float(CATALOG.get(model_key, {}).get("vram_gb") or 0) >= 5.0:
                from .engines.whisper_asr import asr

                if asr.model is not None:
                    asr.unload()
        except Exception:
            pass
    engine.load(model_key)
    events.emit("engine", {"engine": engine_id, "model": model_key, "loaded": True})


# ---------------------------------------------------------------- handlers
def _apply_pronunciations(text: str, settings: dict) -> str:
    """User-defined find→replace rules (names, acronyms, IPA-ish hints)."""
    for rule in settings.get("pronunciations") or []:
        src = (rule.get("from") or "").strip()
        if src and src in text:
            text = text.replace(src, rule.get("to") or "")
    return text


def _voice_ref(voice: dict | None) -> tuple[str, list[str] | None, list[str | None] | None, str]:
    """(speaker, ref_audios, ref_texts, voice_key) for a store voice.

    Multi-sample cloning: up to 3 reference clips (max 90 s combined) are used —
    Qwen3-TTS conditions on all of them, which sharpens the timbre match.
    """
    if not voice:
        return "", None, None, ""
    meta = voice.get("meta") or {}
    speaker = meta.get("speaker", "")
    ref_audios: list[str] = []
    ref_texts: list[str | None] = []
    if voice.get("samples") and not speaker:
        budget = 90.0
        for sample in voice["samples"][:3]:
            dur = float(sample.get("duration") or 0.0)
            if ref_audios and dur and budget - dur < 5.0:
                break  # keep total reference length sane
            path = VOICES_DIR / voice["id"] / sample["file"]
            if not path.exists():
                continue
            ref_audios.append(str(path))
            ref_texts.append((sample.get("transcript") or "").strip() or None)
            budget -= dur or 0.0
    if not ref_audios:
        return speaker, None, None, voice["id"]
    key = voice["id"] if len(ref_audios) == 1 else f"{voice['id']}#{len(ref_audios)}"
    return speaker, ref_audios, ref_texts, key


def _write_partial(job: Job, parts: list, pauses: list[int], sr: int, settings: dict) -> None:
    """Write a 'play so far' preview of a multi-part render (best effort)."""
    if not parts:
        return
    try:
        from .audio import save_wav

        so_far = stitch(parts, sr, int(settings["crossfade_ms"]), pauses)
        path = OUTPUTS_DIR / f"p_{job.id}.wav"
        save_wav(path, so_far, sr)
        events.emit("partial", {"job_id": job.id, "file": path.name,
                                "seconds": round(len(so_far) / sr, 2)})
    except Exception:
        pass


def h_generate(job: Job, p: dict) -> None:
    settings = load_settings()
    job.check_canceled()
    voice = store.get_voice(p["voice_id"]) if p.get("voice_id") else None

    text = (p.get("text") or "").strip()
    if not text:
        raise RuntimeError("Text is empty")
    text = _apply_pronunciations(text, settings)

    language = effective_language(p.get("language"), voice, settings, text)
    engine_id, model_key = resolve_engine(voice, p.get("engine"), p.get("model"),
                                          design=bool(p.get("design")), language=language)
    ensure_model(engine_id, model_key)
    engine = get_engine(engine_id)
    job.check_canceled()

    # voice reference wiring
    speaker, ref_audio, ref_text, voice_key = _voice_ref(voice)

    chunks = chunk_text(text, int(settings["chunk_max_chars"]))
    if not chunks:
        raise RuntimeError("Nothing to synthesize after chunking")

    parts = []
    pauses: list[int] = []
    sr = 24000
    for i, ch in enumerate(chunks):
        job.check_canceled()
        req = GenRequest(
            text=ch["text"], language=language, instruct=p.get("instruct", ""),
            exaggeration=p.get("exaggeration"), speaker=speaker,
            temperature=p.get("temperature"), seed=p.get("seed"),
            cfg_weight=p.get("cfg_weight"), top_p=p.get("top_p"), top_k=p.get("top_k"),
            min_p=p.get("min_p"), repetition_penalty=p.get("repetition_penalty"),
            speed=p.get("speed"),
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
        if len(chunks) > 1:
            _write_partial(job, parts, pauses, sr, settings)

    job.check_canceled()
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

    tuning = {k: p.get(k) for k in ("temperature", "cfg_weight", "top_p", "top_k",
                                    "min_p", "repetition_penalty", "speed")
              if p.get(k) is not None}
    gen = store.add_generation(
        id_=gid, voice_id=(voice or {}).get("id", ""), voice_name=(voice or {}).get("name", "Voice design"),
        text=text, engine=engine_id, model=model_key, language=language,
        params={"instruct": p.get("instruct", ""), "exaggeration": p.get("exaggeration"),
                "effects": fx, "format": fmt, "tuning": tuning},
        file=final.name, duration=duration_of(master), peaks=compute_peaks(full),
        batch_id=p.get("batch_id", ""),
    )
    job.result = {"generation": gen}
    events.emit("generation", gen)


def h_story(job: Job, p: dict) -> None:
    """Multi-speaker render: each line picks its own voice; one stitched file out."""
    settings = load_settings()
    lines = [l for l in (p.get("lines") or []) if (l.get("text") or "").strip()]
    if not lines:
        raise RuntimeError("A story needs at least one line")
    job.check_canceled()

    parts = []
    pauses: list[int] = []
    segments: list[dict] = []
    spans: list[tuple[int, int]] = []   # (first, last) part index per line
    sr = 24000
    prev_pause_after = 0
    total = len(lines)

    for li, line in enumerate(lines):
        job.check_canceled()
        text = _apply_pronunciations((line.get("text") or "").strip(), settings)
        voice = store.get_voice(line["voice_id"]) if line.get("voice_id") else None
        if not voice:
            raise RuntimeError(f"Line {li + 1}: no voice selected (or the voice was deleted)")
        language = effective_language(line.get("language"), voice, settings, text)
        engine_id, model_key = resolve_engine(voice, line.get("engine"), line.get("model"),
                                              language=language)
        ensure_model(engine_id, model_key)
        engine = get_engine(engine_id)
        speaker, ref_audio, ref_text, voice_key = _voice_ref(voice)

        chunks = chunk_text(text, int(settings["chunk_max_chars"]))
        line_seconds = 0.0
        line_parts = 0
        first_part = len(parts)
        for ci, ch in enumerate(chunks):
            req = GenRequest(
                text=ch["text"], language=language,
                instruct=(line.get("instruct") or p.get("instruct", "")),
                exaggeration=(line.get("exaggeration") if line.get("exaggeration") is not None
                              else p.get("exaggeration")),
                speaker=speaker, temperature=p.get("temperature"), seed=None,
                cfg_weight=p.get("cfg_weight"), top_p=p.get("top_p"), top_k=p.get("top_k"),
                min_p=p.get("min_p"), repetition_penalty=p.get("repetition_penalty"),
                speed=p.get("speed"),
                ref_audio=ref_audio, ref_text=ref_text, voice_key=voice_key,
            )
            audio, s = engine.generate(req)
            if audio.size == 0:
                continue
            sr = s
            parts.append(audio)
            if len(parts) > 1:  # gap before this part
                pauses.append(prev_pause_after if ci == 0 else ch["pause_before_ms"])
            line_seconds += len(audio) / sr
            line_parts += 1
        prev_pause_after = int(line.get("pause_after_ms") or 400)
        if line_parts:
            spans.append((first_part, len(parts) - 1))
            segments.append({
                "voice_id": (voice or {}).get("id", ""),
                "voice_name": (voice or {}).get("name", "Voice"),
                "text": (line.get("text") or "").strip(),
                "duration": round(line_seconds, 3),
            })
        job.set_progress(0.04 + 0.82 * (li + 1) / total, f"line {li + 1}/{total}")
        if total > 1:
            _write_partial(job, parts, pauses, sr, settings)

    if not parts:
        raise RuntimeError("Engines returned no audio for this story")
    job.check_canceled()

    job.set_progress(0.88, "stitching")
    # exact per-line timeline (mirrors stitch(): pauses add, crossfades overlap)
    fade_s = int(settings["crossfade_ms"]) / 1000.0
    starts: list[float] = []
    accum = 0.0
    for i, part in enumerate(parts):
        if i == 0:
            start = 0.0
        else:
            pause = (pauses[i - 1] if i - 1 < len(pauses) else 0) or 0
            if pause > 0:
                start = accum + pause / 1000.0
            elif fade_s > 0 and accum >= fade_s and len(part) >= int(fade_s * sr):
                start = accum - fade_s
            else:
                start = accum
        starts.append(start)
        accum = start + len(part) / sr

    full = stitch(parts, sr, int(settings["crossfade_ms"]), pauses)
    full, trim_off = trim_silence(full, sr, return_offset=True)
    trim_shift = trim_off / sr
    total_s = len(full) / sr
    line_timings = []
    for (a, b), seg in zip(spans, segments):
        seg_start = max(0.0, starts[a] - trim_shift)
        seg_end = min(max(seg_start + 0.05, starts[b] + len(parts[b]) / sr - trim_shift), total_s)
        line_timings.append({**seg, "start": round(seg_start, 3), "end": round(seg_end, 3)})

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

    names: list[str] = []
    for s in segments:
        if s["voice_name"] not in names:
            names.append(s["voice_name"])
    label = " + ".join(names[:3]) + (f" +{len(names) - 3}" if len(names) > 3 else "")
    tuning = {k: p.get(k) for k in ("temperature", "cfg_weight", "top_p", "top_k",
                                    "min_p", "repetition_penalty", "speed")
              if p.get(k) is not None}
    gen = store.add_generation(
        id_=gid, voice_id="", voice_name=label or "Story",
        text="\n".join(s["text"] for s in segments),
        engine="multi", model="story", language=p.get("language") or "auto",
        params={"story": True, "lines": lines, "segments": segments,
                "line_timings": line_timings, "effects": fx, "format": fmt,
                "tuning": tuning},
        file=final.name, duration=duration_of(master), peaks=compute_peaks(full),
        batch_id=p.get("batch_id", ""),
    )
    job.result = {"generation": gen}
    events.emit("generation", gen)


def h_transcribe(job: Job, p: dict) -> None:
    from .engines.whisper_asr import asr

    job.set_progress(0.2, "loading whisper")
    asr.load(size=p.get("size", "small"))
    job.check_canceled()
    job.set_progress(0.5, "transcribing")
    text = asr.transcribe(p["path"], language=p.get("language"))
    job.check_canceled()
    job.result = {"text": text}
    job.set_progress(1.0, "done")


# Prompt assistant: script + emotion -> the delivery prompt engines understand.
ASSIST_PREFERENCE = ["qwen3-prompt-1.7b", "qwen3-prompt-0.6b"]


def h_assist(job: Job, p: dict) -> None:
    mode = p.get("mode") or "instruct"
    text = (p.get("text") or "").strip()
    if not text:
        raise RuntimeError("Write or paste a script first — the assistant reads it.")

    model_key = next((m for m in ASSIST_PREFERENCE if _is_ready(m)), None)
    if not model_key:
        raise RuntimeError(
            "The prompt assistant isn't installed yet. Open the Models page and download "
            "'Prompt Assistant 0.6B' (1.5 GB) — or turn the assistant off in Settings.")
    job.set_progress(0.15, "loading assistant")
    ensure_model("prompt-assist", model_key)
    engine = get_engine("prompt-assist")
    job.check_canceled()
    job.set_progress(0.4, "thinking")

    if mode == "tidy":
        res = engine.tidy_script(text=text, language=p.get("language") or "")
        job.set_progress(0.95, "done")
        job.result = {"mode": "tidy", "text": res["text"], "changed": res["changed"],
                      "rejected": res.get("rejected"), "model": CATALOG[model_key]["name"]}
    else:
        instruct = engine.craft_instruct(
            text=text, emotion=p.get("emotion") or "", emotion_hint=p.get("emotion_hint") or "",
            language=p.get("language") or "", voice=p.get("voice") or "",
            notes=p.get("notes") or "")
        job.set_progress(0.95, "done")
        job.result = {"mode": "instruct", "instruct": instruct,
                      "model": CATALOG[model_key]["name"]}


HANDLERS: dict[str, Callable[[Job, dict], None]] = {
    "generate": h_generate,
    "story": h_story,
    "transcribe": h_transcribe,
    "assist": h_assist,
}


def transcribe_sync(path: str, size: str = "small", timeout: int = 240) -> str:
    job = submit("transcribe", "Transcribe", path=str(path), size=size)
    if not job.done.wait(timeout):
        raise RuntimeError("Transcription timed out")
    if job.status in ("error", "canceled"):
        raise RuntimeError(job.error or "Transcription canceled")
    return (job.result or {}).get("text", "")
