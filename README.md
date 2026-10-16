# HeyVoice — Local Voice Studio

Fully-local, ElevenLabs-style AI voice studio for your own GPU. Clone any voice from a few seconds
of audio, generate speech in 25+ languages, design brand-new voices from text descriptions, and
bulk-produce voice lines for games, videos, audiobooks, and apps — with **zero cloud, zero accounts,
zero uploads**. Every model is open-licensed (Apache-2.0 / MIT).

```
┌────────────────────────────────────────────────────────────┐
│  HeyVoice Studio (Electron + React)                        │
│    Studio · Story · Voices · Batch · Models · API · Settings│
└──────────────────────────┬─────────────────────────────────┘
                           │  localhost REST + SSE  (127.0.0.1:17300)
┌──────────────────────────▼─────────────────────────────────┐
│  Python backend (FastAPI)                                  │
│    job queue · voice store (SQLite) · model manager        │
│    Qwen3-TTS · Chatterbox · Kokoro · Whisper               │
└──────────────────────────┬─────────────────────────────────┘
                           │
                 RTX 4060 (8 GB) — your GPU
```

---

## Features

- **Voice cloning** — drop 5–30 s of clean speech **as audio or video** (mp4/mov/mkv/webm — the
  audio track is extracted with FFmpeg, silence-trimmed and normalized); Whisper auto-transcribes
  it and Qwen3-TTS or Chatterbox clones the timbre. Add up to three clips of the same speaker and
  they are blended into one clone prompt for a sharper match. Reusable forever, no per-use cost.
- **Voice design** — describe a voice in words ("calm middle-aged male, slightly husky") and
  generate it, then save the result as a clonable voice.
- **Story mode** — write multi-speaker scripts: every line gets its own voice, pause length and
  optional delivery instruction, rendered into one stitched track. Ideal for audiobooks, podcasts,
  game dialogue and NPC conversations.
- **One-click previews** — hear any voice (cloned or preset) with a single click; takes auto-play
  when they finish.
- **25+ languages** — Qwen3-TTS (EN, ZH, JA, KO, DE, FR, RU, PT, ES, IT), Chatterbox Multilingual
  v3 (25 languages), Kokoro presets.
- **Delivery control** — natural-language instructions (`speak slowly, whisper`) for Qwen preset
  voices; emotion-exaggeration slider and expressive tags (`[laugh]`, `[whisper]`) for Chatterbox.
- **Script mode** — `[[pause:600ms]]` markers, automatic sentence-aware chunking, crossfade
  stitching, loudness normalization to −16 LUFS, plus find→replace **pronunciation rules**
  ("HeyVoice" → "Hey Voice") applied to every generation.
- **Effects** — gain, pitch shift, reverb, compressor (via Pedalboard), applied before export.
- **Batch** — CSV in (`Voice Name,Text` per line), named audio files out, one-click **ZIP export**
  for the whole batch — perfect for game lines. Finished renders export as **44.1 kHz MP3 with
  ID3 tags**, or as an audiobook **.m4b with per-line chapter marks**, or SubRip **.srt** subtitles
  (exact timings for Story renders) from the player dock.
- **Player dock** — waveform scrubbing, playback speed (1× / 1.25× / 1.5× / 0.75×), loop, star,
  re-roll with a new seed, download.
- **Command palette** — `Ctrl+K` to jump anywhere or run quick actions (new voice, unload VRAM,
  open folders…).
- **Redesigned workspace** — command bar with live GPU/VRAM status, grouped sidebar, and a Studio
  with a sticky voice rail, always-visible take replay, and a polished player dock. Professional
  graphite + indigo theme, a hand-built SVG brand mark (sidebar, splash, favicon, app icon), and
  custom SVG empty-state illustrations — no icon fonts or raster assets.
- **Local API** — REST + SSE for apps, agents, and stream tooling. `POST /speak` is a one-call
  text-to-audio endpoint. A built-in **MCP server** lets Claude and other agents call
  `speak`/`list_voices` directly — see [docs/MCP.md](docs/MCP.md).
- **8 GB VRAM friendly** — one model resident at a time, automatic LRU unloading, bf16, SDPA
  attention (no flash-attn required).

## Quickstart

**Requirements:** Windows 10/11, NVIDIA GPU (6 GB+ VRAM recommended), Python 3.12, Node 20+,
[uv](https://docs.astral.sh/uv/), and `ffmpeg` on PATH.

```powershell
# 1) Backend (creates backend\.venv, installs CUDA torch + engines, prefetches Qwen 0.6B)
powershell -ExecutionPolicy Bypass -File backend\scripts\setup.ps1
# only if setup reports the transformers conflict fix is needed:
powershell -ExecutionPolicy Bypass -File backend\scripts\fix_install.ps1

# 2) Frontend
cd app
npm install

# 3) Run (starts Vite + Electron; Electron boots the Python backend automatically)
npm run dev
```

First launch: open **Models** and download the recommended set
(Qwen3-TTS 0.6B Base, Chatterbox, Kokoro ≈ 3 GB total). Then open **Voices → New voice**,
drop in a short clip, and hit **Generate** in the Studio.

### Install it (no dev tools)

Build the installer with `cd app; npm run build` → `app\dist\HeyVoice Setup 0.1.0.exe`
(≈165 MB, NSIS, per-user install). It bundles the backend source; on first launch the app
offers to set up its voice engine — it installs a private Python 3.12 (via `uv`, downloading
one if the system has none), all dependencies, and prefetches the flagship model
(~4 GB total, internet needed once, 10–30 min). A PowerShell window shows the progress.

Everything user-level lives in `%APPDATA%\HeyVoice` (Python env, models, voices, outputs),
so app updates and reinstalls never touch your library. `ffmpeg` must be on PATH
(`winget install Gyan.FFmpeg`) — it powers video-clip cloning and MP3/M4B export.

## Project structure

```
backend/
  heyvoice/            # Python package
    api.py             # FastAPI routes
    jobs.py            # GPU job queue + generation pipeline
    engines/           # qwen3tts · chatterbox · kokoro · whisper_asr
    audio.py           # chunking, stitching, loudness, effects, export
    store.py           # SQLite voices + generations
  scripts/             # setup.ps1, fix_install.ps1, smoke_clone.py
app/                   # Electron + React + Tailwind UI
  electron/main.cjs    # spawns the backend, hosts the window
  src/pages/           # Studio · Story · Voices · Batch · Models · API · Settings
docs/                  # architecture, models, roadmap, API
models/                # downloaded weights (gitignored)
data/                  # voices, outputs, SQLite db (gitignored)
```

## Docs

- [Architecture](docs/ARCHITECTURE.md) — how the pieces fit together
- [Models](docs/MODELS.md) — catalog, licenses, VRAM budget, quality tips
- [API](docs/API.md) — REST reference and integration examples
- [MCP](docs/MCP.md) — use HeyVoice as agent tools (Claude, Cursor, SDK agents)
- [Roadmap](docs/ROADMAP.md) — phases and status

## Licensing

All bundled models are permissively licensed (Qwen3-TTS Apache-2.0, Chatterbox MIT,
Kokoro Apache-2.0, Whisper MIT). No non-commercial weights are used, so your outputs — and this
app — stay product-safe. HeyVoice itself is your project; treat it as MIT for personal use.
