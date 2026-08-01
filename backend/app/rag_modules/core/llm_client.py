"""Standalone Gemini streaming client for the RAG platform.

This is a deliberate small (~intentional) duplicate of
app/services/gemini_service.py's model-fallback-chain + streaming-loop
pattern — not an import of that file. gemini_service.py carries a large
TOOL_REGISTRY of unrelated ERP-wide tools (production status, leave
balance, ...) that don't apply to document Q&A; copying the stable
constants+loop shape avoids a cross-cutting dependency between two
otherwise-unrelated systems. Reuses the same GEMINI_API_KEY/GEMINI_MODEL
env vars already configured for the rest of the app."""

import logging
import os
import sys
import time
from typing import Callable, Dict, Iterator, List, Optional

log = logging.getLogger(__name__)

GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()

GEMINI_MODEL_FALLBACKS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-flash-latest",
    # "-lite" models measurably struggle with this assistant's core job —
    # calling a pricing/lookup tool instead of asking another clarifying
    # question, even when the prompt explicitly says not to (confirmed via
    # AIChatHistory.MODEL_NAME on real failing turns: every one was served
    # by a "-lite" model, never a full one). Kept last, not removed, so a
    # customer still gets an answer on a day every full model is exhausted
    # rather than no answer at all.
    "gemini-2.5-flash-lite",
]

_user_model = (os.getenv("GEMINI_MODEL", "") or "").strip()

if _user_model:

    GEMINI_MODEL_FALLBACKS = (
        [_user_model] + [m for m in GEMINI_MODEL_FALLBACKS if m != _user_model]
    )

DEFAULT_MODEL = GEMINI_MODEL_FALLBACKS[0]

# Self-healing safety net: if every hardcoded model above fails (e.g. Google
# deprecates/renames one), ask the live API what this key can actually use
# right now instead of just giving up. Cached for a while so this never adds
# latency to the common case — it only runs once every static model has
# already failed.
_DISCOVERY_CACHE_TTL = 3600  # seconds
_discovery_cache = {"models": None, "fetched_at": 0.0}


def _discover_available_models():

    now = time.monotonic()

    if _discovery_cache["models"] is not None and (now - _discovery_cache["fetched_at"]) < _DISCOVERY_CACHE_TTL:

        return _discovery_cache["models"]

    try:

        import google.generativeai as genai

        genai.configure(api_key=GEMINI_API_KEY)

        # Names to reject outright even though they'd otherwise pass the
        # flash/pro substring test below — these support generateContent but
        # are specialized non-text-chat variants (TTS, image generation,
        # computer-use/robotics agents, tool-calling experiments) wrong for
        # this assistant.
        _EXCLUDED_SUBSTRINGS = ("-tts", "-image", "-computer-use", "-robotics-er", "-customtools")

        discovered = []

        for m in genai.list_models():

            methods = getattr(m, "supported_generation_methods", None) or []

            if "generateContent" not in methods:

                continue

            name = m.name.split("/")[-1]

            if not name.startswith("gemini-"):

                continue  # excludes gemma/lyria/nano-banana/deep-research/antigravity, etc.

            if any(bad in name for bad in _EXCLUDED_SUBSTRINGS):

                continue

            if "flash" in name or "pro" in name:

                discovered.append(name)

        # Prefer stable, full-capability models over reduced/experimental
        # ones — under quota pressure some flagship models may be
        # unavailable, but whatever IS available should be tried in order of
        # capability, not raw catalog order.
        discovered.sort(key=lambda n: ("-preview" in n, "-lite" in n))

        _discovery_cache["models"] = discovered

        _discovery_cache["fetched_at"] = now

        return discovered

    except Exception:

        return []


def _try_model(genai, name, model_kwargs, gemini_history, user_message):
    """One attempt against one model name. Returns (chat, response) on
    success; raises on failure (caller decides how to record/continue)."""

    model_kwargs = dict(model_kwargs, model_name=name)

    model = genai.GenerativeModel(**model_kwargs)

    chat = model.start_chat(history=gemini_history)

    response = chat.send_message(user_message)

    return chat, response


def is_configured() -> bool:

    return bool(GEMINI_API_KEY)


def stream_answer(
    system_prompt: str,
    user_message: str,
    history: Optional[List[Dict]] = None,
    tools: Optional[List[Dict]] = None,
    tool_resolver: Optional[Callable[[str, Dict], Dict]] = None,
    max_tool_rounds: int = 4,
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
    gemini_service.py's existing shape.

    max_tool_rounds counts sequential dispatch BATCHES, not individual tool
    calls (Gemini can request several tools in one batch) — default 4 gives
    headroom for one lookup-recovery round (e.g. a name that needs a
    did_you_mean retry) plus the two-step resolve-then-act business chain
    plus one round of the model's own multi-tool chaining habits, while
    costing nothing extra in the common single-tool-call turn (the loop
    still breaks the instant a response has no pending function calls)."""

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

    tried = set()

    for name in GEMINI_MODEL_FALLBACKS:

        tried.add(name)

        try:

            chat, response = _try_model(genai, name, model_kwargs, gemini_history, user_message)

            used_model = name

            break

        except Exception as e:

            attempt_errors.append(f"{name}: {type(e).__name__}: {e}")

            continue

    if response is None:

        # Every hardcoded model failed — ask the live API what this key can
        # actually use right now rather than giving up (see
        # _discover_available_models's docstring above).
        for name in _discover_available_models():

            if name in tried:

                continue

            tried.add(name)

            try:

                chat, response = _try_model(genai, name, model_kwargs, gemini_history, user_message)

                used_model = name

                break

            except Exception as e:

                attempt_errors.append(f"{name}: {type(e).__name__}: {e}")

                continue

    if response is None:

        detail = "\n  ".join(attempt_errors) or "no models tried"

        raise RuntimeError(
            f"Every Gemini model failed.\n  {detail}\n\n"
            "Update GEMINI_MODEL in backend/.env, or check GEMINI_API_KEY / quota."
        )

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

        else:

            # Loop exhausted every round with a function call still pending —
            # response.text below will likely be empty. Log it so this
            # failure mode is never silently invisible behind the generic
            # apology again.
            log.warning(
                "Gemini tool-calling loop exhausted %s round(s) with a function "
                "call still pending for model %s", max_tool_rounds, used_model
            )

    final_text = ""

    try:

        final_text = response.text or ""

    except Exception:

        final_text = ""

    if not final_text:

        # Gemini can complete "successfully" with no usable text (e.g. an
        # aborted/malformed function-call attempt) — never let that reach
        # the caller as a silent empty reply.
        final_text = (
            "I'm sorry, I couldn't come up with an answer for that just now — "
            "could you try rephrasing, or ask something else?"
        )

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
