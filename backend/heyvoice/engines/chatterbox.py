"""Chatterbox engines (Resemble AI, MIT):
- Multilingual v3: 25 languages zero-shot cloning with emotion exaggeration
- Turbo: 350M fast English model with paralinguistic tags like [laugh]

The pip package API is introspected at load time so we stay compatible across
package releases.
"""
from __future__ import annotations

import threading
from typing import Any

import numpy as np

from .base import EngineBase, EngineCaps, GenRequest

MODELS = {
    "chatterbox-multilingual": {"repo": "ResembleAI/chatterbox", "role": "multilingual", "params": "0.5B"},
    "chatterbox-turbo": {"repo": "ResembleAI/chatterbox-turbo", "role": "turbo", "params": "350M"},
}

LANG_MAP = {
    "en": "en", "zh": "zh", "ja": "ja", "ko": "ko", "de": "de", "fr": "fr", "ru": "ru",
    "pt": "pt", "es": "es", "it": "it", "ar": "ar", "da": "da", "fi": "fi", "el": "el",
    "he": "he", "hi": "hi", "ms": "ms", "nl": "nl", "no": "no", "pl": "pl", "sv": "sv",
    "sw": "sw", "tr": "tr", "cs": "cs", "hu": "hu",
}

ML_LANGS = ["en", "ar", "da", "de", "el", "es", "fi", "fr", "he", "hi", "it", "ja", "ko",
            "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh", "cs", "hu"]


class ChatterboxEngine(EngineBase):
    id = "chatterbox"
    name = "Chatterbox"
    model_specs = MODELS

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()

    def capabilities(self) -> EngineCaps:
        return EngineCaps(
            cloning=True, preset_voices=False, voice_design=False,
            instruct=False, tags=True, exaggeration=True,
            languages=ML_LANGS,
        )

    def _imports(self):
        """Return (class_turbo, class_multilingual) whichever exist."""
        turbo = ml = None
        try:
            from chatterbox.tts_turbo import ChatterboxTurboTTS as turbo  # type: ignore
        except Exception:
            try:
                from chatterbox.tts import ChatterboxTurboTTS as turbo  # type: ignore
            except Exception:
                turbo = None
        try:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS as ml  # type: ignore
        except Exception:
            ml = None
        return turbo, ml

    def load(self, key: str, device: str = "auto") -> None:
        if self.is_loaded(key):
            return
        with self._lock:
            self.unload()
            self.device = self.pick_device(device)
            dev = "cuda" if self.device == "cuda" else "cpu"
            turbo_cls, ml_cls = self._imports()
            role = MODELS[key]["role"]
            if role == "multilingual":
                if ml_cls is None:
                    raise RuntimeError("chatterbox-tts package does not provide the multilingual model")
                self.model = ml_cls.from_pretrained(device=dev)
            else:
                if turbo_cls is None:
                    # older packages: plain ChatterboxTTS is the only class
                    from chatterbox.tts import ChatterboxTTS as turbo_cls  # type: ignore
                self.model = turbo_cls.from_pretrained(device=dev)
            self.loaded_key = key

    def generate(self, req: GenRequest) -> tuple[np.ndarray, int]:
        if self.model is None:
            raise RuntimeError("Chatterbox model not loaded")
        role = MODELS[self.loaded_key]["role"]
        kwargs: dict[str, Any] = {}
        if req.ref_audio:
            kwargs["audio_prompt_path"] = req.ref_audio
        if req.exaggeration is not None:
            kwargs["exaggeration"] = float(max(0.0, min(2.0, req.exaggeration)))
        if req.temperature is not None:
            kwargs["temperature"] = float(req.temperature)

        if role == "multilingual":
            lang = LANG_MAP.get(req.language, "en")
            try:
                wav = self.model.generate(req.text, language_id=lang, **kwargs)
            except TypeError:
                wav = self.model.generate(req.text, language=lang, **kwargs)
        else:
            wav = self.model.generate(req.text, **kwargs)

        audio = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
        audio = np.asarray(audio, dtype=np.float32).squeeze()
        return audio, int(getattr(self.model, "sr", 24000))
