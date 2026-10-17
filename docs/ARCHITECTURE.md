# Architecture

## Process model

| Process | Tech | Role |
|---|---|---|
| Electron main (`app/electron/main.cjs`) | Node | Creates the window, spawns the Python backend if not already running, kills it on quit |
| Renderer (`app/src`) | React 18 + Tailwind 4 + Zustand | The UI. Talks to the backend over `http://127.0.0.1:17300` |
| Backend (`backend/heyvoice`) | Python 3.12 + FastAPI + uvicorn | GPU work, storage, model management |

The backend binds **127.0.0.1 only**. CORS is open for the local Vite dev server.

## Backend modules

```
heyvoice/
  config.py      paths (data/, models/), settings.json persistence, port/host
  events.py      thread-safe SSE broadcaster (worker threads → asyncio queues)
  store.py       SQLite (WAL): voices, generations; JSON columns for samples/params/peaks
  audio.py       chunk_text ([[pause:ms]] aware), crossfade stitch, trim,
                 LUFS normalize (pyloudnorm), effects (pedalboard), peaks, export (ffmpeg)
  jobs.py        single GPU worker thread + Job objects; resolve_engine() decides which
                 engine/model serves a voice; ensure_model() does LRU VRAM swapping
  engines/
    base.py      EngineBase + EngineCaps + GenRequest (the plugin interface)
    qwen3tts.py  Base (cloning), CustomVoice (presets + instruct), VoiceDesign
    chatterbox.py Multilingual v3 + Turbo; API introspected at load time
    kokoro.py    KPipeline presets, CPU-only
    indicf5.py   IndicF5 (11 Indian languages, zero-shot cloning) + 5 bundled presets
    vendor_f5/   vendored MIT F5-TTS inference code used by indicf5.py (no remote code)
    whisper_asr.py  faster-whisper: ref-text transcription
  api.py         REST + SSE routes
  main.py        FastAPI app, static mounts (/files/outputs, /files/voices), startup
```

### The generation pipeline (`jobs.h_generate`)

1. Resolve `(engine, model)` for the requested voice — explicit `model` param wins, otherwise
   the voice's engine hint, otherwise Auto: **Indic languages + a clone → IndicF5** (Hindi can
   fall back to Chatterbox; preset voices stay on their own engine); cloned → Qwen 0.6B Base →
   1.7B Base → Chatterbox; preset speakers → CustomVoice models; Kokoro presets → Kokoro.
   When the language is `auto`, the script of the text is detected (Devanagari, Gurmukhi, Tamil,
   Telugu, Kannada, Malayalam, Odia, Gujarati, Bengali) and overrides a mismatched voice default,
   so pasting Telugu always reaches IndicF5 (or a clear prompt on voices that can't speak it).
2. `ensure_model()` — unload other engines (auto-unload setting; the Whisper ASR model is freed
   as well when a model with ≥5 GB needs the room) and load the target with
   `dtype=bfloat16` (CUDA) and `attn_implementation="sdpa"`.
3. Chunk text (sentence-aware, honors `[[pause:600ms]]`) at `chunk_max_chars` (default 280).
4. Generate each chunk; progress events (`0.05 → 0.85`) stream over SSE.
5. Stitch with crossfade (default 60 ms) or explicit pause gaps; trim leading/trailing silence.
6. Apply effects (gain, pitch, reverb, compressor, filters) if set.
7. Loudness-normalize (default −16 LUFS), peak-safe.
8. Write master WAV `data/outputs/<gen-id>.wav`, export requested format via ffmpeg,
   compute 96-bucket peaks for UI sparklines, insert the generation row, emit `generation` event.

Clone prompts (Qwen) are cached **in memory per voice** — rebuilding them costs 1–2 s and
persisting GPU tensors across restarts is fragile, so the cache is intentionally volatile.

### Jobs & events

One worker thread owns the GPU. `POST /generate` returns `{job_id}` immediately. The UI listens
on `GET /system/events` (SSE) for `job`, `model`, `voices`, `generation`, `engine`, `settings`
events. Synchronous needs (transcription during voice upload, `/speak`) wait on the job's
`threading.Event` via `asyncio.to_thread`.

## Data model (SQLite `data/heyvoice.db`)

```
voices(id, name, description, kind[cloned|preset|designed], engine, language, color,
       favorite, samples JSON[{id,file,url,transcript,duration}], meta JSON, created_at)

generations(id, voice_id, voice_name, text, engine, model, language, params JSON,
            file, duration, peaks JSON, favorite, batch_id, created_at)
```

Voice sample audio lives in `data/voices/<voice-id>/<sample-id>.wav` (24 kHz mono, loudness-
normalized at ingest). Outputs live in `data/outputs/`. Both are served read-only under `/files/`.

## VRAM strategy (8 GB cards)

- One TTS model resident at a time; `auto_unload` swaps on demand (LRU = whoever is loaded).
- Whisper `small` runs float16 on CUDA but is unloaded when idle in future phases; tiny CPU cost.
- bf16 weights + SDPA attention; **no flash-attn** (no official Windows wheels — do not enable).
- Kokoro runs on **CPU** deliberately, freeing VRAM entirely.
- Budgets: Qwen 0.6B ≈ 2.4 GB peak (measured on the RTX 4060), Chatterbox ≈ 3 GB,
  IndicF5 ≈ 2.2 GB peak (1.4 GB resident), Qwen 1.7B/VoiceDesign ≈ 6.5 GB (tight, works when
  nothing else is loaded).

## Frontend structure

```
app/src/
  lib/api.ts     typed fetch client for every endpoint
  lib/store.ts   Zustand store: data caches, SSE subscription, job tracking, toasts, drafts
  components/    Sidebar (status + nav) · Player (WaveSurfer dock) · ui.tsx (Avatar, Modal,
                 Slider, Toggle, Progress, Toasts, formatters)
  pages/         Studio · Voices (clone wizard, design wizard) · Batch · Models · ApiPage · Settings
```

The Electron preload exposes `window.heyvoice.{openPath, showItem, backendUrl}` for native
folder actions. Everything else is plain web APIs, so the UI also runs in a browser (`npm run dev:ui`).

## Ports & paths

| Thing | Where |
|---|---|
| Backend API | `http://127.0.0.1:17300` |
| Vite dev UI | `http://127.0.0.1:5173` |
| Models | `models/` (`HF_HOME=models/hf`, whisper in `models/whisper`) |
| Data | `data/` (override with `HEYVOICE_DATA_DIR`, `HEYVOICE_MODELS_DIR`) |
| Settings | `data/settings.json` |
