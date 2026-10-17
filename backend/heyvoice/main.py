"""HeyVoices backend entry point. Run:  python -m heyvoice"""
from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import events
from .api import router, seed_indic_presets, seed_presets
from .config import HOST, OUTPUTS_DIR, PORT, UPLOADS_DIR, VERSION, VOICES_DIR
from .jobs import start_worker

app = FastAPI(title="HeyVoices", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],           # localhost-only app
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.mount("/files/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.mount("/files/voices", StaticFiles(directory=str(VOICES_DIR)), name="voices")
app.mount("/files/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


@app.on_event("startup")
async def _startup() -> None:
    events.set_loop(asyncio.get_running_loop())
    start_worker()
    try:
        seed_presets()
        seed_indic_presets()
    except Exception as exc:  # noqa: BLE001
        print("preset seeding failed:", exc, flush=True)
    print(f"HeyVoices backend v{VERSION} ready on http://{HOST}:{PORT}", flush=True)


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
