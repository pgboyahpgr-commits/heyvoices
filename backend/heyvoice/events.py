"""Server-Sent-Events broadcaster. Thread-safe: worker threads call emit()."""
from __future__ import annotations

import asyncio
import json
import time

_loop: asyncio.AbstractEventLoop | None = None
_subs: set[asyncio.Queue] = set()


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subs.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subs.discard(q)


def _emit_now(type_: str, data: dict) -> None:
    msg = {"type": type_, "data": data, "ts": time.time()}
    for q in list(_subs):
        try:
            q.put_nowait(msg)
        except Exception:
            pass


def emit(type_: str, data: dict) -> None:
    """Emit an event from ANY thread."""
    if _loop is None:
        return
    try:
        _loop.call_soon_threadsafe(_emit_now, type_, data)
    except RuntimeError:
        pass
