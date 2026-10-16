# Roadmap

## Phase 0 — Spark ✅ (current)
- [x] Project scaffold: backend (uv + FastAPI), app (Electron + React + Tailwind), docs
- [x] Engine plugin interface + model catalog + download manager
- [x] Qwen3-TTS adapter (Base / CustomVoice / VoiceDesign)
- [x] Chatterbox adapter (Multilingual v3 + Turbo) with runtime API introspection
- [x] Kokoro adapter (CPU presets)
- [x] Whisper ASR for ref-text + upload transcription
- [x] Generation pipeline: chunking, `[[pause:ms]]`, crossfade, LUFS, effects (pedalboard)
- [x] Job queue + SSE progress
- [x] Full REST API + `/speak` integration endpoint
- [x] Desktop UI: Studio, Voices (clone + design wizards), Batch, Models, API, Settings
- [x] Docs: README, ARCHITECTURE, MODELS, API, ROADMAP
- [x] Smoke test on hardware (`backend/scripts/smoke_clone.py`) — **passed on RTX 4060 Laptop**:
      Qwen3-TTS 0.6B Base loads in ~11 s, 2.0 GB allocated / 2.4 GB peak VRAM;
      ~29 s cold and ~10 s warm for 7.4 s of speech (RTF ≈ 1.35× warm)
- [x] Full app loop verified: clone → generate in UI → SSE progress → take list → player

## Phase 1 — Engine core hardening
- [x] Multi-sample cloning: 1–3 clips per voice merge into **one** clone prompt — ICL code streams
      concatenated, transcripts joined, speaker embeddings averaged (Qwen3-TTS); verified with a
      2-clip voice producing clean takes
- [x] Clone from audio **or video** clips: FFmpeg extracts the audio track (mp4/mov/mkv/webm/avi…),
      edge silence trimmed, loudness-normalized, capped at 60 s; reference is auditionable in the
      wizard (`/files/uploads`) before creating the voice
- [ ] Streaming playback for Qwen (97 ms first-packet streaming path)
- [ ] Per-engine parameter surface in the UI (auto-shown based on capabilities)
- [ ] Model integrity checks + resume-aware download UI
- [ ] VRAM telemetry panel (live allocation graph)

## Phase 2 — Creation power tools
- [x] Stories mode: multi-speaker editor — per-line voice, pause and delivery, one stitched render
- [x] Pronunciation overrides (Settings → Text & pronunciation, applied before synthesis)
- [x] Batch v2: zip export of a finished batch
- [x] Command palette (`Ctrl+K`): navigation + quick actions
- [x] UI 2.0 refresh: command bar with live GPU/VRAM status, grouped sidebar, Studio voice rail,
      always-visible take replay, ambient dark theme, page transitions
- [x] UI 3.0 polish: professional graphite + indigo palette (no neon glows), custom SVG brand mark
      (app icon + favicon + animated splash), SVG empty-state illustrations, softer shadows/rings
- [x] Audiobook & subtitle export: per-take **.srt** (exact per-line timings for Story renders,
      sentence-weighted approximation otherwise; batch ZIPs include each take's .srt), 44.1 kHz
      **.m4b** with per-line chapter marks + tags, and 44.1 kHz **.mp3** with ID3v2 tags — all in
      the player dock's export menu
- [ ] Text expansion: numbers/dates/units (SSML-lite)
- [ ] Batch v2 (rest): per-row settings, retries, folder-per-character naming schemes

## Phase 3 — Integrations
- [x] MCP server (Claude/agents can call `speak` as a tool) — stdio server over the local REST
      API, 7 tools, verified end-to-end with the official SDK client (docs/MCP.md)
- [ ] Global-hotkey dictation (Whisper + OS-wide paste)
- [ ] Webhooks on generation completion for pipelines (Streamer.bot, OBS)

## Phase 4 — Packaging & polish
- [ ] Single-file installer (NSIS) with embedded Python runtime — no dev tools needed
  - [x] NSIS installer bundles the backend source; first launch auto-installs the Python env
        (uv-managed 3.12 + dependencies + model prefetch — internet once) and stores everything in
        `%APPDATA%\HeyVoice`; packaged app verified end-to-end on hardware (spawns its own backend
        with user-dir data/models)
  - [ ] Fully offline install: Python wheels + models bundled in the installer
- [ ] Auto-updates, crash reports stored locally
- [ ] First-run model picker tuned per GPU

## Phase 5 — Expanding the engine set
- [ ] LuxTTS (style transfer) if licenses check out
- [ ] k2-fsa OmniVoice (646 languages) as an optional heavyweight engine
- [ ] Fine-tune wizard for Qwen3-TTS (LoRA on personal recordings)
- [ ] ACE-Step / music-bed mixing for YouTube workflows

## Ideas backlog
- Voice "blending" (interpolate two clone prompts)
- Take comparison A/B player
- Discord/Twitch read-aloud bridge
