# HeyVoice REST API

Base URL: `http://127.0.0.1:17300` — localhost only, no auth needed (the app never binds beyond
loopback). Interactive OpenAPI docs are always available at `/docs` while the backend runs.

## Conventions

- JSON bodies unless marked *multipart*.
- Long work is queued: `POST /generate` returns `{job_id}`. Watch progress on the SSE stream or
  poll `GET /jobs/{id}`.
- Files are served read-only:
  - outputs: `GET /files/outputs/<file>`
  - voice samples: `GET /files/voices/<voice-id>/<sample-file>`

## Health & system

### `GET /health`
```json
{ "status": "ok", "version": "0.1.0", "app": "HeyVoice" }
```

### `GET /system/info`
GPU name, `vram_total_gb`, `vram_free_gb`, `vram_used_gb`, `engines_loaded`, `models_dir`,
`outputs_dir`, `disk_free_gb`, `settings`, active jobs.

### `GET /system/events` — SSE
Each message is `data: {"type": ..., "data": ..., "ts": ...}`. Event types:
`job`, `model`, `model_error`, `voices`, `generation`, `engine`, `settings`.
A `: ping` comment is emitted every 15 s so idle connections stay alive.

Example (Python):
```python
import json, requests

with requests.get("http://127.0.0.1:17300/system/events", stream=True) as r:
    for line in r.iter_lines():
        if line and line.startswith(b"data: "):
            msg = json.loads(line[6:])
            print(msg["type"], msg["data"])
```

### `GET /settings` · `PATCH /settings`
PATCH expects `{ "patch": { ... } }`. Settings keys: `output_format`, `normalize_loudness`,
`target_lufs`, `chunk_max_chars`, `crossfade_ms`, `default_engine`, `default_language`,
`auto_unload`, `vram_budget_gb`.

## Voices

### `GET /voices`
Array of voice objects:
```json
{
  "id": "a1b2c3d4e5f6",
  "name": "Narrator",
  "description": "Warm baritone",
  "kind": "cloned",            // cloned | designed | preset
  "engine": "qwen3-tts",       // preferred engine ("" = auto)
  "language": "en",
  "color": "#7C5CFF",
  "favorite": false,
  "samples": [
    { "id": "9f8e...", "file": "9f8e....wav",
      "url": "/files/voices/a1b2c3d4e5f6/9f8e....wav",
      "transcript": "Hello there, this is my voice.", "duration": 12.4 }
  ],
  "meta": { "speaker": "Ryan" },
  "created_at": "2026-10-17T12:00:00"
}
```

### `POST /voices/ingest` — *multipart*
Fields: `files` (one or more audio files), `transcribe` (bool, default true).
Converts anything ffmpeg can read to 24 kHz mono, loudness-normalized, then Whisper-transcribes.
```json
[{ "upload_id": "3c1f...", "filename": "clip.mp3", "converted": true,
   "duration": 14.2, "transcript": "…" }]
```

### `POST /voices`
```json
{
  "name": "Narrator",
  "description": "Warm baritone",
  "language": "en",
  "engine": "",                                  // optional preference
  "samples": [ { "upload_id": "3c1f...", "transcript": "…" } ]
}
```

### `POST /voices/from-generation`
Save a generated take (e.g. VoiceDesign output) as a reusable cloned voice:
```json
{ "generation_id": "d4e5f6...", "name": "Cinematic Trailer", "description": "…" }
```

### `PATCH /voices/{id}` · `DELETE /voices/{id}`
PATCH body: `{ "patch": { "name": ..., "description": ..., "favorite": true, "samples": [...] } }`.
Changing samples invalidates the cached clone prompt automatically.

## Generation

### `POST /generate`
```json
{
  "text": "Line one. [[pause:500ms]] Line two.",
  "voice_id": "a1b2c3d4e5f6",     // omit + "design": true for VoiceDesign
  "engine": null,                  // "qwen3-tts" | "chatterbox" | "kokoro" (optional)
  "model": null,                   // explicit model id overrides everything
  "language": "en",                // omit for the voice's language / auto
  "instruct": "whisper softly",    // Qwen preset voices / VoiceDesign
  "exaggeration": 0.6,             // Chatterbox emotion
  "temperature": 0.8,
  "seed": 12345,
  "normalize": true,
  "effects": { "gain_db": 0, "pitch_semitones": -2, "reverb_mix": 0.15,
               "highpass_hz": 80, "lowpass_hz": 0, "compressor": true },
  "output_format": "mp3",          // wav | mp3 | ogg | flac
  "batch_id": "",                  // tag generations for grouping
  "design": false
}
```
→ `{ "job_id": "9a8b..." }`

`GET /jobs/{job_id}`:
```json
{ "id": "9a8b...", "type": "generate", "status": "running", "progress": 0.62,
  "note": "chunk 3/5", "error": null, "result": null }
```
On success, `result.generation` is the finished generation record (same shape as `GET /generations`).

### `GET /generations?limit=100&batch_id=…`
Newest first. Each record includes `file`, `duration`, `peaks` (96 values for waveform
sparklines), `engine`, `model`, `params`.

### `POST /generations/{id}/regenerate`
Re-queues the same text/voice/settings as a fresh take → `{ "job_id": ... }`.

### `PATCH /generations/{id}` · `DELETE /generations/{id}`
PATCH: `{ "patch": { "favorite": true } }`. DELETE removes the row and its audio files.

## One-shot speak (for apps & agents)

### `POST /speak`
```json
{ "text": "Hello from my app!", "voice": "Narrator", "wait": true }
```
- `voice`: voice **name** or id; omit to use your first cloned voice.
- Blocks until the audio exists (queue-aware, 10-min ceiling), then:
```json
{ "file": "9a8b....wav", "url": "/files/outputs/9a8b....wav",
  "duration": 3.2, "voice": "Narrator" }
```
Set `"wait": false` to get `{ "job_id": ... }` instead.

## Transcription

### `POST /transcribe` — *multipart*
Fields: `file` (audio), `size` (`tiny|base|small|medium|large-v3|turbo`, default `small`).
→ `{ "text": "…", "duration": 8.1 }`

## Models

### `GET /models/catalog`
```json
{ "models": [
    { "id": "qwen3-tts-0.6b-base", "name": "Qwen3-TTS 0.6B Base", "engine": "qwen3-tts",
      "params": "0.6B", "size_gb": 1.4, "vram_gb": 3.5, "license": "Apache-2.0",
      "role": "Voice cloning (3-second samples)", "languages": ["en", "zh", …],
      "state": "ready", "progress": 0.0, "recommended": true } ],
  "disk_free_gb": 41.2 }
```
`state`: `absent` → `downloading` (poll or ride SSE `model` events) → `ready` → `loaded`.

### `POST /models/download`
`{ "id": "chatterbox-turbo" }` → starts a background snapshot download.

### `POST /models/unload`
Unloads every loaded model from VRAM.

## Errors
Non-2xx responses carry `{ "detail": "human readable message" }` — surfaced verbatim as toasts
in the UI.
