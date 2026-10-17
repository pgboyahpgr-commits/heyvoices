# Vendored F5-TTS inference code

This folder is a trimmed copy of the inference code used by **IndicF5**
(AI4Bharat), which builds on **F5-TTS** (SWivid). Both are MIT licensed —
see [LICENSE](LICENSE).

## Source

- IndicF5 — https://github.com/AI4Bharat/IndicF5
  @ `13f7c4d627cc10111aea8fe9c0039462cacacdc7` (2025-09-24)
- F5-TTS — https://github.com/SWivid/F5-TTS (inference stack)

## What was changed

- `model/` keeps only what inference needs: `CFM`, `DiT`, `modules`, `utils`.
  Training scripts, datasets, CLI and the demo server are not vendored.
- Imports are relative (`f5_tts.*` → `.*`) — nothing is installed under the
  `f5_tts` package name, so there is no chance of resolving a different version.
- `infer_utils.py` is a rewritten, trimmed version of the upstream
  `utils_infer.py`:
  - the vocoder is **vocos only**, loaded from local files (no network access)
  - the whisper ASR fallback for an empty reference text is removed — the app
    always supplies the transcript of the reference clip
  - spectrogram plotting (matplotlib) removed
  - explicit `device` arguments instead of module-level globals

Nothing executes remote code: no `trust_remote_code`, no `torch.compile`.
Model weights, vocab and vocoder are loaded from the local model snapshot, so
generation works fully offline once the model is downloaded.

The vocos implementation itself is *not* vendored — it is the `vocos` pip
package (MIT, https://github.com/gemelo-ai/vocos), loaded from a local
snapshot of `charactr/vocos-mel-24khz`.
