# app/lang_mapping.py
"""
Maps subdivision/country keys to ISO 639-1 language codes for translation model routing.
"""

SUBDIVISION_TO_LANG: dict[str, str] = {
    # South America
    "uy": "es",   # Uruguay - Spanish
    "ar": "es",   # Argentina - Spanish
    "br": "pt",   # Brazil - Portuguese
    "py": "es",   # Paraguay - Spanish
    "bo": "es",   # Bolivia - Spanish
    "cl": "es",   # Chile - Spanish
    "co": "es",   # Colombia - Spanish
    "pe": "es",   # Peru - Spanish
    "ec": "es",   # Ecuador - Spanish
    "ve": "es",   # Venezuela - Spanish
    # Mexico
    "mx": "es",   # Mexico - Spanish
    # Central America  
    "gt": "es",   # Guatemala - Spanish
    "sv": "es",   # El Salvador - Spanish
    "hn": "es",   # Honduras - Spanish
    "ni": "es",   # Nicaragua - Spanish
    "cr": "es",   # Costa Rica - Spanish
    "pa": "es",   # Panama - Spanish
    # Europe
    "es": "es",   # Spain - Spanish
    "fr": "fr",   # France - French
    "it": "it",   # Italy - Italian
    "gr": "el",   # Greece - Greek
    "pt": "pt",   # Portugal - Portuguese
    "cy": "el",   # Cyprus - Greek
    "hr": "hr",   # Croatia - Croatian
    "tr": "tr",   # Turkey - Turkish
    "mt": "mt",   # Malta - Maltese
}

# Subdivision keys that default to a language (used when no explicit lang on source)
def get_lang_for_subdivision(subdivision_key: str) -> str:
    """Return ISO 639-1 language code for a subdivision key, or 'es' as default."""
    return SUBDIVISION_TO_LANG.get((subdivision_key or "").lower().strip(), "es")

# Model routing per the Venice migration spec
MISTRAL_LANGUAGES = {"es", "pt", "fr", "it", "de", "nl", "hr", "pl", "ro"}
DEEPSEEK_LANGUAGES = {"el", "tr", "mt", "ar", "zh", "ja", "ko", "ru", "hi"}

def get_model_for_lang(lang_code: str) -> str:
    """Route language to Venice model."""
    lc = (lang_code or "").lower().strip()
    if lc in MISTRAL_LANGUAGES:
        return "mistral-small-3-2-24b-instruct"
    return "deepseek-v4-flash"
