"""Language-selection support for the WhatsApp welcome flow's quick-reply
buttons (e.g. "English" / "தமிழ்" on the lead_welcome template). Deliberately
a small, standalone map rather than baked into whatsapp_inbound_service.py —
adding a new supported language is one entry in each dict below, nothing
else in the codebase needs to change.

This module only maps an already-tapped button's title text to a language
code; it never guesses a language from free-typed text (see
whatsapp_inbound_service._store_inbound_message for why: a button tap is a
100%-reliable explicit signal, free text is not)."""

from typing import Optional

# Button title (lowercased, stripped) -> language code. Extend here to
# support a new welcome-template language button.
LANGUAGE_BUTTON_LABELS = {
    "english": "en",
    "தமிழ்": "ta",
}

# Language code -> human-readable name, used only to phrase the AI's
# soft-default language instruction (see whatsapp_inbound_service.run_ai_turn).
LANGUAGE_DISPLAY_NAMES = {
    "en": "English",
    "ta": "Tamil",
}


def resolve_language_from_button_title(title: Optional[str]) -> Optional[str]:
    """Returns the language code for a tapped button's title, or None if the
    title doesn't match a known language-selection button (e.g. it was some
    other quick-reply button, not a language choice)."""
    if not title:
        return None
    return LANGUAGE_BUTTON_LABELS.get(title.strip().lower())


def language_display_name(code: Optional[str]) -> Optional[str]:
    """Human-readable name for a stored language code, falling back to the
    raw code itself if it's not in the display-name map (e.g. a code was
    added to LANGUAGE_BUTTON_LABELS but not yet given a display name)."""
    if not code:
        return None
    return LANGUAGE_DISPLAY_NAMES.get(code, code)
