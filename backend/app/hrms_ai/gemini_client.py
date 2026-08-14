"""
Thin wrapper around google-generativeai for the HRMS AI module.

Isolated from the older gemini_service.py so this module has zero
dependency on the deleted chatbot code. Provides three primitives:

  embed_text(texts)        -> list[list[float]]
  chat(messages, temp)     -> str
  chat_yes_no(prompt)      -> bool  (grounding check)

Configuration comes from environment variables:
  GEMINI_API_KEY      required
  GEMINI_MODEL        default gemini-2.0-flash
  GEMINI_EMBED_MODEL  default text-embedding-004
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Iterable, List, Optional

# Ensure backend/.env is loaded even when this module is imported by
# a standalone script (e.g. `python -m app.hrms_ai.knowledge_builder`).
# The FastAPI app already calls load_dotenv() at startup, so the extra
# call here is a no-op for the running server.
try:
    from dotenv import load_dotenv as _load_dotenv
    _HERE = Path(__file__).resolve().parent           # backend/app/hrms_ai
    _BACKEND_ENV = _HERE.parent.parent / ".env"        # backend/.env
    if _BACKEND_ENV.exists():
        _load_dotenv(_BACKEND_ENV, override=False)
    else:
        _load_dotenv(override=False)                   # fall back to CWD lookup
except Exception:
    # python-dotenv isn't installed OR the file is unreadable — the
    # env var may still be set by the shell; getenv() below handles it.
    pass


log = logging.getLogger("hrms_ai.gemini")


# =====================================================================
# Config
# =====================================================================

def _cfg_key() -> str:
    return (os.getenv("GEMINI_API_KEY") or "").strip()


def _cfg_model() -> str:
    return (os.getenv("GEMINI_MODEL") or "gemini-2.0-flash").strip()


def _cfg_embed_model() -> str:
    return (os.getenv("GEMINI_EMBED_MODEL") or "text-embedding-004").strip()


def is_configured() -> bool:
    return bool(_cfg_key())


# =====================================================================
# Lazy client — imported only when actually used so a system without
# google-generativeai still boots (endpoints will 503, but the rest
# of the ERP keeps running).
# =====================================================================

_genai = None


def _client():
    global _genai
    if _genai is None:
        try:
            import google.generativeai as genai
        except ImportError as e:
            raise RuntimeError(
                "google-generativeai is not installed. "
                "Run: pip install google-generativeai"
            ) from e

        key = _cfg_key()
        if not key:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Add it to backend/.env "
                "(get a free key at https://aistudio.google.com/apikey)."
            )
        # New AQ.-prefixed API keys hit "ACCESS_TOKEN_TYPE_UNSUPPORTED"
        # on the default gRPC transport of the deprecated
        # google-generativeai package. Forcing REST bypasses the
        # OAuth-style auth check and just sends the key in the header.
        try:
            genai.configure(api_key=key, transport="rest")
        except TypeError:
            # older versions don't accept the transport kwarg
            genai.configure(api_key=key)
        _genai = genai
    return _genai


# =====================================================================
# Embeddings
# =====================================================================

def embed_text(texts: Iterable[str], task_type: str = "RETRIEVAL_DOCUMENT") -> List[List[float]]:
    """Embed a batch of strings. task_type is either
    RETRIEVAL_DOCUMENT (indexing) or RETRIEVAL_QUERY (searching)."""

    g = _client()
    model = _cfg_embed_model()
    out: List[List[float]] = []
    for t in texts:
        if not t or not t.strip():
            # placeholder zero-vector; retrieval will never match it
            out.append([0.0] * 768)
            continue
        try:
            resp = g.embed_content(
                model=f"models/{model}",
                content=t,
                task_type=task_type,
            )
            emb = resp.get("embedding") if isinstance(resp, dict) else getattr(resp, "embedding", None)
            if emb is None:
                emb = [0.0] * 768
            out.append(list(emb))
        except Exception as e:
            log.warning("embed_text failed for chunk (len=%d): %s", len(t), e)
            out.append([0.0] * 768)
    return out


# =====================================================================
# Chat
# =====================================================================

def chat(
    messages: List[dict],
    system_instruction: Optional[str] = None,
    temperature: float = 0.2,
    max_output_tokens: int = 1024,
) -> str:
    """messages: [{role: 'user'|'model', parts: [text]}, ...]"""

    g = _client()
    model_id = _cfg_model()

    model = g.GenerativeModel(
        model_name=model_id,
        system_instruction=system_instruction,
        generation_config={
            "temperature": temperature,
            "max_output_tokens": max_output_tokens,
        },
    )

    # Prefer the chat interface so we can pass full turn history
    if len(messages) > 1:
        history = messages[:-1]
        last = messages[-1]
        chat_session = model.start_chat(history=history)
        resp = chat_session.send_message(last["parts"][0] if last.get("parts") else "")
    else:
        text = messages[0]["parts"][0] if messages and messages[0].get("parts") else ""
        resp = model.generate_content(text)

    return (getattr(resp, "text", "") or "").strip()


def chat_yes_no(prompt: str) -> bool:
    """Grounding / verification calls that expect a YES / NO reply.
    Returns True on YES-ish, False otherwise. Never raises."""

    try:
        raw = chat(
            [{"role": "user", "parts": [prompt]}],
            system_instruction=(
                "You are a strict verifier. Reply with only YES or NO. "
                "Do not add any other text."
            ),
            temperature=0.0,
            max_output_tokens=8,
        )
    except Exception as e:
        log.warning("chat_yes_no failed: %s", e)
        return False
    return raw.strip().upper().startswith("Y")
