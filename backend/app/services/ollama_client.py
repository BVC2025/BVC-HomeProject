"""
Minimal HTTP client for a locally-running Ollama daemon.

Ollama defaults to http://localhost:11434 and exposes two endpoints we
use:

  POST /api/embeddings   { model, prompt }       → { embedding: [...] }
  POST /api/generate     { model, prompt, ... }  → { response: str, ... }

Everything is best-effort — if the daemon isn't running, we return None
so the caller can fall back gracefully. No hard dependency on `requests`
or `httpx`: we use urllib to keep the AI stack install-free.
"""

from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional


# =====================================================================
# Configuration — read from env with sensible defaults
# =====================================================================


def _cfg() -> Dict[str, Any]:

    return {
        "url":         os.getenv("OLLAMA_URL",         "http://localhost:11434").rstrip("/"),
        "chat_model":  os.getenv("OLLAMA_CHAT_MODEL",  "phi3:mini"),
        "embed_model": os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
        "timeout_sec": int(os.getenv("OLLAMA_TIMEOUT_SEC", "60")),
    }


def is_configured() -> bool:
    """We assume Ollama is desired if the env vars point anywhere. The
    actual reachability check happens on the first call — cheaper than
    pinging on every request."""

    return True


# =====================================================================
# Low-level HTTP helpers
# =====================================================================


def _post_json(path: str, payload: Dict[str, Any], timeout: int) -> Optional[Dict[str, Any]]:
    """POST JSON, return parsed JSON or None on any failure. Never
    raises — network hiccups + daemon-not-running are expected."""

    cfg = _cfg()
    url = cfg["url"] + path

    body = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:

        with urllib.request.urlopen(req, timeout=timeout) as resp:

            raw = resp.read().decode("utf-8")

            return json.loads(raw)

    except urllib.error.URLError:

        # Daemon not running / DNS / socket
        return None

    except (urllib.error.HTTPError, ValueError, json.JSONDecodeError):

        # HTTP 4xx/5xx or bad JSON — treat as unavailable
        return None


def _get_json(path: str, timeout: int = 5) -> Optional[Dict[str, Any]]:

    cfg = _cfg()
    url = cfg["url"] + path

    try:

        with urllib.request.urlopen(url, timeout=timeout) as resp:

            return json.loads(resp.read().decode("utf-8"))

    except Exception:

        return None


# =====================================================================
# Public API
# =====================================================================


def is_up() -> bool:
    """Cheap probe — /api/version returns quickly if the daemon is alive."""

    return _get_json("/api/version", timeout=3) is not None


def health() -> Dict[str, Any]:
    """Detailed health snapshot for the /ai/chat/health endpoint. Never
    raises — includes what's missing if something is."""

    cfg = _cfg()

    up = is_up()

    tags = _get_json("/api/tags", timeout=3) if up else None

    installed_models: List[str] = []

    if isinstance(tags, dict) and isinstance(tags.get("models"), list):

        installed_models = [m.get("name", "") for m in tags["models"] if isinstance(m, dict)]

    def _has(model_ref: str) -> bool:

        # Ollama tag might be "phi3:mini" or "phi3:latest" — treat
        # anything sharing the base name as installed.
        base = model_ref.split(":")[0].lower()
        return any(name.lower().startswith(base) for name in installed_models)

    return {
        "url":                cfg["url"],
        "reachable":          up,
        "chat_model":         cfg["chat_model"],
        "chat_model_present": _has(cfg["chat_model"]) if up else False,
        "embed_model":        cfg["embed_model"],
        "embed_model_present": _has(cfg["embed_model"]) if up else False,
        "installed_models":   installed_models,
    }


def embed(text: str) -> Optional[List[float]]:
    """Return a dense embedding for `text`, or None if Ollama is down /
    embed model missing / anything else went wrong."""

    text = (text or "").strip()

    if not text:

        return None

    cfg = _cfg()

    result = _post_json(
        "/api/embeddings",
        {"model": cfg["embed_model"], "prompt": text},
        timeout=cfg["timeout_sec"],
    )

    if not result:

        return None

    vec = result.get("embedding")

    if not isinstance(vec, list) or not vec:

        return None

    return [float(x) for x in vec]


def generate(
    prompt: str,
    system: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 512,
    format: Optional[str] = None,
    top_p: Optional[float] = None,
    model: Optional[str] = None,
    timeout: Optional[int] = None,
) -> Optional[str]:
    """Run a single-shot generation. Returns the response text or None.

    `format`      — pass "json" to enable Ollama's grammar-enforced
                    JSON mode. The model will produce valid JSON or
                    Ollama will error. Any other value is passed
                    through unchanged for future formats.
    `top_p`       — nucleus sampling. Only sent when explicitly set.
    `model`       — override the default chat model. Ollama swaps
                    models on-demand, so this lets the resume parser
                    force Qwen 2.5 7B (higher-quality JSON output)
                    while the general chatbot stays on Phi-3 mini.
    `timeout`     — override the default timeout. Longer models like
                    Qwen 7B take ~60-90 sec per resume on CPU.
    """

    prompt = (prompt or "").strip()

    if not prompt:

        return None

    cfg = _cfg()

    options: Dict[str, Any] = {
        "temperature": float(temperature),
        "num_predict": int(max_tokens),
    }

    if top_p is not None:

        options["top_p"] = float(top_p)

    payload: Dict[str, Any] = {
        "model":   model or cfg["chat_model"],
        "prompt":  prompt,
        "stream":  False,
        "options": options,
    }

    if system:

        payload["system"] = system

    if format:

        payload["format"] = format

    result = _post_json(
        "/api/generate",
        payload,
        timeout=timeout if timeout is not None else cfg["timeout_sec"],
    )

    if not result:

        return None

    text = result.get("response")

    if not isinstance(text, str):

        return None

    return text.strip()


def parser_model() -> str:
    """Which Ollama model to use for high-accuracy structured JSON
    extraction (currently the resume parser). Defaults to Qwen 2.5 7B
    because it's noticeably better than Phi-3 mini at structured output,
    even though it's slower on CPU (60-90 sec vs 10-15 sec)."""

    return (os.getenv("OLLAMA_PARSER_MODEL") or "qwen2.5:7b").strip() or "qwen2.5:7b"
