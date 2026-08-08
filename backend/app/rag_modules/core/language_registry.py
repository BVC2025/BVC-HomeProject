"""Single source of truth for which languages this RAG/LLM platform
supports — TTS voice availability, the /speech/speak request contract, and
WhatsApp button-title parsing all derive from this one module. Adding a
future language is one entry in each dict below; nothing else needs a new
hardcoded list."""

from typing import Optional, Tuple

SUPPORTED_LANGUAGES: Tuple[str, ...] = ("en", "ta", "hi", "ml")

LANGUAGE_DISPLAY_NAMES = {
    "en": "English",
    "ta": "Tamil",
    "hi": "Hindi",
    "ml": "Malayalam",
}

LANGUAGE_PATTERN = "^(" + "|".join(SUPPORTED_LANGUAGES) + ")$"


def is_supported_language(code: Optional[str]) -> bool:
    return bool(code) and code in SUPPORTED_LANGUAGES


def language_display_name(code: Optional[str]) -> Optional[str]:
    """Human-readable name for a language code, falling back to the raw
    code itself if it's not in the display-name map (e.g. a code was added
    to SUPPORTED_LANGUAGES but not yet given a display name)."""
    if not code:
        return None
    return LANGUAGE_DISPLAY_NAMES.get(code, code)
