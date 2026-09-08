"""Optional, better-quality TTS via Kokoro — an alternative to the
existing offline Piper voices (speech_service.py), NOT a replacement.

Kokoro's shipped voices only cover English, Japanese, Mandarin, Spanish,
French, Hindi, Italian, and Brazilian Portuguese — it has no Tamil or
Malayalam voice. Since this ERP's SUPPORTED_LANGUAGES is (en, ta, hi, ml)
and Tamil is this team's primary language, Kokoro is wired in as an
opt-in `engine=kokoro` choice on POST /speech/speak for the languages it
actually supports (en, hi); Tamil/Malayalam requests with engine=kokoro
fall back to Piper in the route layer (see routes/speech.py) rather than
erroring, so a caller can always just ask for "kokoro" and get *a* voice
back.

Lazy-loaded per language on first use (unlike Piper's eager
startup-thread load) — Kokoro's model is heavier and genuinely optional;
most installs won't have `pip install kokoro` done at all, and we don't
want an ImportError at server boot to be fatal for an unrelated feature.
"""

import io
import logging
import threading

logger = logging.getLogger("uvicorn")

# language code (matches app.rag_modules.core.language_registry) -> (Kokoro
# lang_code, default voice). See Kokoro's own voice list for alternatives —
# these are just reasonable, well-reviewed defaults per language.
_KOKORO_LANG_MAP = {
    "en": ("a", "af_heart"),   # American English, "Heart" voice
    "hi": ("h", "hf_alpha"),   # Hindi, "Alpha" voice
}

SUPPORTED_LANGUAGES = tuple(_KOKORO_LANG_MAP.keys())

_SAMPLE_RATE = 24000


class KokoroUnavailable(Exception):
    """Raised when the `kokoro` package isn't installed, or synthesis
    fails for any other reason — callers should treat this the same way
    as SpeechServiceUnavailable (503 / fall back to Piper)."""


class KokoroSpeechService:

    def __init__(self):

        self._pipelines = {}

        self._lock = threading.Lock()

    def is_supported(self, language: str) -> bool:

        return language in _KOKORO_LANG_MAP

    def _get_pipeline(self, language: str):

        if language in self._pipelines:

            return self._pipelines[language]

        with self._lock:

            if language in self._pipelines:

                return self._pipelines[language]

            try:

                from kokoro import KPipeline

            except ImportError as e:

                raise KokoroUnavailable(
                    "Kokoro isn't installed — run `pip install kokoro soundfile` "
                    "(and install the espeak-ng binary) in the backend's Python "
                    "environment, then restart the server."
                ) from e

            lang_code, _voice = _KOKORO_LANG_MAP[language]

            try:

                pipeline = KPipeline(lang_code=lang_code)

            except Exception as e:

                raise KokoroUnavailable(f"Kokoro failed to initialize for '{language}': {e}") from e

            self._pipelines[language] = pipeline

            logger.info("kokoro_speech_service: loaded '%s' pipeline", language)

            return pipeline

    def speak(self, text: str, language: str) -> bytes:

        if not text or not text.strip():

            raise ValueError("speak() requires non-empty 'text'")

        if language not in _KOKORO_LANG_MAP:

            raise ValueError(
                f"Kokoro doesn't support '{language}' (supports {SUPPORTED_LANGUAGES}) — "
                "use engine=piper for this language instead."
            )

        pipeline = self._get_pipeline(language)

        _lang_code, voice = _KOKORO_LANG_MAP[language]

        try:

            import numpy as np
            import soundfile as sf

            chunks = [audio for _gs, _ps, audio in pipeline(text, voice=voice)]

            if not chunks:

                raise KokoroUnavailable("Kokoro produced no audio for this text.")

            full_audio = np.concatenate(chunks)

            buffer = io.BytesIO()

            sf.write(buffer, full_audio, _SAMPLE_RATE, format="WAV")

            return buffer.getvalue()

        except KokoroUnavailable:

            raise

        except Exception as e:

            raise KokoroUnavailable(f"Kokoro synthesis failed: {e}") from e


kokoro_speech_service = KokoroSpeechService()
