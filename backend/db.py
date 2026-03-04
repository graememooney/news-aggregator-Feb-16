# app/db.py
import os
import sqlite3
import json
from contextlib import contextmanager
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime, timezone

from .config import settings


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)


@contextmanager
def get_conn():
    ensure_parent_dir(settings.sqlite_path)
    conn = sqlite3.connect(settings.sqlite_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        # Existing link-based enrichment cache (kept)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS enrich_cache (
                link TEXT PRIMARY KEY,
                title_en TEXT,
                summary_en TEXT,
                created_utc TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_enrich_created ON enrich_cache(created_utc)")

        # NEW: cluster-level enrichment cache (cluster_id -> title_en/summary_en)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cluster_enrich_cache (
                cluster_id TEXT PRIMARY KEY,
                title_en TEXT,
                summary_en TEXT,
                created_utc TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cluster_enrich_created ON cluster_enrich_cache(created_utc)"
        )

        # NEW: top feed cache (response payload cache)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS top_cache (
                cache_key TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                created_utc TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_top_cache_created ON top_cache(created_utc)")

        conn.commit()


# ----------------------------
# Shared time helpers
# ----------------------------
def parse_iso_utc(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def is_cache_fresh(created_utc: str, ttl_seconds: int) -> bool:
    dt = parse_iso_utc(created_utc)
    if dt is None:
        return False
    age = datetime.now(timezone.utc) - dt
    return age.total_seconds() <= ttl_seconds


# ----------------------------
# Existing link-based enrichment cache (kept)
# ----------------------------
def get_cache_row(link: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT link, title_en, summary_en, created_utc FROM enrich_cache WHERE link = ?",
            (link,),
        ).fetchone()
        return dict(row) if row else None


def upsert_cache(link: str, title_en: str, summary_en: str) -> None:
    now = utc_now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO enrich_cache (link, title_en, summary_en, created_utc)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(link) DO UPDATE SET
                title_en = excluded.title_en,
                summary_en = excluded.summary_en,
                created_utc = excluded.created_utc
            """,
            (link, title_en, summary_en, now),
        )
        conn.commit()


def fetch_expired_links(limit: int, ttl_seconds: int) -> List[str]:
    """
    Returns links whose cache exists but is older than TTL, oldest first.
    """
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT link, created_utc
            FROM enrich_cache
            ORDER BY created_utc ASC
            LIMIT ?
            """,
            (max(limit, 0),),
        ).fetchall()

    expired: List[str] = []
    for r in rows:
        if not is_cache_fresh(r["created_utc"], ttl_seconds):
            expired.append(r["link"])
    return expired


# ----------------------------
# NEW: cluster-level enrichment cache
# ----------------------------
def get_cluster_cache_row(cluster_id: str) -> Optional[Dict[str, Any]]:
    cid = (cluster_id or "").strip()
    if not cid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT cluster_id, title_en, summary_en, created_utc FROM cluster_enrich_cache WHERE cluster_id = ?",
            (cid,),
        ).fetchone()
        return dict(row) if row else None


def upsert_cluster_cache(cluster_id: str, title_en: str, summary_en: str) -> None:
    cid = (cluster_id or "").strip()
    if not cid:
        return
    now = utc_now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO cluster_enrich_cache (cluster_id, title_en, summary_en, created_utc)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(cluster_id) DO UPDATE SET
                title_en = excluded.title_en,
                summary_en = excluded.summary_en,
                created_utc = excluded.created_utc
            """,
            (cid, title_en, summary_en, now),
        )
        conn.commit()


# ----------------------------
# NEW: top feed cache (payload caching)
# ----------------------------
def make_top_cache_key(country: str, range_str: str, q: str, limit: int) -> str:
    c = (country or "").strip().lower()
    r = (range_str or "").strip().lower()
    qq = (q or "").strip().lower()
    lim = int(limit)
    return f"top|country={c}|range={r}|q={qq}|limit={lim}"


def get_top_cache(cache_key: str) -> Optional[Dict[str, Any]]:
    k = (cache_key or "").strip()
    if not k:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT cache_key, payload_json, created_utc FROM top_cache WHERE cache_key = ?",
            (k,),
        ).fetchone()
        if not row:
            return None
        try:
            payload = json.loads(row["payload_json"])
        except Exception:
            payload = None
        return {
            "cache_key": row["cache_key"],
            "payload": payload,
            "created_utc": row["created_utc"],
        }


def set_top_cache(cache_key: str, payload: Dict[str, Any]) -> None:
    k = (cache_key or "").strip()
    if not k:
        return
    now = utc_now_iso()
    payload_json = json.dumps(payload, ensure_ascii=False)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO top_cache (cache_key, payload_json, created_utc)
            VALUES (?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                payload_json = excluded.payload_json,
                created_utc = excluded.created_utc
            """,
            (k, payload_json, now),
        )
        conn.commit()


def delete_old_top_cache_rows(max_rows: int = 500) -> None:
    """
    Simple cap to avoid unbounded growth.
    Keeps newest max_rows, deletes older.
    """
    try:
        mr = int(max_rows)
    except Exception:
        mr = 500
    if mr <= 0:
        return

    with get_conn() as conn:
        count_row = conn.execute("SELECT COUNT(*) AS n FROM top_cache").fetchone()
        n = int(count_row["n"]) if count_row and count_row["n"] is not None else 0
        if n <= mr:
            return

        to_delete = n - mr
        keys = conn.execute(
            """
            SELECT cache_key
            FROM top_cache
            ORDER BY created_utc ASC
            LIMIT ?
            """,
            (to_delete,),
        ).fetchall()

        for r in keys:
            conn.execute("DELETE FROM top_cache WHERE cache_key = ?", (r["cache_key"],))
        conn.commit()