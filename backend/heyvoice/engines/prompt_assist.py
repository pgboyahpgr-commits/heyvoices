"""Prompt assistant engine: a small local LLM (Qwen3 0.6B / 1.7B, Apache-2.0)
that turns a script + a chosen emotion into the delivery instruction the TTS
engines understand, and tidies scripts into text TTS reads naturally.

Fully offline: weights come from the same local HF snapshot cache as every
other model, and nothing leaves the machine.
"""
from __future__ import annotations

import re
import threading
from typing import Any

import numpy as np

from .base import EngineBase, EngineCaps, GenRequest

# ------------------------------------------------------------------ prompts
_INSTRUCT_SYSTEM = (
    "You are HeyVoices' voice director. You turn a script and an emotion into ONE English "
    "delivery instruction for a text-to-speech engine. Describe tone, pace, energy, pitch and "
    "emotion in a single flowing sentence. Never quote the script, never use markdown, lists or "
    "quotes. Reply with only the instruction, at most 30 words."
)

_TIDY_SYSTEM = (
    "You are a script editor for a text-to-speech engine. Improve punctuation and insert "
    "[[pause:250ms]] (up to [[pause:600ms]] after full stops) between sentences where a pause "
    "helps delivery. Never translate. Never add, remove or explain words. Keep the exact "
    "language and writing system of the input. Output only the edited script."
)

_INSTRUCT_EXAMPLES: list[tuple[str, str]] = [
    (
        "Script language: English\n"
        "Emotion: Excited — high energy and enthusiastic\n"
        "Script starts: \"Stop scrolling. This is the last productivity tool you will ever need.\"",
        "Speak with high energy and real enthusiasm, a quicker upbeat pace, bright rising "
        "intonation and punchy emphasis on the key words.",
    ),
    (
        "Script language: Telugu\n"
        "Emotion: Whisper — soft, breathy and intimate\n"
        "Script starts: \"నమస్తే! ఈ రోజు మనం ఒక కొత్త విషయం గురించి మాట్లాడుకుందాం.\"",
        "Speak in a soft, breathy whisper with a slow, intimate pace, keeping the Telugu rhythm "
        "gentle and even.",
    ),
]

_TIDY_EXAMPLES: list[tuple[str, str]] = [
    (
        "the wind carried the smell of rain across the valley and for a moment everything was "
        "still then the first drop fell",
        "The wind carried the smell of rain across the valley, and for a moment everything was "
        "still. [[pause:400ms]] Then the first drop fell.",
    ),
    (
        "హాయ్ ఎలా ఉన్నారు ఈ రోజు మనం కొత్త విషయం నేర్చుకుందాం",
        "హాయ్! [[pause:300ms]] ఎలా ఉన్నారు? [[pause:300ms]] ఈ రోజు మనం కొత్త విషయం నేర్చుకుందాం.",
    ),
]

# scripts we refuse to let the model mangle (Devanagari … Malayalam + Gurmukhi/Gujarati/Odia)
_SCRIPT_RE = re.compile(
    "[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F"
    "\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]"
)


def _strip_reasoning(raw: str) -> str:
    """Remove thinking traces, code fences and stray quoting the model may emit."""
    text = re.sub(r"(?s) thinking.*? response", "", raw)
    text = re.sub(r"(?s)```.*?```", "", text)
    text = text.strip()
    return text


def _clean_instruct(raw: str) -> str:
    text = _strip_reasoning(raw)
    text = text.split("\n\n")[0].strip()          # first paragraph only
    text = text.strip('"\'“”‘’` ')                # stray quotes
    text = re.sub(r"^[-*\u2022\d.)\s]+", "", text)  # bullets / numbering
    text = re.sub(r"\s+", " ", text).strip()
    return text[:300].strip()


def _clean_script(raw: str) -> str:
    text = _strip_reasoning(raw)
    text = text.strip().strip('"\'“”‘’` ')
    # a pause marker dangling at the very end is noise — the pipeline already
    # pauses between chunks
    text = re.sub(r"(\s*\[\[pause:\d+m?s\]\])+\s*$", "", text).strip()
    return text


def _script_char_count(text: str) -> int:
    return len(_SCRIPT_RE.findall(text))


def _latin_letter_count(text: str) -> int:
    return sum(1 for ch in text if ("a" <= ch <= "z") or ("A" <= ch <= "Z"))


class PromptAssistEngine(EngineBase):
    """Not a TTS engine — a tiny text LLM used by the /assist job."""

    id = "prompt-assist"
    name = "Prompt assistant"

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self.tokenizer: Any = None

    def capabilities(self) -> EngineCaps:
        return EngineCaps()

    # ---- lifecycle ----------------------------------------------------
    def load(self, key: str, device: str = "auto") -> None:
        with self._lock:
            if self.is_loaded(key):
                return
            self.unload()
            self.device = self.pick_device(device)
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            from . import local_snapshot

            snap = local_snapshot(key)
            if snap is None:
                raise RuntimeError(
                    f"{key} is not downloaded yet — get it from the Models page.")
            dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
            self.tokenizer = AutoTokenizer.from_pretrained(str(snap))
            self.model = (
                AutoModelForCausalLM.from_pretrained(str(snap), dtype=dtype)
                .to(self.device)
                .eval()
            )
            self.loaded_key = key

    def unload(self) -> None:
        super().unload()
        self.tokenizer = None

    def generate(self, req: GenRequest) -> tuple[np.ndarray, int]:
        raise NotImplementedError("The prompt assistant is not a speech engine")

    # ---- text generation -----------------------------------------------
    def _chat(self, messages: list[dict], max_new_tokens: int,
              temperature: float = 0.7, top_p: float = 0.9) -> str:
        import torch

        tok = self.tokenizer
        try:
            prompt = tok.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        except TypeError:  # older template without the Qwen3 thinking switch
            prompt = tok.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True)
        inputs = tok([prompt], return_tensors="pt").to(self.device)
        with torch.inference_mode():
            out = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=temperature > 0,
                temperature=max(temperature, 1e-4),
                top_p=top_p,
                repetition_penalty=1.05,
            )
        gen = out[0][inputs["input_ids"].shape[1]:]
        return tok.decode(gen, skip_special_tokens=True)

    # ---- public API used by the assist job ------------------------------
    def craft_instruct(self, *, text: str, emotion: str = "", emotion_hint: str = "",
                       language: str = "", voice: str = "", notes: str = "") -> str:
        """One English delivery instruction for the TTS engine."""
        if self.model is None:
            raise RuntimeError("The prompt assistant is not loaded")
        snippet = re.sub(r"\s+", " ", text.strip())[:280]
        lines = []
        if language:
            lines.append(f"Script language: {language}")
        if emotion:
            lines.append(f"Emotion: {emotion}" + (f" — {emotion_hint}" if emotion_hint else ""))
        else:
            lines.append("Emotion: (not set — infer the strongest fit from the script)")
        if voice:
            lines.append(f"Voice: {voice}")
        lines.append(f'Script starts: "{snippet}"')
        if notes.strip():
            lines.append(f"Extra direction from the user: {notes.strip()[:220]}")
        lines.append("Write the delivery instruction now.")

        messages: list[dict] = [{"role": "system", "content": _INSTRUCT_SYSTEM}]
        for ex_in, ex_out in _INSTRUCT_EXAMPLES:
            messages.append({"role": "user", "content": ex_in})
            messages.append({"role": "assistant", "content": ex_out})
        messages.append({"role": "user", "content": "\n".join(lines)})

        raw = self._chat(messages, max_new_tokens=80, temperature=0.7, top_p=0.9)
        cleaned = _clean_instruct(raw)
        if len(cleaned) < 12 or len(cleaned.split()) < 4:
            raise RuntimeError(
                "The assistant produced an unusable prompt — try again, or add a note to steer it.")
        return cleaned

    def tidy_script(self, *, text: str, language: str = "") -> dict:
        """Punctuation + natural pause tidy-up with strict keep-the-words guards."""
        if self.model is None:
            raise RuntimeError("The prompt assistant is not loaded")
        original = text.strip()
        snippet = original[:2400]
        user = (f"Script language: {language}\n" if language else "") + \
               f"Edit this script:\n{snippet}"
        messages: list[dict] = [{"role": "system", "content": _TIDY_SYSTEM}]
        for ex_in, ex_out in _TIDY_EXAMPLES:
            messages.append({"role": "user", "content": f"Edit this script:\n{ex_in}"})
            messages.append({"role": "assistant", "content": ex_out})
        messages.append({"role": "user", "content": user})

        max_tokens = max(220, min(1400, len(snippet) // 2 + 120))
        raw = self._chat(messages, max_new_tokens=max_tokens, temperature=0.3, top_p=0.9)
        out = _clean_script(raw)

        # ---- guards: never let the model translate, invent or delete text ----
        def reject(reason: str) -> dict:
            return {"text": original, "changed": False, "rejected": reason}

        if not out:
            return reject("the assistant returned nothing")
        if not (0.5 <= len(out) / max(1, len(snippet)) <= 2.5):
            return reject("the result changed the script too much")
        src_script = _script_char_count(snippet)
        if src_script >= 5 and _script_char_count(out) < src_script * 0.5:
            return reject("the result dropped the original script")
        src_latin = _latin_letter_count(snippet)
        if src_script < 5 and src_latin >= 20 and _latin_letter_count(out) < src_latin * 0.5:
            return reject("the result lost the original words")
        return {"text": out, "changed": out.strip() != original, "rejected": None}
