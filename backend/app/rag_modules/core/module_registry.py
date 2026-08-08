"""Maps a module_code to its per-module prompt/tools file via dynamic
import. This is what lets a future module (Sales, HR, ...) be onboarded
with zero core-engine changes: drop a
backend/app/rag_modules/<code>_rag_module/prompts.py file and it's picked
up automatically."""

import importlib
from typing import List, Optional

from app.rag_modules.core.language_registry import language_display_name

_DEFAULT_SYSTEM_PROMPT = (
    "You are an AI assistant answering questions using ONLY the context "
    "chunks provided below, retrieved from the knowledge base. If the "
    "answer isn't in the provided context, say so honestly instead of "
    "guessing or inventing information."
)


def get_system_prompt(module_code: str, preferred_language: Optional[str] = None) -> str:
    """preferred_language is optional and additive: omit it (or pass None)
    for byte-identical behavior to before. Any module/channel that already
    knows the customer's confirmed language preference (today: the
    WhatsApp welcome flow's language button) gets a "reply in that
    language by default" instruction appended for free, with zero
    per-module prompt duplication — a future module/channel wanting the
    same behavior just needs to pass a language code here."""

    try:

        mod = importlib.import_module(
            f"app.rag_modules.{module_code}_rag_module.prompts"
        )

        prompt = getattr(mod, "SYSTEM_PROMPT", _DEFAULT_SYSTEM_PROMPT)

    except ModuleNotFoundError:

        prompt = _DEFAULT_SYSTEM_PROMPT

    if preferred_language:

        label = language_display_name(preferred_language)

        prompt += (
            f"\n\nThe customer has confirmed their preferred language is {label} "
            f"(selected via the welcome message's language button). Reply in {label} "
            f"by default — but if the customer clearly writes in a different language, "
            f"follow their lead and reply in that language instead, exactly as you "
            f"already do today."
        )

    return prompt


def get_tools(module_code: str) -> List:
    """Future function-calling tools for this module, if any. Empty list
    if the module has no tools.py or no TOOLS list yet."""

    try:

        mod = importlib.import_module(
            f"app.rag_modules.{module_code}_rag_module.tools"
        )

        return getattr(mod, "TOOLS", [])

    except ModuleNotFoundError:

        return []


def get_tool_resolver(module_code: str):
    """The module's resolve(name, args, db, context) dispatch function, if
    it has one — None if the module has no tools.py or no resolve()
    defined (e.g. the internal "lead" module, whose tools.py is
    intentionally still TOOLS = [] with no resolve())."""

    try:

        mod = importlib.import_module(
            f"app.rag_modules.{module_code}_rag_module.tools"
        )

        return getattr(mod, "resolve", None)

    except ModuleNotFoundError:

        return None
