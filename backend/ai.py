# app/ai.py
from typing import Tuple, Optional
from config import settings

# Model routing for Venice AI — deterministic, no fallback chain
# Romance + Germanic + West/South Slavic → Mistral (cheaper, stronger on these)
# Everything else → DeepSeek V4 Flash (reasoning model for complex languages)
MISTRAL_LANGS = {"es", "pt", "fr", "it", "de", "nl", "hr", "pl", "ro"}
DEEPSEEK_LANGS = {"el", "tr", "mt", "ar", "zh", "ja", "ko", "ru", "hi"}

_MISTRAL_MODEL = "mistral-small-3-2-24b-instruct"
_DEEPSEEK_MODEL = "deepseek-v4-flash"


def _get_venice_model(lang_code: str) -> str:
    lc = (lang_code or "").lower().strip()
    if lc in MISTRAL_LANGS:
        return _MISTRAL_MODEL
    return _DEEPSEEK_MODEL


try:
    from openai import OpenAI
except Exception:
    OpenAI = None  # type: ignore


def _openai_client():
    """Legacy OpenAI client (used when Venice is disabled)."""
    if OpenAI is None:
        raise RuntimeError("openai package not installed. Add it to requirements.")
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    return OpenAI(api_key=settings.openai_api_key)


def _venice_client():
    """Venice client — OpenAI-compatible SDK with x-api-key header for inference keys."""
    if OpenAI is None:
        raise RuntimeError("openai package not installed. Add it to requirements.")
    if not settings.venice_api_key:
        raise RuntimeError("VENICE_API_KEY is not set.")
    # Venice inference keys use x-api-key header, not Authorization Bearer
    from openai._base_client import SyncHttpxClientWrapper
    return OpenAI(
        base_url=settings.venice_base_url,
        api_key="venice-inference",  # dummy, real key via custom header
        default_headers={"x-api-key": settings.venice_api_key},
    )


def _client():
    """Returns the active client: Venice if enabled, else OpenAI."""
    if settings.use_venice:
        return _venice_client()
    return _openai_client()


def _model_for_call(preferred_model: Optional[str] = None) -> str:
    """Returns the model to use for this API call."""
    if preferred_model:
        return preferred_model
    if settings.use_venice:
        return settings.default_venice_model
    return settings.openai_model


VALID_CATEGORIES = [
    "Politics", "Economy", "Business", "Markets", "World",
    "Society", "Education", "Health", "Science", "Technology",
    "Energy", "Environment", "Security", "Culture", "Sports",
]

_VALID_CATEGORIES_SET = {c.lower() for c in VALID_CATEGORIES}


def translate_and_summarize(
    title: str,
    snippet: str,
    source_lang_hint: str = "",
    model: Optional[str] = None,
) -> Tuple[str, str, str]:
    """
    Input: title + snippet only (RSS metadata).
    Output: (title_en, summary_en, category).
    category is one of VALID_CATEGORIES or "General".

    model override: if provided, uses that specific model. Otherwise routes
    by language (Venice) or uses the default model (OpenAI legacy mode).
    """
    text = f"TITLE:\n{title}\n\nSNIPPET:\n{snippet or ''}".strip()

    categories_str = ", ".join(VALID_CATEGORIES)
    sys = (
        "You are a news assistant. Translate the title into English, write a short English summary, "
        "and classify the article into exactly one category.\n"
        "Rules:\n"
        "- Use ONLY the provided TITLE and SNIPPET.\n"
        "- Do NOT invent facts.\n"
        "- Keep the summary 1–2 sentences.\n"
        f"- category must be exactly one of: {categories_str}\n"
        "- Choose the category based on the actual content, NOT the source's own category label.\n"
        "- Return strict JSON: {\"title_en\": \"...\", \"summary_en\": \"...\", \"category\": \"...\"}\n"
    )
    if source_lang_hint:
        sys += f"\nLanguage hint: {source_lang_hint}\n"

    # Determine model: explicit override > language-based routing > default
    if model:
        chosen_model = model
    elif settings.use_venice:
        chosen_model = _get_venice_model(source_lang_hint)
    else:
        chosen_model = settings.openai_model

    client = _client()
    resp = client.chat.completions.create(
        model=chosen_model,
        messages=[
            {"role": "system", "content": sys},
            {"role": "user", "content": text},
        ],
        temperature=0.2,
    )

    content = resp.choices[0].message.content or ""
    import json

    try:
        data = json.loads(content)
        title_en = (data.get("title_en") or "").strip()
        summary_en = (data.get("summary_en") or "").strip()
        category = (data.get("category") or "").strip()
    except Exception:
        title_en = title.strip()
        summary_en = (snippet or "").strip()[:280]
        category = ""

    if not title_en:
        title_en = title.strip()
    if not summary_en:
        summary_en = (snippet or "").strip()

    # Validate category
    if category.lower() not in _VALID_CATEGORIES_SET:
        category = "General"

    return title_en, summary_en, category
