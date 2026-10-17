"""REST API routes for HeyVoices."""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from . import events, jobs, store
from .audio import analyze_reference, duration_of, prepare_clone_ref, to_wav24k
from .config import (MODELS_DIR, OUTPUTS_DIR, UPLOADS_DIR, VERSION, VOICES_DIR,
                     load_settings, save_settings)
from .engines import (CATALOG, ENGINES, disk_free_gb, get_engine, list_catalog,
                      model_state, unload_all, verify_model, _write_model_manifest)

router = APIRouter()

PALETTE = ["#14B8A6", "#3B82F6", "#8B5CF6", "#F472B6", "#F59E0B", "#34D399",
           "#60A5FA", "#FB7185", "#A78BFA", "#4ADE80"]


def _color_for(name: str) -> str:
    return PALETTE[sum(ord(c) for c in name) % len(PALETTE)]


# ================================================================ system
@router.get("/health")
def health() -> dict:
    return {"status": "ok", "version": VERSION, "app": "HeyVoices"}


@router.get("/system/info")
def system_info() -> dict:
    gpu = {"available": False}
    try:
        import torch

        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            gpu = {
                "available": True, "name": torch.cuda.get_device_name(0),
                "vram_total_gb": round(total / 1024**3, 1),
                "vram_free_gb": round(free / 1024**3, 1),
                "vram_used_gb": round((total - free) / 1024**3, 1),
            }
    except Exception:
        pass
    loaded = {eid: e.loaded_key for eid, e in ENGINES.items() if e.model is not None}
    return {
        "version": VERSION,
        "gpu": gpu,
        "engines_loaded": loaded,
        "models_dir": str(MODELS_DIR),
        "outputs_dir": str(OUTPUTS_DIR),
        "disk_free_gb": disk_free_gb(),
        "settings": load_settings(),
        "jobs_active": [j.to_dict() for j in jobs.active_jobs()],
    }


# torch import is expensive; remember when it is unavailable so the 2 s VRAM
# telemetry poll stays cheap on machines without CUDA.
_torch_missing = False


@router.get("/system/vram")
def system_vram() -> dict:
    global _torch_missing
    if not _torch_missing:
        try:
            import torch

            if torch.cuda.is_available():
                free, total = torch.cuda.mem_get_info()
                return {
                    "available": True,
                    "total_gb": round(total / 1024**3, 2),
                    "free_gb": round(free / 1024**3, 2),
                    "used_gb": round((total - free) / 1024**3, 2),
                    "alloc_gb": round(torch.cuda.memory_allocated() / 1024**3, 2),
                    "reserved_gb": round(torch.cuda.memory_reserved() / 1024**3, 2),
                }
        except Exception:
            _torch_missing = True
    return {"available": False}


@router.get("/system/events")
async def sse() -> StreamingResponse:
    q = events.subscribe()

    async def gen():
        try:
            yield ": connected\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            events.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                                      "X-Accel-Buffering": "no"})


@router.get("/settings")
def get_settings() -> dict:
    return load_settings()


class SettingsPatch(BaseModel):
    patch: dict


@router.patch("/settings")
def patch_settings(body: SettingsPatch) -> dict:
    settings = save_settings(body.patch)
    events.emit("settings", settings)
    return settings


# ================================================================ models
@router.get("/models/catalog")
def models_catalog() -> dict:
    return {"models": list_catalog(), "disk_free_gb": disk_free_gb()}


_downloads: dict[str, threading.Thread] = {}


def _hf_token() -> str | None:
    """Saved HF token (Settings) or a CLI login cache — needed for gated repos."""
    token = (load_settings().get("hf_token") or "").strip()
    if token:
        return token
    for p in (Path.home() / ".cache" / "huggingface" / "token",
              Path.home() / ".huggingface" / "token"):
        try:
            if p.exists():
                cached = p.read_text(encoding="utf-8").strip()
                if cached:
                    return cached
        except OSError:
            pass
    return None


def _start_model_download(model_id: str, meta: dict) -> bool:
    """Spawn a resumable HF snapshot download (also used for repairs)."""
    if model_id in _downloads and _downloads[model_id].is_alive():
        return False

    def _run() -> None:
        from huggingface_hub import snapshot_download

        try:
            from huggingface_hub.errors import GatedRepoError
        except Exception:  # pragma: no cover - very old huggingface_hub
            GatedRepoError = None  # type: ignore[assignment,misc]

        try:
            events.emit("model", model_state(model_id))
            token = _hf_token()
            repos = [{"repo": meta["repo"], "revision": meta.get("revision")}]
            repos += list(meta.get("extra_repos") or [])
            for entry in repos:
                snapshot_download(entry["repo"], revision=entry.get("revision"), token=token)
            _write_model_manifest(model_id)
            try:
                seed_indic_presets()
            except Exception:  # preset seeding is best-effort
                pass
            events.emit("model", model_state(model_id))
        except Exception as exc:  # noqa: BLE001
            text = str(exc)
            gated = bool(GatedRepoError and isinstance(exc, GatedRepoError)) or any(
                s in text.lower() for s in ("gated", "restricted", "401", "403", "authenticated"))
            payload: dict = {"id": model_id, "error": text[:600], "gated": gated}
            if gated:
                payload["url"] = f"https://huggingface.co/{meta['repo']}"
            events.emit("model_error", payload)
        finally:
            _downloads.pop(model_id, None)

    t = threading.Thread(target=_run, name=f"dl-{model_id}", daemon=True)
    _downloads[model_id] = t
    t.start()
    return True


@router.post("/models/download")
def models_download(body: dict) -> dict:
    model_id = body.get("id", "")
    meta = CATALOG.get(model_id)
    if not meta:
        raise HTTPException(404, f"Unknown model {model_id}")
    if not _start_model_download(model_id, meta):
        return {"started": False, "reason": "already downloading"}
    return {"started": True, "id": model_id}


@router.post("/models/verify")
def models_verify(body: dict) -> dict:
    """Compare a downloaded model against its file manifest (first run records
    a baseline). Catches files lost to interrupted downloads."""
    model_id = body.get("id", "")
    if model_id not in CATALOG:
        raise HTTPException(404, f"Unknown model {model_id}")
    return verify_model(model_id)


@router.post("/models/repair")
def models_repair(body: dict) -> dict:
    """Re-run the download — huggingface_hub skips complete files and resumes
    partial ones, so only missing/truncated data is fetched."""
    model_id = body.get("id", "")
    meta = CATALOG.get(model_id)
    if not meta:
        raise HTTPException(404, f"Unknown model {model_id}")
    if not _start_model_download(model_id, meta):
        return {"started": False, "reason": "already downloading"}
    return {"started": True, "id": model_id}


@router.post("/models/unload")
def models_unload() -> dict:
    unload_all()
    events.emit("engine", {"loaded": False, "all": True})
    return {"ok": True}


# ================================================================ voices
@router.get("/voices")
def voices_list() -> list[dict]:
    return store.list_voices()


@router.get("/voices/{voice_id}")
def voices_get(voice_id: str) -> dict:
    voice = store.get_voice(voice_id)
    if not voice:
        raise HTTPException(404, "Voice not found")
    return voice


@router.post("/voices/from-generation")
def voices_from_generation(body: dict) -> dict:
    """Save a generated take (e.g. a VoiceDesign result) as a new cloned voice."""
    gen_id = body.get("generation_id", "")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Name is required")
    gen = store.get_generation(gen_id)
    if not gen:
        raise HTTPException(404, "Generation not found")
    if store.voice_exists_by_name(name):
        raise HTTPException(400, f"A voice named '{name}' already exists")
    src = OUTPUTS_DIR / gen["file"]
    if not src.exists():
        src = OUTPUTS_DIR / f"{gen_id}.wav"
    if not src.exists():
        raise HTTPException(404, "Audio file missing")

    voice = store.create_voice(name=name, description=body.get("description", ""),
                               kind="designed", engine="qwen3-tts",
                               language=gen.get("language", "auto"),
                               color=_color_for(name), samples=[])
    vid = voice["id"]
    dst_dir = VOICES_DIR / vid
    dst_dir.mkdir(parents=True, exist_ok=True)
    sid = store.new_id()
    dst = dst_dir / f"{sid}.wav"
    if src.suffix.lower() != ".wav":
        if not to_wav24k(src, dst):
            shutil.copy2(src, dst)
    else:
        shutil.copy2(src, dst)
    transcript = ""
    try:
        transcript = jobs.transcribe_sync(str(dst), "small", 240)
    except Exception:
        pass
    samples = [{
        "id": sid, "file": dst.name, "url": f"/files/voices/{vid}/{dst.name}",
        "transcript": transcript, "duration": duration_of(dst),
    }]
    voice = store.update_voice(vid, {"samples": samples})
    events.emit("voices", {"action": "created", "voice": voice})
    return voice  # type: ignore


class VoiceCreate(BaseModel):
    name: str
    description: str = ""
    language: str = "auto"
    engine: str = ""
    kind: str = "cloned"
    samples: list[dict] = []


@router.post("/voices")
def voices_create(body: VoiceCreate) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Voice name is required")
    if store.voice_exists_by_name(name):
        raise HTTPException(400, f"A voice named '{name}' already exists")
    samples = []
    voice_id = None
    for s in body.samples:
        upload_path = UPLOADS_DIR / s["upload_id"]
        wav_src = UPLOADS_DIR / f"{s['upload_id']}.wav"
        if not wav_src.exists() and not upload_path.exists():
            continue
        # defer real ids until voice exists
        samples.append(s)
    voice = store.create_voice(name=name, description=body.description, kind=body.kind,
                               engine=body.engine, language=body.language,
                               color=_color_for(name), samples=[])
    voice_id = voice["id"]
    final_samples = []
    for s in samples:
        sid = store.new_id()
        src_wav = UPLOADS_DIR / f"{s['upload_id']}.wav"
        if not src_wav.exists():
            src = UPLOADS_DIR / s["upload_id"]
            dst_wav = UPLOADS_DIR / f"{s['upload_id']}.wav"
            if src.exists() and to_wav24k(src, dst_wav):
                src_wav = dst_wav
        if not src_wav.exists():
            continue
        dst_dir = VOICES_DIR / voice_id
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / f"{sid}.wav"
        shutil.copy2(src_wav, dst)
        final_samples.append({
            "id": sid, "file": dst.name,
            "url": f"/files/voices/{voice_id}/{dst.name}",
            "transcript": (s.get("transcript") or "").strip(),
            "duration": duration_of(dst),
        })
    voice = store.update_voice(voice_id, {"samples": final_samples})
    events.emit("voices", {"action": "created", "voice": voice})
    return voice  # type: ignore


class VoicePatch(BaseModel):
    patch: dict


@router.patch("/voices/{voice_id}")
def voices_patch(voice_id: str, body: VoicePatch) -> dict:
    voice = store.update_voice(voice_id, body.patch)
    if not voice:
        raise HTTPException(404, "Voice not found")
    # changed samples/engine → drop cached clone prompt
    for e in ENGINES.values():
        if hasattr(e, "invalidate_voice"):
            e.invalidate_voice(voice_id)  # type: ignore[attr-defined]
    events.emit("voices", {"action": "updated", "voice": voice})
    return voice


@router.delete("/voices/{voice_id}")
def voices_delete(voice_id: str) -> dict:
    voice = store.get_voice(voice_id)
    if not voice:
        raise HTTPException(404, "Voice not found")
    store.delete_voice(voice_id)
    folder = VOICES_DIR / voice_id
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    events.emit("voices", {"action": "deleted", "id": voice_id})
    return {"ok": True}


VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".m4v", ".avi", ".webm", ".mpg", ".mpeg",
              ".wmv", ".flv", ".ts", ".3gp", ".ogv"}


@router.post("/voices/ingest")
async def voices_ingest(files: list[UploadFile] = File(...),
                        transcribe: bool = Form(True)) -> list[dict]:
    """Upload raw audio *or video* (wav/mp3/m4a/webm/mp4/mov/mkv...). FFmpeg extracts and
    cleans the audio track (edge silence trimmed, capped at 60 s), then optionally
    auto-transcribes with Whisper (greatly improves clone quality)."""
    out = []
    for f in files:
        upload_id = uuid.uuid4().hex[:12]
        src_name = Path(f.filename or "audio").name
        raw = UPLOADS_DIR / f"{upload_id}_{src_name}"
        raw.write_bytes(await f.read())
        wav = UPLOADS_DIR / f"{upload_id}.wav"
        prep = await asyncio.to_thread(prepare_clone_ref, raw, wav)
        entry = {"upload_id": upload_id, "filename": f.filename, "converted": prep["ok"],
                 "duration": prep["duration"], "transcript": "",
                 "source": "video" if Path(src_name).suffix.lower() in VIDEO_EXTS else "audio"}
        if prep.get("trimmed_silence"):
            entry["trimmed_silence"] = True
        if prep.get("capped"):
            entry["capped"] = True
        if prep["ok"]:
            # objective reference-quality metrics on the *original* (pre-normalization)
            entry["analysis"] = await asyncio.to_thread(analyze_reference, raw)
        if prep["ok"] and transcribe:
            size = load_settings().get("transcribe_size", "small")
            try:
                entry["transcript"] = await asyncio.to_thread(jobs.transcribe_sync, str(wav), size, 300)
            except Exception as exc:  # noqa: BLE001
                entry["transcript_error"] = str(exc)
        out.append(entry)
    return out


class RetranscribeIn(BaseModel):
    upload_id: str | None = None
    voice_id: str | None = None
    sample_id: str | None = None
    size: str = "turbo"
    language: str | None = None


@router.post("/voices/re-transcribe")
async def voices_retranscribe(body: RetranscribeIn) -> dict:
    """Re-run ASR with a bigger Whisper model. Works on a fresh upload (clone
    wizard) or on a stored voice sample, where it updates the transcript in place.

    'turbo' = large-v3-turbo: dramatically better transcripts on names/numbers
    at ~8x realtime on a 4060; downloads once (~1.5 GB) into the models folder.
    """
    from .engines.whisper_asr import SIZES

    size = body.size if body.size in SIZES else "turbo"
    voice = None
    if body.voice_id and body.sample_id:
        voice = store.get_voice(body.voice_id)
        if not voice:
            raise HTTPException(404, "Voice not found")
        sample = next((s for s in voice.get("samples", []) if s.get("id") == body.sample_id), None)
        if not sample:
            raise HTTPException(404, "Sample not found")
        path = VOICES_DIR / body.voice_id / sample["file"]
        if not path.exists():
            raise HTTPException(404, "Sample file missing")
    elif body.upload_id:
        path = UPLOADS_DIR / f"{body.upload_id}.wav"
        if not path.exists():
            raise HTTPException(404, "Upload not found — please upload again")
    else:
        raise HTTPException(400, "upload_id or voice_id + sample_id is required")

    try:
        text = await asyncio.to_thread(jobs.transcribe_sync, str(path), size, 900)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Transcription failed: {exc}") from exc

    if voice is not None:
        samples = [({**s, "transcript": text} if s.get("id") == body.sample_id else s)
                   for s in voice.get("samples", [])]
        updated = store.update_voice(body.voice_id, {"samples": samples})
        for e in ENGINES.values():
            if hasattr(e, "invalidate_voice"):
                e.invalidate_voice(body.voice_id)  # type: ignore[attr-defined]
        events.emit("voices", {"action": "updated", "voice": updated})
    return {"transcript": text, "size": size}


# ================================================================ generation
class GenerateIn(BaseModel):
    text: str
    voice_id: str | None = None
    engine: str | None = None
    model: str | None = None
    language: str | None = None
    instruct: str = ""
    exaggeration: float | None = None
    temperature: float | None = None
    seed: int | None = None
    # engine tuning knobs (auto → None)
    cfg_weight: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    min_p: float | None = None
    repetition_penalty: float | None = None
    speed: float | None = None
    normalize: bool | None = None
    effects: dict = {}
    output_format: str | None = None
    batch_id: str = ""
    design: bool = False


@router.post("/generate")
def generate(body: GenerateIn) -> dict:
    if not body.text.strip():
        raise HTTPException(400, "Text is empty")
    voice = store.get_voice(body.voice_id) if body.voice_id else None
    if body.voice_id and not voice:
        raise HTTPException(404, "Voice not found")
    label = (voice or {}).get("name", "Voice design")
    job = jobs.submit("generate", label, **body.model_dump())
    return {"job_id": job.id}


class StoryIn(BaseModel):
    lines: list[dict] = []
    language: str | None = None
    instruct: str = ""
    exaggeration: float | None = None
    temperature: float | None = None
    cfg_weight: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    min_p: float | None = None
    repetition_penalty: float | None = None
    speed: float | None = None
    normalize: bool | None = None
    effects: dict = {}
    output_format: str | None = None
    batch_id: str = ""


@router.post("/generate/story")
def generate_story(body: StoryIn) -> dict:
    lines = [l for l in body.lines if (l.get("text") or "").strip()]
    if not lines:
        raise HTTPException(400, "Add at least one line with text")
    job = jobs.submit("story", f"Story · {len(lines)} lines", **body.model_dump())
    return {"job_id": job.id}


@router.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job.to_dict()


@router.get("/jobs")
def jobs_list(active: bool = False) -> list[dict]:
    if active:
        return [j.to_dict() for j in jobs.active_jobs()]
    return [j.to_dict() for j in jobs.JOBS.values()]


@router.post("/jobs/{job_id}/cancel")
def job_cancel(job_id: str) -> dict:
    """Queued jobs cancel instantly; the running job stops at the next safe step."""
    try:
        status = jobs.cancel_job(job_id)
    except KeyError:
        raise HTTPException(404, "Job not found") from None
    return {"id": job_id, "status": status}


class JobMove(BaseModel):
    offset: int = -1


@router.post("/jobs/{job_id}/move")
def job_move(job_id: str, body: JobMove) -> dict:
    if not jobs.get_job(job_id):
        raise HTTPException(404, "Job not found")
    return {"ok": jobs.move_job(job_id, body.offset)}


@router.post("/jobs/clear")
def jobs_clear() -> dict:
    """Cancel every queued job (the running one keeps going)."""
    return {"cleared": jobs.clear_pending()}


@router.get("/generations")
def generations(limit: int = 100, batch_id: str | None = None) -> list[dict]:
    return store.list_generations(limit=limit, batch_id=batch_id)


@router.get("/generations/export")
def generations_export(batch_id: str) -> StreamingResponse:
    """Zip every take of a batch — game lines / audiobook chapters in one download."""
    import io
    import re as _re
    import zipfile

    items = store.list_generations(limit=2000, batch_id=batch_id)
    if not items:
        raise HTTPException(404, "No generations in this batch")
    buf = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for g in items:
            f = OUTPUTS_DIR / g["file"]
            if not f.exists():
                continue
            base = _re.sub(r"[^\w\-. ]+", "", (g.get("voice_name") or "voice"))[:40].strip() or "voice"
            name = f"{base} - {g['id'][:6]}{f.suffix}"
            k = 2
            while name in used:
                name = f"{base} - {g['id'][:6]}_{k}{f.suffix}"
                k += 1
            used.add(name)
            z.write(f, name)
            if (g.get("text") or "").strip():
                srt = _srt_text(g)
                if srt:
                    z.writestr(name.rsplit(".", 1)[0] + ".srt", srt)
    buf.seek(0)
    fname = f"heyvoices-batch-{batch_id[:8] or 'export'}.zip"
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


def _srt_time(t: float) -> str:
    ms = max(0, int(round(t * 1000)))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _srt_cues(gen: dict) -> list[tuple[float, float, str]]:
    """Exact cues for stories (line_timings), approximate sentence split otherwise."""
    params = gen.get("params") or {}
    timings = params.get("line_timings") or []
    if timings:
        return [(float(t.get("start", 0)), float(t.get("end", 0)), (t.get("text") or "").strip())
                for t in timings if (t.get("text") or "").strip()]
    text = (gen.get("text") or "").strip()
    duration = float(gen.get("duration") or 0)
    if not text or duration <= 0:
        return []
    import re as _re

    pieces: list[str] = []
    for p in _re.split(r"(?<=[.!?…])\s+", text):
        p = p.strip()
        while len(p) > 84:
            cut = p.rfind(",", 0, 84)
            if cut < 30:
                cut = p.rfind(" ", 0, 84)
            if cut < 30:
                cut = 84
            pieces.append(p[:cut + 1].strip())
            p = p[cut + 1:].strip()
        if p:
            pieces.append(p)
    total = sum(len(x) for x in pieces) or 1
    cues, t = [], 0.0
    for x in pieces:
        d = duration * len(x) / total
        cues.append((t, min(duration, t + d), x))
        t += d
    return cues


def _srt_text(gen: dict) -> str:
    blocks = []
    for i, (a, b, txt) in enumerate(_srt_cues(gen), 1):
        blocks.append(f"{i}\n{_srt_time(a)} --> {_srt_time(b)}\n{txt}\n")
    return "\n".join(blocks)


@router.get("/generations/{gid}/srt")
def generation_srt(gid: str):
    gen = store.get_generation(gid)
    if not gen:
        raise HTTPException(404, "Generation not found")
    body = _srt_text(gen)
    if not body:
        raise HTTPException(400, "Nothing to subtitle in this take")
    return PlainTextResponse(body, headers={
        "Content-Disposition": f'attachment; filename="heyvoices-{gid}.srt"'})


def _meta_escape(s: str) -> str:
    return (s.replace("\\", "\\\\").replace("=", "\\=").replace(";", "\\;")
             .replace("#", "\\#").replace("\n", " ").strip())


@router.get("/generations/{gid}/chapter")
def generation_chapter(gid: str, fmt: str = "m4b", title: str = "", artist: str = "",
                       album: str = "HeyVoices", track: int = 0):
    """Audiobook-ready export: 44.1 kHz with metadata tags and chapter marks.

    fmt=m4b → AAC audiobook with native chapters; fmt=mp3 → ID3v2 with CHAP frames.
    Story takes get one chapter per spoken line; everything else one chapter.
    """
    gen = store.get_generation(gid)
    if not gen:
        raise HTTPException(404, "Generation not found")
    fmt = (fmt or "m4b").lower()
    if fmt not in ("m4b", "mp3"):
        raise HTTPException(400, "fmt must be m4b or mp3")
    src = OUTPUTS_DIR / f"{gid}.wav"
    if not src.exists():
        src = OUTPUTS_DIR / (gen.get("file") or "")
    if not src.exists():
        raise HTTPException(404, "Audio file not found")
    duration = float(gen.get("duration") or 0)
    t_title = (title.strip() or (gen.get("text") or "").strip()[:60]
               or gen.get("voice_name") or "HeyVoices").replace("\n", " ").strip()
    t_artist = artist.strip() or gen.get("voice_name") or "HeyVoices"
    timings = (gen.get("params") or {}).get("line_timings") or []
    chapters = timings or [{"text": "Chapter 1", "start": 0.0, "end": max(duration, 0.1)}]
    meta = [";FFMETADATA1",
            f"title={_meta_escape(t_title)}",
            f"artist={_meta_escape(t_artist)}",
            f"album={_meta_escape(album or 'HeyVoices')}"]
    if track:
        meta.append(f"track={int(track)}")
    for ch in chapters:
        ch_start = max(0.0, float(ch.get("start", 0)))
        ch_end = max(ch_start + 0.5, float(ch.get("end") or duration))
        meta += ["[CHAPTER]", "TIMEBASE=1/1000",
                 f"START={int(ch_start * 1000)}", f"END={int(ch_end * 1000)}",
                 f"title={_meta_escape(ch.get('text') or t_title)}"]
    meta_path = OUTPUTS_DIR / f"{gid}_chapter_meta.txt"
    meta_path.write_text("\n".join(meta) + "\n", encoding="utf-8")
    dst = OUTPUTS_DIR / f"{gid}_chapter.{fmt}"
    codec = (["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"] if fmt == "m4b"
             else ["-c:a", "libmp3lame", "-qscale:a", "2", "-id3v2_version", "3"])
    try:
        subprocess.run(["ffmpeg", "-y", "-i", str(src), "-i", str(meta_path),
                        "-map", "0:a", "-map_metadata", "1", "-ar", "44100", *codec, str(dst)],
                       check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(500, f"ffmpeg failed: {(exc.stderr or b'')[-300:].decode(errors='replace')}")
    finally:
        meta_path.unlink(missing_ok=True)
    safe_name = "".join(c for c in t_title if c.isalnum() or c in " -_")[:40].strip() or gid
    return FileResponse(dst, media_type=("audio/mp4" if fmt == "m4b" else "audio/mpeg"),
                        filename=f"{safe_name}.{fmt}")


@router.patch("/generations/{gid}")
def generation_patch(gid: str, body: VoicePatch) -> dict:
    gen = store.update_generation(gid, body.patch)
    if not gen:
        raise HTTPException(404, "Generation not found")
    events.emit("generation", gen)
    return gen


@router.delete("/generations/{gid}")
def generation_delete(gid: str) -> dict:
    file_name = store.delete_generation(gid)
    if file_name:
        (OUTPUTS_DIR / file_name).unlink(missing_ok=True)
        (OUTPUTS_DIR / f"{gid}.wav").unlink(missing_ok=True)
    events.emit("generation", {"id": gid, "deleted": True})
    return {"ok": True}


@router.post("/generations/{gid}/regenerate")
def generation_regenerate(gid: str) -> dict:
    gen = store.get_generation(gid)
    if not gen:
        raise HTTPException(404, "Generation not found")
    params = gen.get("params") or {}
    job = jobs.submit(
        "generate", gen.get("voice_name", "Take"),
        text=gen["text"], voice_id=gen["voice_id"], engine=gen["engine"],
        model=gen["model"], language=gen["language"], instruct=params.get("instruct", ""),
        exaggeration=params.get("exaggeration"), effects=params.get("effects", {}),
        output_format=params.get("format"),
    )
    return {"job_id": job.id}


# ================================================================ speak (integration API)
class SpeakIn(BaseModel):
    text: str
    voice: str = ""            # voice name or id; fallback: first cloned voice
    engine: str | None = None
    model: str | None = None
    language: str | None = None  # e.g. "te"; None = auto (voice -> script -> default)
    wait: bool = True


@router.post("/speak")
async def speak(body: SpeakIn) -> dict:
    """Convenience endpoint for apps/agents: text in → generated file URL out.
    Blocks until the audio is ready (queue-aware)."""
    voice = None
    if body.voice:
        for v in store.list_voices():
            if v["id"] == body.voice or v["name"].lower() == body.voice.lower():
                voice = v
                break
    if voice is None:
        cloned = [v for v in store.list_voices() if v["kind"] == "cloned"]
        voice = cloned[0] if cloned else None
    job = jobs.submit("generate", f"speak:{body.voice or 'default'}",
                      text=body.text, voice_id=(voice or {}).get("id"),
                      engine=body.engine, model=body.model, language=body.language)
    if not body.wait:
        return {"job_id": job.id}
    ok = await asyncio.to_thread(job.done.wait, 600)
    if not ok:
        raise HTTPException(504, "Generation timed out")
    if job.status == "error":
        raise HTTPException(500, job.error or "Generation failed")
    gen = (job.result or {}).get("generation", {})
    return {"file": gen.get("file"), "url": f"/files/outputs/{gen.get('file')}",
            "duration": gen.get("duration"), "voice": (voice or {}).get("name")}


# ================================================================ transcribe
@router.post("/transcribe")
async def transcribe_endpoint(file: UploadFile = File(...), size: str = Form("small")) -> dict:
    upload_id = uuid.uuid4().hex[:12]
    raw = UPLOADS_DIR / f"{upload_id}_{Path(file.filename or 'audio').name}"
    raw.write_bytes(await file.read())
    wav = UPLOADS_DIR / f"{upload_id}.wav"
    if not to_wav24k(raw, wav):
        raise HTTPException(400, "Could not decode audio file")
    text = await asyncio.to_thread(jobs.transcribe_sync, str(wav), size, 600)
    return {"text": text, "duration": duration_of(wav)}


# ================================================================ seed presets
def seed_presets() -> None:
    """One-time seeding of built-in preset voices (Kokoro + Qwen)."""
    existing = store.list_voices()
    if any(v["kind"] == "preset" for v in existing):
        return
    from .engines.kokoro import VOICES as KOKORO_VOICES
    from .engines.qwen3tts import SPEAKERS as QWEN_SPEAKERS

    for vid, (name, lang) in KOKORO_VOICES.items():
        store.create_voice(name=f"Kokoro {name}", description="Kokoro preset voice (fast, CPU)",
                           kind="preset", engine="kokoro", language=lang,
                           color=_color_for(f"Kokoro {name}"),
                           meta={"speaker": vid, "kokoro": True, "preset": True})
    for s in QWEN_SPEAKERS:
        store.create_voice(name=f"Qwen {s['name']}", description=s["description"],
                           kind="preset", engine="qwen3-tts", language=s["language"],
                           color=_color_for(s["name"]),
                           meta={"speaker": s["id"], "preset": True})


def seed_indic_presets() -> None:
    """Preset voices for IndicF5 (bundled AI4Bharat prompt clips, MIT).

    Incremental + idempotent: safe to run on every startup and after downloads.
    """
    try:
        from .engines.indicf5 import PRESETS, preset_clip_path
    except Exception:
        return
    existing = {v.get("meta", {}).get("preset_key") for v in store.list_voices()
                if v.get("kind") == "preset"}
    for p in PRESETS:
        if p["key"] in existing:
            continue
        src = preset_clip_path(p["file"])
        if not src:
            continue
        name = p["name"]
        if store.voice_exists_by_name(name):
            continue
        voice = store.create_voice(
            name=name,
            description=f"IndicF5 preset · {p['language_label']} — speaks all 11 Indian languages",
            kind="preset", engine="indicf5", language=p["language"],
            color=_color_for(name),
            meta={"preset": True, "indic": True, "preset_key": p["key"]})
        vid = voice["id"]
        sid = store.new_id()
        dst_dir = VOICES_DIR / vid
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / f"{sid}.wav"
        shutil.copy2(src, dst)
        samples = [{
            "id": sid, "file": dst.name,
            "url": f"/files/voices/{vid}/{dst.name}",
            "transcript": p["transcript"],
            "duration": duration_of(dst),
        }]
        updated = store.update_voice(vid, {"samples": samples})
        events.emit("voices", {"action": "created", "voice": updated})
