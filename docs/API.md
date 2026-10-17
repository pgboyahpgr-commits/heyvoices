# HeyVoices REST API

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
{ "status": "ok", "version": "0.2.0", "app": "HeyVoices" }
```

### `GET /system/info`
GPU name, `vram_total_gb`, `vram_free_gb`, `vram_used_gb`, `engines_loaded`, `models_dir`,
`outputs_dir`, `disk_free_gb`, `settings`, active jobs.

### `GET /system/vram`
Cheap poll target for live VRAM telemetry (the top-bar meter):
```json
{ "available": true, "total_gb": 8.0, "free_gb": 5.4, "used_gb": 2.6,
  "alloc_gb": 2.1, "reserved_gb": 2.4 }
```
`{"available": false}` when no CUDA device is present.

### `GET /system/events` — SSE
Each message is `data: {"type": ..., "data": ..., "ts": ...}`. Event types:
`job`, `model`, `model_error`, `voices`, `generation`, `engine`, `settings`, `queue`,
`partial`.
- `partial` — `{ "job_id", "file", "seconds" }`: a playable "so far" preview written after
  each finished chunk/line. Served at `GET /files/outputs/<file>`; the file is removed when
  the job finishes or is canceled.
- `queue` — `{ "active": [job, …] }`: the full active queue re-broadcast after any
  cancel / move / clear so clients stay in sync.
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
`auto_unload`, `vram_budget_gb`, `transcribe_size` (Whisper model for reference clips),
`hf_token` (Hugging Face read token — only needed for gated models such as IndicF5),
`pronunciations` (`[{"from": "HeyVoices", "to": "Hey Voice"}]` — applied before synthesis).

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
Fields: `files` (one or more **audio or video** files), `transcribe` (bool, default true).
FFmpeg extracts the audio track from video containers (mp4/mov/mkv/webm/avi…), converts to
24 kHz mono, loudness-normalizes, trims edge silence and caps at 60 s, then Whisper-transcribes.
The cleaned reference is playable at `GET /files/uploads/{upload_id}.wav`.
```json
[{ "upload_id": "3c1f...", "filename": "clip.mp4", "converted": true, "source": "video",
   "duration": 29.4, "transcript": "…", "trimmed_silence": true,
   "analysis": { "duration": 29.4, "peak_dbfs": -3.1, "snr_db": 24.0,
                 "speech_ratio": 0.82, "clipping_pct": 0.0, "verdict": "good",
                 "notes": ["Clean single-speaker reference — great for cloning."] } }]
```
`analysis.verdict` is `good | fair | poor` with human-readable `notes` (noise, clipping,
too quiet, music-heavy, too short) — shown as chips in the clone wizard.

### `POST /voices/re-transcribe`
Re-runs ASR with a bigger Whisper model. Either a fresh upload (before creating the voice)
or a stored voice sample (updates its transcript in place and invalidates the cached clone
prompt so the next render uses it).
```json
{ "upload_id": "3c1f...",              // OR:
  "voice_id": "a1b2...", "sample_id": "9f8e...",
  "size": "turbo" }                    // tiny|base|small|medium|large-v3|turbo (default turbo)
```
→ `{ "transcript": "…", "size": "turbo" }`.
`turbo` = large-v3-turbo: clearly better on names/numbers, ~8× realtime on a 4060, one-time
~1.5 GB download into the models folder.

### `POST /voices`
Creates a voice from uploaded reference clips (see `/voices/ingest`). Pass `samples` with
`upload_id` + optional `transcript` each. **Up to 3 clips are used per voice** (≤90 s combined):
Qwen3-TTS conditions on all of them (ICL streams concatenated, speaker embeddings averaged),
other engines use the first clip.
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
  "engine": null,                  // "qwen3-tts" | "chatterbox" | "indicf5" | "kokoro" (optional)
  "model": null,                   // explicit model id overrides everything
  "language": "en",                // omit for auto (text script overrides the voice's default).
                                   //   Indic text is detected (te, ta, kn, ml, mr, or, pa, gu, bn, as, hi)
                                   //   and routed to IndicF5
  "instruct": "whisper softly",    // Qwen preset voices / VoiceDesign
  "exaggeration": 0.6,             // Chatterbox emotion
  "temperature": 0.8,
  "seed": 12345,
  "cfg_weight": null,              // engine tuning knobs — omit/null = engine default
  "top_p": null, "top_k": null, "min_p": null,
  "repetition_penalty": null, "speed": null,
  "normalize": true,
  "effects": { "gain_db": 0, "pitch_semitones": -2, "reverb_mix": 0.15,
               "highpass_hz": 80, "lowpass_hz": 0, "compressor": true },
  "output_format": "mp3",          // wav | mp3 | ogg | flac
  "batch_id": "",                  // tag generations for grouping
  "design": false
}
```
→ `{ "job_id": "9a8b..." }`

Tuning knobs are per-engine and validated at the engine boundary: Chatterbox uses
`cfg_weight / exaggeration / top_p / min_p / repetition_penalty`, Qwen3-TTS uses
`temperature / top_p / top_k / repetition_penalty`, Kokoro uses `speed` (0.5–2).
`seed` fixes the sampler for reproducible takes. Applied values are recorded in
`params.tuning` on the finished generation.

`GET /jobs/{job_id}`:
```json
{ "id": "9a8b...", "type": "generate", "status": "running", "progress": 0.62,
  "note": "chunk 3/5", "error": null, "result": null }
```
On success, `result.generation` is the finished generation record (same shape as `GET /generations`).
Statuses: `queued` → `running` → `done | error | canceled`.

### Queue controls
- `GET /jobs` — every job (newest last). `GET /jobs?active=true` — running first, then queued.
- `POST /jobs/{id}/cancel` → `{ "id", "status": "canceled" }`. Queued jobs cancel instantly;
  the running job stops at the next safe point (between chunks/lines) and cleans up its
  partial preview.
- `POST /jobs/{id}/move` with `{ "offset": -1 }` (or `+1`) — reorder a queued job.
- `POST /jobs/clear` → `{ "cleared": 2 }` — cancel every queued job; the running one keeps going.

### `POST /generate/story` — multi-speaker render
Renders a script where **each line picks its own voice**, then stitches everything into one track.
```json
{
  "lines": [
    { "voice_id": "a1b2...", "text": "We need to go. Now.", "pause_after_ms": 600 },
    { "voice_id": "f9e8...", "text": "Then we go together.", "pause_after_ms": 400,
      "instruct": "whispering, scared" }
  ],
  "output_format": "wav",
  "normalize": true,
  "effects": {}
}
```
→ `{ "job_id": "c3d4..." }`. The finished generation carries
`params.story = true`, `params.lines` (the script, for re-editing),
`params.segments` (`[{ "voice_name", "text", "duration" }]` per line) and
`params.line_timings` (`[{ "voice_name", "text", "start", "end" }]` — exact per-line offsets
used by the subtitle export).

### `POST /assist` — prompt assistant (small local LLM)
Turns a script + a chosen emotion into the delivery prompt instruct-capable engines understand
(`instruct` mode), or tidies a script with punctuation and natural `[[pause:…]]` markers
(`tidy` mode). Runs as a normal queue job (never competes with a render for VRAM) and needs a
**Prompt Assistant** model from the Models page (Qwen3 0.6B/1.7B, Apache-2.0, fully offline).
```json
{
  "mode": "instruct",              // "instruct" | "tidy"
  "text": "Halt! Who goes there? …",
  "emotion": "Excited",            // "" → the assistant infers one from the script
  "emotion_hint": "high energy …", // the preset's canned line (steers the LLM)
  "language": "te",                // script-language hint
  "voice": "Kavya",                // voice name (flavors the wording)
  "notes": "…"                     // optional extra direction (the Studio passes the current instruct)
}
```
→ `{ "job_id": "e5f6..." }`. On success `result` is:
```json
{ "mode": "instruct", "instruct": "Speak with high energy …", "model": "Prompt Assistant 0.6B" }
{ "mode": "tidy", "text": "Tidied script …", "changed": true, "rejected": null }
```
Tidy results are guarded: if the model changes the script too much (length, lost script/words),
the **original text** is returned with `changed: false` and a `rejected` reason.

### `GET /generations?limit=100&batch_id=…`
Newest first. Each record includes `file`, `duration`, `peaks` (96 values for waveform
sparklines), `engine`, `model`, `params`.

### `GET /generations/export?batch_id=…`
Streams a `.zip` with every take of a batch — the audio as `<Voice Name> - <id>.<ext>` plus a
matching `.srt` per take when it has text — ideal for game-line drops and chapter exports.

### `GET /generations/{id}/srt` — subtitles
`text/plain` SubRip attachment. Story renders use the recorded per-line timeline (exact cues);
everything else is split into sentence-sized cues with character-weighted timing.
→ `Content-Disposition: attachment; filename="heyvoice-<id>.srt"`.

### `GET /generations/{id}/chapter?fmt=m4b|mp3&title=…&artist=…&album=…&track=N`
Audiobook-ready export at **44.1 kHz** with metadata tags:
- `fmt=m4b` (default) — AAC `.m4b` with native chapter marks (**one chapter per story line**,
  titled with the line text; single-take renders get one chapter).
- `fmt=mp3` — ID3v2-tagged MP3 (`title`/`artist`/`album`/`track`).
Defaults: `title` = first 60 chars of the take's text, `artist` = voice name.
→ attachment, e.g. `Storm Chapter.m4b`.

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
- `language`: optional code (`"te"`, `"ta"`, `"hi"`, `"en"`, …); omit for auto (voice language →
  script detection → default). Indian-language text or a language hint routes to IndicF5.
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
Gated models (`indicf5`) also need a Hugging Face read token (`hf_token` setting) and a one-time
terms accept on the model page; if refused, an SSE `model_error` event arrives with
`{ "id": "indicf5", "error": "...", "gated": true, "url": "https://huggingface.co/ai4bharat/IndicF5" }`.

### `POST /models/verify`
`{ "id": "chatterbox-turbo" }` → checks every file against the manifest recorded at download
time (the first call records the baseline):
```json
{ "ok": true, "baseline": false, "files": 13, "size_gb": 4.04,
  "missing": [], "mismatched": [], "missing_count": 0 }
```
`ok: false` lists missing files in `missing` and truncated/changed files in `mismatched` —
catches interrupted downloads.

### `POST /models/repair`
`{ "id": "chatterbox-turbo" }` → `{ "started": true }`. Re-runs the resumable HF download:
complete files are skipped, partial ones continue where they left off. Progress arrives as
the usual `model` SSE events.

### `POST /models/unload`
Unloads every loaded model from VRAM.

## App updates

These power **Settings → App updates**. They are the only calls that talk to GitHub
(`GET` release metadata, then a download straight from the release asset).

### `GET /update/check`
Compares the running `VERSION` with the latest GitHub release (cached 60 s):
```json
{ "ok": true, "current": "0.2.0", "latest": "0.3.0", "update_available": true,
  "release_name": "HeyVoices 0.3.0", "release_url": "https://github.com/…/releases/tag/v0.3.0",
  "notes": "…release body (truncated)…", "published_at": "2026-10-17T04:53:28Z",
  "asset": { "name": "HeyVoices Setup 0.3.0.exe", "url": "https://github.com/…",
             "size": 173426251 },
  "auto_install": true, "repo": "pgboyahpgr-commits/heyvoices" }
```
Offline / rate-limited: `{ "ok": false, "error": "Could not reach GitHub — …" }`.
Repo without releases: `ok: true` with `no_releases: true`.

### `POST /update/download`
`{ "url": "…", "name": "HeyVoices Setup 0.3.0.exe", "size": 173426251 }` — from the check
result. Streams the installer into `data/updates/` (only github.com / *.githubusercontent.com
URLs are accepted), validates the size and the Windows `MZ` header, and reports progress on
the SSE `update` event:
```json
{ "type": "update", "data": { "phase": "download", "progress": 0.42, "received": 72843264, "total": 173426251 } }
```
→ on success `{ "file": "D:\\…\\data\\updates\\HeyVoices Setup 0.3.0.exe", "name": "…", "size": 173426251 }`.

### `POST /update/install`
`{ "file": "…" }` — must live inside `data/updates/`. Launches the installer **detached**
(Windows only), so the app can quit while it replaces the files:
→ `{ "launched": true, "file": "…" }`.

## Errors
Non-2xx responses carry `{ "detail": "human readable message" }` — surfaced verbatim as toasts
in the UI.
