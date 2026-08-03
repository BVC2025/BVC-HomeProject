"""Language-selection support for the WhatsApp welcome flow's quick-reply
buttons (e.g. "English" / "தமிழ்" / "Hindi" / "Malayalam" on the
lead_welcome template). Deliberately a small, standalone map rather than
baked into whatsapp_inbound_service.py — adding a new supported language is
one entry in LANGUAGE_BUTTON_LABELS below (plus a display name in the
shared app.rag_modules.core.language_registry), nothing else in the
codebase needs to change.

This module only maps an already-tapped button's title text to a language
code; it never guesses a language from free-typed text (see
whatsapp_inbound_service._store_inbound_message for why: a button tap is a
100%-reliable explicit signal, free text is not). Display names themselves
live in language_registry.py (the single source of truth shared with TTS
and the /speech/speak endpoint) — this module only owns the WhatsApp/Meta-
specific detail of which button title text maps to which code."""

from typing import Optional

# Button title (lowercased, stripped) -> language code. Extend here to
# support a new welcome-template language button.
LANGUAGE_BUTTON_LABELS = {
    "english": "en",
    "தமிழ்": "ta",
    "hindi": "hi",
    "malayalam": "ml",
}


def resolve_language_from_button_title(title: Optional[str]) -> Optional[str]:
    """Returns the language code for a tapped button's title, or None if the
    title doesn't match a known language-selection button (e.g. it was some
    other quick-reply button, not a language choice)."""
    if not title:
        return None
    return LANGUAGE_BUTTON_LABELS.get(title.strip().lower())
