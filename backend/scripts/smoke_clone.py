"""Phase-0 smoke test: clone a voice from a short clip and generate a line.

Usage (from the backend folder, with the venv python):
    .venv\\Scripts\\python.exe scripts\\smoke_clone.py [path\\to\\reference.wav]

Without an argument it downloads Qwen's official demo clip. Prints timings and
VRAM so we can measure real RTF on the target machine.
"""
from __future__ import annotations

import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from heyvoice import config  # noqa: E402
from heyvoice.audio import duration_of, normalize_loudness, save_wav, to_wav24k  # noqa: E402
from heyvoice.engines.base import GenRequest  # noqa: E402
from heyvoice.engines.qwen3tts import Qwen3TTSEngine  # noqa: E402

DEMO_URL = "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-TTS-Repo/clone.wav"
TEXT = ("HeyVoice is running fully locally on this laptop, with a voice cloned from just a few seconds "
        "of audio. No cloud, no accounts - just a graphics card and open models.")


def main() -> None:
    import torch

    sample_dir = config.DATA_DIR / "samples"
    sample_dir.mkdir(parents=True, exist_ok=True)

    ref_raw = Path(sys.argv[1]) if len(sys.argv) > 1 else sample_dir / "demo_clone.wav"
    if not ref_raw.exists():
        print(f"Downloading demo clip -> {ref_raw}", flush=True)
        urllib.request.urlretrieve(DEMO_URL, ref_raw)

    ref = sample_dir / "ref_24k.wav"
    if not to_wav24k(ref_raw, ref):
        raise SystemExit("ffmpeg could not convert the reference clip")
    print(f"Reference: {ref} ({duration_of(ref):.1f}s)", flush=True)

    print("Transcribing reference with Whisper...", flush=True)
    t0 = time.time()
    from heyvoice.engines.whisper_asr import asr

    ref_text = asr.transcribe(ref)
    print(f"  ({time.time() - t0:.1f}s) ref_text: {ref_text!r}", flush=True)

    engine = Qwen3TTSEngine()
    print("Loading Qwen3-TTS 0.6B Base...", flush=True)
    t0 = time.time()
    engine.load("qwen3-tts-0.6b-base")
    print(f"  loaded in {time.time() - t0:.1f}s", flush=True)
    if torch.cuda.is_available():
        print(f"  VRAM allocated after load: {torch.cuda.memory_allocated() / 1024**3:.2f} GB", flush=True)
        torch.cuda.reset_peak_memory_stats()

    print("Generating...", flush=True)
    req = GenRequest(text=TEXT, language="en", ref_audio=str(ref), ref_text=ref_text, voice_key="smoke")
    t0 = time.time()
    audio, sr = engine.generate(req)
    wall = time.time() - t0

    audio = normalize_loudness(audio, sr, -16.0)
    out = config.OUTPUTS_DIR / "smoke_clone.wav"
    save_wav(out, audio, sr)
    seconds = len(audio) / sr
    print(f"Saved {out}", flush=True)
    print(f"audio {seconds:.2f}s | wall {wall:.2f}s | RTF {wall / max(seconds, 0.01):.2f}x", flush=True)
    if torch.cuda.is_available():
        print(f"VRAM peak: {torch.cuda.max_memory_allocated() / 1024**3:.2f} GB", flush=True)
    print("SMOKE TEST OK", flush=True)


if __name__ == "__main__":
    main()
