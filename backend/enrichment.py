# app/enrichment.py
from typing import Dict, Any, Optional, Tuple

from .config import settings
from .db import (
    get_cache_row,
    is_cache_fresh,
    upsert_cache,
    get_cluster_cache_row,
    upsert_cluster_cache,
)
from .ai import translate_and_summarize


# ----------------------------
# Link-based enrichment (existing, kept)
# ----------------------------
def get_cached_enrichment(link: str) -> Tuple[Optional[str], Optional[str], bool]:
    row = get_cache_row(link)
    if not row:
        return None, None, False

    fresh = is_cache_fresh(row.get("created_utc", ""), settings.cache_ttl_seconds)
    return row.get("title_en"), row.get("summary_en"), fresh


def enrich_if_needed(article: Dict[str, Any], force: bool = False) -> Dict[str, Any]:
    """
    Link-based enrichment cache (legacy / still used by /enrich).
    article must contain at least: link, title, snippet (optional).
    Writes to cache when enrichment is performed.
    """
    link = (article.get("link") or "").strip()
    if not link:
        return article

    cached_title_en, cached_summary_en, fresh = get_cached_enrichment(link)

    if cached_title_en and cached_summary_en and fresh and not force:
        article["title_en"] = cached_title_en
        article["summary_en"] = cached_summary_en
        article["cache_fresh"] = True
        return article

    title = (article.get("title") or "").strip()
    snippet = (article.get("snippet") or "").strip()
    lang_hint = (article.get("lang") or "").strip()

    title_en, summary_en = translate_and_summarize(title=title, snippet=snippet, source_lang_hint=lang_hint)
    upsert_cache(link=link, title_en=title_en, summary_en=summary_en)

    article["title_en"] = title_en
    article["summary_en"] = summary_en
    article["cache_fresh"] = True
    return article


# ----------------------------
# NEW: Cluster-based enrichment (preferred for clustered feeds)
# ----------------------------
def get_cached_cluster_enrichment(cluster_id: str) -> Tuple[Optional[str], Optional[str], bool]:
    row = get_cluster_cache_row(cluster_id)
    if not row:
        return None, None, False

    fresh = is_cache_fresh(row.get("created_utc", ""), settings.cache_ttl_seconds)
    return row.get("title_en"), row.get("summary_en"), fresh


def enrich_cluster_if_needed(
    cluster_id: str,
    representative: Dict[str, Any],
    force: bool = False,
) -> Dict[str, Any]:
    """
    Cluster-based enrichment.
    - cluster_id: stable id for the story cluster
    - representative: typically the best_item with fields: title, snippet (or snippet_text), lang(optional)

    Returns a dict with: title_en, summary_en, cache_fresh
    """
    cid = (cluster_id or "").strip()
    if not cid:
        return {"title_en": None, "summary_en": None, "cache_fresh": False}

    cached_title_en, cached_summary_en, fresh = get_cached_cluster_enrichment(cid)
    if cached_title_en and cached_summary_en and fresh and not force:
        return {"title_en": cached_title_en, "summary_en": cached_summary_en, "cache_fresh": True}

    title = (representative.get("title") or "").strip()
    # accept either key (your code uses snippet_text in some places)
    snippet = (representative.get("snippet") or representative.get("snippet_text") or "").strip()
    lang_hint = (representative.get("lang") or "").strip()

    title_en, summary_en = translate_and_summarize(title=title, snippet=snippet, source_lang_hint=lang_hint)
    upsert_cluster_cache(cluster_id=cid, title_en=title_en, summary_en=summary_en)

    return {"title_en": title_en, "summary_en": summary_en, "cache_fresh": True}