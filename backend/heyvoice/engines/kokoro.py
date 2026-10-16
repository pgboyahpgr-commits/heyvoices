"""Kokoro-82M engine — tiny, ultra-fast, 54 preset voices (no cloning). Apache-2.0."""
from __future__ import annotations

import threading

import numpy as np

from .base import EngineBase, EngineCaps, GenRequest

MODELS = {
    "kokoro-82m": {"repo": "hexgrad/Kokoro-82M", "role": "preset", "params": "82M"},
}

# id -> (display name, language tag)
VOICES = {
    "af_heart": ("Heart", "en"), "af_bella": ("Bella", "en"), "af_nicole": ("Nicole", "en"),
    "af_sarah": ("Sarah", "en"), "af_sky": ("Sky", "en"),
    "am_adam": ("Adam", "en"), "am_michael": ("Michael", "en"),
    "bf_emma": ("Emma", "en"), "bf_isabella": ("Isabella", "en"),
    "bm_george": ("George", "en"), "bm_lewis": ("Lewis", "en"),
}

LANG_CODE = {"en": "a", "es": "e", "fr": "f", "hi": "h", "it": "i", "pt": "p", "ja": "j", "zh": "z"}


class KokoroEngine(EngineBase):
    id = "kokoro"
    name = "Kokoro"
    model_specs = MODELS

    def __init__(self) -> None:
        super().__init__()
        self._pipelines: dict[str, object] = {}
        self._lock = threading.Lock()

    def capabilities(self) -> EngineCaps:
        return EngineCaps(
            cloning=False, preset_voices=True, voice_design=False, instruct=False,
            streaming=False, exaggeration=False,
            languages=["en", "es", "fr", "hi", "it", "pt", "ja", "zh"],
        )

    def preset_speakers(self) -> list[dict]:
        return [
            {"id": vid, "name": name, "description": f"Kokoro preset voice ({vid})",
             "language": lang, "engine": self.id}
            for vid, (name, lang) in VOICES.items()
        ]

    def load(self, key: str, device: str = "auto") -> None:
        # Kokoro runs great on CPU and saves VRAM for the big engines.
        with self._lock:
            if self.loaded_key != key:
                self.unload()
            self.device = "cpu"
            self.loaded_key = key
            self.model = "kokoro"  # sentinel: pipelines are created lazily

    def _pipeline(self, lang_code: str):
        pipe = self._pipelines.get(lang_code)
        if pipe is None:
            from kokoro import KPipeline

            pipe = KPipeline(lang_code=lang_code)
            self._pipelines[lang_code] = pipe
        return pipe

    def unload(self) -> None:
        self._pipelines = {}
        super().unload()

    def generate(self, req: GenRequest) -> tuple[np.ndarray, int]:
        lang = req.language if req.language in LANG_CODE else "en"
        speaker = req.speaker or "af_heart"
        if speaker not in VOICES:
            # allow lang-prefixed voices we did not seed
            speaker = "af_heart"
        pipe = self._pipeline(LANG_CODE[lang])
        parts = []
        speed = 1.0
        if req.speed is not None:
            speed = float(max(0.5, min(2.0, req.speed)))
        for _gs, _ps, audio in pipe(req.text, voice=speaker, speed=speed):
            parts.append(np.asarray(audio, dtype=np.float32))
        if not parts:
            return np.zeros(0, dtype=np.float32), 24000
        return np.concatenate(parts), 24000
