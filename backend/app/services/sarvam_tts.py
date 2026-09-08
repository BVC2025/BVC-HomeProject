"""Shared Sarvam AI Bulbul v3 TTS helper.

One function `sarvam_speak(text, language, voice)` used by both the
Recruitment voice agent (HR-facing, RBAC-gated) and the Leave voice
assistant (employee-facing, portal-scoped). Keeping the network call in
one place means any Sarvam-side change — payload shape, model version,
new voice roster — only needs updating here.

Also exposes `detect_language(text)` — a lightweight script sniffer used
when the client says "auto" and we still need to pick a Sarvam language
code. Sarvam's TTS won't infer language from mixed-script text on its
own; picking the right `target_language_code` is what makes a Tamil-word
reply come out in a Tamil-speaker voice instead of an English one
trying to read Tamil phonetically.
"""

from __future__ import annotations

import base64
import json
import os
import re
import urllib.request
import urllib.error
from typing import Optional, Tuple


# ---------------------------------------------------------------------
# Public constants
# ---------------------------------------------------------------------

# Bulbul:v3 female voices we let through. Anything else in the payload
# gets replaced with the env default so the API can't be handed a
# rogue speaker id.
ALLOWED_VOICES = {
    "priya", "pooja", "kavya", "shruti", "ishita", "neha",
    "shreya", "kavitha", "ritu", "simran", "roopa", "tanya",
    "suhani",
}

# BCP-47 → Sarvam target-language-code map. Same string in most cases;
# kept explicit so any Sarvam-side rename stays local to this file.
SARVAM_LANG_MAP = {
    "en-IN": "en-IN",
    "en-US": "en-IN",     # Sarvam has no en-US; fall back to en-IN
    "ta-IN": "ta-IN",
    "hi-IN": "hi-IN",
    "kn-IN": "kn-IN",
    "te-IN": "te-IN",
    "ml-IN": "ml-IN",
    "mr-IN": "mr-IN",
    "bn-IN": "bn-IN",
    "gu-IN": "gu-IN",
    "pa-IN": "pa-IN",
    "od-IN": "od-IN",
}


# ---------------------------------------------------------------------
# Language / script detection
# ---------------------------------------------------------------------

_TAMIL_RE      = re.compile(r"[஀-௿]")   # Tamil script
_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")   # Hindi / Marathi
_KANNADA_RE    = re.compile(r"[ಀ-೿]")
_TELUGU_RE     = re.compile(r"[ఀ-౿]")
_MALAYALAM_RE  = re.compile(r"[ഀ-ൿ]")
_BENGALI_RE    = re.compile(r"[ঀ-৿]")

# Rough Thanglish sniffer — Tamil words in Latin script. If none of the
# Indic scripts hit and the text is mostly Latin but contains any of
# these markers, we treat it as Tamil so Sarvam picks a Tamil voice
# that pronounces "vanakkam" correctly instead of an English voice
# saying "van-ack-am".
_THANGLISH_MARKERS = re.compile(
    r"\b(naan|naanga|neenga|ipo|adhu|idhu|enna|pandra|panra|panra|"
    r"vanakkam|paakalam|pesalam|iruken|solren|solriya|venum|venaam|"
    r"varen|varra|varum|romba|konjam|innaikku|naalaiku|leave|panuvom)\b",
    re.IGNORECASE,
)


def detect_language(text: str, fallback: str = "en-IN") -> str:
    """Return a Sarvam-compatible language code for `text`.

    Order matters — check the most specific scripts first. `fallback`
    is what we return if nothing matches (usually en-IN).
    """
    if not text:
        return fallback

    if _TAMIL_RE.search(text):      return "ta-IN"
    if _DEVANAGARI_RE.search(text): return "hi-IN"
    if _KANNADA_RE.search(text):    return "kn-IN"
    if _TELUGU_RE.search(text):     return "te-IN"
    if _MALAYALAM_RE.search(text):  return "ml-IN"
    if _BENGALI_RE.search(text):    return "bn-IN"

    if _THANGLISH_MARKERS.search(text):
        return "ta-IN"

    return fallback


# ---------------------------------------------------------------------
# TTS call
# ---------------------------------------------------------------------

class SarvamError(Exception):
    """Raised when Sarvam TTS is unreachable, misconfigured, or returns
    a payload we can't decode. The caller (a FastAPI route) is expected
    to turn this into a 502/503 HTTPException."""


def sarvam_speak(
    text: str,
    language: Optional[str] = "en-IN",
    voice: Optional[str] = None,
) -> Tuple[bytes, str, str]:
    """Synthesize `text` in Sarvam's Bulbul v3 female voice.

    Returns (wav_bytes, resolved_voice, resolved_language). The caller
    is responsible for choosing whether to stream this as an
    `audio/wav` response or persist it.

    Raises `SarvamError` on any failure — API key missing, network
    down, HTTP error, or unparseable payload.
    """
    text = (text or "").strip()
    if not text:
        raise SarvamError("text is required")

    # Sarvam has a ~500-char soft cap per request; trim on a sentence
    # boundary so mid-word cuts don't leave a garbled tail.
    if len(text) > 500:
        cut = text[:500].rsplit(".", 1)[0] or text[:500]
        text = (cut + "…").strip()

    api_key = os.getenv("SARVAM_API_KEY", "").strip()
    if not api_key:
        raise SarvamError(
            "SARVAM_API_KEY not set — voice output disabled."
        )

    resolved_lang = SARVAM_LANG_MAP.get(language or "en-IN", "en-IN")

    body_voice = (voice or "").strip().lower()
    resolved_voice = (
        body_voice if body_voice in ALLOWED_VOICES
        else (os.getenv("SARVAM_VOICE", "pooja").strip() or "pooja")
    )
    model = os.getenv("SARVAM_MODEL", "bulbul:v3").strip() or "bulbul:v3"

    payload_new = {
        "text": text,
        "target_language_code": resolved_lang,
        "speaker": resolved_voice,
        "pitch": 0,
        "pace": 1.0,
        "loudness": 1.15,
        "speech_sample_rate": 22050,
        "enable_preprocessing": True,
        "model": model,
    }
    payload_legacy = {
        "inputs": [text],
        "target_language_code": resolved_lang,
        "speaker": resolved_voice,
        "pitch": 0,
        "pace": 1.0,
        "loudness": 1.15,
        "speech_sample_rate": 22050,
        "enable_preprocessing": True,
        "model": model,
    }

    data, err = _post_sarvam(api_key, payload_new)
    if err and "400" in (err or ""):
        data, err = _post_sarvam(api_key, payload_legacy)

    if err:
        raise SarvamError(f"Sarvam TTS · {err}")
    if not data:
        raise SarvamError("Sarvam TTS returned no data")

    audios = data.get("audios") or []
    if not audios:
        raise SarvamError(
            f"Sarvam TTS returned no audio. Full response: "
            f"{json.dumps(data)[:400]}"
        )

    try:
        wav_bytes = base64.b64decode(audios[0])
    except Exception:
        raise SarvamError("Sarvam TTS payload was not valid base64")

    return wav_bytes, resolved_voice, resolved_lang


def _post_sarvam(api_key: str, payload: dict):
    req = urllib.request.Request(
        "https://api.sarvam.ai/text-to-speech",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "api-subscription-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data, None
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")[:500]
        except Exception:
            pass
        return None, f"HTTP {e.code} · {body or str(e)}"
    except (urllib.error.URLError, TimeoutError, Exception) as e:
        return None, f"unreachable · {e}"
