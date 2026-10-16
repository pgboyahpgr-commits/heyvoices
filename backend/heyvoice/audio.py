"""Audio pipeline: text chunking, crossfade stitching, loudness, effects, export."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import numpy as np

PAUSE_RE = re.compile(r"\[\[\s*pause\s*:\s*(\d+)\s*(ms)?\s*\]\]", re.IGNORECASE)
TAG_RE = re.compile(r"\[[a-zA-Z][a-zA-Z ]{0,24}\]")  # keeps [laugh] etc. intact while splitting
SENT_SPLIT = re.compile(r"(?<=[.!?\u3002\uff01\uff1f;\uff1b])\s+")
PATH_SEP = re.compile(r"[,;:\u2014-]\s+")


# --------------------------------------------------------------- chunking
def _hard_wrap(sentence: str, max_len: int) -> list[str]:
    """Split an over-long sentence at commas, then spaces."""
    parts = [p.strip() for p in PATH_SEP.split(sentence) if p.strip()]
    out: list[str] = []
    buf = ""
    for p in parts:
        if len(p) > max_len:
            words = p.split(" ")
            for w in words:
                candidate = (buf + " " + w).strip()
                if len(candidate) > max_len and buf:
                    out.append(buf)
                    buf = w
                else:
                    buf = candidate
        else:
            candidate = (buf + " " + p).strip() if buf else p
            if len(candidate) > max_len and buf:
                out.append(buf)
                buf = p
            else:
                buf = candidate
    if buf:
        out.append(buf)
    return out or [sentence]


def chunk_text(text: str, max_len: int = 280) -> list[dict]:
    """Split script into chunks honoring [[pause:500]] markers.

    Returns [{"text": str, "pause_before_ms": int}, ...]
    """
    text = (text or "").replace("\r", "").strip()
    if not text:
        return []

    # tokenize around pause markers
    tokens: list[tuple[str, str | int]] = []
    last = 0
    for m in PAUSE_RE.finditer(text):
        tokens.append(("text", text[last:m.start()]))
        tokens.append(("pause", int(m.group(1))))
        last = m.end()
    tokens.append(("text", text[last:]))

    chunks: list[dict] = []
    buf = ""
    pending_pause = 0

    def flush():
        nonlocal buf, pending_pause
        piece = buf.strip()
        if piece:
            chunks.append({"text": piece, "pause_before_ms": pending_pause})
        buf = ""
        pending_pause = 0

    for kind, payload in tokens:
        if kind == "pause":
            flush()
            pending_pause = int(payload)
            continue
        for para in str(payload).split("\n"):
            para = para.strip()
            if not para:
                continue
            for sentence in SENT_SPLIT.split(para):
                pieces = [sentence] if len(sentence) <= max_len else _hard_wrap(sentence, max_len)
                for piece in pieces:
                    candidate = (buf + " " + piece).strip() if buf else piece
                    if len(candidate) > max_len and buf:
                        flush()
                        buf = piece
                    else:
                        buf = candidate
    flush()
    return chunks


# --------------------------------------------------------------- stitching
def crossfade(a: np.ndarray, b: np.ndarray, fade: int) -> np.ndarray:
    if fade <= 0 or len(a) < fade or len(b) < fade:
        return np.concatenate([a, b])
    ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
    head, tail = b[:fade], a[-fade:]
    mixed = tail * (1 - ramp) + head * ramp
    return np.concatenate([a[:-fade], mixed, b[fade:]])


def stitch(parts: list[np.ndarray], sr: int, crossfade_ms: int = 60,
           pauses_ms: list[int] | None = None) -> np.ndarray:
    if not parts:
        return np.zeros(0, dtype=np.float32)
    out = parts[0]
    for i, part in enumerate(parts[1:], start=1):
        pause = (pauses_ms[i - 1] if pauses_ms and i - 1 < len(pauses_ms) else 0) or 0
        if pause > 0:
            gap = np.zeros(int(sr * pause / 1000.0), dtype=np.float32)
            out = np.concatenate([out, gap, part])
        else:
            out = crossfade(out, part, int(sr * crossfade_ms / 1000.0))
    return out


# --------------------------------------------------------------- processing
def peak_normalize(audio: np.ndarray, target_db: float = -1.0) -> np.ndarray:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak < 1e-6:
        return audio
    target = 10 ** (target_db / 20.0)
    return audio * (target / peak)


def normalize_loudness(audio: np.ndarray, sr: int, target_lufs: float = -16.0) -> np.ndarray:
    try:
        import pyloudnorm as pyln

        meter = pyln.Meter(sr)
        loudness = meter.integrated_loudness(audio)
        if np.isfinite(loudness):
            gain_db = target_lufs - loudness
            out = audio * (10 ** (gain_db / 20.0))
            return peak_normalize(out, -1.0)
    except Exception:
        pass
    return peak_normalize(audio, -1.5)


def apply_effects(audio: np.ndarray, sr: int, fx: dict) -> np.ndarray:
    """fx: {gain_db, pitch_semitones, reverb_mix, lowpass_hz, highpass_hz, compressor}"""
    if not fx:
        return audio
    try:
        import pedalboard as pb
    except Exception:
        return audio
    plugins = []
    if fx.get("highpass_hz"):
        plugins.append(pb.HighpassFilter(cutoff_frequency_hz=float(fx["highpass_hz"])))
    if fx.get("lowpass_hz"):
        plugins.append(pb.LowpassFilter(cutoff_frequency_hz=float(fx["lowpass_hz"])))
    if fx.get("compressor"):
        plugins.append(pb.Compressor(threshold_db=-18.0, ratio=3.0))
    if fx.get("pitch_semitones"):
        plugins.append(pb.PitchShift(semitones=float(fx["pitch_semitones"])))
    if fx.get("reverb_mix"):
        wet = min(1.0, max(0.0, float(fx["reverb_mix"])))
        plugins.append(pb.Reverb(room_size=0.6, wet_level=wet * 0.7, dry_level=1.0 - wet * 0.4))
    if fx.get("gain_db"):
        plugins.append(pb.Gain(gain_db=float(fx["gain_db"])))
    if not plugins:
        return audio
    try:
        out = pb.Pedalboard(plugins)(audio.astype(np.float32), sr)
        return np.asarray(out, dtype=np.float32)
    except Exception:
        return audio


def trim_silence(audio: np.ndarray, sr: int, thresh_db: float = -45.0, pad_ms: float = 40.0,
                 return_offset: bool = False):
    if audio.size == 0:
        return (audio, 0) if return_offset else audio
    thresh = 10 ** (thresh_db / 20.0)
    env = np.abs(audio)
    idx = np.where(env > thresh)[0]
    if idx.size == 0:
        return (audio, 0) if return_offset else audio
    pad = int(sr * pad_ms / 1000.0)
    start = max(0, idx[0] - pad)
    end = min(len(audio), idx[-1] + pad)
    out = audio[start:end]
    return (out, start) if return_offset else out


def compute_peaks(audio: np.ndarray, buckets: int = 96) -> list[float]:
    if audio.size == 0:
        return []
    n = min(buckets, audio.size)
    edges = np.linspace(0, audio.size, n + 1).astype(int)
    peaks = []
    for i in range(n):
        seg = audio[edges[i]:edges[i + 1]]
        peaks.append(round(float(np.max(np.abs(seg))) if seg.size else 0.0, 4))
    return peaks


# --------------------------------------------------------------- io / export
def save_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    import soundfile as sf

    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), peak_normalize(np.nan_to_num(audio), -0.5), sr, subtype="PCM_16")


def export_audio(src_wav: Path, dst: Path, fmt: str) -> Path:
    """Convert a wav master to mp3/ogg/flac via ffmpeg; wav = just copy path."""
    fmt = (fmt or "wav").lower()
    if fmt == "wav":
        return src_wav
    dst.parent.mkdir(parents=True, exist_ok=True)
    codec = {"mp3": ["-codec:a", "libmp3lame", "-qscale:a", "2"],
             "ogg": ["-codec:a", "libvorbis", "-qscale:a", "5"],
             "flac": ["-codec:a", "flac"]}.get(fmt)
    if not codec:
        return src_wav
    try:
        subprocess.run(["ffmpeg", "-y", "-i", str(src_wav), *codec, str(dst)],
                       check=True, capture_output=True)
        return dst
    except Exception:
        return src_wav


def to_wav24k(src: Path, dst: Path, sr: int = 24000) -> bool:
    """Convert any audio *or video* file (webm/opus/mp3/m4a/mp4/mov/mkv...) to mono wav
    via ffmpeg. Video streams are stripped; the best audio track is used."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    base = ["ffmpeg", "-y", "-i", str(src), "-vn"]
    try:
        subprocess.run(
            [*base, "-ac", "1", "-ar", str(sr),
             "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", str(dst)],
            check=True, capture_output=True)
        return True
    except Exception:
        try:  # loudnorm on very short clips can fail; retry without it
            subprocess.run([*base, "-ac", "1", "-ar", str(sr), str(dst)],
                           check=True, capture_output=True)
            return True
        except Exception:
            return False


def prepare_clone_ref(src: Path, dst: Path, sr: int = 24000,
                      max_seconds: float = 60.0) -> dict:
    """Turn any uploaded audio/video file into a clean 24 kHz mono clone reference:
    extract the audio track via ffmpeg, trim edge silence, cap length. Returns metadata."""
    if not to_wav24k(src, dst, sr):
        return {"ok": False, "duration": 0.0, "trimmed_silence": False, "capped": False}
    data, _ = load_audio(dst, sr)
    clean = trim_silence(data, sr, thresh_db=-50.0, pad_ms=120.0)
    trimmed = clean.size != data.size
    capped = False
    limit = int(max_seconds * sr)
    if clean.size > limit:
        clean = clean[:limit]
        capped = True
    if trimmed or capped:
        save_wav(dst, clean, sr)
    return {"ok": True, "duration": round(clean.size / sr, 3),
            "trimmed_silence": trimmed, "capped": capped}


def analyze_reference(src: Path) -> dict:
    """Objective quality metrics for a clone reference clip (pre-normalization).

    Decodes via a lightweight ffmpeg f32le pipe so clipping/peak reflect the
    *original* recording (to_wav24k() loudness-normalizes, which hides clipping).
    Heuristic but useful: drives the friendly warnings in the clone wizard.
    """
    try:
        proc = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "24000",
             "-t", "90", "-f", "f32le", "-"],
            capture_output=True, check=True)
        data = np.frombuffer(proc.stdout, dtype=np.float32)
    except Exception:
        try:
            data = np.asarray(load_audio(src)[0], dtype=np.float32)
        except Exception:
            return {}
    if data.size == 0:
        return {}
    sr = 24000
    dur = data.size / sr
    peak = float(np.max(np.abs(data)))
    peak_dbfs = 20 * np.log10(max(peak, 1e-6))
    clipping_pct = float(np.mean(np.abs(data) > 0.985) * 100.0)

    hop = max(1, int(sr * 0.025))
    n = data.size // hop
    if n >= 4:
        frames = np.sqrt(np.mean(np.square(data[: n * hop]).reshape(n, hop), axis=1))
    else:
        frames = np.array([float(np.sqrt(np.mean(np.square(data))))])
    frames_db = 20 * np.log10(np.maximum(frames, 1e-7))
    noise_db = float(np.percentile(frames_db, 10))
    speech_db = float(np.percentile(frames_db, 90))
    snr = speech_db - noise_db
    speech_ratio = float(np.mean(frames_db > noise_db + 6.0))

    notes: list[str] = []
    verdict = "good"
    if dur < 5:
        notes.append("Clip is short — 10–30 s references clone noticeably more stably.")
        verdict = "fair"
    if snr < 12:
        notes.append(f"Background noise is audible (SNR ≈ {snr:.0f} dB) — a cleaner clip clones better.")
        verdict = "poor" if snr < 8 else "fair"
    if clipping_pct > 0.5:
        notes.append(f"Sound is clipped on {clipping_pct:.1f}% of samples — recorded too loud.")
        verdict = "fair"
    if peak_dbfs < -28:
        notes.append("Recording is very quiet — raise the source volume or pick a louder section.")
        verdict = "fair"
    if speech_ratio < 0.35:
        notes.append(f"Only ~{speech_ratio * 100:.0f}% of the clip is speech — trim music or silence.")
        verdict = "fair"
    if not notes:
        notes.append("Clean single-speaker reference — great for cloning.")

    return {
        "duration": round(dur, 2), "peak_dbfs": round(peak_dbfs, 1),
        "snr_db": round(snr, 1), "speech_ratio": round(speech_ratio, 2),
        "clipping_pct": round(clipping_pct, 2), "verdict": verdict, "notes": notes,
    }


def load_audio(path: Path, sr: int | None = None) -> tuple[np.ndarray, int]:
    import soundfile as sf

    data, file_sr = sf.read(str(path), dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data, (sr or file_sr)


def duration_of(path: Path) -> float:
    try:
        import soundfile as sf

        info = sf.info(str(path))
        return round(info.duration, 3)
    except Exception:
        return 0.0
