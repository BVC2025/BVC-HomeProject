"""Maps a module_code to its per-module prompt/tools file via dynamic
import. This is what lets a future module (Sales, HR, ...) be onboarded
with zero core-engine changes: drop a
backend/app/rag_modules/<code>_rag_module/prompts.py file and it's picked
up automatically."""

import importlib
from typing import List

_DEFAULT_SYSTEM_PROMPT = (
    "You are an AI assistant answering questions using ONLY the context "
    "chunks provided below, retrieved from the knowledge base. If the "
    "answer isn't in the provided context, say so honestly instead of "
    "guessing or inventing information."
)


def get_system_prompt(module_code: str) -> str:

    try:

        mod = importlib.import_module(
            f"app.rag_modules.{module_code}_rag_module.prompts"
        )

        return getattr(mod, "SYSTEM_PROMPT", _DEFAULT_SYSTEM_PROMPT)

    except ModuleNotFoundError:

        return _DEFAULT_SYSTEM_PROMPT


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
