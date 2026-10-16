"""Prefetch the flagship model weights into the repo's models/hf cache."""
from huggingface_hub import snapshot_download

for repo in [
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    "Qwen/Qwen3-TTS-Tokenizer-12Hz",
]:
    print("downloading", repo, flush=True)
    snapshot_download(repo)
print("MODEL PREFETCH DONE", flush=True)
