"""REST API routes for HeyVoice."""
from __future__ import annotations

import asyncio
import json
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from . import events, jobs, store
from .audio import duration_of, to_wav24k
from .config import (MODELS_DIR, OUTPUTS_DIR, UPLOADS_DIR, VERSION, VOICES_DIR,
                     load_settings, save_settings)
from .engines import CATALOG, ENGINES, disk_free_gb, get_engine, list_catalog, model_state, unload_all

router = APIRouter()

PALETTE = ["#7C5CFF", "#22D3EE", "#F472B6", "#34D399", "#FBBF24", "#FB7185",
           "#A78BFA", "#60A5FA", "#4ADE80", "#F97316"]


def _color_for(name: str) -> str:
    return PALETTE[sum(ord(c) for c in name) % len(PALETTE)]


# ================================================================ system
@router.get("/health")
def health() -> dict:
    return {"status": "ok", "version": VERSION, "app": "HeyVoice"}


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
        "jobs_active": [j.to_dict() for j in jobs.JOBS.values() if j.status in ("queued", "running")],
    }


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


@router.post("/models/download")
def models_download(body: dict) -> dict:
    model_id = body.get("id", "")
    meta = CATALOG.get(model_id)
    if not meta:
        raise HTTPException(404, f"Unknown model {model_id}")
    if model_id in _downloads and _downloads[model_id].is_alive():
        return {"started": False, "reason": "already downloading"}

    def _run() -> None:
        from huggingface_hub import snapshot_download

        try:
            events.emit("model", model_state(model_id))
            snapshot_download(meta["repo"])
            events.emit("model", model_state(model_id))
        except Exception as exc:  # noqa: BLE001
            events.emit("model_error", {"id": model_id, "error": str(exc)})

    t = threading.Thread(target=_run, name=f"dl-{model_id}", daemon=True)
    _downloads[model_id] = t
    t.start()
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


@router.post("/voices/ingest")
async def voices_ingest(files: list[UploadFile] = File(...),
                        transcribe: bool = Form(True)) -> list[dict]:
    """Upload raw audio (wav/mp3/m4a/webm...), convert to 24k mono, optionally
    auto-transcribe with Whisper (greatly improves clone quality)."""
    out = []
    for f in files:
        upload_id = uuid.uuid4().hex[:12]
        raw = UPLOADS_DIR / f"{upload_id}_{Path(f.filename or 'audio').name}"
        raw.write_bytes(await f.read())
        wav = UPLOADS_DIR / f"{upload_id}.wav"
        ok = to_wav24k(raw, wav)
        entry = {"upload_id": upload_id, "filename": f.filename, "converted": ok,
                 "duration": duration_of(wav) if ok else 0.0, "transcript": ""}
        if ok and transcribe:
            size = load_settings().get("transcribe_size", "small")
            try:
                entry["transcript"] = await asyncio.to_thread(jobs.transcribe_sync, str(wav), size, 300)
            except Exception as exc:  # noqa: BLE001
                entry["transcript_error"] = str(exc)
        out.append(entry)
    return out


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
def jobs_list() -> list[dict]:
    return [j.to_dict() for j in jobs.JOBS.values()]


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
    buf.seek(0)
    fname = f"heyvoice-batch-{batch_id[:8] or 'export'}.zip"
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


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
                      engine=body.engine, model=body.model)
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
