"""Self-hosted LLM client for the RAG platform — talks to a local Ollama
server (e.g. running Qwen3) instead of a cloud API. Same public shape as
llm_client.py (Gemini) so chat_orchestrator.run_chat() can swap between
them per-module based on AIModule.LLM_PROVIDER without any other code
caring which one actually answered.

No tool-calling in this first version (tools/tool_resolver are accepted
for signature compatibility but ignored) — see erp_assistant_rag_module/
tools.py's docstring. A future version can add Ollama's own tool-calling
API (same request shape as OpenAI's, which several Qwen releases support)
without changing this function's signature.
"""

import json
import logging
import os
import time
from typing import Callable, Dict, Iterator, List, Optional

import requests

log = logging.getLogger(__name__)

OLLAMA_BASE_URL = (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")

OLLAMA_MODEL = (os.getenv("OLLAMA_MODEL") or "qwen3").strip()

# Local server, no cloud latency to hide behind — but a cold model load
# (first request after Ollama starts) can genuinely take a while, so this
# is generous rather than tight.
_REQUEST_TIMEOUT_SECONDS = 120


def is_configured() -> bool:
    """Ollama itself doesn't need an API key — "configured" here just
    means a base URL is set, which it always is (has a default). Actual
    reachability is only known once a request is attempted; see
    stream_answer()'s error message for that case."""

    return bool(OLLAMA_BASE_URL)


def _role_for_ollama(role: str) -> str:
    """This platform's history uses {"role": "user"|"model", ...}
    (Gemini's naming) — Ollama/OpenAI-style APIs use "assistant" instead
    of "model"."""

    return "assistant" if role == "model" else "user"


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
    "completion_tokens":, "total_tokens":, "response_time": ...} dict —
    identical shape to llm_client.stream_answer(), see that function's
    docstring for the full contract. Raises RuntimeError with a
    descriptive message if Ollama can't be reached or errors."""

    messages = [{"role": "system", "content": system_prompt}]

    for h in (history or []):

        role = h.get("role")

        text = h.get("text", "")

        if role in ("user", "model") and text:

            messages.append({"role": _role_for_ollama(role), "content": text})

    messages.append({"role": "user", "content": user_message})

    start = time.monotonic()

    try:

        resp = requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={"model": OLLAMA_MODEL, "messages": messages, "stream": True},
            stream=True,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )

        resp.raise_for_status()

    except requests.exceptions.ConnectionError as e:

        raise RuntimeError(
            f"Could not reach Ollama at {OLLAMA_BASE_URL} — is it running? "
            f"(Install: https://ollama.com/download, then `ollama pull {OLLAMA_MODEL}`.)"
        ) from e

    except requests.exceptions.RequestException as e:

        raise RuntimeError(f"Ollama request failed: {e}") from e

    final_text_parts = []

    prompt_tokens = None

    completion_tokens = None

    try:

        for raw_line in resp.iter_lines(decode_unicode=True):

            if not raw_line:

                continue

            try:

                frame = json.loads(raw_line)

            except json.JSONDecodeError:

                continue

            if frame.get("error"):

                raise RuntimeError(f"Ollama error: {frame['error']}")

            chunk = (frame.get("message") or {}).get("content") or ""

            if chunk:

                final_text_parts.append(chunk)

                yield {"type": "text", "text": chunk}

            if frame.get("done"):

                prompt_tokens = frame.get("prompt_eval_count")

                completion_tokens = frame.get("eval_count")

                break

    except requests.exceptions.RequestException as e:

        raise RuntimeError(f"Ollama streaming failed mid-response: {e}") from e

    if not final_text_parts:

        yield {
            "type": "text",
            "text": (
                "I'm sorry, I couldn't come up with an answer for that just now — "
                "could you try rephrasing, or ask something else?"
            ),
        }

    elapsed = time.monotonic() - start

    total_tokens = (
        (prompt_tokens or 0) + (completion_tokens or 0)
        if prompt_tokens is not None or completion_tokens is not None
        else None
    )

    yield {
        "type": "meta",
        "model_name": OLLAMA_MODEL,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "response_time": round(elapsed, 3),
    }
