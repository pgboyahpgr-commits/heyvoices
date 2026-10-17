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
- [x] Reference quality analysis: every clip scored on arrival (SNR, clipping, speech ratio,
      duration) with plain-language notes + verdict chips in the wizard
- [x] One-click transcript upgrade: re-run ASR with large-v3-turbo on any upload or stored sample
      (updates the transcript in place, invalidates the cached clone prompt)
- [x] Per-engine parameter surface in the UI: Chatterbox CFG/emotion, Qwen temperature/top-p/top-k/
      rep-penalty, Kokoro speed, IndicF5 speed/CFG strength — engine defaults shown as `auto`,
      one-click reset, values recorded in `params.tuning`; `seed` now fixes the sampler for
      reproducible takes
- [x] Model integrity checks + resume-aware download UI: per-model **Verify** (manifest baseline
      recorded on first run) and one-click **Repair** (resumable re-download of missing files)
- [x] VRAM telemetry: live `/system/vram` poll with rolling sparkline + peak tooltip in the top bar
- [x] Job queue v2: cooperative cancel (instant for queued, between-chunks for running), reorder,
      clear-queue, live chunk progress, and "play so far" partial previews written after every
      finished chunk/line
- [ ] Streaming playback for Qwen (97 ms first-packet streaming path)

## Phase 2 — Creation power tools
- [x] Stories mode: multi-speaker editor — per-line voice, pause and delivery, one stitched render
- [x] Pronunciation overrides (Settings → Text & pronunciation, applied before synthesis)
- [x] Batch v2: zip export of a finished batch
- [x] Command palette (`Ctrl+K`): navigation + quick actions
- [x] UI 2.0 refresh: command bar with live GPU/VRAM status, grouped sidebar, Studio voice rail,
      always-visible take replay, ambient dark theme, page transitions
- [x] UI 3.0 polish: professional graphite + indigo palette (no neon glows), custom SVG brand mark
      (app icon + favicon + animated splash), SVG empty-state illustrations, softer shadows/rings
- [x] UI 4.0 redesign: warm graphite + amber palette (pro-audio console feel, no neon), ink-on-amber
      brand mark across sidebar/splash/favicon/installer icon, warm ambient glows, focus rings and
      selection accents to match
- [x] UI 5.0 redesign: minimal grey shell with a green-blue (teal) accent — top bar removed, queue +
      GPU/VRAM telemetry + engine state folded into the sidebar, command-palette search moved to the
      sidebar, shared PageHeader on every page, takes as a flat list, flat surfaces and quiet borders
      throughout, teal-blue brand mark (sidebar/splash/favicon/installer icon)
- [x] Audiobook & subtitle export: per-take **.srt** (exact per-line timings for Story renders,
      sentence-weighted approximation otherwise; batch ZIPs include each take's .srt), 44.1 kHz
      **.m4b** with per-line chapter marks + tags, and 44.1 kHz **.mp3** with ID3v2 tags — all in
      the player dock's export menu
- [x] Script import: paste a script (or `NAME:`-tagged dialogue) → speakers auto-detected, mapped
      to voices, line/duration preview → loaded straight into the story editor
- [x] Take comparison player: render 3 takes of a line, audition them side by side with variant
      chips, keep the best and discard the rest in one click
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
        `%APPDATA%\HeyVoices`; packaged app verified end-to-end on hardware (spawns its own backend
        with user-dir data/models)
  - [ ] Fully offline install: Python wheels + models bundled in the installer
- [x] Multi-platform builds: **Windows** setup + portable (assisted NSIS installer, no-install
      portable exe), **Linux** AppImage + deb, **macOS** dmg + zip — electron-builder targets plus a
      CI release workflow that builds all three platforms on every `v*` tag
- [x] `setup.sh` — Linux/macOS backend setup (uv, Python 3.12 venv, CUDA/MPS torch, requirements,
      prefetch + self-check)
- [ ] Auto-updates, crash reports stored locally
- [ ] First-run model picker tuned per GPU

## Phase 5 — Expanding the engine set
- [x] **IndicF5 (AI4Bharat, MIT)** — 11 Indian languages (Telugu, Tamil, Odia, Kannada, Malayalam,
      Marathi, Punjabi, Gujarati, Bengali, Assamese, Hindi) with zero-shot cloning from one clip +
      transcript; language-aware auto-routing + script detection, 5 bundled preset voices, vendored
      MIT inference code (`engines/vendor_f5/`), gated-download UX (HF terms accept + token in
      Settings) — verified end-to-end on the RTX 4060 (te/ta/or/hi/ml/bn generation, ASR round-trip)
- [x] **Hardening pass (round 2)** — ref clip/transcript pairing + >15 s clip transcript trimming,
      danda-aware Hindi/Marathi chunking, `ळ`-based Marathi detection, text-script override for auto
      language (Telugu text on any voice reaches IndicF5), bounded Qwen3-TTS decode with an
      unstable-output guard, `language` param on `/speak` + MCP `speak`
- [ ] LuxTTS (style transfer) if licenses check out
- [ ] k2-fsa OmniVoice (646 languages) as an optional heavyweight engine
- [ ] Fine-tune wizard for Qwen3-TTS (LoRA on personal recordings)
- [ ] ACE-Step / music-bed mixing for YouTube workflows

## Phase 6 — Brand, tour & web presence
- [x] Rename HeyVoice → HeyVoices everywhere user-visible (UI, splash, installer/productName, MCP
      server, export filenames, docs) — internal identifiers (`heyvoice` package, `window.heyvoice`
      bridge, env vars) kept for stability
- [x] In-app guided tour: 11 page-aware steps with spotlight overlay — first-run auto-start plus
      replay from the sidebar footer, Settings → About and `Ctrl+K`; completion remembered
- [x] "Built by GeethuDino" attribution (sidebar, Settings, installer copyright, README, website)
- [x] Landing page (`website/`) with real generated-voice demos rendered by HeyVoices itself —
      grey + teal aesthetic matching the app, deployed to GitHub Pages via Actions
- [x] Public repo hygiene: MIT LICENSE, README badges + download matrix, release workflow
      (Win/Linux/macOS artifacts), Pages deploy workflow

## Ideas backlog
- Voice "blending" (interpolate two clone prompts)
- Discord/Twitch read-aloud bridge
