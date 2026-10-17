"""Trimmed F5-TTS inference pipeline for the IndicF5 engine.

Vendored from AI4Bharat/IndicF5 (MIT) — https://github.com/AI4Bharat/IndicF5
Original F5-TTS by SWivid (MIT) — https://github.com/SWivid/F5-TTS

Changes vs upstream (deliberate, kept minimal):
- vocos is the only vocoder and it loads from *local* files (no network)
- the whisper/ASR fallback for an empty reference text is removed — the
  engine always supplies the voice's sample transcript
- matplotlib / spectrogram saving removed; the combined mel spectrogram is
  not built (less memory, no plotting dependency)
- every entry point takes an explicit ``device`` (upstream used a global)
"""
from __future__ import annotations

import re
import tempfile

import numpy as np
import torch
import torchaudio
from pydub import AudioSegment, silence

from .model import CFM
from .model.utils import convert_char_to_pinyin, get_tokenizer

target_sample_rate = 24000
n_mel_channels = 100
hop_length = 256
win_length = 1024
n_fft = 1024
mel_spec_type = "vocos"
target_rms = 0.1
cross_fade_duration = 0.15
ode_method = "euler"
nfe_step = 32  # 16 / 32 — higher = a little better, slower
cfg_strength = 2.0
sway_sampling_coef = -1.0
speed = 1.0
fix_duration = None


def chunk_text(text, max_chars=135):
    """Split text into chunks of at most ``max_chars`` utf-8 bytes."""
    chunks = []
    current_chunk = ""
    # split into sentences on punctuation (ASCII + CJK)
    sentences = re.split(r"(?<=[;:,.!?])\s+|(?<=[；：，。！？])", text)

    for sentence in sentences:
        if len(current_chunk.encode("utf-8")) + len(sentence.encode("utf-8")) <= max_chars:
            current_chunk += sentence + " " if sentence and len(sentence[-1].encode("utf-8")) == 1 else sentence
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sentence + " " if sentence and len(sentence[-1].encode("utf-8")) == 1 else sentence

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks


def load_vocoder(config_path: str, model_path: str, device: str = "cpu"):
    """Load the vocos 24 kHz mel vocoder from local files."""
    from vocos import Vocos

    print(f"[indicf5] vocoder <- {config_path}", flush=True)
    vocoder = Vocos.from_hparams(config_path)
    state_dict = torch.load(model_path, map_location="cpu", weights_only=True)

    from vocos.feature_extractors import EncodecFeatures

    if isinstance(vocoder.feature_extractor, EncodecFeatures):
        encodec_parameters = {
            "feature_extractor.encodec." + key: value
            for key, value in vocoder.feature_extractor.encodec.state_dict().items()
        }
        state_dict.update(encodec_parameters)

    vocoder.load_state_dict(state_dict)
    return vocoder.eval().to(device)


def load_model(model_cfg: dict, vocab_file: str, device: str = "cpu"):
    """Build the F5-TTS CFM/DiT model with the IndicF5 recipe (vocos 24 kHz)."""
    vocab_char_map, vocab_size = get_tokenizer(vocab_file, "custom")
    from .model import DiT

    model = CFM(
        transformer=DiT(**model_cfg, text_num_embeds=vocab_size, mel_dim=n_mel_channels),
        mel_spec_kwargs=dict(
            n_fft=n_fft,
            hop_length=hop_length,
            win_length=win_length,
            n_mel_channels=n_mel_channels,
            target_sample_rate=target_sample_rate,
            mel_spec_type=mel_spec_type,
        ),
        odeint_kwargs=dict(method=ode_method),
        vocab_char_map=vocab_char_map,
    )
    return model.to(device)


def split_indic_state_dict(state_dict: dict) -> tuple[dict, dict]:
    """Split the IndicF5 checkpoint into DiT (ema_model.*) and vocoder weights.

    Mirrors the official wrapper: ``_orig_mod.`` prefixes (from torch.compile)
    are stripped when present.
    """
    ema_state_dict: dict = {}
    vocoder_state_dict: dict = {}
    for key, value in state_dict.items():
        if key.startswith("ema_model._orig_mod."):
            ema_state_dict[key[len("ema_model._orig_mod."):]] = value
        elif key.startswith("ema_model."):
            ema_state_dict[key[len("ema_model."):]] = value
        elif key.startswith("vocoder._orig_mod."):
            vocoder_state_dict[key[len("vocoder._orig_mod."):]] = value
        elif key.startswith("vocoder."):
            vocoder_state_dict[key[len("vocoder."):]] = value
    return ema_state_dict, vocoder_state_dict


def remove_silence_edges(audio, silence_threshold=-42):
    # remove silence from the start
    non_silent_start_idx = silence.detect_leading_silence(audio, silence_threshold=silence_threshold)
    audio = audio[non_silent_start_idx:]

    # remove silence from the end
    non_silent_end_duration = audio.duration_seconds
    for ms in reversed(audio):
        if ms.dBFS > silence_threshold:
            break
        non_silent_end_duration -= 0.001
    trimmed_audio = audio[: int(non_silent_end_duration * 1000)]

    return trimmed_audio


def preprocess_ref_audio_text(ref_audio_orig, ref_text, clip_short=True, show_info=print):
    """Clip the reference to <=15 s (upstream recipe), trim edge silence.

    Returns (processed wav path, ref_text with sentence punctuation).
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as f:
        aseg = AudioSegment.from_file(ref_audio_orig)

        if clip_short:
            # 1. try to find long silence for clipping
            non_silent_segs = silence.split_on_silence(
                aseg, min_silence_len=1000, silence_thresh=-50, keep_silence=1000, seek_step=10
            )
            non_silent_wave = AudioSegment.silent(duration=0)
            for non_silent_seg in non_silent_segs:
                if len(non_silent_wave) > 6000 and len(non_silent_wave + non_silent_seg) > 15000:
                    show_info("[indicf5] reference is over 15 s, clipping short. (1)")
                    break
                non_silent_wave += non_silent_seg

            # 2. try to find short silence for clipping if 1. failed
            if len(non_silent_wave) > 15000:
                non_silent_segs = silence.split_on_silence(
                    aseg, min_silence_len=100, silence_thresh=-40, keep_silence=1000, seek_step=10
                )
                non_silent_wave = AudioSegment.silent(duration=0)
                for non_silent_seg in non_silent_segs:
                    if len(non_silent_wave) > 6000 and len(non_silent_wave + non_silent_seg) > 15000:
                        show_info("[indicf5] reference is over 15 s, clipping short. (2)")
                        break
                    non_silent_wave += non_silent_seg

            aseg = non_silent_wave

            # 3. if no proper silence found for clipping
            if len(aseg) > 15000:
                aseg = aseg[:15000]
                show_info("[indicf5] reference is over 15 s, clipping short. (3)")

        aseg = remove_silence_edges(aseg) + AudioSegment.silent(duration=50)
        aseg.export(f.name, format="wav")
        ref_audio = f.name

    if not ref_text.strip():
        # the engine always supplies a transcript (voice sample transcript)
        return ref_audio, ref_text

    # ensure ref_text ends with proper sentence-ending punctuation
    if not ref_text.endswith(". ") and not ref_text.endswith("。"):
        if ref_text.endswith("."):
            ref_text += " "
        else:
            ref_text += ". "

    return ref_audio, ref_text


def infer_process(
    ref_audio,
    ref_text,
    gen_text,
    model_obj,
    vocoder,
    show_info=print,
    target_rms=target_rms,
    cross_fade_duration=cross_fade_duration,
    nfe_step=nfe_step,
    cfg_strength=cfg_strength,
    sway_sampling_coef=sway_sampling_coef,
    speed=speed,
    fix_duration=fix_duration,
    device: str = "cpu",
):
    """Chunk the generation text (upstream heuristic) then run batches."""
    audio, sr = torchaudio.load(ref_audio)
    dur = audio.shape[-1] / sr
    max_chars = int(len(ref_text.encode("utf-8")) / dur * (25 - dur))
    max_chars = max(60, max_chars)
    gen_text_batches = chunk_text(gen_text, max_chars=max_chars)

    return infer_batch_process(
        (audio, sr),
        ref_text,
        gen_text_batches,
        model_obj,
        vocoder,
        target_rms=target_rms,
        cross_fade_duration=cross_fade_duration,
        nfe_step=nfe_step,
        cfg_strength=cfg_strength,
        sway_sampling_coef=sway_sampling_coef,
        speed=speed,
        fix_duration=fix_duration,
        device=device,
    )


def infer_batch_process(
    ref_audio,
    ref_text,
    gen_text_batches,
    model_obj,
    vocoder,
    target_rms=0.1,
    cross_fade_duration=0.15,
    nfe_step=32,
    cfg_strength=2.0,
    sway_sampling_coef=-1,
    speed=1,
    fix_duration=None,
    device: str = "cpu",
):
    audio, sr = ref_audio
    if audio.shape[0] > 1:
        audio = torch.mean(audio, dim=0, keepdim=True)

    rms = torch.sqrt(torch.mean(torch.square(audio)))
    if rms < target_rms:
        audio = audio * target_rms / rms
    if sr != target_sample_rate:
        resampler = torchaudio.transforms.Resample(sr, target_sample_rate)
        audio = resampler(audio)
    audio = audio.to(device)

    generated_waves = []

    if len(ref_text[-1].encode("utf-8")) == 1:
        ref_text = ref_text + " "

    for gen_text in gen_text_batches:
        # prepare the conditioning text (reference transcript + target text)
        text_list = [ref_text + gen_text]
        final_text_list = convert_char_to_pinyin(text_list)

        ref_audio_len = audio.shape[-1] // hop_length
        if fix_duration is not None:
            duration = int(fix_duration * target_sample_rate / hop_length)
        else:
            # estimate target duration from the reference speech rate
            ref_text_len = len(ref_text.encode("utf-8"))
            gen_text_len = len(gen_text.encode("utf-8"))
            duration = ref_audio_len + int(ref_audio_len / ref_text_len * gen_text_len / speed)

        with torch.inference_mode():
            generated, _ = model_obj.sample(
                cond=audio,
                text=final_text_list,
                duration=duration,
                steps=nfe_step,
                cfg_strength=cfg_strength,
                sway_sampling_coef=sway_sampling_coef,
            )

            generated = generated.to(torch.float32)
            generated = generated[:, ref_audio_len:, :]
            generated_mel_spec = generated.permute(0, 2, 1)
            generated_wave = vocoder.decode(generated_mel_spec)
            if rms < target_rms:
                generated_wave = generated_wave * rms / target_rms

            generated_wave = generated_wave.squeeze().cpu().numpy()
            generated_waves.append(generated_wave)

    # combine all generated waves with cross-fading (upstream algorithm)
    if cross_fade_duration <= 0:
        final_wave = np.concatenate(generated_waves)
    else:
        final_wave = generated_waves[0]
        for i in range(1, len(generated_waves)):
            prev_wave = final_wave
            next_wave = generated_waves[i]

            cross_fade_samples = int(cross_fade_duration * target_sample_rate)
            cross_fade_samples = min(cross_fade_samples, len(prev_wave), len(next_wave))

            if cross_fade_samples <= 0:
                final_wave = np.concatenate([prev_wave, next_wave])
                continue

            prev_overlap = prev_wave[-cross_fade_samples:]
            next_overlap = next_wave[:cross_fade_samples]

            fade_out = np.linspace(1, 0, cross_fade_samples)
            fade_in = np.linspace(0, 1, cross_fade_samples)

            cross_faded_overlap = prev_overlap * fade_out + next_overlap * fade_in

            final_wave = np.concatenate(
                [prev_wave[:-cross_fade_samples], cross_faded_overlap, next_wave[cross_fade_samples:]]
            )

    return final_wave, target_sample_rate, None
