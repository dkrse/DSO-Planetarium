"""Server-side storage for equipment setups, planned targets and app settings.

SQLite (stdlib) used as a small JSON document store: one table per collection,
each row = (id, JSON document). The database lives in `data/astro.db`.
"""
import json
import sqlite3
import threading
import uuid
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "astro.db"
COLLECTIONS = ("setups", "targets")

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        for c in COLLECTIONS:
            _conn.execute(f"CREATE TABLE IF NOT EXISTS {c} (id TEXT PRIMARY KEY, pos INTEGER, data TEXT NOT NULL)")
        _conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        _conn.commit()
    return _conn


def new_id() -> str:
    return uuid.uuid4().hex[:10]


def list_docs(coll: str) -> list[dict]:
    with _lock:
        rows = _db().execute(f"SELECT data FROM {coll} ORDER BY pos, rowid").fetchall()
    return [json.loads(r[0]) for r in rows]


def get_doc(coll: str, doc_id: str) -> dict | None:
    with _lock:
        row = _db().execute(f"SELECT data FROM {coll} WHERE id = ?", (doc_id,)).fetchone()
    return json.loads(row[0]) if row else None


def put_doc(coll: str, doc: dict) -> dict:
    with _lock:
        db = _db()
        pos = db.execute(f"SELECT pos FROM {coll} WHERE id = ?", (doc["id"],)).fetchone()
        if pos is None:
            pos = (db.execute(f"SELECT COALESCE(MAX(pos), 0) + 1 FROM {coll}").fetchone()[0],)
        db.execute(f"INSERT OR REPLACE INTO {coll} (id, pos, data) VALUES (?, ?, ?)",
                   (doc["id"], pos[0], json.dumps(doc, ensure_ascii=False)))
        db.commit()
    return doc


def delete_doc(coll: str, doc_id: str) -> bool:
    with _lock:
        cur = _db().execute(f"DELETE FROM {coll} WHERE id = ?", (doc_id,))
        _db().commit()
    return cur.rowcount > 0


def get_settings() -> dict:
    with _lock:
        rows = _db().execute("SELECT key, value FROM settings").fetchall()
    return {k: json.loads(v) for k, v in rows}


def update_settings(values: dict) -> dict:
    with _lock:
        db = _db()
        for k, v in values.items():
            db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, json.dumps(v)))
        db.commit()
    return get_settings()
