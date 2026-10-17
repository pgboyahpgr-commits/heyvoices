"""IndicF5 engine (AI4Bharat, MIT) — 11 Indian languages with zero-shot cloning.

Telugu, Tamil, Odia, Kannada, Malayalam, Marathi, Gujarati, Bengali,
Assamese, Punjabi and Hindi. F5-TTS architecture (flow-matching DiT + vocos
vocoder) conditioned on a short reference clip and its transcript, so one
cloned voice can speak all 11 languages (cross-lingual prompting is a
first-class mode of the model).

Inference runs on vendored MIT code (vendor_f5/) — no remote code execution,
no trust_remote_code, every file loads from the local model snapshot, so
generation works fully offline once downloaded.

The checkpoint is *gated* on Hugging Face ("auto" gating): a free account
plus a one-click terms accept on the model page unlock the download.
"""
from __future__ import annotations

import hashlib
import shutil
import threading
from pathlib import Path
from typing import Any

import numpy as np

from .base import EngineBase, EngineCaps, GenRequest

MODELS = {"indicf5": {"repo": "ai4bharat/IndicF5", "role": "indic", "params": "0.3B"}}

# The 11 languages the checkpoint was trained on
INDIC_LANGS = ["as", "bn", "gu", "hi", "kn", "ml", "mr", "or", "pa", "ta", "te"]

# Built-in prompt clips (AI4Bharat, MIT) and their official transcripts.
# Every preset can speak all 11 languages — the clip sets the timbre.
PRESETS: list[dict] = [
    {"key": "indic_kavya", "name": "Kavya", "language": "ta", "language_label": "Tamil",
     "file": "TAM_F_HAPPY_00001.wav",
     "transcript": "நான் நெனச்ச மாதிரியே அமேசான்ல பெரிய தள்ளுபடி வந்திருக்கு. "
                   "கம்மி காசுக்கே அந்தப் புது சேம்சங் மாடல வாங்கிடலாம்."},
    {"key": "indic_kiran", "name": "Kiran", "language": "kn", "language_label": "Kannada",
     "file": "KAN_F_HAPPY_00001.wav",
     "transcript": "ನಮ್ ಫ್ರಿಜ್ಜಲ್ಲಿ ಕೂಲಿಂಗ್ ಸಮಸ್ಯೆ ಆಗಿ ನಾನ್ ಭಾಳ ದಿನದಿಂದ ಒದ್ದಾಡ್ತಿದ್ದೆ, "
                   "ಆದ್ರೆ ಅದ್ನೀಗ ಮೆಕಾನಿಕ್ ಆಗಿರೋ ನಿಮ್ ಸಹಾಯ್ದಿಂದ ಬಗೆಹರಿಸ್ಕೋಬೋದು ಅಂತಾಗಿ ನಿರಾಳ ಆಯ್ತು ನಂಗೆ."},
    {"key": "indic_meera", "name": "Meera", "language": "mr", "language_label": "Marathi (wiki style)",
     "file": "MAR_F_WIKI_00001.wav",
     "transcript": "दिगंतराव्दारे अंतराळ कक्षेतला कचरा चिन्हित करण्यासाठी प्रयत्न केले जात आहे."},
    {"key": "indic_arjun", "name": "Arjun", "language": "mr", "language_label": "Marathi (male)",
     "file": "MAR_M_WIKI_00001.wav",
     "transcript": "या प्रथाला एकोणीसशे पंचातर ईसवी पासून भारतीय दंड संहिताची धारा चारशे अठ्ठावीस "
                   "आणि चारशे एकोणतीसच्या अन्तर्गत निषेध केला."},
    {"key": "indic_simran", "name": "Simran", "language": "pa", "language_label": "Punjabi",
     "file": "PAN_F_HAPPY_00001.wav",
     "transcript": "ਭਹੰਪੀ ਵਿੱਚ ਸਮਾਰਕਾਂ ਦੇ ਭਵਨ ਨਿਰਮਾਣ ਕਲਾ ਦੇ ਵੇਰਵੇ ਗੁੰਝਲਦਾਰ ਅਤੇ ਹੈਰਾਨ ਕਰਨ ਵਾਲੇ ਹਨ, "
                   "ਜੋ ਮੈਨੂੰ ਖੁਸ਼ ਕਰਦੇ ਹਨ।"},
]

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets" / "indic_prompts"

# F5-TTS "Base" recipe used by IndicF5 (matches the official wrapper)
MODEL_CFG = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4)
VOCOS_REPO = "charactr/vocos-mel-24khz"


def preset_clip_path(file_name: str) -> Path | None:
    """Locate a preset's bundled prompt clip."""
    p = ASSETS_DIR / file_name
    return p if p.exists() else None


class IndicF5Engine(EngineBase):
    id = "indicf5"
    name = "IndicF5"
    model_specs = MODELS

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self.vocoder: Any = None
        self._ref_cache: dict[str, str] = {}
        self._cache_dir: Path | None = None

    # ---- capabilities ---------------------------------------------
    def capabilities(self) -> EngineCaps:
        return EngineCaps(cloning=True, preset_voices=True, languages=INDIC_LANGS)

    def preset_speakers(self) -> list[dict]:
        return [{"id": p["key"], "name": p["name"], "language": p["language"],
                 "description": f"IndicF5 preset · {p['language_label']}",
                 "engine": self.id} for p in PRESETS]

    # ---- lifecycle -------------------------------------------------
    def load(self, key: str, device: str = "auto") -> None:
        if self.is_loaded(key):
            return
        with self._lock:
            self.unload()
            self.device = self.pick_device(device)

            from ..engines import local_extra_snapshot, local_snapshot
            from .vendor_f5 import infer_utils as f5

            snap = local_snapshot(key)
            if snap is None:
                raise RuntimeError("IndicF5 is not downloaded yet — open the Models page and download it.")
            ckpt = snap / "model.safetensors"
            vocab = snap / "checkpoints" / "vocab.txt"
            vdir = local_extra_snapshot(key, VOCOS_REPO)
            if not ckpt.exists() or not vocab.exists():
                raise RuntimeError("IndicF5 model files are missing — use Repair on the Models page.")
            if vdir is None:
                raise RuntimeError("IndicF5 vocoder files are missing — use Repair on the Models page.")

            print(f"[indicf5] loading model on {self.device} …", flush=True)
            from safetensors.torch import load_file

            model = f5.load_model(dict(MODEL_CFG), vocab_file=str(vocab), device=self.device)
            state = load_file(str(ckpt), device="cpu")
            ema_sd, vocoder_sd = f5.split_indic_state_dict(state)
            if not ema_sd:
                raise RuntimeError("IndicF5 checkpoint was not recognised (no ema_model weights).")
            missing, unexpected = model.load_state_dict(ema_sd, strict=False)
            del state, ema_sd

            vocoder = f5.load_vocoder(str(vdir / "config.yaml"), str(vdir / "pytorch_model.bin"),
                                      device=self.device)
            if vocoder_sd:
                vocoder.load_state_dict(vocoder_sd, strict=False)
            model.eval().to(self.device)
            vocoder.eval().to(self.device)
            self.model, self.vocoder = model, vocoder
            self.loaded_key = key
            print(f"[indicf5] ready (missing={len(missing)} unexpected={len(unexpected)} keys)", flush=True)

    def unload(self) -> None:
        self.model = None
        self.vocoder = None
        super().unload()

    def invalidate_voice(self, voice_id: str) -> None:
        for k in [k for k in self._ref_cache if k.startswith(voice_id)]:
            self._ref_cache.pop(k, None)

    # ---- reference conditioning -------------------------------------
    def _prepared_ref(self, ref_audio: str, voice_key: str) -> str:
        """Clip/trim/normalise the reference once per voice (upstream recipe)."""
        from .vendor_f5 import infer_utils as f5

        src = Path(ref_audio)
        try:
            stamp = f"{voice_key}:{src.resolve()}:{src.stat().st_mtime_ns}"
        except OSError:
            return ref_audio
        hit = self._ref_cache.get(stamp)
        if hit and Path(hit).exists():
            return hit
        if self._cache_dir is None:
            from ..config import MODELS_DIR

            self._cache_dir = MODELS_DIR / "indicf5_refs"
            self._cache_dir.mkdir(parents=True, exist_ok=True)
        out = self._cache_dir / f"{hashlib.md5(stamp.encode('utf-8')).hexdigest()[:16]}.wav"
        if not out.exists():
            tmp, _ = f5.preprocess_ref_audio_text(str(src), "", clip_short=True)
            shutil.copy2(tmp, out)
            try:
                Path(tmp).unlink(missing_ok=True)
            except OSError:
                pass
        if len(self._ref_cache) > 24:
            self._ref_cache.clear()
        self._ref_cache[stamp] = str(out)
        return str(out)

    # ---- generation --------------------------------------------------
    def generate(self, req: GenRequest) -> tuple[np.ndarray, int]:
        if self.model is None:
            raise RuntimeError("IndicF5 model is not loaded")
        ref = req.ref_audio[0] if isinstance(req.ref_audio, list) and req.ref_audio else (
            req.ref_audio if isinstance(req.ref_audio, str) else None)
        ref_text = req.ref_text
        if isinstance(ref_text, list):
            ref_text = next((t for t in ref_text if t and t.strip()), "")
        ref_text = (ref_text or "").strip()
        if not ref:
            raise RuntimeError("IndicF5 needs a reference clip — clone a voice (or pick an Indic preset) first.")
        if not ref_text:
            raise RuntimeError("IndicF5 needs the transcript of the reference clip — open the voice and add it "
                               "(re-transcribe it with Whisper Turbo for best results).")

        from .vendor_f5 import infer_utils as f5
        from .vendor_f5.model.utils import seed_everything

        if req.seed is not None:
            seed_everything(int(req.seed))

        prepared = self._prepared_ref(ref, req.voice_key or "ref")
        speed = 1.0 if req.speed is None else float(min(2.0, max(0.5, req.speed)))
        cfg = 2.0 if req.cfg_weight is None else float(min(3.5, max(0.2, req.cfg_weight)))
        audio, sr, _ = f5.infer_process(
            prepared, ref_text, req.text, self.model, self.vocoder,
            cfg_strength=cfg, speed=speed, device=self.device,
        )
        return np.asarray(audio, dtype=np.float32), int(sr)
