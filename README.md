# HeyVoices — Local Voice Studio

[![Website](https://img.shields.io/badge/website-live-14b8a6?style=flat-square)](https://pgboyahpgr-commits.github.io/heyvoices/)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux%20%7C%20macOS-3b82f6?style=flat-square)](https://github.com/pgboyahpgr-commits/heyvoices/releases)
[![License](https://img.shields.io/badge/license-MIT-6a737e?style=flat-square)](LICENSE)

Fully-local, ElevenLabs-style AI voice studio for your own GPU. Clone any voice from a few seconds
of audio, generate speech in 25+ languages, design brand-new voices from text descriptions, and
bulk-produce voice lines for games, videos, audiobooks, and apps — with **zero cloud, zero accounts,
zero uploads**. Every model is open-licensed (Apache-2.0 / MIT).

> **Built by GeethuDino** · listen to real output on the [landing page](https://pgboyahpgr-commits.github.io/heyvoices/)

```
┌────────────────────────────────────────────────────────────┐
│  HeyVoices Studio (Electron + React)                        │
│    Studio · Story · Voices · Batch · Models · API · Settings│
└──────────────────────────┬─────────────────────────────────┘
                           │  localhost REST + SSE  (127.0.0.1:17300)
┌──────────────────────────▼─────────────────────────────────┐
│  Python backend (FastAPI)                                  │
│    job queue · voice store (SQLite) · model manager        │
│    Qwen3-TTS · Chatterbox · IndicF5 · Kokoro · Whisper     │
└──────────────────────────┬─────────────────────────────────┘
                           │
                 RTX 4060 (8 GB) — your GPU
```

---

## Features

- **Voice cloning** — drop 5–30 s of clean speech **as audio or video** (mp4/mov/mkv/webm — the
  audio track is extracted with FFmpeg, silence-trimmed and normalized); Whisper auto-transcribes
  it and Qwen3-TTS or Chatterbox clones the timbre (up to three clips of the same speaker blend
  into one sharper clone prompt). Clone an Indian-language speaker with **IndicF5** and the same
  voice speaks all 11 — Telugu, Tamil, Odia, Kannada, Malayalam, Marathi, Punjabi, Gujarati,
  Bengali, Assamese, Hindi. Reusable forever, no per-use cost. Every reference clip is **analyzed
  on arrival** (SNR, clipping, speech ratio, duration) with plain-language verdicts, and any
  transcript can be upgraded to **large-v3-turbo** in one click.
- **Voice design** — describe a voice in words ("calm middle-aged male, slightly husky") and
  generate it, then save the result as a clonable voice.
- **Story mode** — write multi-speaker scripts: every line gets its own voice, pause length and
  optional delivery instruction, rendered into one stitched track. Ideal for audiobooks, podcasts,
  game dialogue and NPC conversations. **Import a script** (or paste dialogue with `NAME:` tags)
  and the speakers are auto-detected, mapped to voices, previewed with line/duration counts, and
  loaded straight into the editor.
- **3-take compare** — render one line three times in a row and audition them side by side in the
  player: click through the takes, keep your favorite, discard the rest. (Kokoro is deterministic,
  so its takes vary pacing slightly for a meaningful comparison.)
- **Engine tuning** — per-engine advanced knobs (Chatterbox CFG/emotion, Qwen temperature/top-p/
  top-k/rep-penalty, Kokoro speed, IndicF5 speed/CFG strength) with the engine defaults shown as
  `auto` and one-click reset.
- **One-click previews** — hear any voice (cloned or preset) with a single click; takes auto-play
  when they finish. During long renders a **"Play so far"** button streams the partial audio
  rendered up to that point — no waiting for the full line.
- **35+ languages** — Qwen3-TTS (EN, ZH, JA, KO, DE, FR, RU, PT, ES, IT), Chatterbox Multilingual
  v3 (25 languages), Kokoro presets, plus 11 Indian languages with IndicF5 (Telugu, Tamil, Odia,
  Kannada, Malayalam, Marathi, Punjabi, Gujarati, Bengali, Assamese, Hindi).
- **Delivery control** — natural-language instructions (`speak slowly, whisper`) for Qwen preset
  voices; emotion-exaggeration slider and expressive tags (`[laugh]`, `[whisper]`) for Chatterbox.
- **Emotion presets + prompt assistant** — 15 one-click emotions (Excited, Whisper, Narration,
  Devotional, Game NPC…). Picking one applies a tuned delivery line instantly; a **small local LLM**
  (**Qwen3 0.6B/1.7B**, Apache-2.0, optional) refines it into a script-aware prompt for the engine
  and can **tidy your script** — punctuation and natural pauses, with hard guards so your words,
  language and script are never changed. Toggleable in Settings (default on), fully offline.
- **Script mode** — `[[pause:600ms]]` markers, automatic sentence-aware chunking, crossfade
  stitching, loudness normalization to −16 LUFS, plus find→replace **pronunciation rules**
  ("HeyVoices" → "Hey Voice") applied to every generation.
- **Effects** — gain, pitch shift, reverb, compressor (via Pedalboard), applied before export.
- **Batch** — CSV in (`Voice Name,Text` per line), named audio files out, one-click **ZIP export**
  for the whole batch — perfect for game lines. Finished renders export as **44.1 kHz MP3 with
  ID3 tags**, or as an audiobook **.m4b with per-line chapter marks**, or SubRip **.srt** subtitles
  (exact timings for Story renders) from the player dock.
- **Player dock** — waveform scrubbing, playback speed (1× / 1.25× / 1.5× / 0.75×), loop, star,
  re-roll with a new seed, download, and variant chips for 3-take batches.
- **Live queue & telemetry** — the sidebar shows real VRAM usage with a rolling sparkline; the
  queue popover lists running + waiting jobs with live progress (chunk 3/5), per-job cancel,
  reorder, and clear-queue — canceled renders stop between chunks and clean up after themselves.
- **Model integrity** — verify any downloaded model against its recorded file manifest (catches
  interrupted downloads) and repair it with a resumable re-download of just the missing files.
- **In-app updates** — Settings → App updates checks GitHub for a newer release (also quietly at
  startup), shows what's new, downloads the installer with live progress and launches it for you
  (the app closes, updates, reopens). Optional background download, a sidebar pill and a
  clickable toast flag new versions. Your voices, takes, models and settings are never touched.
- **Command palette** — `Ctrl+K` to jump anywhere or run quick actions (new voice, unload VRAM,
  open folders, check for updates…).
- **Guided tour** — a first-run walkthrough spotlights the sidebar, composer, voice rail, takes,
  player and every page (clone, story, batch, models). Replay it anytime from the sidebar footer,
  Settings → About, or `Ctrl+K`.
- **Redesigned workspace** — a single minimal grey shell: sidebar with built-in command-palette
  search, grouped navigation, and a live status column (job queue with cancel/reorder, GPU + VRAM
  telemetry with sparkline, engine state). Studio keeps its sticky voice rail and take replay, now
  as a clean flat take list, with a polished player dock. Grey + green-blue (teal) theme, a
  hand-built SVG brand mark (sidebar, splash, favicon, installer icon), and custom SVG empty-state
  illustrations — no icon fonts or raster assets.
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
drop in a short clip, and hit **Generate** in the Studio. For the 11 Indian languages add
**IndicF5** too (~1.6 GB) — it is gated on Hugging Face: click “Agree and access repository”
once on its model page (free account) and paste a read token in **Settings → Hugging Face**.
For the Emotion presets + AI prompt crafting, add **Prompt Assistant 0.6B** (~1.5 GB, optional) —
or grab it right from the Studio's Delivery panel.

### Install it (no dev tools)

Grab the latest build from the [**Releases page**](https://github.com/pgboyahpgr-commits/heyvoices/releases):

| Platform | Artifacts | Status |
| --- | --- | --- |
| **Windows 10/11** | `HeyVoices.Setup.0.3.1.exe` (assisted install) · `HeyVoices.Portable.0.3.1.exe` (no install) | ready |
| **Linux x64** | `HeyVoices-0.3.1.AppImage` · `HeyVoices-0.3.1.deb` | built by CI |
| **macOS (Apple Silicon)** | `HeyVoices-0.3.1.dmg` · `HeyVoices-0.3.1.zip` | built by CI |

The installer bundles the backend source; on first launch the app offers to set up its voice
engine — it installs a private Python 3.12 (via `uv`, downloading one if the system has none), all
dependencies, and prefetches the flagship model (~4 GB total, internet needed once, 10–30 min).
A PowerShell window shows the progress.

Build them yourself:

```powershell
cd app
npm install
npm run build        # Windows: setup + portable
npm run dist:linux   # Linux: AppImage + deb
npm run dist:mac     # macOS: dmg + zip
```

Everything user-level lives in `%APPDATA%\HeyVoices` (Python env, models, voices, outputs),
so app updates and reinstalls never touch your library. `ffmpeg` must be on PATH
(`winget install Gyan.FFmpeg`) — it powers video-clip cloning and MP3/M4B export.

On Linux/macOS, prepare the backend environment with `bash backend/scripts/setup.sh`.

## Project structure

```
backend/
  heyvoice/            # Python package
    api.py             # FastAPI routes
    jobs.py            # GPU job queue + generation pipeline
    engines/           # qwen3tts · chatterbox · indicf5 · kokoro · whisper_asr (+ vendor_f5)
    audio.py           # chunking, stitching, loudness, effects, export
    store.py           # SQLite voices + generations
  scripts/             # setup.ps1 (Windows) · setup.sh (Linux/macOS) · smoke_clone.py
app/                   # Electron + React + Tailwind UI
  electron/main.cjs    # spawns the backend, hosts the window
  src/pages/           # Studio · Story · Voices · Batch · Models · API · Settings
  build/               # icon generator + installer assets
website/               # landing page (GitHub Pages) with real generated voice demos
.github/workflows/     # Pages deploy + multi-platform release builds
docs/                  # architecture, models, roadmap, API
models/                # downloaded weights (gitignored)
data/                  # voices, outputs, SQLite db (gitignored)
```

## Docs

- [Architecture](docs/ARCHITECTURE.md) — how the pieces fit together
- [Models](docs/MODELS.md) — catalog, licenses, VRAM budget, quality tips
- [API](docs/API.md) — REST reference and integration examples
- [MCP](docs/MCP.md) — use HeyVoices as agent tools (Claude, Cursor, SDK agents)
- [Roadmap](docs/ROADMAP.md) — phases and status
- [Website](website/index.html) — the landing page (deployed to GitHub Pages)

## Licensing

All bundled models are permissively licensed (Qwen3-TTS Apache-2.0, Chatterbox MIT,
Kokoro Apache-2.0, IndicF5 MIT, Whisper MIT). No non-commercial weights are used, so your outputs
— and this app — stay product-safe. HeyVoices itself is MIT-licensed (see [LICENSE](LICENSE)) —
built by GeethuDino.
