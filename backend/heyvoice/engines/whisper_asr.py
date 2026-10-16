"""Whisper ASR (faster-whisper) — auto-transcribes voice samples (required for
best Qwen3-TTS clone quality) and powers dictation later."""
from __future__ import annotations

import threading
from pathlib import Path

from ..config import WHISPER_DIR

SIZES = ["tiny", "base", "small", "medium", "large-v3", "turbo"]


class WhisperASR:
    def __init__(self) -> None:
        self.model = None
        self.size: str | None = None
        self.device = "cpu"
        self._lock = threading.Lock()

    def load(self, size: str = "small", device: str = "auto") -> None:
        if self.model is not None and self.size == size:
            return
        with self._lock:
            from faster_whisper import WhisperModel
            import torch

            if device == "auto":
                self.device = "cuda" if torch.cuda.is_available() else "cpu"
            else:
                self.device = device
            compute = "float16" if self.device == "cuda" else "int8"
            self.model = WhisperModel(size, device=self.device, compute_type=compute,
                                      download_root=str(WHISPER_DIR))
            self.size = size

    def transcribe(self, path: str | Path, language: str | None = None) -> str:
        if self.model is None:
            self.load()
        audio = self._load_16k_mono(path)
        segments, _info = self.model.transcribe(audio, language=language, vad_filter=True)
        return " ".join(seg.text.strip() for seg in segments).strip()

    @staticmethod
    def _load_16k_mono(path: str | Path):
        """Decode with soundfile + resample to 16 kHz, bypassing PyAV entirely
        (installed av versions and faster-whisper's decode_audio are frequently
        incompatible on Windows; passing an ndarray skips decode_audio)."""
        import numpy as np
        import soundfile as sf

        data, sr = sf.read(str(path), dtype="float32", always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        if sr != 16000:
            import librosa

            data = librosa.resample(data, orig_sr=sr, target_sr=16000)
        return np.ascontiguousarray(data, dtype=np.float32)

    def unload(self) -> None:
        self.model = None
        self.size = None


asr = WhisperASR()
