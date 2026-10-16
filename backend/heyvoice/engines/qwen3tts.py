"""Qwen3-TTS engine — flagship: 3-second zero-shot voice cloning, CustomVoice
presets with natural-language delivery control, and VoiceDesign (invent a voice
from a text description). Apache-2.0. 10 languages. Streaming capable.
"""
from __future__ import annotations

import threading
from typing import Any

import numpy as np

from .base import EngineBase, EngineCaps, GenRequest

MODELS = {
    "qwen3-tts-0.6b-base": {
        "repo": "Qwen/Qwen3-TTS-12Hz-0.6B-Base", "role": "clone", "params": "0.6B",
    },
    "qwen3-tts-1.7b-base": {
        "repo": "Qwen/Qwen3-TTS-12Hz-1.7B-Base", "role": "clone", "params": "1.7B",
    },
    "qwen3-tts-0.6b-customvoice": {
        "repo": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", "role": "custom", "params": "0.6B",
    },
    "qwen3-tts-1.7b-customvoice": {
        "repo": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", "role": "custom", "params": "1.7B",
    },
    "qwen3-tts-1.7b-voicedesign": {
        "repo": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", "role": "design", "params": "1.7B",
    },
}

LANG_MAP = {
    "auto": "Auto", "en": "English", "zh": "Chinese", "ja": "Japanese", "ko": "Korean",
    "de": "German", "fr": "French", "ru": "Russian", "pt": "Portuguese", "es": "Spanish",
    "it": "Italian",
}

SPEAKERS = [
    {"id": "Vivian", "name": "Vivian", "description": "Bright, slightly edgy young female voice", "language": "zh"},
    {"id": "Serena", "name": "Serena", "description": "Warm, gentle young female voice", "language": "zh"},
    {"id": "Uncle_Fu", "name": "Uncle Fu", "description": "Seasoned male voice, low mellow timbre", "language": "zh"},
    {"id": "Dylan", "name": "Dylan", "description": "Youthful Beijing male voice", "language": "zh"},
    {"id": "Eric", "name": "Eric", "description": "Lively Chengdu male voice", "language": "zh"},
    {"id": "Ryan", "name": "Ryan", "description": "Dynamic male voice, strong rhythmic drive", "language": "en"},
    {"id": "Aiden", "name": "Aiden", "description": "Sunny American male voice", "language": "en"},
    {"id": "Ono_Anna", "name": "Ono Anna", "description": "Playful Japanese female voice", "language": "ja"},
    {"id": "Sohee", "name": "Sohee", "description": "Warm Korean female voice, rich emotion", "language": "ko"},
]


class Qwen3TTSEngine(EngineBase):
    id = "qwen3-tts"
    name = "Qwen3-TTS"
    model_specs = MODELS

    def __init__(self) -> None:
        super().__init__()
        self._prompt_cache: dict[str, Any] = {}
        self._lock = threading.Lock()

    def capabilities(self) -> EngineCaps:
        return EngineCaps(
            cloning=True, preset_voices=True, voice_design=True, instruct=True,
            streaming=True, exaggeration=False,
            languages=["en", "zh", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
        )

    def preset_speakers(self) -> list[dict]:
        out = []
        for s in SPEAKERS:
            tags = ["qwen"] + ([] if not s["language"] else [])
            out.append({**s, "engine": self.id})
        return out

    def load(self, key: str, device: str = "auto") -> None:
        if self.is_loaded(key):
            return
        with self._lock:
            self.unload()
            self.device = self.pick_device(device)
            import torch
            from qwen_tts import Qwen3TTSModel

            dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
            repo = MODELS[key]["repo"]
            self.model = Qwen3TTSModel.from_pretrained(
                repo,
                device_map=self.device,
                dtype=dtype,
                attn_implementation="sdpa",  # flash-attn has no Windows wheels
            )
            self.loaded_key = key
            self._prompt_cache.clear()

    # ---- clone prompt management ------------------------------------
    def get_clone_prompt(self, voice_key: str, ref_audio, ref_text):
        """Build (and cache) a clone prompt from 1..N reference clips.

        Qwen3-TTS consumes one prompt item per *generation*, so when several
        reference clips are supplied they are merged into a single item:
        ICL code streams are concatenated (transcripts joined in order) and
        speaker embeddings are averaged — conditioning on all clips at once.
        """
        cached = self._prompt_cache.get(voice_key)
        if cached is not None:
            return cached
        audios = ref_audio if isinstance(ref_audio, list) else [ref_audio]
        texts = ref_text if isinstance(ref_text, list) else [ref_text]
        texts = [(t or None) for t in (list(texts) + [None] * len(audios))[:len(audios)]]
        xvec = [not bool(t) for t in texts]
        if len(audios) == 1:
            prompt = self.model.create_voice_clone_prompt(
                ref_audio=audios[0], ref_text=texts[0], x_vector_only_mode=xvec[0])
        else:
            import torch
            from qwen_tts.inference.qwen3_tts_model import VoiceClonePromptItem

            items = self.model.create_voice_clone_prompt(
                ref_audio=audios, ref_text=texts, x_vector_only_mode=xvec)
            icl = [it for it in items if it.ref_code is not None]
            prompt = [VoiceClonePromptItem(
                ref_code=(torch.cat([it.ref_code for it in icl], dim=0) if icl else None),
                ref_spk_embedding=torch.stack([it.ref_spk_embedding for it in items]).mean(dim=0),
                x_vector_only_mode=not icl,
                icl_mode=bool(icl),
                ref_text=(" ".join((it.ref_text or "").strip() for it in icl).strip() or None)
                if icl else None,
            )]
        print(f"[qwen3tts] clone prompt: {len(audios)} ref(s), "
              f"{sum(1 for t in texts if t)} transcript(s) -> {len(prompt)} item(s) key={voice_key}",
              flush=True)
        self._prompt_cache[voice_key] = prompt
        return prompt

    def invalidate_voice(self, voice_key: str) -> None:
        # multi-sample prompts are cached under "{voice_id}#{n}" keys too
        for k in list(self._prompt_cache):
            if k == voice_key or k.startswith(f"{voice_key}#"):
                self._prompt_cache.pop(k, None)

    # ---- generation ---------------------------------------------------
    def generate(self, req: GenRequest) -> tuple[np.ndarray, int]:
        if self.model is None:
            raise RuntimeError("Qwen3-TTS model not loaded")
        role = MODELS[self.loaded_key]["role"]
        lang = LANG_MAP.get(req.language, "Auto")

        # sampling knobs — forwarded to the model's generate() as kwargs
        gen_kwargs: dict[str, Any] = {}
        if req.temperature is not None:
            gen_kwargs["temperature"] = float(max(0.05, min(2.0, req.temperature)))
        if req.top_k is not None:
            gen_kwargs["top_k"] = int(max(1, min(10000, req.top_k)))
        if req.top_p is not None:
            gen_kwargs["top_p"] = float(max(0.0, min(1.0, req.top_p)))
        if req.repetition_penalty is not None:
            gen_kwargs["repetition_penalty"] = float(max(1.0, min(2.5, req.repetition_penalty)))
        if req.seed is not None:
            import torch

            torch.manual_seed(int(req.seed))

        if role == "clone":
            if req.ref_audio:
                prompt = self.get_clone_prompt(req.voice_key or req.ref_audio,
                                               req.ref_audio, req.ref_text)
                wavs, sr = self.model.generate_voice_clone(
                    text=req.text, language=lang, voice_clone_prompt=prompt, **gen_kwargs)
            else:
                raise RuntimeError("A cloned voice with a reference sample is required "
                                   "for the Base model. Add a sample to this voice first.")
        elif role == "custom":
            if not req.speaker:
                raise RuntimeError("CustomVoice model needs a preset speaker")
            wavs, sr = self.model.generate_custom_voice(
                text=req.text, language=lang, speaker=req.speaker,
                instruct=(req.instruct or None), **gen_kwargs)
        elif role == "design":
            if not req.instruct:
                raise RuntimeError("VoiceDesign needs a voice description (instruct)")
            wavs, sr = self.model.generate_voice_design(
                text=req.text, language=lang, instruct=req.instruct, **gen_kwargs)
        else:
            raise RuntimeError(f"Unknown Qwen3-TTS role {role}")

        audio = np.asarray(wavs[0], dtype=np.float32).squeeze()
        return audio, int(sr)
