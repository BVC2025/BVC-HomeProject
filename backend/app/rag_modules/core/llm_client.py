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
from typing import Callable, Dict, Iterator, List, Optional

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
    tools: Optional[List[Dict]] = None,
    tool_resolver: Optional[Callable[[str, Dict], Dict]] = None,
    max_tool_rounds: int = 2,
) -> Iterator[Dict]:
    """Yields {"type": "text", "text": ...} chunks as they stream, then a
    final {"type": "meta", "model_name":, "prompt_tokens":,
    "completion_tokens":, "total_tokens":, "response_time": ...} dict.
    Raises RuntimeError with a descriptive message if every fallback model
    fails (mirrors gemini_service.py's error-aggregation behaviour).

    tools/tool_resolver are optional, additive, backward-compatible params:
    when tools is falsy this function's control flow is identical to before
    they existed. When both are provided, a bounded Gemini function-calling
    loop runs first (shape lifted from services/gemini_service.py's proven
    stream_chat implementation) — tool_resolver(name, args) is called for
    each requested tool and must return a JSON-safe dict; any exception it
    raises is caught here and turned into {"error": str(exc)} so a broken
    tool degrades the answer rather than crashing the turn. Also yields
    {"type": "tool", "name":, "args":} frames for observability, matching
    gemini_service.py's existing shape."""

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

    model_kwargs = {"model_name": None, "system_instruction": system_prompt}
    if tools:
        model_kwargs["tools"] = [{"function_declarations": tools}]

    start = time.monotonic()

    attempt_errors = []

    response = None

    chat = None

    used_model = None

    for name in GEMINI_MODEL_FALLBACKS:

        try:

            model_kwargs["model_name"] = name

            model = genai.GenerativeModel(**model_kwargs)

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

    if tools and tool_resolver:

        for _ in range(max(1, max_tool_rounds)):

            fn_calls = []

            try:

                for part in response.candidates[0].content.parts:

                    if part.function_call and part.function_call.name:

                        fn_calls.append(part.function_call)

            except (IndexError, AttributeError):

                fn_calls = []

            if not fn_calls:

                break

            tool_response_parts = []

            for fc in fn_calls:

                tool_name = fc.name

                args = dict(fc.args) if fc.args else {}

                yield {"type": "tool", "name": tool_name, "args": args}

                try:

                    result = tool_resolver(tool_name, args)

                except Exception as e:

                    result = {"error": str(e)}

                tool_response_parts.append(
                    genai.protos.Part(
                        function_response=genai.protos.FunctionResponse(
                            name=tool_name, response={"result": result}
                        )
                    )
                )

            response = chat.send_message(genai.protos.Content(parts=tool_response_parts))

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
