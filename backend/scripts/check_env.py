"""Post-install environment check."""
import sys

print("python:", sys.version.split()[0], flush=True)
try:
    import torch

    print("torch:", torch.__version__, flush=True)
    print("cuda available:", torch.cuda.is_available(), flush=True)
    if torch.cuda.is_available():
        print("gpu:", torch.cuda.get_device_name(0), flush=True)
        total = torch.cuda.get_device_properties(0).total_memory / 1024**3
        print(f"vram: {total:.1f} GB", flush=True)
except Exception as exc:  # noqa: BLE001
    print("torch check failed:", exc, flush=True)

for mod in ("fastapi", "soundfile", "faster_whisper", "pedalboard", "librosa"):
    try:
        __import__(mod)
        print(f"ok: {mod}", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"MISSING: {mod} ({exc})", flush=True)

for mod in ("qwen_tts", "chatterbox", "kokoro"):
    try:
        m = __import__(mod)
        print(f"ok: {mod} {getattr(m, '__version__', '')}", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"MISSING: {mod} ({exc})", flush=True)

print("CHECK DONE", flush=True)
