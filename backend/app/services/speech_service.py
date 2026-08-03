"""Offline TTS via Piper — ported from a reference desktop app's
backend/services/speech_service.py. Model loading, the language-folder
convention, and the "still warming up" contract are preserved as-is. What
does NOT carry over: server-side playback (that reference plays audio via
Windows' winsound, since its backend and the user's speakers are the same
machine) and the queue/worker-thread that made playback sequential — in
this web deployment, playback happens in the requesting user's own browser,
so this service's only job is synthesis: text (+ language) in, WAV bytes
out. "Never overlapping" is a client concern (frontend/src/hooks/useSpeech.js).
"""

import glob
import io
import logging
import os
import threading
import wave

from piper import PiperVoice

from app.rag_modules.core.language_registry import SUPPORTED_LANGUAGES

logger = logging.getLogger("uvicorn")


class SpeechServiceUnavailable(Exception):
    """Raised when speak() is called for a language whose model hasn't
    finished loading (or is missing entirely)."""


def _models_dir() -> str:

    # This file: backend/app/services/speech_service.py
    # parent.parent.parent = backend/ -> backend/tts/models
    return os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tts", "models")
    )


def _find_model(models_dir: str, language: str):

    candidates = sorted(glob.glob(os.path.join(models_dir, language, "*.onnx")))

    return candidates[0] if candidates else None


class SpeechService:

    def __init__(self):

        self._voices = {}

        self._voice_locks = {lang: threading.Lock() for lang in SUPPORTED_LANGUAGES}

        self._initialized = False

    def initialize(self):
        """Call once at FastAPI startup. Non-blocking — loading happens on
        a background thread so ~2x60MB ONNX loads never delay server boot."""

        if self._initialized:

            return

        self._initialized = True

        threading.Thread(target=self._load_voices, daemon=True).start()

    def _load_voices(self):

        models_dir = _models_dir()

        for language in SUPPORTED_LANGUAGES:

            model_path = _find_model(models_dir, language)

            if not model_path:

                logger.warning(
                    "speech_service: no .onnx model for '%s' under %s -- "
                    "requests for this language will 503 until a model is added "
                    "(see backend/tts/README.md).",
                    language, os.path.join(models_dir, language),
                )

                continue

            try:

                self._voices[language] = PiperVoice.load(model_path)

                logger.info("speech_service: loaded '%s' voice from %s", language, model_path)

            except Exception:

                logger.exception("speech_service: failed to load '%s' voice", language)

    def is_ready(self, language: str) -> bool:

        return language in self._voices

    def speak(self, text: str, language: str) -> bytes:

        if not text or not text.strip():

            raise ValueError("speak() requires non-empty 'text'")

        if language not in SUPPORTED_LANGUAGES:

            raise ValueError(f"Unsupported language '{language}' (expected one of {SUPPORTED_LANGUAGES})")

        voice = self._voices.get(language)

        if voice is None:

            raise SpeechServiceUnavailable(
                f"'{language}' voice is still loading or unavailable -- try again shortly."
            )

        with self._voice_locks[language]:

            buffer = io.BytesIO()

            with wave.open(buffer, "wb") as wav_file:

                voice.synthesize_wav(text, wav_file)

            return buffer.getvalue()


speech_service = SpeechService()
