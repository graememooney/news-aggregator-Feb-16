# app/ai.py
from typing import Tuple
from .config import settings

# If you already have a client elsewhere, keep that and remove this.
try:
    from openai import OpenAI
except Exception:
    OpenAI = None  # type: ignore


def _client():
    if OpenAI is None:
        raise RuntimeError("openai package not installed. Add it to requirements.")
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    return OpenAI(api_key=settings.openai_api_key)


def translate_and_summarize(title: str, snippet: str, source_lang_hint: str = "") -> Tuple[str, str]:
    """
    Input: title + snippet only (RSS metadata). Output: (title_en, summary_en).
    """
    text = f"TITLE:\n{title}\n\nSNIPPET:\n{snippet or ''}".strip()

    sys = (
        "You are a news assistant. Translate the title into English and write a short English summary.\n"
        "Rules:\n"
        "- Use ONLY the provided TITLE and SNIPPET.\n"
        "- Do NOT invent facts.\n"
        "- Keep the summary 1–2 sentences.\n"
        "- Return strict JSON: {\"title_en\": \"...\", \"summary_en\": \"...\"}\n"
    )
    if source_lang_hint:
        sys += f"\nLanguage hint: {source_lang_hint}\n"

    client = _client()
    resp = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": sys},
            {"role": "user", "content": text},
        ],
        temperature=0.2,
    )

    content = resp.choices[0].message.content or ""
    # Simple JSON extraction without extra deps:
    import json

    try:
        data = json.loads(content)
        title_en = (data.get("title_en") or "").strip()
        summary_en = (data.get("summary_en") or "").strip()
    except Exception:
        # Fallback: if model returns non-JSON, do minimal safe behavior
        title_en = title.strip()
        summary_en = (snippet or "").strip()[:280]

    if not title_en:
        title_en = title.strip()
    if not summary_en:
        summary_en = (snippet or "").strip()

    return title_en, summary_en