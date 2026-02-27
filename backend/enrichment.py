# app/enrichment.py
from typing import Dict, Any, Optional, Tuple
from .config import settings
from .db import get_cache_row, is_cache_fresh, upsert_cache
from .ai import translate_and_summarize


def get_cached_enrichment(link: str) -> Tuple[Optional[str], Optional[str], bool]:
    row = get_cache_row(link)
    if not row:
        return None, None, False

    fresh = is_cache_fresh(row.get("created_utc", ""), settings.cache_ttl_seconds)
    return row.get("title_en"), row.get("summary_en"), fresh


def enrich_if_needed(article: Dict[str, Any], force: bool = False) -> Dict[str, Any]:
    """
    article must contain at least: link, title, snippet (optional).
    Writes to cache when enrichment is performed.
    Returns the article with title_en + summary_en filled when possible.
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

    # If we have cached values but stale, we can serve them immediately in /news
    # and refresh via worker / /enrich. This function does the actual refresh.
    title = (article.get("title") or "").strip()
    snippet = (article.get("snippet") or "").strip()
    lang_hint = (article.get("lang") or "").strip()

    title_en, summary_en = translate_and_summarize(title=title, snippet=snippet, source_lang_hint=lang_hint)
    upsert_cache(link=link, title_en=title_en, summary_en=summary_en)

    article["title_en"] = title_en
    article["summary_en"] = summary_en
    article["cache_fresh"] = True
    return article