# Model Catalog

All models are downloaded on demand from Hugging Face into `models/hf` and are **permissively
licensed** — safe for personal use *and* for shipping products built on their outputs.

| Model | Engine | Params | Download | VRAM | License | Languages | Role |
|---|---|---|---|---|---|---|---|
| Qwen3-TTS 0.6B Base | Qwen3-TTS | 0.6B | ~1.4 GB | ~2.4 GB | Apache-2.0 | 10 | **Voice cloning (recommended)** |
| Qwen3-TTS 1.7B Base | Qwen3-TTS | 1.7B | ~3.6 GB | ~6.5 GB | Apache-2.0 | 10 | Cloning, richer prosody |
| Qwen3-TTS 0.6B CustomVoice | Qwen3-TTS | 0.6B | ~1.4 GB | ~2.5 GB | Apache-2.0 | 10 | 9 preset speakers + instructions |
| Qwen3-TTS 1.7B CustomVoice | Qwen3-TTS | 1.7B | ~3.6 GB | ~6.5 GB | Apache-2.0 | 10 | Higher-quality presets |
| Qwen3-TTS 1.7B VoiceDesign | Qwen3-TTS | 1.7B | ~3.6 GB | ~6.5 GB | Apache-2.0 | 10 | Invent voices from descriptions |
| Chatterbox Multilingual v3 | Chatterbox | 0.5B | ~1.2 GB | ~3 GB | MIT | 25 | Broadest language coverage |
| Chatterbox Turbo | Chatterbox | 350M | ~1 GB | ~2.5 GB | MIT | EN | Fast + expressive tags |
| Kokoro 82M | Kokoro | 82M | ~0.4 GB | CPU | Apache-2.0 | 8 | Instant preset voices |
| Whisper `small` (faster-whisper) | ASR | 244M | ~0.5 GB | ~1.5 GB | MIT | 99 | Ref-text transcription (default) |
| Whisper `large-v3-turbo` | ASR | 809M | ~1.6 GB | ~2 GB | MIT | 99 | "Better transcript" upgrade — names, numbers, punctuation |

**Recommended starter set (~3 GB):** Qwen3-TTS 0.6B Base + Chatterbox + Kokoro.

Every downloaded model gets a **file manifest** written at download time. The Models page can
**Verify** any model against it (first run records the baseline) and **Repair** — a resumable
re-download that only fetches missing or truncated files. Interrupted downloads are caught and
fixed in place; no full re-download needed.

## Engines in detail

### Qwen3-TTS (flagship)
- 3-second zero-shot cloning; quality improves with 10–30 s references.
- **Clone mode wants a transcript of the reference clip.** HeyVoice transcribes it with Whisper
  automatically at upload; if transcription fails it falls back to `x_vector_only` (lower fidelity,
  still usable). Editing the transcript in the voice editor is worth it for best results.
- Preset speakers (CustomVoice): Vivian, Serena, Uncle Fu, Dylan, Eric, Ryan, Aiden, Ono Anna,
  Sohee — steer delivery with instructions like "excited and energetic".
- VoiceDesign: describe → generate → save as a clonable voice (HeyVoice automates the whole loop).
- Note: cloning and emotion-instruction control can't be combined on the same generation.

### Chatterbox (Resemble AI, MIT)
- Multilingual v3: 25 languages (en ar da de el es fi fr he hi it ja ko ms nl no pl pt ru sv sw tr
  zh cs hu), zero-shot cloning, emotion exaggeration slider.
- Turbo: hundreds of milliseconds-class English model that understands paralinguistic tags:
  `[laugh] [chuckle] [sigh] [gasp] [whisper] [angry] [happy] [sad] [dramatic] [narration]`.
  Verified on the RTX 4060 (10 s expressive take, cloning + tags together). The package's built-in
  loudness norm hands the reference clip to the tokenizer as float64 and crashes — HeyVoice disables
  it (references are pre-normalized) and patches the tokenizer to be dtype-safe.
- Outputs embed an inaudible **PerTh watermark** — keep in mind for "clean" deliverables.

### Kokoro (Apache-2.0)
- 82M params, runs on CPU in realtime — zero VRAM cost. Preset voices only (no cloning).
- Great for drafts, long lists, and when the GPU is busy.

## Hardware guidance (RTX 4060 Laptop, 8 GB)

| Combination | Works? | Notes |
|---|---|---|
| Qwen 0.6B Base alone | ✅ | ~3.5 GB, comfortable; fastest good-quality cloning |
| Chatterbox ML + Turbo swapping | ✅ | ~3 GB each, auto-unload handles it |
| Qwen 1.7B variants | ✅ | ~6.5 GB — close browsers/games first |
| Everything at once | ❌ | Single-model residency is enforced by design |

Measured on the reference machine (RTX 4060 Laptop, 8 GB) via `backend/scripts/smoke_clone.py`
with Qwen3-TTS 0.6B Base and an ~8 s reference clip:

| Metric | Value |
|---|---|
| Model load time (cold) | ~11 s |
| VRAM after load | 2.0 GB (2.4 GB peak while generating) |
| 7.4 s of speech, first run | ~29 s (includes warm-up) |
| 7.4 s of speech, warm | ~10 s (RTF ≈ 1.35×) |

Run the script yourself after setup to compare on your hardware.

**All engines verified working** (full UI + API pass, 2026-10-17):

| Engine / flow | Verified | Cold timing (includes model load) |
|---|---|---|
| Qwen3-TTS 0.6B Base — cloned voice | ✅ | 7.4 s speech in ~23 s first run, ~10 s warm |
| Story mode — 2 voices stitched, per-line pauses | ✅ | 6.6 s track in ~12 s warm (0.6B Base) |
| Kokoro 82M — preset voice on CPU | ✅ | 4.4 s speech in ~18 s first run, then ~1–2 s |
| Chatterbox Multilingual — clone + `[laugh]` tags | ✅ | 6.4 s speech in ~22 s first run |
| Qwen3-TTS 1.7B VoiceDesign — description → voice | ✅ | 5.9 s speech in ~26 s first run, saved as a new voice |

**Disk notes:** HuggingFace repos carry more than the runtime weights — `ResembleAI/chatterbox`
pulls ~16 GB (all variants + dev artifacts) and VoiceDesign ~9 GB on disk. Disk is only needed
once; the catalog's `size_gb` reflects the runtime footprint, not the repo size.

## Quality tips (this is 80% of clone quality)

1. **Reference audio: 10–30 s of clean, single-speaker speech, no music, no reverb.**
2. Provide the transcript (auto or corrected) — biggest quality jump for Qwen3-TTS. The voice
   editor's **Better transcript** button re-runs ASR with large-v3-turbo when the auto one fumbles
   names, numbers, or punctuation.
3. If a clone sounds flat, record 20–30 s with varied intonation, not monotone reading.
4. For languages with tone (zh/ja/ko), use references in the same language you'll synthesize.
5. Cloning is voice *transfer*, not acting: put emotion into the text's punctuation and the
   Delivery panel; don't rely on the reference clip's mood.
6. Chatterbox exaggeration ~0.5 is neutral; push to 0.8–1.2 for character work.

## License traps (deliberately excluded)

| Model | Why excluded |
|---|---|
| XTTS v2 (Coqui) | Coqui Public Model License — non-commercial |
| F5-TTS | Weights CC-BY-NC |
| IndexTTS-2 | Additional restrictions |
| Fish Speech S2 | Research-only license |
