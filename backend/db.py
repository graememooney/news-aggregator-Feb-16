# app/db.py
import os
import sqlite3
from contextlib import contextmanager
from typing import Optional, Dict, Any, List
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
        conn.commit()


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


def parse_iso_utc(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
        # If stored without tz (shouldn’t happen), assume UTC
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