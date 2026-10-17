"""SQLite store: voices, samples, generations. Thread-safe (WAL + lock)."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from threading import Lock
from typing import Any, Optional

from .config import DB_PATH

_lock = Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    kind TEXT DEFAULT 'cloned',          -- cloned | preset | designed
    engine TEXT DEFAULT '',              -- engine hint ('' = auto)
    language TEXT DEFAULT 'auto',
    color TEXT DEFAULT '#14B8A6',
    favorite INTEGER DEFAULT 0,
    samples TEXT DEFAULT '[]',           -- JSON [{id,file,transcript,duration,url}]
    meta TEXT DEFAULT '{}',
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    voice_id TEXT,
    voice_name TEXT,
    text TEXT,
    engine TEXT,
    model TEXT,
    language TEXT,
    params TEXT DEFAULT '{}',
    file TEXT,
    duration REAL DEFAULT 0,
    peaks TEXT DEFAULT '[]',
    favorite INTEGER DEFAULT 0,
    batch_id TEXT DEFAULT '',
    created_at TEXT
);
"""


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.commit()
    return _conn


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


# ---------------------------------------------------------------- voices
def _voice_row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["samples"] = json.loads(d.get("samples") or "[]")
    d["meta"] = json.loads(d.get("meta") or "{}")
    d["favorite"] = bool(d.get("favorite"))
    return d


def list_voices() -> list[dict]:
    with _lock:
        rows = _db().execute("SELECT * FROM voices ORDER BY created_at DESC").fetchall()
    return [_voice_row(r) for r in rows]


def get_voice(voice_id: str) -> Optional[dict]:
    with _lock:
        row = _db().execute("SELECT * FROM voices WHERE id=?", (voice_id,)).fetchone()
    return _voice_row(row) if row else None


def create_voice(name: str, description: str = "", kind: str = "cloned", engine: str = "",
                 language: str = "auto", color: str = "#7C5CFF", samples: list | None = None,
                 meta: dict | None = None) -> dict:
    vid = new_id()
    with _lock:
        _db().execute(
            "INSERT INTO voices(id,name,description,kind,engine,language,color,samples,meta,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (vid, name, description, kind, engine, language, color,
             json.dumps(samples or []), json.dumps(meta or {}), now()),
        )
        _db().commit()
    return get_voice(vid)  # type: ignore


def update_voice(voice_id: str, patch: dict) -> Optional[dict]:
    allowed = {"name", "description", "engine", "language", "color", "favorite", "samples", "meta"}
    fields, values = [], []
    for k, v in patch.items():
        if k in allowed:
            fields.append(f"{k}=?")
            values.append(json.dumps(v) if k in ("samples", "meta") else (int(v) if k == "favorite" else v))
    if not fields:
        return get_voice(voice_id)
    values.append(voice_id)
    with _lock:
        _db().execute(f"UPDATE voices SET {', '.join(fields)} WHERE id=?", values)
        _db().commit()
    return get_voice(voice_id)


def delete_voice(voice_id: str) -> bool:
    with _lock:
        cur = _db().execute("DELETE FROM voices WHERE id=?", (voice_id,))
        _db().commit()
    return cur.rowcount > 0


def voice_exists_by_name(name: str) -> bool:
    with _lock:
        row = _db().execute("SELECT 1 FROM voices WHERE name=? COLLATE NOCASE", (name,)).fetchone()
    return row is not None


def count_voices() -> int:
    with _lock:
        row = _db().execute("SELECT COUNT(*) c FROM voices").fetchone()
    return row["c"]


# ---------------------------------------------------------------- generations
def _gen_row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["params"] = json.loads(d.get("params") or "{}")
    d["peaks"] = json.loads(d.get("peaks") or "[]")
    d["favorite"] = bool(d.get("favorite"))
    return d


def add_generation(id_: str | None = None, **kw: Any) -> dict:
    gid = id_ or new_id()
    with _lock:
        _db().execute(
            "INSERT INTO generations(id,voice_id,voice_name,text,engine,model,language,params,file,"
            "duration,peaks,favorite,batch_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (gid, kw.get("voice_id", ""), kw.get("voice_name", ""), kw.get("text", ""),
             kw.get("engine", ""), kw.get("model", ""), kw.get("language", "auto"),
             json.dumps(kw.get("params", {})), kw.get("file", ""), kw.get("duration", 0.0),
             json.dumps(kw.get("peaks", [])), 0, kw.get("batch_id", ""), now()),
        )
        _db().commit()
    return get_generation(gid)  # type: ignore


def list_generations(limit: int = 100, batch_id: str | None = None) -> list[dict]:
    with _lock:
        if batch_id is not None:
            rows = _db().execute(
                "SELECT * FROM generations WHERE batch_id=? ORDER BY created_at DESC LIMIT ?",
                (batch_id, limit)).fetchall()
        else:
            rows = _db().execute(
                "SELECT * FROM generations ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [_gen_row(r) for r in rows]


def get_generation(gid: str) -> Optional[dict]:
    with _lock:
        row = _db().execute("SELECT * FROM generations WHERE id=?", (gid,)).fetchone()
    return _gen_row(row) if row else None


def update_generation(gid: str, patch: dict) -> Optional[dict]:
    allowed = {"favorite", "peaks", "duration", "file"}
    fields, values = [], []
    for k, v in patch.items():
        if k in allowed:
            fields.append(f"{k}=?")
            values.append(json.dumps(v) if k == "peaks" else v)
    if fields:
        values.append(gid)
        with _lock:
            _db().execute(f"UPDATE generations SET {', '.join(fields)} WHERE id=?", values)
            _db().commit()
    return get_generation(gid)


def delete_generation(gid: str) -> Optional[str]:
    with _lock:
        row = _db().execute("SELECT file FROM generations WHERE id=?", (gid,)).fetchone()
        _db().execute("DELETE FROM generations WHERE id=?", (gid,))
        _db().commit()
    return row["file"] if row else None
