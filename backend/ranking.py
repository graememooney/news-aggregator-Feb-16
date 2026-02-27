# ranking.py
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple


@dataclass(frozen=True)
class RankingConfig:
    # Recency decay constant (in hours). Smaller => stronger preference for very recent.
    recency_halflife_hours: float = 18.0

    # Weighting: keep recency dominant, consensus second, then gentle nudges.
    w_recency: float = 1.00
    w_consensus: float = 0.35
    w_source: float = 0.10
    w_enriched: float = 0.05

    # Enrichment bump (tiny)
    enriched_bonus: float = 0.10

    # Source weights: light preference. 1.0 = neutral.
    # You can tune these over time without changing logic.
    source_weights: Optional[Dict[str, float]] = None


DEFAULT_SOURCE_WEIGHTS: Dict[str, float] = {
    # Keep neutral by default; tune later once you’re confident.
    # Examples (ONLY if you decide to use them):
    # "MercoPress": 1.10,
    # "El Observador": 1.05,
}
DEFAULT_CONFIG = RankingConfig(source_weights=DEFAULT_SOURCE_WEIGHTS)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime_any(value: Any) -> Optional[datetime]:
    """
    Accepts ISO 8601 strings, RFC822 strings, or datetime.
    Returns timezone-aware UTC datetime or None.
    """
    if value is None:
        return None

    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        # treat as unix timestamp seconds
        try:
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
        except Exception:
            return None
    elif isinstance(value, str):
        s = value.strip()
        if not s:
            return None

        # Try ISO 8601 first
        try:
            # Handle trailing Z
            if s.endswith("Z"):
                s2 = s[:-1] + "+00:00"
                dt = datetime.fromisoformat(s2)
            else:
                dt = datetime.fromisoformat(s)
        except Exception:
            # Try RFC822 / RSS date formats
            try:
                dt = parsedate_to_datetime(s)
            except Exception:
                return None
    else:
        return None

    # Normalize to UTC aware
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _get_first(d: Dict[str, Any], keys: Iterable[str]) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def compute_article_score(
    item: Dict[str, Any],
    *,
    now_utc: Optional[datetime] = None,
    config: RankingConfig = DEFAULT_CONFIG,
) -> float:
    """
    Expects a deduped 'best item' shape OR a cluster-like shape containing:
    - published / published_utc / published_at (string/datetime)
    - duplicates_count (int) OR sources_count (int) OR sources (list)
    - source (string)
    - title_en/summary_en optional
    """
    now = now_utc or _now_utc()

    published_val = _get_first(item, ["published_utc", "published", "published_at", "date"])
    dt = _parse_datetime_any(published_val)

    if dt is None:
        age_hours = 10_000.0  # treat unknown as very old
    else:
        age_s = max(0.0, (now - dt).total_seconds())
        age_hours = age_s / 3600.0

    # Smooth exponential decay. Using halflife-like constant (not exact half-life math, but intuitive).
    H = max(1.0, float(config.recency_halflife_hours))
    recency = math.exp(-age_hours / H)

    # Consensus: prefer duplicates_count if present; otherwise infer.
    dup = item.get("duplicates_count")
    if isinstance(dup, int):
        d = max(1, dup)
    else:
        sources_count = item.get("sources_count")
        if isinstance(sources_count, int):
            d = max(1, sources_count)
        else:
            sources = item.get("sources")
            d = max(1, len(sources) if isinstance(sources, list) else 1)

    consensus = math.log1p(d)  # diminishing returns

    source = item.get("source") or ""
    sw = 1.0
    if config.source_weights:
        sw = float(config.source_weights.get(str(source), 1.0))
    source_boost = sw - 1.0  # neutral = 0

    enriched = bool(item.get("title_en") or item.get("summary_en"))
    enriched_bonus = config.enriched_bonus if enriched else 0.0

    score = (
        config.w_recency * recency
        + config.w_consensus * consensus
        + config.w_source * source_boost
        + config.w_enriched * enriched_bonus
    )

    # Keep stable numeric type
    return float(score)


def rank_articles(
    items: List[Dict[str, Any]],
    *,
    now_utc: Optional[datetime] = None,
    config: RankingConfig = DEFAULT_CONFIG,
    attach_score: bool = False,
) -> List[Dict[str, Any]]:
    """
    Returns a NEW list sorted by score desc, then published desc as tie-breaker.
    If attach_score is True, mutates each dict by adding 'score' (float).
    """
    now = now_utc or _now_utc()

    scored: List[Tuple[float, float, Dict[str, Any]]] = []
    for it in items:
        s = compute_article_score(it, now_utc=now, config=config)

        published_val = _get_first(it, ["published_utc", "published", "published_at", "date"])
        dt = _parse_datetime_any(published_val)
        published_ts = dt.timestamp() if dt else 0.0

        if attach_score:
            it["score"] = s

        scored.append((s, published_ts, it))

    # Sort: score desc, published desc
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [t[2] for t in scored]