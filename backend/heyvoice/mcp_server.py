"""HeyVoices MCP server — use the local voice studio from any MCP agent.

Exposes the running HeyVoices backend (http://127.0.0.1:17300) as MCP tools
over stdio: list voices, speak text, queue generations, poll jobs, inspect
models and studio status. Everything stays on this machine.

Launch (used by the agent's MCP config):
    <backend venv python>  heyvoice/mcp_server.py

Environment:
    HEYVOICE_API   override the backend URL (default http://127.0.0.1:17300)
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from mcp.server.mcpserver import MCPServer

API = os.environ.get("HEYVOICE_API", "http://127.0.0.1:17300").rstrip("/")

server = MCPServer(
    "HeyVoices",
    version="0.1.0",
    instructions=(
        "Fully local text-to-speech studio: preset voices, cloned voices and "
        "multi-speaker stories. Start with list_voices(), then speak() for "
        "one-shot text-to-audio (returns the absolute file path + duration). "
        "For long renders use start_generation() and poll get_job(). The desktop "
        "app must be running for these tools to work."
    ),
)

_outputs_dir_cache: str | None = None


def _api(method: str, path: str, body: dict | None = None, timeout: float = 660.0):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(f"{API}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"HeyVoices API {exc.code} on {path}: {detail}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"HeyVoices backend unreachable at {API} ({exc.reason}). "
            "Launch the HeyVoices desktop app first."
        ) from None


def _outputs_dir() -> str:
    global _outputs_dir_cache
    if _outputs_dir_cache is None:
        _outputs_dir_cache = str(_api("GET", "/system/info", timeout=30).get("outputs_dir") or "")
    return _outputs_dir_cache


def _find_voice(name_or_id: str) -> dict | None:
    if not name_or_id:
        return None
    wanted = name_or_id.strip().lower()
    for v in _api("GET", "/voices", timeout=30):
        if v["id"] == name_or_id or (v.get("name") or "").lower() == wanted:
            return v
    return None


@server.tool()
def list_voices() -> list[dict]:
    """Every voice in the local library (presets, clones, designed).

    Returns id, name, kind, language, engine and the number of reference clips
    (clones use 1-3). Use the id or the name in speak()/start_generation().
    """
    voices = _api("GET", "/voices", timeout=30)
    return [
        {
            "id": v["id"],
            "name": v.get("name"),
            "kind": v.get("kind"),
            "language": v.get("language"),
            "engine": v.get("engine"),
            "ref_clips": len(v.get("samples") or []),
        }
        for v in voices
    ]


@server.tool()
def speak(text: str, voice: str = "", engine: str = "", model: str = "",
          language: str = "") -> dict:
    """Generate speech now and wait for the finished file.

    text: the line to say; may include [[pause:500]] pauses and, on the
    chatterbox-turbo model, delivery tags like [laugh] or [sigh].
    voice: name or id from list_voices(); empty = first cloned voice.
    engine/model: optional overrides, e.g. engine="kokoro", model="chatterbox-turbo".
    language: optional code like "te", "hi", "en"; empty = auto (voice language,
    then script detection, then the app default).
    Returns file, absolute path on disk, url, duration (s) and the voice name.
    """
    body: dict = {"text": text, "wait": True}
    if voice:
        body["voice"] = voice
    if engine:
        body["engine"] = engine
    if model:
        body["model"] = model
    if language:
        body["language"] = language
    res = _api("POST", "/speak", body)
    if res.get("file"):
        base = _outputs_dir()
        res["path"] = str(Path(base) / res["file"]) if base else res["file"]
        if res.get("url", "").startswith("/"):
            res["url"] = f"{API}{res['url']}"
    return res


@server.tool()
def start_generation(text: str, voice: str = "", language: str = "",
                     model: str = "", output_format: str = "") -> dict:
    """Queue a generation without waiting (good for long text or batch work).

    voice: name or id from list_voices(). language: e.g. "en", "de".
    model: catalog id, e.g. "qwen3-tts-0.6b-base" or "chatterbox-turbo".
    output_format: wav | mp3 | ogg | flac.
    Returns {"job_id": ...} — poll with get_job().
    """
    found = _find_voice(voice)
    if voice and found is None:
        raise RuntimeError(f'No voice named "{voice}". Use list_voices() to pick one.')
    body: dict = {"text": text}
    if found:
        body["voice_id"] = found["id"]
    if language:
        body["language"] = language
    if model:
        body["model"] = model
    if output_format:
        body["output_format"] = output_format
    return _api("POST", "/generate", body)


@server.tool()
def get_job(job_id: str) -> dict:
    """Job status: {status: queued|running|done|error, progress: 0-1, message,
    error, result}. When done, result.generation holds file/duration/voice."""
    return _api("GET", f"/jobs/{job_id}", timeout=30)


@server.tool()
def list_takes(limit: int = 10) -> list[dict]:
    """Most recent finished takes, newest first (id, text, voice, duration, file)."""
    takes = _api("GET", f"/generations?limit={max(1, min(100, int(limit)))}", timeout=30)
    return [
        {
            "id": g["id"],
            "text": (g.get("text") or "")[:160],
            "voice": g.get("voice_name"),
            "duration": g.get("duration"),
            "file": g.get("file"),
            "created_at": g.get("created_at"),
        }
        for g in takes
    ]


@server.tool()
def list_models() -> list[dict]:
    """Local model catalog with download state (ready / downloading / missing)."""
    cat = _api("GET", "/models/catalog", timeout=30)
    models = cat.get("models", []) if isinstance(cat, dict) else cat
    return [
        {
            "id": m.get("id"),
            "name": m.get("name"),
            "engine": m.get("engine"),
            "role": m.get("role"),
            "state": m.get("state"),
            "size_gb": m.get("size_gb"),
            "vram_gb": m.get("vram_gb"),
            "license": m.get("license"),
        }
        for m in models
    ]


@server.tool()
def studio_status() -> dict:
    """Backend + hardware status: version, GPU name/VRAM, loaded engines, active jobs."""
    info = _api("GET", "/system/info", timeout=30)
    return {
        "version": info.get("version"),
        "gpu": info.get("gpu"),
        "engines_loaded": info.get("engines_loaded"),
        "jobs_active": info.get("jobs_active"),
        "models_dir": info.get("models_dir"),
        "outputs_dir": info.get("outputs_dir"),
    }


def main() -> None:
    server.run()  # stdio transport


if __name__ == "__main__":
    main()
