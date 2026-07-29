"""Standalone Gemini streaming client for the RAG platform.

This is a deliberate small (~intentional) duplicate of
app/services/gemini_service.py's model-fallback-chain + streaming-loop
pattern — not an import of that file. gemini_service.py carries a large
TOOL_REGISTRY of unrelated ERP-wide tools (production status, leave
balance, ...) that don't apply to document Q&A; copying the stable
constants+loop shape avoids a cross-cutting dependency between two
otherwise-unrelated systems. Reuses the same GEMINI_API_KEY/GEMINI_MODEL
env vars already configured for the rest of the app."""

import os
import sys
import time
from typing import Dict, Iterator, List, Optional

GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()

GEMINI_MODEL_FALLBACKS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-flash-latest",
]

_user_model = (os.getenv("GEMINI_MODEL", "") or "").strip()

if _user_model:

    GEMINI_MODEL_FALLBACKS = (
        [_user_model] + [m for m in GEMINI_MODEL_FALLBACKS if m != _user_model]
    )

DEFAULT_MODEL = GEMINI_MODEL_FALLBACKS[0]


def is_configured() -> bool:

    return bool(GEMINI_API_KEY)


def stream_answer(
    system_prompt: str,
    user_message: str,
    history: Optional[List[Dict]] = None,
) -> Iterator[Dict]:
    """Yields {"type": "text", "text": ...} chunks as they stream, then a
    final {"type": "meta", "model_name":, "prompt_tokens":,
    "completion_tokens":, "total_tokens":, "response_time": ...} dict.
    Raises RuntimeError with a descriptive message if every fallback model
    fails (mirrors gemini_service.py's error-aggregation behaviour)."""

    if not is_configured():

        raise RuntimeError(
            "GEMINI_API_KEY not configured — set it in backend/.env"
        )

    try:

        import google.generativeai as genai

    except ModuleNotFoundError as e:

        raise RuntimeError(
            "google-generativeai is not installed in the Python interpreter "
            "running this server (" + sys.executable + "). It IS listed in "
            "backend/requirements-ai.txt — this almost always means the "
            "backend was started with the wrong interpreter (e.g. a bare "
            "`python` on PATH) instead of backend/venv/Scripts/python.exe. "
            "Restart with: backend\\venv\\Scripts\\python.exe -m uvicorn "
            "app.main:app --reload"
        ) from e

    genai.configure(api_key=GEMINI_API_KEY)

    gemini_history = []

    for h in (history or []):

        role = h.get("role")

        text = h.get("text", "")

        if role in ("user", "model") and text:

            gemini_history.append({"role": role, "parts": [text]})

    start = time.monotonic()

    attempt_errors = []

    response = None

    used_model = None

    for name in GEMINI_MODEL_FALLBACKS:

        try:

            model = genai.GenerativeModel(model_name=name, system_instruction=system_prompt)

            chat = model.start_chat(history=gemini_history)

            response = chat.send_message(user_message)

            used_model = name

            break

        except Exception as e:

            attempt_errors.append(f"{name}: {type(e).__name__}: {e}")

            continue

    if response is None:

        detail = "\n  ".join(attempt_errors) or "no models tried"

        raise RuntimeError(f"Every Gemini model failed.\n  {detail}")

    final_text = ""

    try:

        final_text = response.text or ""

    except Exception:

        final_text = ""

    for i in range(0, len(final_text), 4):

        yield {"type": "text", "text": final_text[i:i + 4]}

    elapsed = time.monotonic() - start

    usage = getattr(response, "usage_metadata", None)

    prompt_tokens = getattr(usage, "prompt_token_count", None) if usage else None

    completion_tokens = getattr(usage, "candidates_token_count", None) if usage else None

    total_tokens = getattr(usage, "total_token_count", None) if usage else None

    yield {
        "type": "meta",
        "model_name": used_model,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "response_time": round(elapsed, 3),
    }
