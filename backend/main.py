import os
import re
import json
import time
import sqlite3
import urllib.request
import urllib.error
import threading
import hashlib
import math
import copy
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import feedparser
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ✅ Load backend/.env automatically
try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv()
except Exception:
    pass

# ----------------------------
# App
# ----------------------------
app = FastAPI(title="News Aggregator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # MVP / Codespaces
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# Source config (single source of truth)
# ----------------------------
# Mercosur bloc (as requested): UY, AR, BR, PY, BO + MercoPress ("mp") + "all"
SOURCES: List[Dict[str, Any]] = [
    # --- Uruguay (UY) ---
    {
        "id": "montevideo_portal",
        "name": "Montevideo Portal",
        "country_key": "uy",
        "country_code": "UY",
        "country_flag_url": "https://flagcdn.com/w40/uy.png",
        "source_logo": "https://www.montevideo.com.uy/favicon.ico",
        "feed_url": "https://www.montevideo.com.uy/anxml.aspx?59",
    },
    {
        "id": "el_observador_uy",
        "name": "El Observador (UY)",
        "country_key": "uy",
        "country_code": "UY",
        "country_flag_url": "https://flagcdn.com/w40/uy.png",
        "source_logo": "https://www.elobservador.com.uy/favicon.ico",
        "feed_url": "https://www.elobservador.com.uy/rss/pages/home.xml",
    },
    # --- Argentina (AR) ---
    {
        "id": "lanacion_ar",
        "name": "La Nación (AR)",
        "country_key": "ar",
        "country_code": "AR",
        "country_flag_url": "https://flagcdn.com/w40/ar.png",
        "source_logo": "https://www.lanacion.com.ar/favicon.ico",
        "feed_url": "https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml",
    },
    # Clarín rss.html is an index and often not well-formed; Lo Último is a proper feed
    {
        "id": "clarin_ar_lo_ultimo",
        "name": "Clarín (AR) - Lo Último",
        "country_key": "ar",
        "country_code": "AR",
        "country_flag_url": "https://flagcdn.com/w40/ar.png",
        "source_logo": "https://www.clarin.com/favicon.ico",
        "feed_url": "https://www.clarin.com/rss/lo-ultimo/",
    },
    # --- Brazil (BR) ---
    {
        "id": "g1_br",
        "name": "G1 (BR)",
        "country_key": "br",
        "country_code": "BR",
        "country_flag_url": "https://flagcdn.com/w40/br.png",
        "source_logo": "https://g1.globo.com/favicon.ico",
        "feed_url": "https://g1.globo.com/rss/g1/",
    },
    {
        "id": "uol_br",
        "name": "UOL (BR)",
        "country_key": "br",
        "country_code": "BR",
        "country_flag_url": "https://flagcdn.com/w40/br.png",
        "source_logo": "https://www.uol.com.br/favicon.ico",
        "feed_url": "https://rss.uol.com.br/feed/noticias.xml",
    },
    # --- Paraguay (PY) ---
    {
        "id": "abccolor_py",
        "name": "ABC Color (PY)",
        "country_key": "py",
        "country_code": "PY",
        "country_flag_url": "https://flagcdn.com/w40/py.png",
        "source_logo": "https://www.abc.com.py/favicon.ico",
        "feed_url": "https://www.abc.com.py/arc/outboundfeeds/rss/nacionales/",
    },
    # --- Bolivia (BO) ---
    {
        "id": "radiofides_bo",
        "name": "Radio Fides (BO)",
        "country_key": "bo",
        "country_code": "BO",
        "country_flag_url": "https://flagcdn.com/w40/bo.png",
        "source_logo": "https://radiofides.com/es/favicon.ico",
        "feed_url": "https://radiofides.com/es/feed/",
    },
    {
        "id": "radiofides_bo_nacional",
        "name": "Radio Fides - Nacional (BO)",
        "country_key": "bo",
        "country_code": "BO",
        "country_flag_url": "https://flagcdn.com/w40/bo.png",
        "source_logo": "https://radiofides.com/es/favicon.ico",
        "feed_url": "https://radiofides.com/es/category/nacional/feed/",
    },
    {
        "id": "lapatria_bo",
        "name": "La Patria (BO)",
        "country_key": "bo",
        "country_code": "BO",
        "country_flag_url": "https://flagcdn.com/w40/bo.png",
        "source_logo": "https://lapatria.bo/favicon.ico",
        "feed_url": "https://lapatria.bo/feed/",
    },
    # --- MercoPress (Mercosur bloc) ---
    {
        "id": "mercopress_mercosur",
        "name": "MercoPress (Mercosur)",
        "country_key": "mp",
        "country_code": "MP",
        "country_flag_url": None,
        "source_logo": "https://en.mercopress.com/favicon.ico",
        "feed_url": "https://en.mercopress.com/rss/mercosur",
    },
]

# ----------------------------
# SQLite cache
# ----------------------------
DB_PATH = os.path.join(os.path.dirname(__file__), "cache.db")


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _db() as conn:
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


_init_db()

# ----------------------------
# Helpers
# ----------------------------
_TAG_RE = re.compile(r"<[^>]+>")


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_html(s: str) -> str:
    if not s:
        return ""
    s = _TAG_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _clean_text_any(s: str, max_chars: int = 700) -> str:
    s = _strip_html(s)
    if len(s) > max_chars:
        s = s[: max_chars - 1].rstrip() + "…"
    return s


def _range_to_since(range_str: str) -> datetime:
    r = (range_str or "24h").strip().lower()
    if r == "24h":
        delta = timedelta(hours=24)
    elif r == "3d":
        delta = timedelta(days=3)
    elif r == "7d":
        delta = timedelta(days=7)
    elif r == "30d":
        delta = timedelta(days=30)
    else:
        delta = timedelta(hours=24)
    return datetime.now(timezone.utc) - delta


def _parse_date(entry: Dict[str, Any]) -> Optional[datetime]:
    dt_struct = entry.get("published_parsed") or entry.get("updated_parsed")
    if dt_struct:
        try:
            return datetime(*dt_struct[:6], tzinfo=timezone.utc)
        except Exception:
            pass

    for key in ("published", "updated"):
        val = entry.get(key)
        if isinstance(val, str) and val.strip():
            try:
                parsed = feedparser._parse_date(val)
                if parsed:
                    return datetime(*parsed[:6], tzinfo=timezone.utc)
            except Exception:
                pass

    return None


def _matches_q(article: Dict[str, Any], q: str) -> bool:
    if not q:
        return True
    qn = q.strip().lower()
    if not qn:
        return True
    hay = " ".join(
        [
            str(article.get("title", "")),
            str(article.get("snippet_text", "")),
            str(article.get("source", "")),
            str(article.get("title_en", "")),
            str(article.get("summary_en", "")),
        ]
    ).lower()
    return qn in hay


# ----------------------------
# Robust feed fetch (timeout + UA)
# ----------------------------
DEFAULT_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def _fetch_feed(feed_url: str, timeout_s: int = 12) -> feedparser.FeedParserDict:
    req = urllib.request.Request(
        feed_url,
        headers={
            "User-Agent": DEFAULT_UA,
            "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read()
        return feedparser.parse(raw)
    except urllib.error.URLError as e:
        raise RuntimeError(f"URL error: {e}")
    except Exception as e:
        raise RuntimeError(f"Fetch failed: {e}")


# ----------------------------
# Cache helpers
# ----------------------------
def _get_cached_enrich(link: str) -> Optional[Dict[str, Any]]:
    with _db() as conn:
        row = conn.execute(
            "SELECT title_en, summary_en, created_utc FROM enrich_cache WHERE link = ?",
            (link,),
        ).fetchone()
        if not row:
            return None
        return {
            "title_en": row["title_en"],
            "summary_en": row["summary_en"],
            "created_utc": row["created_utc"],
        }


def _set_cached_enrich(link: str, title_en: str, summary_en: str) -> None:
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO enrich_cache (link, title_en, summary_en, created_utc)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(link) DO UPDATE SET
              title_en=excluded.title_en,
              summary_en=excluded.summary_en,
              created_utc=excluded.created_utc
            """,
            (link, title_en, summary_en, _now_utc_iso()),
        )


# ----------------------------
# /news TTL cache (in-memory)
# ----------------------------
_NEWS_CACHE_LOCK = threading.Lock()
_NEWS_CACHE: Dict[str, Dict[str, Any]] = {}
# entry shape:
# { "ts": float_epoch, "payload": dict }


def _news_ttl_s() -> int:
    try:
        return int((os.getenv("NEWS_TTL_S") or "120").strip())
    except Exception:
        return 120


def _news_cache_max_keys() -> int:
    try:
        return int((os.getenv("NEWS_CACHE_MAX_KEYS") or "200").strip())
    except Exception:
        return 200


def _news_cache_get(key: str) -> Optional[Tuple[Dict[str, Any], int]]:
    ttl = _news_ttl_s()
    if ttl <= 0:
        return None

    now = time.time()
    with _NEWS_CACHE_LOCK:
        entry = _NEWS_CACHE.get(key)
        if not entry:
            return None
        age = int(now - float(entry.get("ts", 0.0)))
        if age < 0:
            age = 0
        if age > ttl:
            _NEWS_CACHE.pop(key, None)
            return None

        payload = copy.deepcopy(entry.get("payload", {}))
        return payload, age


def _news_cache_set(key: str, payload: Dict[str, Any]) -> None:
    ttl = _news_ttl_s()
    if ttl <= 0:
        return

    now = time.time()
    with _NEWS_CACHE_LOCK:
        _NEWS_CACHE[key] = {"ts": now, "payload": copy.deepcopy(payload)}

        max_keys = _news_cache_max_keys()
        if max_keys > 0 and len(_NEWS_CACHE) > max_keys:
            items = list(_NEWS_CACHE.items())
            items.sort(key=lambda kv: float(kv[1].get("ts", 0.0)))
            for k, _v in items[: max(1, len(_NEWS_CACHE) - max_keys)]:
                _NEWS_CACHE.pop(k, None)


# ----------------------------
# Simple rate limit (NEW) – protects /enrich from abuse + protects your OpenAI spend
# ----------------------------
_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: Dict[str, List[float]] = {}


def _env_bool(key: str, default: bool = False) -> bool:
    v = (os.getenv(key) or "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    return default


def _env_int(key: str, default: int) -> int:
    try:
        return int((os.getenv(key) or "").strip())
    except Exception:
        return default


def _client_ip(req: Request) -> str:
    # If you later run behind a proxy/load balancer, you can expand this to honor X-Forwarded-For safely.
    # For now, keep it predictable.
    try:
        if req.client and req.client.host:
            return str(req.client.host)
    except Exception:
        pass
    return "unknown"


def _rate_limit_check(req: Request) -> None:
    """
    Very simple fixed-window-ish limiter (rolling window):
    - ENRICH_RATE_LIMIT_ENABLED (default true)
    - ENRICH_RPM (default 30)
    - ENRICH_WINDOW_S (default 60)
    """
    if not _env_bool("ENRICH_RATE_LIMIT_ENABLED", default=True):
        return

    rpm = _env_int("ENRICH_RPM", 30)
    window_s = _env_int("ENRICH_WINDOW_S", 60)

    if rpm <= 0:
        return
    if window_s <= 0:
        window_s = 60

    ip = _client_ip(req)
    now = time.time()
    cutoff = now - float(window_s)

    with _RATE_LOCK:
        bucket = _RATE_BUCKETS.get(ip) or []
        # drop old timestamps
        bucket = [t for t in bucket if t >= cutoff]

        if len(bucket) >= rpm:
            retry_after = 5
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded for /enrich. Try again in a few seconds.",
                headers={"Retry-After": str(retry_after)},
            )

        bucket.append(now)
        _RATE_BUCKETS[ip] = bucket


# ----------------------------
# Source category extraction + mapping
# ----------------------------
def _extract_entry_categories(entry: Dict[str, Any]) -> List[str]:
    """
    feedparser maps RSS <category> and Atom categories into entry.tags (list of dicts).
    Some feeds may also expose entry.category or entry.categories.
    """
    cats: List[str] = []

    # tags is the main place
    tags = entry.get("tags")
    if isinstance(tags, list):
        for t in tags:
            try:
                if isinstance(t, dict):
                    term = (t.get("term") or t.get("label") or "").strip()
                    if term:
                        cats.append(term)
                else:
                    s = str(t).strip()
                    if s:
                        cats.append(s)
            except Exception:
                continue

    # sometimes category is a single string
    cat = entry.get("category")
    if isinstance(cat, str) and cat.strip():
        cats.append(cat.strip())

    # sometimes categories is a list
    categories = entry.get("categories")
    if isinstance(categories, list):
        for c in categories:
            try:
                if isinstance(c, str) and c.strip():
                    cats.append(c.strip())
                elif isinstance(c, dict):
                    term = (c.get("term") or c.get("label") or "").strip()
                    if term:
                        cats.append(term)
                else:
                    s = str(c).strip()
                    if s:
                        cats.append(s)
            except Exception:
                continue

    # de-dupe, preserve order
    seen = set()
    out: List[str] = []
    for c in cats:
        cc = c.strip()
        if not cc:
            continue
        key = cc.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cc)
    return out


def _norm_cat(s: str) -> str:
    t = (s or "").strip().lower()
    t = unicodedata.normalize("NFKD", t)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"\s+", " ", t)
    return t


def _map_source_category_to_topic(cat: str) -> Optional[str]:
    """
    Map Spanish/Portuguese (and some English) feed categories into our UI buckets.
    Return None if unmappable.
    """
    c = _norm_cat(cat)
    if not c:
        return None

    # Sports
    if any(
        x in c
        for x in [
            "deporte",
            "deportes",
            "sports",
            "futbol",
            "fútbol",
            "futebol",
            "tenis",
            "rugby",
            "basquet",
            "básquet",
            "basket",
        ]
    ):
        return "Sports"

    # Politics / National
    if any(
        x in c
        for x in [
            "politica",
            "política",
            "gobierno",
            "parlamento",
            "elecciones",
            "estado",
            "congreso",
            "senado",
        ]
    ):
        return "Politics"

    # Economy / Business / Markets
    if (
        "mercado" in c
        or "markets" in c
        or "bolsa" in c
        or "acciones" in c
        or "bonos" in c
        or "finanzas" in c
        or "trading" in c
    ):
        return "Markets"
    if "empresa" in c or "empresas" in c or "negocio" in c or "negocios" in c or "industria" in c or "corporat" in c:
        return "Business"
    if "econom" in c or "inflacion" in c or "inflación" in c or "pib" in c or "macro" in c:
        return "Economy"

    # World / International
    if any(x in c for x in ["internacional", "internacionales", "mundo", "world", "exterior", "global"]):
        return "World"

    # Society / Local / General news sections
    if any(
        x in c
        for x in [
            "sociedad",
            "social",
            "comunidad",
            "local",
            "locales",
            "ciudad",
            "ciudades",
            "interes general",
            "interés general",
            "actualidad",
            "cotidiano",
        ]
    ):
        return "Society"

    # Education
    if any(x in c for x in ["educacion", "educación", "escuela", "liceo", "universidad", "udelar", "ensenanza", "enseñanza"]):
        return "Education"

    # Health
    if any(x in c for x in ["salud", "health", "hospital", "medicina", "covid", "dengue"]):
        return "Health"

    # Science
    if any(x in c for x in ["ciencia", "science", "investigacion", "investigación", "laboratorio", "espacio", "astronomia", "astronomía"]):
        return "Science"

    # Technology (kept strict here; categories are usually explicit)
    if any(
        x in c
        for x in [
            "tecnologia",
            "tecnología",
            "technology",
            "tech",
            "ciberseguridad",
            "internet",
            "software",
            "inteligencia artificial",
            "inteligencia",
            "artificial",
            "ia",
            "ai",
        ]
    ):
        return "Technology"

    # Energy
    if any(x in c for x in ["energia", "energía", "petroleo", "petróleo", "gas", "ute", "ancap", "combustible", "renovable", "eolica", "eólica", "solar"]):
        return "Energy"

    # Environment
    if any(
        x in c
        for x in [
            "ambiente",
            "medio ambiente",
            "environment",
            "clima",
            "climate",
            "inundacion",
            "inundación",
            "sequia",
            "sequía",
            "contaminacion",
            "contaminación",
        ]
    ):
        return "Environment"

    # Security / Police / Courts
    if any(
        x in c
        for x in [
            "seguridad",
            "policial",
            "policiales",
            "policia",
            "policía",
            "crimen",
            "judicial",
            "tribunales",
            "narcotrafico",
            "narcotráfico",
            "delito",
            "delitos",
        ]
    ):
        return "Security"

    # Culture
    if any(x in c for x in ["cultura", "culture", "arte", "artes", "cine", "teatro", "musica", "música", "festival", "literatura"]):
        return "Culture"

    # Common domestic labels -> Society
    if any(x in c for x in ["nacional", "nacionales", "pais", "país", "uruguay", "argentina", "brasil", "paraguay", "bolivia"]):
        return "Society"

    return None


def _topic_from_source_categories(a: Dict[str, Any]) -> Optional[str]:
    cats = a.get("source_categories") or []
    if not isinstance(cats, list) or not cats:
        return None

    for c in cats:
        try:
            mapped = _map_source_category_to_topic(str(c))
            if mapped:
                return mapped
        except Exception:
            continue

    return None


# ----------------------------
# Article builder
# ----------------------------
def _build_article(source: Dict[str, Any], entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    link = (entry.get("link") or "").strip()
    title = (entry.get("title") or "").strip()
    if not link or not title:
        return None

    published_dt = _parse_date(entry)
    published_utc = published_dt.isoformat() if published_dt else None

    snippet = ""
    if entry.get("summary"):
        snippet = entry["summary"]
    elif entry.get("description"):
        snippet = entry["description"]
    elif entry.get("content") and isinstance(entry["content"], list) and entry["content"]:
        snippet = entry["content"][0].get("value", "") or ""

    snippet_text = _clean_text_any(snippet, max_chars=700)

    source_categories = _extract_entry_categories(entry)
    source_category_primary = source_categories[0] if source_categories else None

    article: Dict[str, Any] = {
        "title": title,
        "link": link,
        "published": entry.get("published") or entry.get("updated") or (published_dt.isoformat() if published_dt else ""),
        "published_utc": published_utc,
        "source": source["name"],
        "country_key": source.get("country_key"),
        "country_code": source.get("country_code"),
        "country_flag_url": source.get("country_flag_url"),
        "source_logo": source.get("source_logo"),
        "snippet_text": snippet_text,
        "has_cached_summary": False,
        # NEW (non-breaking): raw categories from the feed
        "source_categories": source_categories,
        "source_category_primary": source_category_primary,
    }

    cached = _get_cached_enrich(link)
    if cached and cached.get("summary_en"):
        article["title_en"] = cached.get("title_en") or ""
        article["summary_en"] = cached.get("summary_en") or ""
        article["has_cached_summary"] = True

    return article


# ----------------------------
# Deduplication + clustering signature
# ----------------------------
_NON_WORD = re.compile(r"[^a-z0-9\s]")


def _norm_title(s: str) -> str:
    s = (s or "").strip().lower()
    s = _NON_WORD.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _day_bucket(published_utc: Optional[str]) -> str:
    if not published_utc:
        return "unknown"
    try:
        dt = datetime.fromisoformat(published_utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date().isoformat()
    except Exception:
        return "unknown"


def _sig(article: Dict[str, Any]) -> str:
    ck = (article.get("country_key") or "").lower() or "x"
    day = _day_bucket(article.get("published_utc"))
    nt = _norm_title(article.get("title") or "")
    raw = f"{ck}|{day}|{nt[:180]}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _quality_score(a: Dict[str, Any]) -> Tuple[int, int, str]:
    has_en = 1 if (a.get("title_en") and a.get("summary_en")) else 0
    has_cached = 1 if a.get("has_cached_summary") else 0
    snip_len = len((a.get("snippet_text") or "").strip())
    has_snip = 1 if snip_len >= 60 else 0
    pu = a.get("published_utc") or ""
    return (has_en * 3 + has_cached * 2 + has_snip, snip_len, pu)


def _dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    best: Dict[str, Dict[str, Any]] = {}
    counts: Dict[str, int] = {}

    for a in items:
        s = _sig(a)
        counts[s] = counts.get(s, 0) + 1
        if s not in best:
            best[s] = a
            continue
        if _quality_score(a) > _quality_score(best[s]):
            best[s] = a

    out = list(best.values())
    for a in out:
        s = _sig(a)
        c = counts.get(s, 1)
        if c > 1:
            a["duplicates_count"] = c
    return out


# ----------------------------
# Topic labeling v5 (category-first, scoring fallback)
# ----------------------------
GENERAL_LABEL = "General"

MIN_SCORE = 4.0
MIN_MARGIN = 1.25
STRONG_WIN_SCORE = 8.5

SPORTS_MIN_SCORE = 6.0
SPORTS_REQUIRE_ANCHOR = True

_SCORE_PATTERN = re.compile(r"\b\d{1,2}\s*[-–:]\s*\d{1,2}\b")  # 2-1, 3:0


def _norm_text_for_topic(text: str) -> str:
    if not text:
        return ""
    t = text.lower().strip()
    t = unicodedata.normalize("NFKD", t)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"\s+", " ", t)
    return t


def _count_phrase_hits(text: str, phrase: str) -> int:
    if not phrase:
        return 0
    if " " in phrase:
        return 1 if phrase in text else 0
    return len(re.findall(rf"\b{re.escape(phrase)}\b", text))


def _score_category(text: str, rules: Dict[str, Dict[str, float]]) -> Tuple[float, List[str]]:
    score = 0.0
    matched: List[str] = []

    for phrase, w in (rules.get("strong") or {}).items():
        hits = _count_phrase_hits(text, phrase)
        if hits:
            score += w * hits
            matched.append(f"+{phrase}")

    for phrase, w in (rules.get("keywords") or {}).items():
        hits = _count_phrase_hits(text, phrase)
        if hits:
            score += w * hits
            matched.append(f"+{phrase}")

    for phrase, pen in (rules.get("negative") or {}).items():
        hits = _count_phrase_hits(text, phrase)
        if hits:
            score -= abs(pen) * hits
            matched.append(f"-{phrase}")

    distinct_positive = len([m for m in matched if m.startswith("+")])
    if distinct_positive >= 3:
        score += 1.0
    elif distinct_positive == 2:
        score += 0.5

    return score, matched


CATEGORY_RULES: Dict[str, Dict[str, Dict[str, float]]] = {
    "Politics": {
        "strong": {
            "presidente": 4.0,
            "gobierno": 3.5,
            "parlamento": 3.5,
            "senado": 3.5,
            "diputados": 3.5,
            "ministerio": 3.0,
            "elecciones": 4.0,
            "plebiscito": 4.0,
            "referendum": 4.0,
            "decreto": 3.0,
            "oposicion": 2.5,
            "fiscalia": 3.0,
            "corte": 2.5,
            "tribunal": 2.5,
            "justicia": 2.5,
        },
        "keywords": {
            "partido": 1.5,
            "campana": 1.5,
            "coalicion": 1.5,
            "intendente": 1.5,
            "alcalde": 1.5,
            "canciller": 1.5,
            "ley": 1.5,
            "proyecto": 1.0,
            "plenario": 1.5,
            "comision": 1.0,
            "diputado": 1.5,
            "senador": 1.5,
        },
        "negative": {},
    },
    "Economy": {
        "strong": {
            "inflacion": 4.0,
            "pib": 3.5,
            "recesion": 4.0,
            "tasa de interes": 4.0,
            "banco central": 4.0,
            "deuda": 3.0,
            "fmi": 3.5,
            "imf": 3.5,
            "desempleo": 3.5,
        },
        "keywords": {
            "crecimiento": 2.0,
            "exportaciones": 2.0,
            "importaciones": 2.0,
            "salarios": 2.0,
            "empleo": 2.0,
            "impuestos": 2.0,
            "arancel": 1.5,
            "dolar": 1.5,
            "usd": 1.0,
            "peso": 1.0,
            "real": 1.0,
            "costo de vida": 2.5,
            "ipc": 2.5,
            "tarifas": 2.0,
        },
        "negative": {},
    },
    "Business": {
        "strong": {
            "empresa": 3.0,
            "inversion": 3.0,
            "inversiones": 3.0,
            "fusion": 3.5,
            "fusiones": 3.5,
            "adquisicion": 3.5,
            "ganancias": 3.0,
            "resultados": 2.5,
            "restructuracion": 3.0,
            "ipo": 3.5,
        },
        "keywords": {
            "accionistas": 2.0,
            "startup": 2.0,
            "fintech": 2.5,
            "banco": 1.0,
            "industria": 1.5,
            "planta": 1.5,
            "empleador": 1.5,
            "contrato": 1.2,
        },
        "negative": {},
    },
    "Markets": {
        "strong": {
            "bolsa": 4.0,
            "acciones": 3.0,
            "bonos": 3.0,
            "wall street": 4.0,
            "nasdaq": 4.0,
            "dow jones": 4.0,
            "sp 500": 4.0,
            "s&p 500": 4.0,
            "tipo de cambio": 4.0,
        },
        "keywords": {
            "mercados": 2.0,
            "riesgo pais": 3.5,
            "dolar blue": 3.0,
            "cotizacion": 2.0,
            "cotización": 2.0,
            "bitcoin": 2.5,
            "btc": 1.5,
            "ethereum": 2.0,
            "etf": 2.0,
        },
        "negative": {},
    },
    "World": {
        "strong": {
            "onu": 3.0,
            "guerra": 3.5,
            "conflicto": 3.0,
            "ucrania": 4.0,
            "israel": 4.0,
            "gaza": 4.0,
            "china": 3.0,
            "eeuu": 3.0,
            "estados unidos": 3.0,
            "union europea": 3.0,
            "otan": 3.5,
        },
        "keywords": {
            "diplomacia": 2.0,
            "cumbre": 2.0,
            "sanciones": 2.0,
            "embajada": 2.0,
            "consulado": 2.0,
        },
        "negative": {},
    },
    "Society": {
        "strong": {
            "policia": 3.5,
            "policía": 3.5,
            "crimen": 3.5,
            "homicidio": 4.0,
            "asesinato": 4.0,
            "violencia": 3.0,
            "accidente": 3.0,
            "incendio": 3.0,
            "bomberos": 3.0,
            "tragedia": 3.0,
            "transito": 2.5,
            "tránsito": 2.5,
        },
        "keywords": {
            "barrio": 1.5,
            "vecinos": 1.5,
            "protesta": 2.0,
            "manifestacion": 2.0,
            "manifestación": 2.0,
            "sindicato": 2.0,
            "paro": 2.0,
            "huelga": 2.0,
            "educacion": 1.0,
            "educación": 1.0,
        },
        "negative": {},
    },
    "Education": {
        "strong": {
            "escuela": 3.5,
            "liceo": 3.5,
            "universidad": 3.5,
            "udelar": 3.5,
            "docentes": 3.0,
            "clases": 2.5,
            "inscripciones": 3.0,
        },
        "keywords": {
            "alumnos": 2.0,
            "estudiantes": 2.0,
            "facultad": 2.0,
            "beca": 2.0,
            "examen": 2.0,
        },
        "negative": {},
    },
    "Health": {
        "strong": {
            "vacuna": 4.0,
            "dengue": 4.0,
            "brote": 3.5,
            "outbreak": 3.5,
            "virus": 3.0,
            "epidemia": 3.0,
            "hospital": 3.0,
            "covid": 3.5,
            "gripe": 3.0,
        },
        "keywords": {
            "salud": 2.0,
            "medicos": 2.0,
            "médicos": 2.0,
            "pacientes": 2.0,
            "tratamiento": 2.0,
            "clinica": 2.0,
            "clínica": 2.0,
        },
        "negative": {},
    },
    "Science": {
        "strong": {
            "investigacion": 3.5,
            "investigación": 3.5,
            "cientific": 3.0,
            "ciencia": 3.0,
            "estudio": 2.5,
            "laboratorio": 3.0,
        },
        "keywords": {
            "astronomia": 3.0,
            "astronomía": 3.0,
            "espacio": 2.0,
            "nasa": 3.0,
            "descubrimiento": 3.0,
        },
        "negative": {},
    },
    "Technology": {
        "strong": {
            "inteligencia artificial": 4.0,
            "ciberseguridad": 4.0,
            "data breach": 4.0,
            "hackeo": 3.5,
            "software": 2.5,
            "cloud": 2.5,
        },
        "keywords": {
            "ia": 2.0,
            "ai": 2.0,
            "datos": 1.5,
            "algoritmo": 2.0,
            "plataforma": 1.5,
            "chip": 2.0,
            "robot": 2.0,
            "app": 2.0,
        },
        "negative": {},
    },
    "Energy": {
        "strong": {
            "petroleo": 4.0,
            "petróleo": 4.0,
            "gas": 3.0,
            "energia": 3.0,
            "energía": 3.0,
            "combustible": 3.0,
            "ute": 3.5,
            "ancap": 3.5,
        },
        "keywords": {
            "renovable": 2.5,
            "eolica": 2.5,
            "eólica": 2.5,
            "solar": 2.0,
            "tarifa": 2.0,
        },
        "negative": {},
    },
    "Environment": {
        "strong": {
            "clima": 3.0,
            "sequía": 4.0,
            "sequia": 4.0,
            "inundacion": 4.0,
            "inundación": 4.0,
            "incendios forestales": 4.0,
            "contaminacion": 3.5,
            "contaminación": 3.5,
        },
        "keywords": {
            "medio ambiente": 3.0,
            "fauna": 2.5,
            "bosque": 2.5,
            "rio": 1.5,
            "río": 1.5,
            "agua": 1.5,
        },
        "negative": {},
    },
    "Security": {
        "strong": {
            "narcotrafico": 4.0,
            "narcotráfico": 4.0,
            "trafico de drogas": 4.0,
            "tráfico de drogas": 4.0,
            "contrabando": 3.5,
            "operativo": 3.0,
            "allanamiento": 3.5,
            "detenido": 3.0,
        },
        "keywords": {
            "seguridad": 2.0,
            "guardia": 2.0,
            "carcel": 3.0,
            "cárcel": 3.0,
            "penitenciaria": 3.0,
            "penitenciaría": 3.0,
        },
        "negative": {},
    },
    "Culture": {
        "strong": {
            "cine": 3.0,
            "musica": 3.0,
            "música": 3.0,
            "teatro": 3.0,
            "festival": 3.0,
            "literatura": 3.0,
            "arte": 2.5,
        },
        "keywords": {
            "museo": 2.0,
            "exposicion": 2.0,
            "exposición": 2.0,
            "concierto": 2.5,
            "tv": 1.5,
            "pelicula": 2.0,
            "película": 2.0,
        },
        "negative": {},
    },
    "Sports": {
        "strong": {
            "futbol": 4.0,
            "futebol": 4.0,
            "basquet": 3.5,
            "basket": 3.5,
            "baloncesto": 3.5,
            "tenis": 3.0,
            "rugby": 3.0,
            "golf": 3.0,
            "nba": 4.0,
            "nfl": 4.0,
            "mlb": 4.0,
            "nhl": 4.0,
            "copa libertadores": 5.0,
            "sudamericana": 4.0,
            "eliminatorias": 4.0,
            "gran premio": 3.5,
            "formula 1": 4.0,
            "motogp": 4.0,
            "penarol": 3.5,
            "peñarol": 3.5,
            "nacional": 1.0,
        },
        "keywords": {
            "partido": 1.0,
            "liga": 1.0,
            "copa": 1.0,
            "torneo": 1.0,
            "campeonato": 1.5,
            "seleccion": 2.0,
            "selecao": 2.0,
            "gol": 2.0,
            "entrenador": 2.0,
            "jugador": 2.0,
            "fixture": 2.5,
            "referee": 2.0,
            "coach": 2.0,
            "player": 2.0,
        },
        "negative": {
            "parlamento": 2.0,
            "senado": 2.0,
            "diputados": 2.0,
            "ministerio": 2.0,
            "banco central": 2.0,
            "inflacion": 2.0,
            "decreto": 2.0,
            "impuestos": 2.0,
            "fiscalia": 2.0,
            "justicia": 2.0,
        },
    },
}

SPORTS_ANCHORS = [
    "futbol",
    "futebol",
    "basquet",
    "basket",
    "baloncesto",
    "tenis",
    "rugby",
    "golf",
    "nba",
    "nfl",
    "mlb",
    "nhl",
    "formula 1",
    "motogp",
    "copa libertadores",
    "sudamericana",
    "eliminatorias",
    "gol",
    "entrenador",
    "jugador",
    "fixture",
    "penarol",
    "peñarol",
    "boca",
    "river",
    "flamengo",
    "gremio",
    "grêmio",
    "palmeiras",
]

NON_SPORTS_DOMINATORS = [
    "presidente",
    "gobierno",
    "parlamento",
    "senado",
    "diputados",
    "ministerio",
    "banco central",
    "inflacion",
    "pib",
    "deuda",
    "impuestos",
    "decreto",
    "fiscalia",
    "justicia",
]


def _topic_label(a: Dict[str, Any]) -> str:
    # ✅ Source categories first
    source_topic = _topic_from_source_categories(a)
    if source_topic:
        if _env_bool("TOPIC_DEBUG", default=False):
            a["_topic_debug"] = {
                "method": "source_category",
                "source_categories": a.get("source_categories") or [],
                "picked": source_topic,
            }
        return source_topic

    # Fallback: text-scoring
    raw = " ".join(
        [
            str(a.get("title_en") or ""),
            str(a.get("summary_en") or ""),
            str(a.get("title") or ""),
            str(a.get("snippet_text") or ""),
        ]
    )
    text = _norm_text_for_topic(raw)
    if not text:
        return GENERAL_LABEL

    scores: Dict[str, float] = {}
    debug_hits: Dict[str, List[str]] = {}

    for label, rules in CATEGORY_RULES.items():
        s, matched = _score_category(text, rules)
        scores[label] = s
        debug_hits[label] = matched

    # Sports guardrails
    if "Sports" in scores:
        sports_score = scores.get("Sports") or 0.0
        has_anchor = any(anchor in text for anchor in SPORTS_ANCHORS) or bool(_SCORE_PATTERN.search(text))
        dominators_hit = sum(1 for d in NON_SPORTS_DOMINATORS if d in text)

        if SPORTS_REQUIRE_ANCHOR and not has_anchor:
            scores["Sports"] = -999.0
        else:
            if dominators_hit >= 2 and sports_score < (SPORTS_MIN_SCORE + 3.0):
                scores["Sports"] = -999.0
            elif sports_score < SPORTS_MIN_SCORE:
                scores["Sports"] = -999.0

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_label, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else -999.0

    if _env_bool("TOPIC_DEBUG", default=False):
        a["_topic_debug"] = {
            "method": "scoring_fallback",
            "best": {"label": best_label, "score": best_score},
            "second_score": second_score,
            "scores": scores,
            "hits": debug_hits,
        }

    if best_score < MIN_SCORE:
        return GENERAL_LABEL

    if (best_score - second_score) < MIN_MARGIN and best_score < STRONG_WIN_SCORE:
        return GENERAL_LABEL

    return best_label


# ----------------------------
# Ranking v1 (kept)
# ----------------------------
def _rank_score(a: Dict[str, Any]) -> float:
    now = datetime.now(timezone.utc)

    pu = a.get("published_utc") or ""
    if pu:
        try:
            dt = datetime.fromisoformat(pu)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_hours = max(0.0, (now - dt.astimezone(timezone.utc)).total_seconds() / 3600.0)
        except Exception:
            age_hours = 6.0
    else:
        age_hours = 6.0

    recency = math.exp(-age_hours / 10.0)

    dup = int(a.get("duplicates_count") or 1)
    dup_boost = math.log1p(max(1, dup))

    snip_len = len((a.get("snippet_text") or "").strip())
    snip = min(1.0, snip_len / 220.0)

    has_cached = 1.0 if a.get("has_cached_summary") else 0.0

    is_mercopress = (a.get("country_key") or "").lower() == "mp"
    mp_boost = 0.6 if is_mercopress else 0.0

    return float(recency * 5.0 + dup_boost * 0.8 + snip * 0.8 + has_cached * 0.5 + mp_boost)


# ----------------------------
# OpenAI client
# ----------------------------
def _get_openai_client():
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not set in backend environment (.env).")

    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI package not installed in backend venv: {e}")

    return OpenAI(api_key=api_key)


# ----------------------------
# API Models
# ----------------------------
class EnrichItem(BaseModel):
    title: str
    link: str
    source: str
    snippet: str = ""


class EnrichRequest(BaseModel):
    items: List[EnrichItem] = Field(default_factory=list)


# ----------------------------
# Routes
# ----------------------------
@app.get("/")
def read_root():
    return {"message": "News Aggregator API is running"}


# ✅ NEW: health endpoint (hosting + uptime checks)
@app.get("/healthz")
def healthz():
    try:
        # quick DB open to prove disk+sqlite are healthy
        with _db() as conn:
            conn.execute("SELECT 1").fetchone()
        db_ok = True
    except Exception:
        db_ok = False

    return {
        "ok": True,
        "service": "news-aggregator-backend",
        "utc": _now_utc_iso(),
        "db_ok": db_ok,
    }


@app.get("/countries")
def get_countries():
    meta = {
        "all": {"code": "ALL", "name": "All Mercosur", "flag_url": ""},
        "mp": {"code": "MP", "name": "MercoPress", "flag_url": ""},
        "uy": {"code": "UY", "name": "Uruguay", "flag_url": "https://flagcdn.com/w40/uy.png"},
        "ar": {"code": "AR", "name": "Argentina", "flag_url": "https://flagcdn.com/w40/ar.png"},
        "br": {"code": "BR", "name": "Brazil", "flag_url": "https://flagcdn.com/w40/br.png"},
        "py": {"code": "PY", "name": "Paraguay", "flag_url": "https://flagcdn.com/w40/py.png"},
        "bo": {"code": "BO", "name": "Bolivia", "flag_url": "https://flagcdn.com/w40/bo.png"},
    }

    counts: Dict[str, int] = {k: 0 for k in meta.keys()}
    for s in SOURCES:
        ck = (s.get("country_key") or "").lower()
        if ck in counts:
            counts[ck] += 1

    counts["all"] = len(SOURCES)

    countries = []
    for key in ["all", "mp", "uy", "ar", "br", "py", "bo"]:
        countries.append(
            {
                "key": key,
                "code": meta[key]["code"],
                "name": meta[key]["name"],
                "flag_url": meta[key]["flag_url"],
                "source_count": counts.get(key, 0),
            }
        )

    return {"countries": countries}


@app.get("/debug-sources")
def debug_sources():
    out = []
    for s in SOURCES:
        try:
            feed = _fetch_feed(s["feed_url"])
            entries_found = len(feed.entries or [])
            bozo = bool(getattr(feed, "bozo", False))
            bozo_exc = getattr(feed, "bozo_exception", None)
            out.append(
                {
                    "source": s["name"],
                    "source_id": s.get("id"),
                    "feed": s["feed_url"],
                    "entries_found": entries_found,
                    "ok": True,
                    "error": str(bozo_exc) if bozo_exc else None,
                    "status": 200,
                    "bozo": bozo,
                    "country_key": s.get("country_key"),
                    "country_code": s.get("country_code"),
                }
            )
        except Exception as e:
            out.append(
                {
                    "source": s["name"],
                    "source_id": s.get("id"),
                    "feed": s["feed_url"],
                    "entries_found": 0,
                    "ok": False,
                    "error": str(e),
                    "status": None,
                    "bozo": True,
                    "country_key": s.get("country_key"),
                    "country_code": s.get("country_code"),
                }
            )
    return out


# ✅ Backwards compatible: keep /uy-news working exactly like before
@app.get("/uy-news")
def get_uruguay_news(range: str = "24h", q: str = "", limit: int = 50):
    return get_news(country="uy", range=range, q=q, limit=limit)


def _collect_items(country: str, range: str, q: str, scan_cap: int = 999999) -> List[Dict[str, Any]]:
    c = (country or "uy").strip().lower()
    since = _range_to_since(range)

    if c not in {"uy", "ar", "br", "py", "bo", "all", "mp"}:
        raise HTTPException(status_code=400, detail="Invalid country. Use uy|ar|br|py|bo|mp|all")

    items: List[Dict[str, Any]] = []

    for source in SOURCES:
        ck = (source.get("country_key") or "").lower()

        if c == "all":
            if ck not in {"uy", "ar", "br", "py", "bo", "mp"}:
                continue
        else:
            if ck != c:
                continue

        try:
            feed = _fetch_feed(source["feed_url"])
        except Exception:
            continue

        for entry in (feed.entries or []):
            article = _build_article(source, entry)
            if not article:
                continue

            pub_utc = article.get("published_utc")
            if pub_utc:
                try:
                    pub_dt = datetime.fromisoformat(pub_utc)
                    if pub_dt.tzinfo is None:
                        pub_dt = pub_dt.replace(tzinfo=timezone.utc)
                    if pub_dt < since:
                        continue
                except Exception:
                    pass

            if not _matches_q(article, q):
                continue

            items.append(article)
            if len(items) >= scan_cap:
                return items

    return items


@app.get("/news")
def get_news(country: str = "uy", range: str = "24h", q: str = "", limit: int = 50):
    c = (country or "uy").strip().lower()

    try:
        lim = int(limit)
    except Exception:
        lim = 50
    lim = max(1, min(lim, 200))

    cache_key = f"country={c}|range={range}|q={q}|limit={lim}"
    cached = _news_cache_get(cache_key)
    if cached:
        payload, age_s = cached
        payload["cache_hit"] = True
        payload["cache_age_s"] = age_s
        payload["cache_ttl_s"] = _news_ttl_s()
        return payload

    scan_cap = min(2000, max(200, lim * 10))
    items = _collect_items(country=c, range=range, q=q, scan_cap=scan_cap)
    items = _dedupe(items)

    for a in items:
        a["cluster_id"] = _sig(a)
        a["topic"] = _topic_label(a)
        a["rank_score"] = _rank_score(a)

    items.sort(
        key=lambda a: (float(a.get("rank_score") or 0.0), a.get("published_utc") or ""),
        reverse=True,
    )

    items = items[:lim]
    resp = {"country": c, "range": range, "q": q, "limit": lim, "count": len(items), "articles": items}
    _news_cache_set(cache_key, resp)

    resp["cache_hit"] = False
    resp["cache_age_s"] = 0
    resp["cache_ttl_s"] = _news_ttl_s()
    return resp


@app.get("/clusters")
def get_clusters(country: str = "uy", range: str = "24h", q: str = "", limit: int = 50):
    c = (country or "uy").strip().lower()

    try:
        lim = int(limit)
    except Exception:
        lim = 50
    lim = max(1, min(lim, 200))

    scan_cap = min(3000, max(300, lim * 12))
    raw = _collect_items(country=c, range=range, q=q, scan_cap=scan_cap)

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for a in raw:
        cid = _sig(a)
        groups.setdefault(cid, []).append(a)

    clusters: List[Dict[str, Any]] = []
    for cid, items in groups.items():
        for it in items:
            it["topic"] = _topic_label(it)
            it["rank_score"] = _rank_score(it)

        best = items[0]
        for it in items[1:]:
            if _quality_score(it) > _quality_score(best):
                best = it
            elif _quality_score(it) == _quality_score(best):
                if float(it.get("rank_score") or 0.0) > float(best.get("rank_score") or 0.0):
                    best = it

        seen_sources: Dict[str, Dict[str, Any]] = {}
        for it in items:
            sname = (it.get("source") or "").strip() or "Unknown"
            if sname not in seen_sources:
                seen_sources[sname] = {
                    "source": sname,
                    "link": it.get("link") or "",
                    "published_utc": it.get("published_utc") or "",
                }

        sources_list = list(seen_sources.values())
        cluster_topic = best.get("topic") or GENERAL_LABEL

        best_out = dict(best)
        best_out["cluster_id"] = cid

        clusters.append(
            {
                "cluster_id": cid,
                "topic": cluster_topic,
                "duplicates_count": len(items),
                "sources_count": len(sources_list),
                "sources": sources_list,
                "best_item": best_out,
            }
        )

    clusters.sort(
        key=lambda cobj: (
            float(((cobj.get("best_item") or {}).get("rank_score") or 0.0)),
            ((cobj.get("best_item") or {}).get("published_utc") or ""),
        ),
        reverse=True,
    )

    clusters = clusters[:lim]
    return {"country": c, "range": range, "q": q, "limit": lim, "count": len(clusters), "clusters": clusters}


@app.post("/enrich")
def enrich_items(req: EnrichRequest, request: Request):
    # ✅ NEW: rate limit guard (protects OpenAI cost)
    _rate_limit_check(request)

    if not req.items:
        return {"items": []}

    cached_out = []
    to_do: List[EnrichItem] = []

    for it in req.items:
        cached = _get_cached_enrich(it.link)
        if cached and cached.get("summary_en"):
            cached_out.append(
                {
                    "link": it.link,
                    "title_en": cached.get("title_en") or "",
                    "summary_en": cached.get("summary_en") or "",
                    "cached": True,
                }
            )
        else:
            to_do.append(it)

    if not to_do:
        return {"items": cached_out}

    client = _get_openai_client()
    model = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()

    payload = []
    for it in to_do:
        payload.append(
            {
                "link": (it.link or "").strip(),
                "source": (it.source or "").strip(),
                "title": (it.title or "").strip(),
                "snippet": _clean_text_any((it.snippet or "").strip(), max_chars=700),
            }
        )

    system = (
        "You translate Spanish/Portuguese news headlines into English and write a short English summary.\n"
        "Return STRICT JSON only.\n"
        "Output shape:\n"
        '{ "items": [ {"link": "...", "title_en": "...", "summary_en": "..."}, ... ] }\n'
        "Rules:\n"
        "- title_en: natural English headline.\n"
        "- summary_en: 1–2 sentences, neutral, based ONLY on provided title + snippet.\n"
        "- If snippet is empty/uninformative: say so briefly.\n"
        "- No HTML, no markdown, no backticks.\n"
    )

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps({"items": payload})},
            ],
            response_format={"type": "json_object"},
        )
        content = (resp.choices[0].message.content or "").strip()
        data = json.loads(content)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Enrichment failed: {e}")

    out_items = []
    for obj in (data.get("items") or []):
        link = (obj.get("link") or "").strip()
        title_en = (obj.get("title_en") or "").strip()
        summary_en = (obj.get("summary_en") or "").strip()
        if not link:
            continue

        if title_en and summary_en:
            _set_cached_enrich(link, title_en, summary_en)

        out_items.append({"link": link, "title_en": title_en, "summary_en": summary_en, "cached": False})

    return {"items": cached_out + out_items}


# ----------------------------
# Background Pre-Enrichment Worker (kept, but now uses FRESH fetch)
# ----------------------------
_worker_lock = threading.Lock()
_worker_running = False
_worker_last_run_utc: Optional[str] = None
_worker_last_ok_utc: Optional[str] = None
_worker_last_error: Optional[str] = None
_worker_last_stats: Optional[Dict[str, Any]] = None
_worker_thread: Optional[threading.Thread] = None


def _env_list(key: str, default_csv: str) -> List[str]:
    v = (os.getenv(key) or "").strip()
    if not v:
        v = default_csv
    parts = [p.strip().lower() for p in v.split(",") if p.strip()]
    return parts


def _enrich_internal(items: List[Dict[str, str]]) -> int:
    if not items:
        return 0

    todo = []
    for it in items:
        link = (it.get("link") or "").strip()
        if not link:
            continue
        cached = _get_cached_enrich(link)
        if cached and cached.get("summary_en"):
            continue
        todo.append(it)

    if not todo:
        return 0

    client = _get_openai_client()
    model = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()

    system = (
        "You translate Spanish/Portuguese news headlines into English and write a short English summary.\n"
        "Return STRICT JSON only.\n"
        "Output shape:\n"
        '{ "items": [ {"link": "...", "title_en": "...", "summary_en": "..."}, ... ] }\n'
        "Rules:\n"
        "- title_en: natural English headline.\n"
        "- summary_en: 1–2 sentences, neutral, based ONLY on provided title + snippet.\n"
        "- If snippet is empty/uninformative: say so briefly.\n"
        "- No HTML, no markdown, no backticks.\n"
    )

    payload = []
    for it in todo:
        payload.append(
            {
                "link": (it.get("link") or "").strip(),
                "source": (it.get("source") or "").strip(),
                "title": (it.get("title") or "").strip(),
                "snippet": _clean_text_any((it.get("snippet") or "").strip(), max_chars=700),
            }
        )

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps({"items": payload})},
            ],
            response_format={"type": "json_object"},
        )
        content = (resp.choices[0].message.content or "").strip()
        data = json.loads(content)
    except Exception:
        return 0

    enriched = 0
    for obj in (data.get("items") or []):
        link = (obj.get("link") or "").strip()
        title_en = (obj.get("title_en") or "").strip()
        summary_en = (obj.get("summary_en") or "").strip()
        if link and title_en and summary_en:
            _set_cached_enrich(link, title_en, summary_en)
            enriched += 1

    return enriched


def _worker_loop() -> None:
    global _worker_running, _worker_last_run_utc, _worker_last_ok_utc, _worker_last_error, _worker_last_stats

    enabled = _env_bool("PRE_ENRICH_ENABLED", default=False)
    interval_s = _env_int("PRE_ENRICH_INTERVAL_S", _env_int("PRE_ENRICH_INTERVAL_SECONDS", 180))
    startup_delay_s = _env_int("PRE_ENRICH_STARTUP_DELAY_S", _env_int("PRE_ENRICH_STARTUP_DELAY_SECONDS", 3))

    ranges = _env_list("PRE_ENRICH_RANGES", "24h")
    if not ranges:
        ranges = ["24h"]

    countries = _env_list("PRE_ENRICH_COUNTRIES", "uy,ar,br,py,bo,mp,all")
    if not countries:
        countries = ["uy", "ar", "br", "py", "bo", "mp", "all"]

    scan_limit = _env_int("PRE_ENRICH_SCAN_LIMIT", _env_int("PRE_ENRICH_MAX_ITEMS_PER_RUN", 60))
    max_new_per_bucket = _env_int("PRE_ENRICH_MAX_NEW_PER_BUCKET", 15)
    max_new_total = _env_int("PRE_ENRICH_MAX_NEW_TOTAL", _env_int("PRE_ENRICH_MAX_ITEMS_PER_RUN", 40))
    batch_size = _env_int("PRE_ENRICH_BATCH_SIZE", 10)

    if startup_delay_s > 0:
        time.sleep(startup_delay_s)

    while True:
        enabled = _env_bool("PRE_ENRICH_ENABLED", default=False)
        interval_s = _env_int("PRE_ENRICH_INTERVAL_S", _env_int("PRE_ENRICH_INTERVAL_SECONDS", interval_s))

        if not enabled:
            time.sleep(max(3, interval_s))
            continue

        with _worker_lock:
            _worker_running = True
            _worker_last_run_utc = _now_utc_iso()
            _worker_last_error = None

        stats: Dict[str, Any] = {
            "enabled": enabled,
            "interval_s": interval_s,
            "startup_delay_s": startup_delay_s,
            "ranges": ranges,
            "countries": countries,
            "scan_limit": scan_limit,
            "max_new_per_bucket": max_new_per_bucket,
            "max_new_total": max_new_total,
            "batch_size": batch_size,
            "enriched_count": 0,
            "buckets": {},
        }

        try:
            total_enriched = 0
            total_queued = 0

            for c in countries:
                for r in ranges:
                    bucket_key = f"{c}:{r}"
                    bucket_scanned = 0
                    bucket_cached = 0
                    bucket_queued = 0
                    bucket_enriched = 0

                    scan_cap = max(150, int(scan_limit) * 8)
                    items = _collect_items(country=c, range=r, q="", scan_cap=scan_cap)
                    items = _dedupe(items)

                    for a in items:
                        a["rank_score"] = _rank_score(a)

                    items.sort(
                        key=lambda a: (float(a.get("rank_score") or 0.0), a.get("published_utc") or ""),
                        reverse=True,
                    )

                    top = items[: int(scan_limit)]
                    bucket_scanned = len(top)

                    candidates: List[Dict[str, str]] = []
                    for a in top:
                        if a.get("summary_en") and (a.get("summary_en") or "").strip():
                            bucket_cached += 1
                            continue
                        candidates.append(
                            {
                                "title": a.get("title") or "",
                                "link": a.get("link") or "",
                                "source": a.get("source") or "",
                                "snippet": a.get("snippet_text") or "",
                            }
                        )

                    if candidates:
                        remaining = max(0, max_new_total - total_queued)
                        take = min(max_new_per_bucket, remaining)
                        candidates = candidates[:take]
                    else:
                        candidates = []

                    bucket_queued = len(candidates)
                    total_queued += bucket_queued

                    if candidates:
                        for i in range(0, len(candidates), max(1, batch_size)):
                            chunk = candidates[i : i + max(1, batch_size)]
                            ecount = _enrich_internal(chunk)
                            bucket_enriched += ecount
                            total_enriched += ecount
                            if total_queued >= max_new_total:
                                break

                    stats["buckets"][bucket_key] = {
                        "scanned": bucket_scanned,
                        "already_cached": bucket_cached,
                        "queued": bucket_queued,
                        "enriched": bucket_enriched,
                    }
                    stats["enriched_count"] = total_enriched

                    if total_queued >= max_new_total:
                        break
                if total_queued >= max_new_total:
                    break

            with _worker_lock:
                _worker_last_ok_utc = _now_utc_iso()
                _worker_last_stats = stats

        except Exception as e:
            with _worker_lock:
                _worker_last_error = str(e)
                _worker_last_stats = stats

        finally:
            with _worker_lock:
                _worker_running = False

        time.sleep(max(3, interval_s))


@app.get("/worker-status")
def worker_status():
    global _worker_thread
    with _worker_lock:
        return {
            "enabled": _env_bool("PRE_ENRICH_ENABLED", default=False),
            "running": _worker_running,
            "thread_alive": bool(_worker_thread and _worker_thread.is_alive()),
            "last_run_utc": _worker_last_run_utc,
            "last_ok_utc": _worker_last_ok_utc,
            "last_error": _worker_last_error,
            "last_stats": _worker_last_stats,
        }


@app.on_event("startup")
def _start_worker():
    global _worker_thread
    if _worker_thread and _worker_thread.is_alive():
        return
    t = threading.Thread(target=_worker_loop, daemon=True, name="pre_enrich_worker")
    _worker_thread = t
    t.start()