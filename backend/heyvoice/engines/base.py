"""Engine base: the plugin interface every TTS engine implements."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np


@dataclass
class EngineCaps:
    cloning: bool = False
    preset_voices: bool = False
    voice_design: bool = False
    instruct: bool = False          # natural-language delivery control
    tags: bool = False              # [laugh] style paralinguistic tags
    streaming: bool = False
    exaggeration: bool = False      # emotion exaggeration slider
    languages: list[str] = field(default_factory=list)


@dataclass
class GenRequest:
    text: str
    language: str = "auto"
    instruct: str = ""
    exaggeration: Optional[float] = None
    speaker: str = ""
    seed: Optional[int] = None
    temperature: Optional[float] = None
    # voice reference (engine-specific, prepared by resolve logic below)
    ref_audio: Optional[str] = None      # path to a prepared 24k wav sample
    ref_text: Optional[str] = None
    x_vector_only: bool = False
    voice_key: str = ""                  # cache key (voice id)


class EngineBase:
    id: str = "base"
    name: str = "Base"
    # model_key -> {"repo": str, "role": str, ...}
    model_specs: dict[str, dict] = {}

    def __init__(self) -> None:
        self.loaded_key: str | None = None
        self.model: Any = None
        self.device: str = "cpu"

    # ---- lifecycle -------------------------------------------------
    def load(self, key: str, device: str = "auto") -> None:
        raise NotImplementedError

    def unload(self) -> None:
        self.model = None
        self.loaded_key = None
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def is_loaded(self, key: str | None = None) -> bool:
        if key is None:
            return self.model is not None
        return self.model is not None and self.loaded_key == key

    # ---- capabilities ----------------------------------------------
    def capabilities(self) -> EngineCaps:
        return EngineCaps()

    def preset_speakers(self) -> list[dict]:
        return []

    # ---- generation -------------------------------------------------
    def generate(self, req: GenRequest) -> tuple[np.ndarray, int]:
        """Return (mono float32 audio, sample_rate)."""
        raise NotImplementedError

    # ---- helpers -----------------------------------------------------
    @staticmethod
    def pick_device(device: str = "auto") -> str:
        try:
            import torch

            if device == "cpu":
                return "cpu"
            return "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            return "cpu"
